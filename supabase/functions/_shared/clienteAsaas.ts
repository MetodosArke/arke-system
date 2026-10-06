/**
 * O aluno como cliente no Asaas, anonimizado na saída (LGPD).
 *
 * Até 06/10/2026 a anonimização apagava a pessoa do banco e deixava o cliente
 * dela no Asaas como estava: na conta da ArkeFit, nome, CPF e celular
 * (matrícula, Método, cobrança avulsa); na conta da academia, também e-mail e
 * endereço (a nota fiscal). Quem exerceu o direito de eliminação seguia
 * identificado no gateway.
 *
 * O que sai e o que fica:
 *   * sai o que é contato e endereço — nome (vira "Pessoa anonimizada"),
 *     e-mail, telefones, e-mails adicionais, endereço, empresa e observações;
 *     e o Asaas para de mandar aviso (`notificationDisabled`);
 *   * fica o CPF: é o que liga as cobranças pagas e as notas já emitidas a
 *     quem pagou, e o Asaas, como instituição de pagamento, guarda o pagador
 *     pelo prazo legal. As cobranças e as notas não são tocadas — a nota
 *     emitida é documento fiscal e não muda;
 *   * na conta da ArkeFit, onde ficam as cobranças, o cliente anonimizado é
 *     também removido (`DELETE /customers/{id}`). A remoção do Asaas não apaga
 *     nada (o cliente fica marcado `deleted` e pode ser restaurado), mantém as
 *     cobranças pagas e tira as que ainda esperavam pagamento — que a saída já
 *     cancelou antes. Sem ela, quem voltasse a se matricular com o mesmo CPF
 *     teria a cobrança nova presa a "Pessoa anonimizada": a matrícula, o
 *     Método e a avulsa reaproveitam o cliente achado pelo CPF sem atualizar;
 *   * na conta da academia o cliente é só anonimizado: as notas dela ficam
 *     onde estão, e a nota seguinte, se houver, atualiza o cadastro.
 *
 * Quem tem outro vínculo vivo (aluna noutra academia, professora aqui):
 *   * a conta da ArkeFit fica como está. O cliente dali é um só por CPF, e
 *     pode ser o da assinatura da outra academia — anonimizar e remover
 *     derrubaria a cobrança viva de lá;
 *   * na conta da academia sai só o cliente com a referência deste aluno; o
 *     achado pelo CPF pode ser o de outro vínculo da pessoa.
 *
 * Sem Deno e sem Supabase, como os `fluxo.ts`: o teste do app exercita este
 * código, e quem chama lê do banco o que entra aqui.
 */

import { ambienteAsaas } from "./asaas.ts";
import { chaveCombinaComAmbiente } from "../nfse-emitir/fluxo.ts";

export const NOME_ANONIMIZADO = "Pessoa anonimizada";

/** Prazo de cada chamada: um Asaas lento não segura a saída do aluno. */
const PRAZO_MS = 20_000;

/** O cadastro que substitui o do aluno. Vazio limpa o campo no Asaas. */
export const CADASTRO_ANONIMO = {
  name: NOME_ANONIMIZADO,
  email: "",
  additionalEmails: "",
  phone: "",
  mobilePhone: "",
  postalCode: "",
  address: "",
  addressNumber: "",
  complement: "",
  province: "",
  company: "",
  observations: "",
  notificationDisabled: true,
};

/** Os campos que identificam e precisam voltar vazios na resposta do Asaas. */
export const CAMPOS_QUE_SAEM = [
  "email",
  "additionalEmails",
  "phone",
  "mobilePhone",
  "postalCode",
  "address",
  "addressNumber",
  "complement",
  "province",
  "company",
  "observations",
] as const;

export type ClienteAsaas = {
  id: string;
  deleted?: boolean;
  name?: string | null;
  cpfCnpj?: string | null;
  externalReference?: string | null;
  notificationDisabled?: boolean;
  [campo: string]: unknown;
};

export type ContaAsaas = {
  /** "arkefit" (as cobranças) ou "academia" (a nota fiscal). */
  nome: "arkefit" | "academia";
  api: string;
  chave: string;
  /** Remove o cliente depois de anonimizar (só na conta das cobranças). */
  remover: boolean;
  /** Procura também pelo CPF (só quando a pessoa não tem outro vínculo vivo). */
  porCpf: boolean;
};

type Resposta<T> = { ok: boolean; status: number; corpo: T & { errors?: { description?: string }[] } };

/** Falha de rede ou prazo esgotado: o Asaas pode ter feito o que se pediu. */
export class FalhaDeRede extends Error {}

async function chamar<T>(conta: ContaAsaas, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta<T>> {
  let resp: Response;
  try {
    resp = await fetch(`${conta.api}${caminho}`, {
      method: metodo,
      headers: { access_token: conta.chave, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(PRAZO_MS),
    });
  } catch (e) {
    // Só o nome do erro (TimeoutError, TypeError): nada da pessoa vai junto.
    const nome = (e as { name?: unknown } | null)?.name;
    throw new FalhaDeRede(typeof nome === "string" && nome ? nome : "falha de rede");
  }
  let json: unknown = {};
  try {
    json = await resp.json();
  } catch {
    // corpo vazio ou não-JSON: fica {}.
  }
  return { ok: resp.ok, status: resp.status, corpo: json as Resposta<T>["corpo"] };
}

function descricaoErro(corpo: { errors?: { description?: string }[] }): string | null {
  return corpo?.errors?.map((e) => e.description).filter(Boolean).join(" ") || null;
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * Os clientes do aluno numa conta, sem os já removidos. Cada busca confere o
 * que voltou contra o filtro pedido: filtro que o Asaas não aplica devolve a
 * lista inteira da conta (`?cpfCnpj=` vazio já fez isso), e anonimizar "o que
 * voltou" apagaria o cadastro de outras pessoas.
 */
export async function clientesDoAluno(conta: ContaAsaas, alunoId: string, cpf: string | null): Promise<ClienteAsaas[]> {
  const buscas: { filtro: string; confere: (c: ClienteAsaas) => boolean }[] = [];
  if (alunoId) {
    buscas.push({ filtro: `externalReference=${encodeURIComponent(alunoId)}`, confere: (c) => c.externalReference === alunoId });
  }
  const cpfLimpo = soDigitos(cpf);
  if (conta.porCpf && cpfLimpo.length === 11) {
    buscas.push({ filtro: `cpfCnpj=${cpfLimpo}`, confere: (c) => soDigitos(c.cpfCnpj) === cpfLimpo });
  }
  const achados = new Map<string, ClienteAsaas>();
  for (const { filtro, confere } of buscas) {
    const r = await chamar<{ data?: ClienteAsaas[] }>(conta, "GET", `/customers?${filtro}&limit=100`);
    if (!r.ok) throw new Error(descricaoErro(r.corpo) ?? `a busca de clientes respondeu ${r.status}`);
    for (const c of r.corpo.data ?? []) if (!c.deleted && confere(c)) achados.set(c.id, c);
  }
  return [...achados.values()];
}

/** O que o Asaas devolveu ainda identifica a pessoa? Os campos que ficaram. */
export function camposQueFicaram(cliente: Partial<ClienteAsaas>): string[] {
  const ficaram: string[] = CAMPOS_QUE_SAEM.filter((campo) => {
    const v = cliente[campo];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
  if (cliente.name !== NOME_ANONIMIZADO) ficaram.unshift("name");
  return ficaram;
}

/**
 * Anonimiza um cliente e confere a resposta: o Asaas devolve o cadastro
 * atualizado, e campo que ficou preenchido é falha, não sucesso.
 */
export async function anonimizarCliente(conta: ContaAsaas, cliente: ClienteAsaas): Promise<{ ok: true } | { ok: false; erro: string }> {
  const atualizado = await chamar<ClienteAsaas>(conta, "POST", `/customers/${encodeURIComponent(cliente.id)}`, CADASTRO_ANONIMO);
  if (!atualizado.ok) {
    return { ok: false, erro: descricaoErro(atualizado.corpo) ?? `o Asaas recusou a anonimização (HTTP ${atualizado.status})` };
  }
  const ficaram = camposQueFicaram(atualizado.corpo);
  if (ficaram.length) return { ok: false, erro: `o Asaas manteve ${ficaram.join(", ")}` };
  if (!conta.remover) return { ok: true };

  const removido = await chamar<{ deleted?: boolean }>(conta, "DELETE", `/customers/${encodeURIComponent(cliente.id)}`);
  if (!removido.ok || removido.corpo.deleted !== true) {
    return { ok: false, erro: descricaoErro(removido.corpo) ?? `o Asaas não confirmou a remoção (HTTP ${removido.status})` };
  }
  return { ok: true };
}

export type EntradaAnonimizacao = {
  alunoId: string;
  /** `organizations.status` da academia do aluno: decide sandbox ou produção. */
  statusOrganizacao: string | null | undefined;
  /** `profiles.cpf`, lido ANTES de `anonimizar_dados_do_aluno`, que o apaga. */
  cpf: string | null;
  /** `ler_chave_subconta_asaas`: a chave da conta da academia, ou nula. */
  chaveDaAcademia: string | null;
  /** `pessoa_tem_outro_vinculo`. */
  outrosVinculos: boolean;
};

export type ResultadoAnonimizacao =
  | {
      ok: true;
      /** Clientes anonimizados em cada conta; "pulada" diz por que a conta ficou de fora. */
      arkefit: number | "pulada: a pessoa tem outro vínculo";
      academia: number | "sem conta conectada" | "pulada: chave de outro ambiente";
    }
  | { ok: false; erro: string };

/**
 * Anonimiza o aluno nas duas contas do Asaas. Para no primeiro erro: quem
 * chama devolve 502 e a gestão tenta de novo — repetir é seguro (o cliente já
 * removido não volta na busca, e anonimizar de novo dá no mesmo).
 */
export async function anonimizarAlunoNoAsaas(
  entrada: EntradaAnonimizacao,
  env: (nome: string) => string | undefined,
): Promise<ResultadoAnonimizacao> {
  const ambiente = ambienteAsaas(entrada.statusOrganizacao, env);
  if ("erro" in ambiente) return { ok: false, erro: ambiente.erro };

  const contas: ContaAsaas[] = [];
  if (!entrada.outrosVinculos) {
    contas.push({ nome: "arkefit", api: ambiente.api, chave: ambiente.chave, remover: true, porCpf: true });
  }
  let academia: number | "sem conta conectada" | "pulada: chave de outro ambiente" = "sem conta conectada";
  if (entrada.chaveDaAcademia) {
    if (chaveCombinaComAmbiente(entrada.chaveDaAcademia, ambiente.nome)) {
      contas.push({ nome: "academia", api: ambiente.api, chave: entrada.chaveDaAcademia, remover: false, porCpf: !entrada.outrosVinculos });
    } else {
      academia = "pulada: chave de outro ambiente";
    }
  }

  const contagem = { arkefit: 0, academia: 0 };
  for (const conta of contas) {
    let clientes: ClienteAsaas[];
    try {
      clientes = await clientesDoAluno(conta, entrada.alunoId, entrada.cpf);
    } catch (e) {
      return { ok: false, erro: `Não foi possível procurar o cliente na conta ${conta.nome === "arkefit" ? "da ArkeFit" : "da academia"} no Asaas: ${e instanceof Error ? e.message : "erro"}` };
    }
    for (const cliente of clientes) {
      let r: { ok: true } | { ok: false; erro: string };
      try {
        r = await anonimizarCliente(conta, cliente);
      } catch (e) {
        r = { ok: false, erro: e instanceof Error ? e.message : "falha de rede" };
      }
      if ("erro" in r) {
        return { ok: false, erro: `Não foi possível anonimizar o cliente na conta ${conta.nome === "arkefit" ? "da ArkeFit" : "da academia"} no Asaas: ${r.erro}` };
      }
      contagem[conta.nome]++;
    }
  }

  return {
    ok: true,
    arkefit: entrada.outrosVinculos ? "pulada: a pessoa tem outro vínculo" : contagem.arkefit,
    academia: contas.some((c) => c.nome === "academia") ? contagem.academia : academia,
  };
}
