import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Baixar os meus dados" (auditoria de 05/10/2026, achado 7): o aluno leva o
 * que é dele, lido pelo RLS dele mesmo. Um banco de mentira responde cada
 * tabela e anota cada filtro.
 */
type Chamada = { tabela: string; metodo: string; args: unknown[] };
const chamadas: Chamada[] = [];
let respostas: Record<string, { data: unknown; error: { message: string } | null }> = {};

function consulta(tabela: string) {
  const resposta = () => respostas[tabela] ?? { data: [], error: null };
  const b: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "in", "order", "range"]) {
    b[metodo] = (...args: unknown[]) => {
      chamadas.push({ tabela, metodo, args });
      return b;
    };
  }
  b.maybeSingle = () => Promise.resolve(resposta());
  b.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, falha);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (tabela: string) => consulta(tabela) } }));

const { lerMeusDados, montarMeusDados, nomeDoArquivoMeusDados } = await import("./meusDados");

beforeEach(() => {
  chamadas.length = 0;
  respostas = {
    profiles: { data: { full_name: "Maria", cpf: "52998224725" }, error: null },
    alunos: { data: [{ id: "aluno-1", organization_id: "org-1" }, { id: "aluno-2", organization_id: "org-2" }], error: null },
    organizations: { data: [{ id: "org-1", nome: "Academia Um" }], error: null },
    anamnese_acolhimento: { data: [{ aluno_id: "aluno-1", dores_lesoes: "joelho" }], error: null },
    mensagens_mentor: { data: [{ aluno_id: "aluno-1", mensagem: "Oi" }], error: null },
  };
});

describe("baixar os meus dados", () => {
  it("lê cada parte pelas matrículas da própria pessoa", async () => {
    const l = await lerMeusDados("user-1", "maria@exemplo.com");
    expect(l.perfil).toEqual({ full_name: "Maria", cpf: "52998224725" });
    expect(l.anamnese).toEqual([{ aluno_id: "aluno-1", dores_lesoes: "joelho" }]);
    expect(l.mensagensMentor).toHaveLength(1);
    // O ponto de partida é a pessoa logada; as partes vêm pelas matrículas dela.
    expect(chamadas).toContainEqual({ tabela: "alunos", metodo: "eq", args: ["user_id", "user-1"] });
    expect(chamadas).toContainEqual({ tabela: "anamnese_acolhimento", metodo: "in", args: ["aluno_id", ["aluno-1", "aluno-2"]] });
    // Em páginas: a API para em mil linhas sem avisar.
    expect(chamadas.some((c) => c.tabela === "mensagens_treino" && c.metodo === "range")).toBe(true);
  });

  it("uma parte que falha derruba o arquivo inteiro, em vez de sair incompleto", async () => {
    respostas.mensagens_dieta = { data: null, error: { message: "permission denied" } };
    await expect(lerMeusDados("user-1", null)).rejects.toThrow("permission denied");
  });

  it("monta as seções e põe o nome da academia em cada matrícula", async () => {
    const l = await lerMeusDados("user-1", "maria@exemplo.com");
    const arquivo = montarMeusDados(l, "2026-10-06T12:00:00.000Z");
    expect(Object.keys(arquivo)).toEqual([
      "sobre",
      "cadastro",
      "saude",
      "avaliacoes_fisicas",
      "treinos",
      "dietas",
      "presencas",
      "mensagens",
      "autorizacoes",
      "pagamentos",
    ]);
    expect(arquivo.cadastro.email_de_acesso).toBe("maria@exemplo.com");
    expect(arquivo.cadastro.matriculas.map((m) => m.academia)).toEqual(["Academia Um", null]);
    expect(arquivo.saude.anamnese).toHaveLength(1);
    expect(nomeDoArquivoMeusDados("2026-10-06")).toBe("meus-dados-arkefit-2026-10-06.json");
  });

  it("lê com a sessão da pessoa, cobre o que a lei pede e deixa de fora o que é do negócio", () => {
    const codigo = readFileSync(join(__dirname, "meusDados.ts"), "utf8");
    // Nada de service role nem de edge function: o arquivo tem o que o RLS dela mostra.
    expect(codigo).not.toMatch(/functions\.invoke|service_role|SERVICE_ROLE/);
    const tabelas = new Set([...codigo.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]));
    for (const t of [
      "profiles",
      "alunos",
      "anamnese_acolhimento",
      "aluno_parq",
      "avaliacoes_fisicas",
      "treinos",
      "registro_treino",
      "dietas",
      "dieta_adesao",
      "presencas",
      "checkins",
      "mensagens_treino",
      "mensagens_dieta",
      "mensagens_mentor",
      "aluno_consentimento_ia",
      "aluno_consentimento_biometrico",
      "aceites_documentos",
      "aluno_assinaturas_contrato",
      "responsavel_aceites",
      "mensalidades",
      "cobrancas_avulsas",
    ]) {
      expect(tabelas.has(t), t).toBe(true);
    }
    // A divisão do pagamento entre a academia e a ArkeFit não é dado do aluno.
    expect(codigo).not.toMatch(/valor_repasse_arke|valor_liquido_academia|taxa_gateway/);
  });
});
