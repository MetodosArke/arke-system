import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CADASTRO_ANONIMO,
  NOME_ANONIMIZADO,
  anonimizarAlunoNoAsaas,
  camposQueFicaram,
  type ClienteAsaas,
} from "../../supabase/functions/_shared/clienteAsaas";

/**
 * O cliente do aluno no Asaas, anonimizado na saída (auditoria de 05/10/2026,
 * achado 4). Um Asaas de mentira, com os clientes de cada conta em memória:
 * o teste vê cada chamada e o cadastro que ficou.
 */
const CHAVE_ARKEFIT = "$aact_arkefit_producao";
const CHAVE_ACADEMIA = "$aact_academia_producao";
const ENV: Record<string, string> = { ASAAS_API_KEY: CHAVE_ARKEFIT };
const env = (n: string) => ENV[n];

const ALUNO = "aluno-1";
const CPF = "52998224725";

type Chamada = { chave: string; metodo: string; caminho: string; corpo: unknown };

function asaasDeMentira(contas: Record<string, ClienteAsaas[]>, opcoes: { mantemEmail?: boolean; naoRemove?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
      const chave = init.headers.access_token;
      const caminho = url.replace(/^https:\/\/[^/]+\/v3/, "");
      const corpo = init.body ? JSON.parse(String(init.body)) : undefined;
      chamadas.push({ chave, metodo: init.method ?? "GET", caminho, corpo });
      expect(init.signal, "toda chamada tem prazo").toBeTruthy();
      const clientes = contas[chave] ?? [];
      const json = (status: number, dado: unknown) => new Response(JSON.stringify(dado), { status });

      if (init.method === "GET") {
        const q = new URLSearchParams(caminho.split("?")[1]);
        // O Asaas de verdade ignora filtro que não conhece e devolve tudo:
        // aqui, a busca por CPF devolve a conta inteira, e quem filtra é o módulo.
        if (q.has("cpfCnpj")) return json(200, { data: clientes });
        return json(200, { data: clientes.filter((c) => c.externalReference === q.get("externalReference")) });
      }
      const id = decodeURIComponent(caminho.split("/")[2]);
      const cliente = clientes.find((c) => c.id === id)!;
      if (init.method === "POST") {
        Object.assign(cliente, corpo);
        if (opcoes.mantemEmail) cliente.email = "aluna@exemplo.com";
        return json(200, cliente);
      }
      if (init.method === "DELETE") {
        if (opcoes.naoRemove) return json(400, { errors: [{ description: "Cliente não pode ser removido." }] });
        cliente.deleted = true;
        return json(200, { deleted: true, id });
      }
      return json(404, {});
    }),
  );
  return chamadas;
}

const cliente = (id: string, extra: Partial<ClienteAsaas> = {}): ClienteAsaas => ({
  id,
  name: "Maria da Silva",
  cpfCnpj: CPF,
  email: "maria@exemplo.com",
  mobilePhone: "11999990000",
  postalCode: "01001000",
  address: "Praça da Sé",
  addressNumber: "100",
  province: "Sé",
  externalReference: ALUNO,
  ...extra,
});

const entrada = (extra: Partial<Parameters<typeof anonimizarAlunoNoAsaas>[0]> = {}) => ({
  alunoId: ALUNO,
  statusOrganizacao: "active",
  cpf: CPF,
  chaveDaAcademia: CHAVE_ACADEMIA,
  outrosVinculos: false,
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("anonimizar o aluno no Asaas", () => {
  it("sem outro vínculo: anonimiza e remove na conta da ArkeFit, e só anonimiza na da academia", async () => {
    const naArkefit = cliente("cus_arkefit");
    const naAcademia = cliente("cus_academia");
    const chamadas = asaasDeMentira({ [CHAVE_ARKEFIT]: [naArkefit], [CHAVE_ACADEMIA]: [naAcademia] });

    const r = await anonimizarAlunoNoAsaas(entrada(), env);

    expect(r).toEqual({ ok: true, arkefit: 1, academia: 1 });
    // O que identifica saiu; o CPF e a referência ficaram (ligam o pagamento a quem pagou).
    for (const c of [naArkefit, naAcademia]) {
      expect(c.name).toBe(NOME_ANONIMIZADO);
      expect(camposQueFicaram(c)).toEqual([]);
      expect(c.cpfCnpj).toBe(CPF);
      expect(c.notificationDisabled).toBe(true);
    }
    expect(naArkefit.deleted, "a conta das cobranças remove").toBe(true);
    expect(naAcademia.deleted, "a conta da nota fiscal só anonimiza").toBeUndefined();
    // Achado pela referência e pelo CPF, o mesmo cliente é tratado uma vez só.
    expect(chamadas.filter((c) => c.metodo === "POST")).toHaveLength(2);
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual(CADASTRO_ANONIMO);
  });

  it("com outro vínculo: a conta da ArkeFit fica intocada, e na academia sai só a referência deste aluno", async () => {
    const compartilhado = cliente("cus_arkefit", { externalReference: "aluno-da-outra-academia" });
    const doOutroVinculo = cliente("cus_outro", { externalReference: "aluno-2" });
    const deste = cliente("cus_deste");
    const chamadas = asaasDeMentira({ [CHAVE_ARKEFIT]: [compartilhado], [CHAVE_ACADEMIA]: [deste, doOutroVinculo] });

    const r = await anonimizarAlunoNoAsaas(entrada({ outrosVinculos: true }), env);

    expect(r).toEqual({ ok: true, arkefit: "pulada: a pessoa tem outro vínculo", academia: 1 });
    expect(chamadas.some((c) => c.chave === CHAVE_ARKEFIT), "a assinatura da outra academia segue cobrando").toBe(false);
    expect(chamadas.some((c) => c.caminho.includes("cpfCnpj")), "sem busca por CPF").toBe(false);
    expect(compartilhado.name).toBe("Maria da Silva");
    expect(doOutroVinculo.name).toBe("Maria da Silva");
    expect(deste.name).toBe(NOME_ANONIMIZADO);
  });

  it("filtro que o Asaas não aplica não leva o cadastro de outra pessoa", async () => {
    const outraPessoa = cliente("cus_outra", { cpfCnpj: "11144477735", externalReference: "aluno-9", name: "João" });
    const daAluna = cliente("cus_aluna", { externalReference: null });
    asaasDeMentira({ [CHAVE_ARKEFIT]: [outraPessoa, daAluna] });

    const r = await anonimizarAlunoNoAsaas(entrada({ chaveDaAcademia: null }), env);

    expect(r).toEqual({ ok: true, arkefit: 1, academia: "sem conta conectada" });
    expect(daAluna.name).toBe(NOME_ANONIMIZADO);
    expect(outraPessoa.name).toBe("João");
    expect(outraPessoa.deleted).toBeUndefined();
  });

  it("a nova tentativa, já sem o CPF, acha o cliente pela referência de outra matrícula da pessoa", async () => {
    // Criado para a matrícula antiga (outra academia) e reaproveitado pelo CPF.
    const deOutraMatricula = cliente("cus_antigo", { externalReference: "aluno-antigo" });
    const chamadas = asaasDeMentira({ [CHAVE_ARKEFIT]: [deOutraMatricula] });
    const r = await anonimizarAlunoNoAsaas(entrada({ cpf: null, chaveDaAcademia: null, outrasMatriculas: ["aluno-antigo"] }), env);
    expect(r).toEqual({ ok: true, arkefit: 1, academia: "sem conta conectada" });
    expect(deOutraMatricula.deleted).toBe(true);
    expect(chamadas.some((c) => c.caminho.includes("cpfCnpj")), "sem CPF, sem busca por CPF").toBe(false);
  });

  it("com outro vínculo, as referências das outras matrículas não são procuradas", async () => {
    const daMatriculaViva = cliente("cus_viva", { externalReference: "aluno-vivo" });
    const chamadas = asaasDeMentira({ [CHAVE_ACADEMIA]: [daMatriculaViva] });
    const r = await anonimizarAlunoNoAsaas(entrada({ outrosVinculos: true, outrasMatriculas: ["aluno-vivo"] }), env);
    expect(r).toEqual({ ok: true, arkefit: "pulada: a pessoa tem outro vínculo", academia: 0 });
    expect(chamadas.some((c) => c.caminho.includes("aluno-vivo"))).toBe(false);
    expect(daMatriculaViva.name).toBe("Maria da Silva");
  });

  it("CPF em branco não vira busca sem filtro", async () => {
    const chamadas = asaasDeMentira({ [CHAVE_ARKEFIT]: [cliente("cus_x", { externalReference: "outro" })] });
    const r = await anonimizarAlunoNoAsaas(entrada({ cpf: "", chaveDaAcademia: null }), env);
    expect(r).toEqual({ ok: true, arkefit: 0, academia: "sem conta conectada" });
    expect(chamadas.some((c) => c.caminho.includes("cpfCnpj"))).toBe(false);
  });

  it("campo que o Asaas manteve é falha, não sucesso", async () => {
    asaasDeMentira({ [CHAVE_ARKEFIT]: [cliente("cus_1")] }, { mantemEmail: true });
    const r = await anonimizarAlunoNoAsaas(entrada({ chaveDaAcademia: null }), env);
    expect(r).toEqual({ ok: false, erro: "Não foi possível anonimizar o cliente na conta da ArkeFit no Asaas: o Asaas manteve email" });
  });

  it("remoção não confirmada é falha", async () => {
    asaasDeMentira({ [CHAVE_ARKEFIT]: [cliente("cus_1")] }, { naoRemove: true });
    const r = await anonimizarAlunoNoAsaas(entrada({ chaveDaAcademia: null }), env);
    expect(r.ok).toBe(false);
    expect("erro" in r ? r.erro : "").toMatch(/Cliente não pode ser removido/);
  });

  it("repetir depois de uma falha é seguro: o cliente removido não volta", async () => {
    const naArkefit = cliente("cus_arkefit", { deleted: true, name: NOME_ANONIMIZADO });
    const chamadas = asaasDeMentira({ [CHAVE_ARKEFIT]: [naArkefit] });
    const r = await anonimizarAlunoNoAsaas(entrada({ chaveDaAcademia: null }), env);
    expect(r).toEqual({ ok: true, arkefit: 0, academia: "sem conta conectada" });
    expect(chamadas.every((c) => c.metodo === "GET")).toBe(true);
  });

  it("academia em homologação sem chave de sandbox não cai na produção", async () => {
    const chamadas = asaasDeMentira({});
    const r = await anonimizarAlunoNoAsaas(entrada({ statusOrganizacao: "trial" }), env);
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it("chave da academia de outro ambiente fica de fora", async () => {
    asaasDeMentira({ [CHAVE_ARKEFIT]: [] });
    const r = await anonimizarAlunoNoAsaas(entrada({ chaveDaAcademia: "$aact_hmlg_sandbox" }), env);
    expect(r).toEqual({ ok: true, arkefit: 0, academia: "pulada: chave de outro ambiente" });
  });

  it("falha de rede vira erro com o nome da conta, sem dado da pessoa", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("tempo esgotado", "TimeoutError"))));
    const r = await anonimizarAlunoNoAsaas(entrada(), env);
    expect(r).toEqual({ ok: false, erro: "Não foi possível procurar o cliente na conta da ArkeFit no Asaas: TimeoutError" });
  });
});
