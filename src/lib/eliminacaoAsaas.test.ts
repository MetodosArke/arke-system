import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AsaasSemResposta,
  anonimizarClientesDaEliminacao,
  retentarPendentes,
} from "../../supabase/functions/_shared/saidaAsaas";
import { NOME_ANONIMIZADO, type ClienteAsaas } from "../../supabase/functions/_shared/clienteAsaas";

/**
 * O encerramento da academia anonimiza o cliente de cada aluno na conta Asaas
 * da ArkeFit antes de apagar contas e organização (auditoria de prontidão de
 * 06/10/2026, migration 20261396010000). Um banco e um Asaas de mentira, com o
 * código real de `_shared/saidaAsaas.ts` e `_shared/clienteAsaas.ts`.
 */
const CHAVE_PRODUCAO = "$aact_arkefit_producao";
const CHAVE_SANDBOX = "$aact_hmlg_arkefit_sandbox";
const ENV: Record<string, string> = { ASAAS_API_KEY: CHAVE_PRODUCAO, ASAAS_SANDBOX_KEY: CHAVE_SANDBOX };
const env = (n: string) => ENV[n];
const ORG = "org-1";
const ENC = { id: "enc-1", organization_id: ORG };

type Aluno = { aluno_id: string; user_id: string | null; cpf: string | null; outros_vinculos: boolean; outras_matriculas: string[] };
const aluno = (n: number, extra: Partial<Aluno> = {}): Aluno => ({
  aluno_id: `aluno-${String(n).padStart(2, "0")}`,
  user_id: `user-${n}`,
  cpf: null,
  outros_vinculos: false,
  outras_matriculas: [],
  ...extra,
});

/** O Asaas de mentira: os clientes por chave, cada chamada registrada. */
function asaasDeMentira(clientes: Record<string, ClienteAsaas[]>, opcoes: { fora?: boolean; recusaPost?: Set<string> } = {}) {
  const chamadas: { chave: string; metodo: string; caminho: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
      const chave = init.headers.access_token;
      const caminho = url.replace(/^https:\/\/[^/]+\/v3/, "");
      chamadas.push({ chave, metodo: init.method ?? "GET", caminho });
      expect(init.signal, "toda chamada tem prazo").toBeTruthy();
      if (opcoes.fora) throw Object.assign(new Error("tempo esgotado"), { name: "TimeoutError" });
      const lista = clientes[chave] ?? [];
      const json = (status: number, dado: unknown) => new Response(JSON.stringify(dado), { status });
      if ((init.method ?? "GET") === "GET") {
        const q = new URLSearchParams(caminho.split("?")[1]);
        if (q.has("cpfCnpj")) return json(200, { data: lista });
        return json(200, { data: lista.filter((c) => c.externalReference === q.get("externalReference")) });
      }
      const id = decodeURIComponent(caminho.split("/")[2]);
      const cliente = lista.find((c) => c.id === id)!;
      if (init.method === "POST") {
        if (opcoes.recusaPost?.has(id)) return json(400, { errors: [{ description: "Cliente bloqueado." }] });
        Object.assign(cliente, JSON.parse(String(init.body)));
        return json(200, cliente);
      }
      cliente.deleted = true;
      return json(200, { deleted: true, id });
    }),
  );
  return chamadas;
}

/** O banco de mentira: o registro do encerramento, os alunos e as pendências. */
function bancoDeMentira(o: { alunos: Aluno[]; status?: string | null; registro?: Record<string, unknown>; pendencias?: Record<string, unknown>[] }) {
  const registro: Record<string, unknown> = {
    asaas_cursor: null,
    asaas_concluido_em: null,
    asaas_anonimizados: 0,
    asaas_pendentes: 0,
    ...o.registro,
  };
  const pendencias = new Map<string, Record<string, unknown>>((o.pendencias ?? []).map((p) => [p.aluno_id as string, p]));
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const paginas: (string | null)[] = [];

  const consulta = (tabela: string) => {
    const q: { op: string; valores?: Record<string, unknown>; filtros: Record<string, unknown> } = { op: "select", filtros: {} };
    const resolver = () => {
      if (tabela === "organizacao_encerramentos") {
        if (q.op === "update") {
          Object.assign(registro, q.valores);
          return { data: null, error: null };
        }
        return { data: { ...registro }, error: null };
      }
      if (tabela === "organizations") {
        return { data: o.status === undefined || o.status === null ? null : { status: o.status }, error: null };
      }
      if (tabela === "alunos") return { data: [], error: null };
      if (tabela === "profiles") return { data: null, error: null };
      if (tabela === "asaas_saida_pendente") {
        if (q.op === "delete") {
          pendencias.delete(q.filtros.aluno_id as string);
          return { data: null, error: null };
        }
        const todas = [...pendencias.values()].filter((p) => !q.filtros.organization_id || p.organization_id === q.filtros.organization_id);
        return { data: todas, error: null };
      }
      throw new Error(`tabela inesperada ${tabela}`);
    };
    const b = {
      select: () => b,
      update: (v: Record<string, unknown>) => ((q.op = "update"), (q.valores = v), b),
      delete: () => ((q.op = "delete"), b),
      eq: (k: string, v: unknown) => ((q.filtros[k] = v), b),
      neq: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolver()),
      maybeSingle: () => Promise.resolve(resolver()),
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, erro),
    };
    return b;
  };

  const admin = {
    from: consulta,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      if (fn === "alunos_para_anonimizar_no_asaas") {
        paginas.push(args._depois_de as string | null);
        const depois = args._depois_de as string | null;
        const lista = o.alunos.filter((a) => depois === null || a.aluno_id > depois).slice(0, args._limite as number);
        return { data: lista, error: null };
      }
      if (fn === "registrar_saida_asaas_pendente") {
        pendencias.set(args._aluno_id as string, {
          aluno_id: args._aluno_id,
          organization_id: args._organization_id,
          user_id: args._user_id,
          outros_vinculos: args._outros_vinculos,
          ambiente: args._ambiente,
          conta_da_academia: args._conta_da_academia,
          outras_matriculas: args._outras_matriculas,
        });
        return { data: null, error: null };
      }
      if (fn === "ler_chave_subconta_asaas") return { data: null, error: null };
      throw new Error(`rpc inesperada ${fn}`);
    },
  };
  // O tipo do cliente do Supabase não importa ao teste: só os métodos usados.
  return { admin: admin as never, registro, pendencias, rpcs, paginas };
}

const clienteDe = (a: Aluno, extra: Partial<ClienteAsaas> = {}): ClienteAsaas => ({
  id: `cus-${a.aluno_id}`,
  name: "Pessoa de Verdade",
  email: "pessoa@exemplo.com",
  mobilePhone: "11999999999",
  externalReference: a.aluno_id,
  cpfCnpj: "52998224725",
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("eliminação da academia: o cliente de cada aluno no Asaas", () => {
  it("anonimiza e remove na conta da ArkeFit, em lotes, e marca o passo como feito", async () => {
    const alunos = [1, 2, 3, 4, 5, 6, 7].map((n) => aluno(n));
    const clientes = { [CHAVE_PRODUCAO]: alunos.map((a) => clienteDe(a)) };
    const chamadas = asaasDeMentira(clientes);
    const b = bancoDeMentira({ alunos, status: "ativo" });

    const r = await anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000, lote: 3, paralelos: 2 });

    expect(r).toEqual({ concluido: true, anonimizados: 7, pendentes: 0 });
    expect(clientes[CHAVE_PRODUCAO].every((c) => c.name === NOME_ANONIMIZADO && c.deleted && c.email === "")).toBe(true);
    expect(b.registro.asaas_concluido_em).toBeTruthy();
    expect(b.registro.asaas_cursor).toBe("aluno-07");
    expect(b.paginas).toEqual([null, "aluno-03", "aluno-06", "aluno-07"]);
    // Só a conta da ArkeFit: a chave da academia nem é lida.
    expect(b.rpcs.some((x) => x.fn === "ler_chave_subconta_asaas")).toBe(false);
    expect(new Set(chamadas.map((c) => c.chave))).toEqual(new Set([CHAVE_PRODUCAO]));
  });

  it("quem tem vínculo noutra academia fica intocado na conta da ArkeFit", async () => {
    const livre = aluno(1);
    const comOutra = aluno(2, { outros_vinculos: true, outras_matriculas: ["aluno-de-outra"] });
    const clientes = { [CHAVE_PRODUCAO]: [clienteDe(livre), clienteDe(comOutra)] };
    const chamadas = asaasDeMentira(clientes);
    const b = bancoDeMentira({ alunos: [livre, comOutra], status: "ativo" });

    const r = await anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000 });

    expect(r.concluido).toBe(true);
    expect(clientes[CHAVE_PRODUCAO][1].name).toBe("Pessoa de Verdade");
    expect(clientes[CHAVE_PRODUCAO][1].deleted).toBeUndefined();
    expect(chamadas.some((c) => c.caminho.includes(comOutra.aluno_id))).toBe(false);
  });

  it("sem tempo, para no fim de um grupo e a rodada seguinte continua do cursor", async () => {
    const alunos = [1, 2, 3, 4, 5].map((n) => aluno(n));
    asaasDeMentira({ [CHAVE_PRODUCAO]: alunos.map((a) => clienteDe(a)) });
    const b = bancoDeMentira({ alunos, status: "ativo" });
    let leituras = 0;

    // O relógio passa do orçamento depois do primeiro grupo de 2.
    const r1 = await anonimizarClientesDaEliminacao(b.admin, ENC, env, {
      inicio: 0,
      orcamentoMs: 10,
      paralelos: 2,
      agora: () => (leituras++ < 2 ? 0 : 100),
    });
    expect(r1).toEqual({ concluido: false, anonimizados: 2, pendentes: 0 });
    expect(b.registro.asaas_cursor).toBe("aluno-02");
    expect(b.registro.asaas_concluido_em).toBeNull();

    // A rodada seguinte lê o registro e continua do cursor, sem repetir ninguém.
    const r2 = await anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000, paralelos: 2 });
    expect(r2).toEqual({ concluido: true, anonimizados: 5, pendentes: 0 });
    expect(b.paginas).toEqual([null, "aluno-02", "aluno-05"]);
  });

  it("um aluno que falha vira pendência e o passo segue, guardando o que a nova tentativa precisa", async () => {
    const alunos = [aluno(1), aluno(2, { outras_matriculas: ["aluno-antigo"] }), aluno(3)];
    const clientes = { [CHAVE_PRODUCAO]: alunos.map((a) => clienteDe(a)) };
    asaasDeMentira(clientes, { recusaPost: new Set(["cus-aluno-02"]) });
    const b = bancoDeMentira({ alunos, status: "ativo" });

    const r = await anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000, paralelos: 5 });

    expect(r).toEqual({ concluido: true, anonimizados: 2, pendentes: 1 });
    expect(b.pendencias.get("aluno-02")).toMatchObject({
      organization_id: ORG,
      ambiente: "producao",
      conta_da_academia: false,
      outras_matriculas: ["aluno-antigo"],
    });
  });

  it("o Asaas fora do ar: a rodada para sem avançar o cursor", async () => {
    const alunos = [1, 2, 3].map((n) => aluno(n));
    asaasDeMentira({}, { fora: true });
    const b = bancoDeMentira({ alunos, status: "ativo" });

    await expect(
      anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000, paralelos: 3 }),
    ).rejects.toBeInstanceOf(AsaasSemResposta);
    expect(b.registro.asaas_cursor).toBeNull();
    expect(b.registro.asaas_concluido_em).toBeNull();
    // As pendências ficam (a próxima rodada tenta de novo e as tira).
    expect(b.pendencias.size).toBe(3);
  });

  it("academia em homologação: o sandbox, e a pendência guarda o ambiente", async () => {
    const a = aluno(1);
    const chamadas = asaasDeMentira({ [CHAVE_SANDBOX]: [clienteDe(a)] }, { recusaPost: new Set(["cus-aluno-01"]) });
    const b = bancoDeMentira({ alunos: [a], status: "trial" });

    await anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000 });

    expect(chamadas.every((c) => c.chave === CHAVE_SANDBOX)).toBe(true);
    expect(b.pendencias.get(a.aluno_id)).toMatchObject({ ambiente: "sandbox", conta_da_academia: false });
  });

  it("a nova tentativa depois da eliminação usa o ambiente guardado e não procura a conta da academia", async () => {
    const a = aluno(1);
    const clientes = { [CHAVE_SANDBOX]: [clienteDe(a)] };
    const chamadas = asaasDeMentira(clientes);
    const b = bancoDeMentira({
      alunos: [],
      status: null, // a organização já saiu
      pendencias: [
        { aluno_id: a.aluno_id, organization_id: ORG, user_id: null, outros_vinculos: false, ambiente: "sandbox", conta_da_academia: false, outras_matriculas: [] },
      ],
    });

    const r = await retentarPendentes(b.admin, env);

    expect(r).toEqual({ tentadas: 1, concluidas: 1, pendentes: 0 });
    expect(chamadas.every((c) => c.chave === CHAVE_SANDBOX)).toBe(true);
    expect(clientes[CHAVE_SANDBOX][0].deleted).toBe(true);
    expect(b.pendencias.size).toBe(0);
    expect(b.rpcs.some((x) => x.fn === "ler_chave_subconta_asaas")).toBe(false);
  });

  it("passo já feito não chama o Asaas de novo", async () => {
    const chamadas = asaasDeMentira({});
    const b = bancoDeMentira({ alunos: [aluno(1)], status: "ativo", registro: { asaas_concluido_em: "2026-10-06T12:00:00Z", asaas_anonimizados: 1 } });
    expect(await anonimizarClientesDaEliminacao(b.admin, ENC, env, { inicio: Date.now(), orcamentoMs: 60_000 })).toEqual({
      concluido: true,
      anonimizados: 1,
      pendentes: 0,
    });
    expect(chamadas).toEqual([]);
  });
});
