import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { situacaoConsentimentoSaude, VERSAO_CONSENTIMENTO_SAUDE } from "./consentimentoSaude";

/**
 * Trava da auditoria de 05/10/2026: o consentimento de saúde é do titular.
 *
 * A regra de alteração de `anamnese_acolhimento` deixa a equipe escrever a
 * anamnese do aluno do Free, e com ela as colunas do consentimento: a equipe
 * dava o consentimento em nome do aluno. E a Política promete que o aluno
 * revoga a qualquer momento, sem que houvesse como.
 *
 * Falha se o gatilho deixar de conferir o titular, se a retirada esquecer uma
 * resposta da anamnese (coluna nova entra na retirada ou na lista do que
 * fica), ou se a tela de Privacidade perder a retirada.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8").replace(/\r\n/g, "\n");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const todas = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ler("supabase", "migrations", f).replace(/--[^\n]*/g, "").toLowerCase());

function ultimaFuncao(nome: string): string {
  const re = new RegExp(`create or replace function public\\.${nome}\\s*\\([\\s\\S]*?\\$\\$;`, "g");
  let ultima = "";
  for (const sql of todas) for (const m of sql.match(re) ?? []) ultima = m;
  return ultima;
}

/** As colunas de anamnese_acolhimento no types.ts gerado. */
function colunasDaAnamnese(): string[] {
  const tipos = ler("src", "integrations", "supabase", "types.ts");
  const inicio = tipos.indexOf("      anamnese_acolhimento: {\n        Row: {");
  const fim = tipos.indexOf("        }", inicio + 40);
  return [...tipos.slice(inicio, fim).matchAll(/^ {10}(\w+): /gm)].map((m) => m[1]);
}

/** O que fica na linha depois da retirada, e por quê. */
const FICAM: Record<string, string> = {
  id: "a linha fica, como prova",
  aluno_id: "de quem é",
  organization_id: "de qual academia",
  created_at: "quando a anamnese foi feita",
  updated_at: "o gatilho de sempre",
  consentimento_lgpd_aceito_em: "a data do aceite fica como prova de quando foi dado",
  consentimento_lgpd_revogado_em: "a data da retirada",
};

describe("consentimento de saúde: só o titular concede", () => {
  it("o gatilho confere o titular na concessão, e nasce sem EXECUTE para a API", () => {
    const corpo = ultimaFuncao("consentimento_saude_so_do_titular");
    expect(corpo, "a função existe").not.toBe("");
    expect(corpo).toMatch(/a\.id = new\.aluno_id and a\.user_id = auth\.uid\(\)/);
    expect(corpo).toMatch(/errcode = '42501'/);
    // Autorizar de novo zera a retirada anterior.
    expect(corpo).toMatch(/new\.consentimento_lgpd_revogado_em := null/);
    const sql = todas.join("\n");
    expect(sql).toMatch(
      /create trigger trg_consentimento_saude_so_do_titular before insert or update on public\.anamnese_acolhimento/
    );
  });

  it("a retirada confere quem chama, recusa o perfil simulado e apaga o resumo da IA", () => {
    const corpo = ultimaFuncao("revogar_consentimento_saude");
    expect(corpo, "a função existe").not.toBe("");
    expect(corpo).toMatch(/a\.id = _aluno_id and a\.user_id = auth\.uid\(\)/);
    expect(corpo).toMatch(/public\.sessao_simulada\(\)/);
    expect(corpo).toMatch(/delete from public\.sentinela_anamnese where aluno_id = _aluno_id/);
    expect(corpo).toMatch(/consentimento_lgpd_versao = null/);
    expect(corpo).toMatch(/consentimento_lgpd_revogado_em = now\(\)/);
  });

  it("a retirada apaga toda resposta da anamnese, ou diz por que ela fica", () => {
    const colunas = colunasDaAnamnese();
    expect(colunas.length, "o detector detecta").toBeGreaterThan(15);
    const corpo = ultimaFuncao("revogar_consentimento_saude");
    const esquecidas = colunas.filter((c) => !FICAM[c] && !new RegExp(`\\b${c} = (null|now\\(\\))`).test(corpo));
    expect(esquecidas, "apague na retirada ou explique em FICAM").toEqual([]);
  });

  it("o aluno retira pelo app, e o acolhimento não o prende depois", () => {
    const tela = ler("src", "components", "privacidade", "ConsentimentoSaude.tsx");
    expect(tela).toMatch(/rpc\("revogar_consentimento_saude"/);
    expect(tela).toMatch(/emPerfilSimulado\(\)/);
    expect(tela).toMatch(/EFEITO_RETIRAR_CONSENTIMENTO_SAUDE/);
    expect(ler("src", "pages", "app", "AlunoPerfil.tsx")).toMatch(/<ConsentimentoSaude alunoId=\{alunoId\} \/>/);
    expect(ler("src", "App.tsx")).toMatch(/if \(consentimentoSaudeRetirado\) return <>\{children\}<\/>;/);
  });
});

describe("situação do consentimento de saúde", () => {
  const base = { consentimento_lgpd_aceito_em: null, consentimento_lgpd_versao: null, consentimento_lgpd_revogado_em: null };
  it("sem anamnese, nada a mostrar", () => {
    expect(situacaoConsentimentoSaude(null)).toEqual({ tipo: "sem_anamnese" });
  });
  it("aceite da versão vigente é autorizado", () => {
    expect(
      situacaoConsentimentoSaude({ ...base, consentimento_lgpd_aceito_em: "2026-10-01T10:00:00Z", consentimento_lgpd_versao: VERSAO_CONSENTIMENTO_SAUDE })
    ).toEqual({ tipo: "autorizado", em: "2026-10-01T10:00:00Z" });
  });
  it("aceite de texto antigo não conta", () => {
    expect(
      situacaoConsentimentoSaude({ ...base, consentimento_lgpd_aceito_em: "2026-09-01T10:00:00Z", consentimento_lgpd_versao: "2026-01-01" })
    ).toEqual({ tipo: "pendente" });
  });
  it("a retirada vence o aceite que ficou como prova", () => {
    expect(
      situacaoConsentimentoSaude({
        consentimento_lgpd_aceito_em: "2026-09-01T10:00:00Z",
        consentimento_lgpd_versao: null,
        consentimento_lgpd_revogado_em: "2026-10-06T10:00:00Z",
      })
    ).toEqual({ tipo: "retirado", em: "2026-10-06T10:00:00Z" });
  });
});
