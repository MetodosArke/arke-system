import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dividir, regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";
import { TAREFAS_DE_SAUDE } from "./acessoPainel";

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

/**
 * Trava da auditoria de prontidão de 06/10/2026 (20261398010000): a recepção
 * não lê as tarefas de saúde. A ficha e o histórico já escondiam, mas o RLS
 * dava à recepção, pela API, a tarefa de dor ("Relatou dor no joelho").
 *
 * Falha se algum termo da equipe da academia (leitura, as duas metades da
 * alteração e a exclusão) deixar de pedir "não é de saúde, ou quem pede
 * atende a saúde", ou se a lista do banco divergir da ficha.
 */
const SAUDE_COM_QUEM_ATENDE = "not tarefa_de_saude(tipo) or atende_saude(organization_id)";

function definicaoVigente(nome: string): string {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of textosDaReconstrucao()) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima;
}

describe("tarefas: a saúde fica com quem atende", () => {
  it("todo termo da equipe da academia esconde a saúde de quem não atende, na leitura, na alteração e na exclusão", () => {
    const metades: [string, string | null][] = [
      ["leitura (using)", regras.get("leitura")!.using],
      ["alteração (using)", regras.get("alteração")!.using],
      ["alteração (with check)", regras.get("alteração")!.withCheck],
      ["exclusão (using)", regras.get("exclusão")!.using],
    ];
    for (const [metade, expr] of metades) {
      const daEquipe = termos(expr).filter((t) => t.includes("is_org_staff"));
      expect(daEquipe.length, metade).toBeGreaterThan(0);
      for (const t of daEquipe) expect(condicoes(t), `${metade}: ${t}`).toContain(SAUDE_COM_QUEM_ATENDE);
    }
  });

  it("os tipos de saúde do banco são os da ficha", () => {
    const funcao = definicaoVigente("tarefa_de_saude");
    expect(funcao, "a função existe").not.toBe("");
    const lista = funcao.match(/any\s*\(\s*array\[([^\]]*)\]/i)?.[1] ?? "";
    expect([...lista.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...TAREFAS_DE_SAUDE].sort());
  });

  it("o leitor acha a recepção lendo a dor (a trava trava)", () => {
    const solta = regrasVigentes(
      [
        `create policy "leitura" on public.tarefas for select to authenticated using ((is_org_staff((select auth.uid()), organization_id) and dono = 'academia' and (not tarefa_de_saude(tipo::text) or atende_saude(organization_id))));`,
        `alter policy "leitura" on public.tarefas using ((is_org_staff((select auth.uid()), organization_id) and dono = 'academia'));`,
      ],
      "public.tarefas",
    );
    const t = termos(solta.get("leitura")!.using).find((x) => x.includes("is_org_staff"))!;
    expect(condicoes(t)).not.toContain(SAUDE_COM_QUEM_ATENDE);
  });
});

/**
 * Trava das sobras da frente B (07/10/2026, 20261405010000): o Acompanhamento
 * ARKE (`get_atendimentos_mentor_organizacao`) entrega à academia os
 * atendimentos do mentor com os alunos do Método, e entregava o tipo, o
 * motivo e o desfecho da tarefa de dor e da de anamnese. No Método, a saúde
 * do aluno é do mentor: a academia vê que o atendimento aconteceu, e não do
 * que se tratou.
 *
 * Falha se o tipo, o motivo ou o desfecho saírem da função sem passar por
 * `tarefa_de_saude()`, ou se a linha de saúde chegar a quem não atende a
 * saúde (a recepção).
 */
const SAUDE_DA_TAREFA = String.raw`(?:public\.)?tarefa_de_saude\(t\.tipo(?:::text)?\)`;

/** As colunas da tarefa que saem da função sem a troca da saúde (`case when tarefa_de_saude(...) then <sem t.> else t.x end`). */
function colunasDeSaudeSoltas(funcao: string): string[] {
  const corpo = funcao.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const semAsTrocas = corpo
    .replace(
      new RegExp(String.raw`case when ${SAUDE_DA_TAREFA} then (?:(?!\bt\.)[^;])*? else t\.(?:tipo|motivo|desfecho_acao) end`, "g"),
      "",
    )
    .replace(new RegExp(SAUDE_DA_TAREFA, "g"), "");
  return [...semAsTrocas.matchAll(/\bt\.(tipo|motivo|desfecho_acao)\b/g)].map((m) => m[1]);
}

/** O que decide se a linha de saúde sai: o termo depois de `not tarefa_de_saude(t.tipo) or`, aberto se for variável. */
function quemVeASaude(funcao: string): string {
  const corpo = funcao.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
  const termo = corpo.match(new RegExp(String.raw`not ${SAUDE_DA_TAREFA} or ([\w.]+(?:\([^)]*\))?)`))?.[1] ?? "";
  if (!termo) return "";
  return corpo.match(new RegExp(String.raw`\b${termo.replace(/[.()]/g, "\\$&")} := ([^;]*);`))?.[1] ?? termo;
}

describe("o Acompanhamento ARKE não entrega a saúde do aluno do Método à academia", () => {
  const funcao = definicaoVigente("get_atendimentos_mentor_organizacao");

  it("o tipo, o motivo e o desfecho passam por tarefa_de_saude()", () => {
    expect(funcao, "a função existe").not.toBe("");
    expect(colunasDeSaudeSoltas(funcao)).toEqual([]);
    // A troca existe para as três colunas.
    const corpo = funcao.replace(/\s+/g, " ").toLowerCase();
    for (const coluna of ["tipo", "motivo", "desfecho_acao"]) {
      expect(corpo, coluna).toMatch(new RegExp(String.raw`case when ${SAUDE_DA_TAREFA} then [^;]*? else t\.${coluna} end`));
    }
  });

  it("a linha de saúde sai só para quem atende a saúde e para a ArkeFit, e não para a recepção", () => {
    const quem = quemVeASaude(funcao);
    expect(quem, "a condição foi achada").not.toBe("");
    expect(quem).toMatch(/^(public\.)?atende_saude\(_organization_id\)/);
    expect(quem, "toda a equipe veria").not.toMatch(/is_org_staff|is_org_member/);
  });

  it("o leitor acha a versão de antes, que entregava o motivo da dor (a trava trava)", () => {
    const antes = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261230010000_operacao_mentor.sql"), "utf8");
    const definicao = antes.match(/create or replace function public\.get_atendimentos_mentor_organizacao\([\s\S]*?\n\$\$;/)?.[0] ?? "";
    expect(definicao).not.toBe("");
    expect(colunasDeSaudeSoltas(definicao).sort()).toEqual(["desfecho_acao", "motivo", "tipo"]);
    expect(quemVeASaude(definicao)).toBe("");
  });
});
