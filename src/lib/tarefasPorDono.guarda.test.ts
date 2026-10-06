import { describe, expect, it } from "vitest";
import { dividir, regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";

/**
 * Trava da auditoria de prontidão de 06/10/2026: a fila do Mentor
 * Centralizado é a mesma `tarefas`, com `dono`, e a separação mora no RLS
 * (20261227010000 e 20261393010000).
 *
 * - A academia só lê, altera e exclui `dono = 'academia'`.
 * - O `admin_arke` só lê, altera, exclui e abre `dono = 'arkefit'`: cobrança,
 *   atestado e a fila do aluno do Free são da academia.
 * - O Super Admin vê tudo.
 *
 * Lê a versão VIGENTE de cada regra (as migrations aplicadas em ordem, porque
 * `alter policy ... using` muda só o `using`) e falha se o `admin_arke`
 * voltar a alcançar tarefa da academia, por qualquer metade de qualquer regra.
 */
const regras = regrasVigentes(textosDaReconstrucao(), "public.tarefas");
const permissivas = [...regras].filter(([, r]) => !r.restritiva);

const DONO_ARKEFIT = "dono = 'arkefit'";
const DONO_ACADEMIA = "dono = 'academia'";

/** Os termos ligados por OU de uma metade da regra. */
const termos = (expressao: string | null) => (expressao ? dividir(expressao, "or") : []);
const condicoes = (termo: string) => dividir(termo, "and");

describe("tarefas: cada lado na própria fila", () => {
  it("uma regra permissiva por operação", () => {
    expect(permissivas.map(([nome, r]) => `${nome}:${r.comando}`).sort()).toEqual([
      "alteração:update",
      "exclusão:delete",
      "inclusão:insert",
      "leitura:select",
    ]);
  });

  it("todo termo que cita o admin_arke exige dono = 'arkefit', nas duas metades de cada regra", () => {
    const soltos: string[] = [];
    for (const [nome, r] of permissivas) {
      for (const [metade, expr] of [["using", r.using], ["with check", r.withCheck]] as const) {
        for (const t of termos(expr)) {
          if (t.includes("admin_arke") && !condicoes(t).includes(DONO_ARKEFIT)) soltos.push(`${nome} (${metade}): ${t}`);
        }
      }
    }
    expect(soltos).toEqual([]);
  });

  it("a equipe da academia lê, altera e exclui só dono = 'academia'", () => {
    for (const nome of ["leitura", "alteração", "exclusão"]) {
      const r = regras.get(nome)!;
      for (const expr of [r.using, nome === "alteração" ? r.withCheck : null].filter(Boolean)) {
        const daEquipe = termos(expr).filter((t) => t.includes("is_org_staff"));
        expect(daEquipe.length, nome).toBeGreaterThan(0);
        for (const t of daEquipe) expect(condicoes(t), `${nome}: ${t}`).toContain(DONO_ACADEMIA);
      }
    }
  });

  it("o admin_arke alcança as tarefas da ArkeFit (a fila do Mentor não some)", () => {
    for (const nome of ["leitura", "alteração", "exclusão"]) {
      expect(termos(regras.get(nome)!.using), nome).toContain(`has_role((select auth.uid()), 'admin_arke') and ${DONO_ARKEFIT}`);
    }
    expect(termos(regras.get("alteração")!.withCheck)).toContain(`has_role((select auth.uid()), 'admin_arke') and ${DONO_ARKEFIT}`);
    expect(termos(regras.get("inclusão")!.withCheck)).toContain(`has_role((select auth.uid()), 'admin_arke') and ${DONO_ARKEFIT}`);
  });

  it("o Super Admin vê tudo, sem condição de dono", () => {
    for (const nome of ["leitura", "alteração", "exclusão"]) {
      expect(termos(regras.get(nome)!.using), nome).toContain("has_role((select auth.uid()), 'superadmin')");
    }
  });

  it("o leitor acha o admin_arke solto (a trava trava)", () => {
    const solta = regrasVigentes(
      [
        `create policy "leitura" on public.tarefas for select to authenticated using ((is_org_staff((select auth.uid()), organization_id) and dono = 'academia'));`,
        `alter policy "leitura" on public.tarefas using ((is_org_staff((select auth.uid()), organization_id) and dono = 'academia') or has_role((select auth.uid()), 'admin_arke'::app_role));`,
      ],
      "public.tarefas",
    );
    const t = termos(solta.get("leitura")!.using).find((x) => x.includes("admin_arke"))!;
    expect(condicoes(t)).not.toContain(DONO_ARKEFIT);
  });
});
