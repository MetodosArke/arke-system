import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caminhoDaUrlPublica } from "../../supabase/functions/_shared/arquivosDoAluno";

/**
 * Trava da decisão de 06/10/2026 (auditoria de prontidão, D1): a saída do
 * aluno age sobre a academia que pede, e não sobre a pessoa.
 *
 * Antes, `excluir-aluno` apagava a conta de login, e a cascata levava a
 * matrícula e o histórico da pessoa em todas as academias; `anonimizar-aluno`
 * trocava o perfil e o login, que são da pessoa, e anonimizava só nome, CPF e
 * telefone. O trabalho do banco mora em `anonimizar_dados_do_aluno` e
 * `excluir_aluno_da_academia`.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");

const ler = (...partes: string[]) => readFileSync(join(...partes), "utf8");
const HISTORICO = join(RAIZ, "supabase", "historico");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ nome: f, sql: ler(MIGRATIONS, f).toLowerCase() }));
// Algumas tabelas nasceram por fora das migrations e só aparecem no retrato
// fiel de como o banco foi construído (`supabase/historico/`).
const historico = readdirSync(HISTORICO)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ nome: f, sql: ler(HISTORICO, f).toLowerCase() }));

/** A última definição de uma função, entre todas as migrations. */
function ultimaDefinicao(funcao: string): string {
  const re = new RegExp(`create or replace function public\\.${funcao}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "g");
  let ultima = "";
  for (const m of migrations) for (const achado of m.sql.match(re) ?? []) ultima = achado;
  return ultima;
}

/** Tabelas com coluna `aluno_id`, pelas migrations (criadas e não apagadas). */
function tabelasComAluno(): Set<string> {
  const tabelas = new Set<string>();
  for (const m of [...historico, ...migrations]) {
    for (const c of m.sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/g)) {
      if (/\baluno_id\b/.test(c[2])) tabelas.add(c[1]);
    }
    for (const c of m.sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)\s+add column (?:if not exists )?aluno_id\b/g)) {
      tabelas.add(c[1]);
    }
    for (const c of m.sql.matchAll(/drop table (?:if exists )?(?:public\.)?(\w+)/g)) tabelas.delete(c[1]);
  }
  return tabelas;
}

/**
 * O que fica depois da anonimização, e por quê. Tabela nova com `aluno_id`
 * entra aqui (com o motivo) ou na função `anonimizar_dados_do_aluno`.
 */
const FICAM: Record<string, string> = {
  aluno_assinaturas: "registro financeiro do Método, guardado pelo prazo legal",
  aluno_matriculas_academia: "registro financeiro do plano da academia",
  mensalidades: "registro financeiro",
  cobrancas_avulsas: "registro financeiro",
  notas_fiscais: "registro fiscal",
  staff_comissoes_lancamentos: "comissão da equipe, registro contábil",
  presencas: "com o aluno anonimizado, vira só contagem",
  tarefas: "registro do atendimento da equipe",
  gateway_comandos: "a ordem de tirar a digital do equipamento precisa rodar depois",
};

describe("saída do aluno", () => {
  it("a anonimização alcança toda tabela com dado do aluno, ou diz por que ela fica", () => {
    const corpo = ultimaDefinicao("anonimizar_dados_do_aluno");
    expect(corpo, "a função existe").not.toBe("");
    const tabelas = tabelasComAluno();
    expect(tabelas.size, "o detector detecta").toBeGreaterThan(30);
    const esquecidas = [...tabelas].filter((t) => !FICAM[t] && !new RegExp(`public\\.${t}\\b`).test(corpo)).sort();
    expect(esquecidas, "trate na função ou explique em FICAM").toEqual([]);
  });

  it("a anonimização mexe no perfil e no login só sem outro vínculo", () => {
    const corpo = ultimaDefinicao("anonimizar_dados_do_aluno");
    expect(corpo).toMatch(/if not v_outros then\s+update public\.profiles/);
    const funcao = ler(FUNCOES, "anonimizar-aluno", "index.ts");
    expect(funcao).not.toMatch(/from\("profiles"\)/);
    expect(funcao).toMatch(/rpc\("anonimizar_dados_do_aluno"/);
    expect(funcao).toMatch(/if \(!outrosVinculos\) \{\s+const \{ error: authUpdateError \} = await adminClient\.auth\.admin\.updateUserById/);
    expect(funcao.match(/updateUserById/g)?.length).toBe(1);
  });

  it("excluir de vez é só academia em teste, e a conta só sai sem outro vínculo", () => {
    const corpo = ultimaDefinicao("excluir_aluno_da_academia");
    expect(corpo).toMatch(/v_org_status is distinct from 'trial'/);
    const funcao = ler(FUNCOES, "excluir-aluno", "index.ts");
    expect(funcao).toMatch(/orgDoAluno\?\.status !== "trial"/);
    expect(funcao).toMatch(/if \(resultado\.apagar_conta\) \{\s+const \{ error: contaError \} = await adminClient\.auth\.admin\.deleteUser/);
    expect(funcao.match(/deleteUser/g)?.length).toBe(1);
    expect(funcao.indexOf('rpc("excluir_aluno_da_academia"')).toBeLessThan(funcao.indexOf("deleteUser"));
  });

  it("nenhum usuário logado chama as funções de saída", () => {
    const todas = migrations.map((m) => m.sql).join("\n");
    for (const f of ["anonimizar_dados_do_aluno", "excluir_aluno_da_academia", "pessoa_tem_outro_vinculo"]) {
      expect(todas).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`));
      expect(todas).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to [^;]*authenticated`));
    }
  });

  it("a URL pública do Storage vira bucket e caminho; o resto é ignorado", () => {
    expect(caminhoDaUrlPublica("https://x.supabase.co/storage/v1/object/public/feed-images/org/a%20b.jpg")).toEqual({
      bucket: "feed-images",
      caminho: "org/a b.jpg",
    });
    expect(caminhoDaUrlPublica("https://exemplo.com/foto.jpg")).toBeNull();
  });
});

describe("acesso da equipe", () => {
  it("editar a equipe recusa aluno como alvo", () => {
    const funcao = ler(FUNCOES, "editar-membro-equipe", "index.ts");
    expect(funcao).toMatch(/if \(!PAPEIS_VALIDOS\.has\(targetMembership\.role/);
    expect(funcao.indexOf("PAPEIS_VALIDOS.has(targetMembership.role")).toBeLessThan(funcao.indexOf("updateUserById"));
  });

  it("o resumo da anamnese segue a separação do Método, e a recepção fica de fora", () => {
    const funcao = ler(FUNCOES, "sentinela-anamnese", "index.ts");
    expect(funcao).toMatch(/const equipe = \["gestor", "professor", "nutricionista"\]\.includes/);
    expect(funcao).toMatch(/if \(noMetodo \? !arkefit : !equipe\)/);
  });
});
