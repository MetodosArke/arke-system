/**
 * A saída do aluno anonimiza o cliente dele no Asaas, sem esperar o Asaas.
 *
 * `anonimizar-aluno` e `excluir-aluno` chamam `anonimizarClienteNaSaida`
 * depois de encerrar as cobranças e antes de apagar o banco (o CPF ainda
 * está no perfil). Se o Asaas falha, a saída segue — o direito da pessoa não
 * espera o gateway — e a pendência fica em `asaas_saida_pendente`; a rotina
 * `retentar-saida-asaas` chama `retentarPendentes` de hora em hora até dar
 * certo. A regra do que se toca em cada conta mora em `clienteAsaas.ts`.
 *
 * O encerramento da academia (`encerramento-organizacao`, etapa de
 * eliminação) chama `anonimizarClientesDaEliminacao`: o mesmo caminho, aluno
 * por aluno, em lotes, só na conta da ArkeFit (a conta Asaas da academia é
 * dela e continua depois do contrato), e com a pendência guardando o que a
 * nova tentativa precisa quando a organização já não existe: o ambiente e as
 * outras matrículas da pessoa (20261396010000).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anonimizarAlunoNoAsaas, type EntradaAnonimizacao, type ResultadoAnonimizacao } from "./clienteAsaas.ts";

export type AlunoQueSai = { id: string; user_id: string | null; organization_id: string };

export type Ambiente = "sandbox" | "producao";

/**
 * O que quem chama já sabe, e a pendência guarda para depois. Tudo opcional:
 * a saída de um aluno não passa nada, e a função lê do banco.
 */
export type ContextoSaida = {
  /** `organizations.status` já lido (a eliminação lê uma vez para todos). */
  statusOrganizacao?: string | null;
  /** O ambiente guardado na pendência, para quando a organização já não existe. */
  ambiente?: Ambiente | null;
  /** Falso: só a conta da ArkeFit (o encerramento da academia). */
  contaDaAcademia?: boolean;
  /** O CPF já lido (a eliminação lê junto com o aluno). */
  cpf?: string | null;
  /** As outras matrículas da pessoa, guardadas antes de as contas saírem. */
  outrasMatriculas?: string[];
};

export type DesfechoSaidaAsaas =
  | { situacao: "anonimizado"; resultado: Extract<ResultadoAnonimizacao, { ok: true }> }
  /** Ficou para a rotina tentar de novo. */
  | { situacao: "pendente"; erro: string }
  /** Falhou, e nem a pendência foi gravada: só o log e a resposta dizem. */
  | { situacao: "sem_registro"; erro: string };

const descrever = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "erro inesperado");

/** O ambiente que o status da organização decide (trial fala com o sandbox). */
export const ambienteDoStatus = (status: string | null | undefined): Ambiente => (status === "trial" ? "sandbox" : "producao");

/** O status que leva ao ambiente guardado, quando a organização já não existe. */
const statusDoAmbiente = (ambiente: Ambiente | null | undefined) =>
  ambiente === "sandbox" ? "trial" : ambiente === "producao" ? "ativo" : null;

/** O que a anonimização no Asaas precisa ler do banco. Lança se a leitura falhar. */
async function entradaDoAluno(
  admin: SupabaseClient,
  aluno: AlunoQueSai,
  outrosVinculos: boolean,
  contexto: ContextoSaida,
): Promise<EntradaAnonimizacao> {
  const lerStatus = contexto.statusOrganizacao === undefined;
  const lerChave = contexto.contaDaAcademia !== false;
  const lerCpf = contexto.cpf === undefined && !!aluno.user_id;
  const [org, chave, perfil, outras] = await Promise.all([
    lerStatus
      ? admin.from("organizations").select("status").eq("id", aluno.organization_id).maybeSingle()
      : Promise.resolve({ data: { status: contexto.statusOrganizacao }, error: null }),
    lerChave
      ? admin.rpc("ler_chave_subconta_asaas", { _organization_id: aluno.organization_id })
      : Promise.resolve({ data: null, error: null }),
    lerCpf
      ? admin.from("profiles").select("cpf").eq("user_id", aluno.user_id!).maybeSingle()
      : Promise.resolve({ data: { cpf: contexto.cpf ?? null }, error: null }),
    aluno.user_id
      ? admin.from("alunos").select("id").eq("user_id", aluno.user_id).neq("id", aluno.id).limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (org.error) throw new Error(`organização: ${org.error.code ?? org.error.message}`);
  if (chave.error) throw new Error(`chave da academia: ${chave.error.code ?? chave.error.message}`);
  if (perfil.error) throw new Error(`perfil: ${perfil.error.code ?? perfil.error.message}`);
  if (outras.error) throw new Error(`matrículas: ${outras.error.code ?? outras.error.message}`);
  // Organização que já saiu: o ambiente vem da pendência.
  const status = (org.data as { status?: string | null } | null)?.status ?? statusDoAmbiente(contexto.ambiente);
  const lidas = ((outras.data ?? []) as { id: string }[]).map((a) => a.id);
  return {
    alunoId: aluno.id,
    statusOrganizacao: status,
    cpf: (perfil.data as { cpf?: string | null } | null)?.cpf ?? null,
    chaveDaAcademia: lerChave && typeof chave.data === "string" && chave.data ? chave.data : null,
    outrosVinculos,
    outrasMatriculas: [...new Set([...lidas, ...(contexto.outrasMatriculas ?? [])])],
  };
}

/**
 * Anonimiza o cliente do aluno no Asaas. Nunca lança e nunca trava a saída:
 * o desfecho diz se deu certo ou se ficou pendente.
 */
export async function anonimizarClienteNaSaida(
  admin: SupabaseClient,
  aluno: AlunoQueSai,
  outrosVinculos: boolean,
  env: (nome: string) => string | undefined,
  contexto: ContextoSaida = {},
): Promise<DesfechoSaidaAsaas> {
  let r: ResultadoAnonimizacao;
  let entrada: EntradaAnonimizacao | null = null;
  try {
    entrada = await entradaDoAluno(admin, aluno, outrosVinculos, contexto);
    r = await anonimizarAlunoNoAsaas(entrada, env);
  } catch (e) {
    r = { ok: false, erro: descrever(e) };
  }

  if (r.ok) {
    // A pendência de uma tentativa anterior sai junto.
    const { error } = await admin.from("asaas_saida_pendente").delete().eq("aluno_id", aluno.id);
    if (error) console.error("saída no Asaas: a pendência não saiu", error.code);
    return { situacao: "anonimizado", resultado: r };
  }

  const erro = "erro" in r ? r.erro : "erro inesperado";
  console.error("saída no Asaas: ficou pendente");
  // O que a nova tentativa precisa se a organização sair antes dela.
  const ambiente =
    contexto.ambiente ?? (entrada?.statusOrganizacao !== undefined && entrada?.statusOrganizacao !== null ? ambienteDoStatus(entrada.statusOrganizacao) : null);
  const { error } = await admin.rpc("registrar_saida_asaas_pendente", {
    _aluno_id: aluno.id,
    _organization_id: aluno.organization_id,
    _user_id: aluno.user_id,
    _outros_vinculos: outrosVinculos,
    _erro: erro,
    _ambiente: ambiente,
    _conta_da_academia: contexto.contaDaAcademia !== false,
    _outras_matriculas: entrada?.outrasMatriculas ?? contexto.outrasMatriculas ?? [],
  });
  if (error) {
    console.error("saída no Asaas: a pendência não foi gravada", error.code);
    return { situacao: "sem_registro", erro };
  }
  return { situacao: "pendente", erro };
}

type Pendencia = {
  aluno_id: string;
  organization_id: string;
  user_id: string | null;
  outros_vinculos: boolean;
  ambiente: Ambiente | null;
  conta_da_academia: boolean;
  outras_matriculas: string[] | null;
};

/**
 * A nova tentativa das pendências, das mais antigas para as mais novas.
 * Quem tinha outro vínculo na hora da saída continua tratado assim: depois
 * da exclusão, o banco já não sabe responder. Com `organizationId`, só as
 * daquela academia (a eliminação tenta antes de a chave dela sair do cofre),
 * e com `ate`, nenhuma começa depois desse instante.
 */
export async function retentarPendentes(
  admin: SupabaseClient,
  env: (nome: string) => string | undefined,
  limite = 50,
  filtro: { organizationId?: string; ate?: number; agora?: () => number } = {},
): Promise<{ tentadas: number; concluidas: number; pendentes: number }> {
  const agora = filtro.agora ?? Date.now;
  let consulta = admin
    .from("asaas_saida_pendente")
    .select("aluno_id, organization_id, user_id, outros_vinculos, ambiente, conta_da_academia, outras_matriculas");
  if (filtro.organizationId) consulta = consulta.eq("organization_id", filtro.organizationId);
  const { data, error } = await consulta.order("atualizado_em").limit(limite);
  if (error) throw new Error(`pendências: ${error.code ?? error.message}`);
  let concluidas = 0;
  let tentadas = 0;
  for (const p of (data ?? []) as Pendencia[]) {
    if (filtro.ate !== undefined && agora() > filtro.ate) break;
    tentadas++;
    const d = await anonimizarClienteNaSaida(
      admin,
      { id: p.aluno_id, user_id: p.user_id, organization_id: p.organization_id },
      p.outros_vinculos,
      env,
      { ambiente: p.ambiente, contaDaAcademia: p.conta_da_academia, outrasMatriculas: p.outras_matriculas ?? [] },
    );
    if (d.situacao === "anonimizado") concluidas++;
  }
  return { tentadas, concluidas, pendentes: tentadas - concluidas };
}

/** Um aluno da academia que está sendo eliminada (`alunos_para_anonimizar_no_asaas`). */
type AlunoDaEliminacao = {
  aluno_id: string;
  user_id: string | null;
  cpf: string | null;
  outros_vinculos: boolean;
  outras_matriculas: string[] | null;
};

export type PassoAsaasDaEliminacao = { concluido: boolean; anonimizados: number; pendentes: number };

/** O Asaas não respondeu a nenhum aluno de um lote: a rodada para, sem avançar. */
export class AsaasSemResposta extends Error {}

/**
 * A etapa de eliminação da academia: o cliente de cada aluno na conta da
 * ArkeFit, antes de as contas e a organização saírem. Retomável: o cursor e
 * as contagens ficam em `organizacao_encerramentos` a cada lote, e o aluno
 * repetido depois de uma parada no meio não muda nada (anonimizar de novo dá
 * no mesmo, e o removido não volta na busca).
 *
 * Quem falha vira pendência e o passo segue, como na saída de um aluno. Se o
 * lote inteiro falha (o Asaas fora do ar, a chave errada), a rodada para sem
 * avançar o cursor: seguir só trocaria cada aluno por uma pendência, um prazo
 * de 20 segundos de cada vez.
 */
export async function anonimizarClientesDaEliminacao(
  admin: SupabaseClient,
  enc: { id: string; organization_id: string },
  env: (nome: string) => string | undefined,
  opcoes: { inicio: number; orcamentoMs: number; lote?: number; paralelos?: number; agora?: () => number },
): Promise<PassoAsaasDaEliminacao> {
  const agora = opcoes.agora ?? Date.now;
  const lote = opcoes.lote ?? 50;
  const paralelos = opcoes.paralelos ?? 5;

  const { data: registro, error: erroRegistro } = await admin
    .from("organizacao_encerramentos")
    .select("asaas_cursor, asaas_concluido_em, asaas_anonimizados, asaas_pendentes")
    .eq("id", enc.id)
    .single();
  if (erroRegistro || !registro) throw new Error(`encerramento: ${erroRegistro?.code ?? "não encontrado"}`);
  let cursor = (registro.asaas_cursor as string | null) ?? null;
  let anonimizados = (registro.asaas_anonimizados as number | null) ?? 0;
  let pendentes = (registro.asaas_pendentes as number | null) ?? 0;
  if (registro.asaas_concluido_em) return { concluido: true, anonimizados, pendentes };

  const { data: org, error: erroOrg } = await admin.from("organizations").select("status").eq("id", enc.organization_id).maybeSingle();
  if (erroOrg) throw new Error(`organização: ${erroOrg.code}`);
  const statusOrganizacao = (org?.status as string | undefined) ?? null;
  const ambiente = ambienteDoStatus(statusOrganizacao);

  const salvar = async (campos: Record<string, unknown>) => {
    const { error } = await admin
      .from("organizacao_encerramentos")
      .update({ asaas_cursor: cursor, asaas_anonimizados: anonimizados, asaas_pendentes: pendentes, ...campos })
      .eq("id", enc.id);
    if (error) throw new Error(`progresso do Asaas: ${error.code}`);
  };

  for (;;) {
    if (agora() - opcoes.inicio > opcoes.orcamentoMs) return { concluido: false, anonimizados, pendentes };
    const { data, error } = await admin.rpc("alunos_para_anonimizar_no_asaas", {
      _encerramento_id: enc.id,
      _depois_de: cursor,
      _limite: lote,
    });
    if (error) throw new Error(`alunos a anonimizar: ${error.code}`);
    const alunos = (data ?? []) as AlunoDaEliminacao[];
    if (!alunos.length) {
      await salvar({ asaas_concluido_em: new Date(agora()).toISOString() });
      return { concluido: true, anonimizados, pendentes };
    }

    for (let i = 0; i < alunos.length; i += paralelos) {
      if (agora() - opcoes.inicio > opcoes.orcamentoMs) return { concluido: false, anonimizados, pendentes };
      const grupo = alunos.slice(i, i + paralelos);
      const desfechos = await Promise.all(
        grupo.map((a) =>
          anonimizarClienteNaSaida(
            admin,
            { id: a.aluno_id, user_id: a.user_id, organization_id: enc.organization_id },
            a.outros_vinculos,
            env,
            { statusOrganizacao, ambiente, contaDaAcademia: false, cpf: a.cpf, outrasMatriculas: a.outras_matriculas ?? [] },
          ),
        ),
      );
      // Pendência que nem foi gravada: o aluno não pode ficar para trás sem registro.
      if (desfechos.some((d) => d.situacao === "sem_registro")) {
        throw new Error("a pendência do Asaas não foi gravada; a eliminação continua na próxima rodada");
      }
      const ok = desfechos.filter((d) => d.situacao === "anonimizado").length;
      if (ok === 0 && grupo.length > 1) {
        throw new AsaasSemResposta(`o Asaas não anonimizou nenhum dos ${grupo.length} alunos do lote; a eliminação continua na próxima rodada`);
      }
      anonimizados += ok;
      pendentes += grupo.length - ok;
      cursor = grupo[grupo.length - 1].aluno_id;
      await salvar({});
    }
  }
}
