import { describe, expect, it } from "vitest";
import { regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";
import { TAREFAS_DE_SAUDE } from "./acessoPainel";

/**
 * Trava da auditoria de prontidão de 06/10/2026: o histórico do aluno na ficha
 * (`get_historico_aluno`) mostra só o que quem pede pode ver.
 *
 * Ele rodava com a permissão da função e devolvia à recepção e ao professor o
 * que o RLS das tabelas esconde deles: as tarefas do mentor, a dieta, o
 * comentário de saúde do check-in e, no aluno do Método, o que é da ArkeFit.
 * Agora roda com a permissão de quem chama (20261394010000), e cada parte
 * passa pelo RLS da tabela de origem. O que o RLS não diz (a recepção não vê
 * saúde) usa a mesma função das regras, `atende_saude()`, e a mesma lista da
 * ficha.
 *
 * Falha se a função voltar a `security definer`, se ler uma tabela sem regra
 * de leitura, se a lista de tarefas de saúde divergir da ficha, ou se o
 * comentário do check-in sair sem a conferência da saúde.
 */
const textos = textosDaReconstrucao();

function definicaoVigente(nome: string): string {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of textos) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima;
}

const funcao = definicaoVigente("get_historico_aluno");
const corpo = funcao.toLowerCase();

describe("histórico do aluno pelo RLS", () => {
  it("a função existe e roda com a permissão de quem chama", () => {
    expect(funcao, "a definição foi achada").not.toBe("");
    expect(corpo).toMatch(/\bsecurity\s+invoker\b/);
    expect(corpo).not.toMatch(/\bsecurity\s+definer\b/);
  });

  it("toda tabela que ela lê tem regra de leitura (o RLS é quem filtra)", () => {
    const tabelas = [...new Set([...corpo.matchAll(/\bfrom\s+public\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(tabelas).toEqual(
      [
        "agendamentos",
        "aluno_fase_historico",
        "aluno_observacoes",
        "alunos",
        "checkins",
        "dietas",
        "organization_members",
        "profiles",
        "tarefas",
        "treinos",
      ].sort(),
    );
    for (const t of tabelas) {
      const leitura = [...regrasVigentes(textos, `public.${t}`).values()].filter(
        (r) => !r.restritiva && (r.comando === "select" || r.comando === "all"),
      );
      expect(leitura.length, `public.${t} sem regra de leitura`).toBeGreaterThan(0);
    }
  });

  it("quem pede: a equipe da academia, ou a ArkeFit só no aluno do Método", () => {
    expect(corpo).toMatch(/if not \(public\.is_org_staff\(auth\.uid\(\), v_org\) or \(v_metodo and public\.equipe_metodo\(\)\)\) then/);
    expect(corpo).not.toMatch(/has_role\(auth\.uid\(\), 'admin_arke'\)/);
  });

  it("a saúde é de quem atende: a mesma função do RLS", () => {
    expect(corpo).toMatch(/v_ve_saude := public\.atende_saude\(v_org\) or \(v_metodo and public\.equipe_metodo\(\)\);/);
    // O comentário e o motivo do check-in, e a nota da fase (no Método, só a ArkeFit).
    expect(corpo).toMatch(/case when v_ve_saude then c\.comentario end/);
    expect(corpo).toMatch(/case when v_ve_saude then coalesce\(' \(' \|\| replace\(c\.motivo_dificuldade/);
    expect(corpo).toMatch(/case when \(case when v_metodo then public\.equipe_metodo\(\) else v_ve_saude end\) then h\.observacao end/);
    expect(corpo).not.toMatch(/,\s*c\.comentario,/);
  });

  it("as tarefas de saúde são as mesmas da ficha, nas duas partes da fila", () => {
    const listas = [...corpo.matchAll(/v_ve_saude or t\.tipo::text <> all \(array\[([^\]]*)\]\)/g)].map((m) =>
      [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort(),
    );
    expect(listas.length, "a pendência aberta e a resolvida").toBe(2);
    for (const l of listas) expect(l).toEqual([...TAREFAS_DE_SAUDE].sort());
  });

  it("o autor que o RLS não mostra vira a equipe, e não some", () => {
    expect(corpo.match(/'equipe arkefit'/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(corpo).toMatch(/'equipe da academia'/);
  });
});
