import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTERVALO_PESQUISA_DIAS,
  NOTA_MAXIMA_DETRATOR,
  PRIMEIRA_PESQUISA_DIAS,
  devePerguntar,
  npsPorMes,
  resumoNps,
  type EstadoPesquisa,
} from "./pesquisaSatisfacao";

const base: EstadoPesquisa = { liberado: true, dataMatricula: "2026-09-01", ultimaResposta: null, ultimoAdiamento: null };

describe("quando a home pergunta", () => {
  it("a primeira vez 30 dias depois da matrícula, nem um dia antes", () => {
    expect(devePerguntar(base, "2026-09-30")).toBe(false);
    expect(devePerguntar(base, "2026-10-01")).toBe(true);
  });

  it("depois de responder, só 90 dias depois (uma resposta por janela)", () => {
    const respondeu = { ...base, ultimaResposta: "2026-10-01" };
    expect(devePerguntar(respondeu, "2026-10-01")).toBe(false);
    expect(devePerguntar(respondeu, "2026-12-29")).toBe(false);
    expect(devePerguntar(respondeu, "2026-12-30")).toBe(true);
  });

  it("'Agora não' adia 7 dias", () => {
    const adiou = { ...base, ultimoAdiamento: "2026-10-01" };
    expect(devePerguntar(adiou, "2026-10-01")).toBe(false);
    expect(devePerguntar(adiou, "2026-10-07")).toBe(false);
    expect(devePerguntar(adiou, "2026-10-08")).toBe(true);
  });

  it("nunca para quem o banco não libera (pausado, bloqueado ou com a matrícula encerrada)", () => {
    expect(devePerguntar({ ...base, liberado: false }, "2027-06-01")).toBe(false);
  });

  it("a conta atravessa o mês e o ano", () => {
    expect(devePerguntar({ ...base, dataMatricula: "2026-12-15" }, "2027-01-13")).toBe(false);
    expect(devePerguntar({ ...base, dataMatricula: "2026-12-15" }, "2027-01-14")).toBe(true);
  });
});

describe("o NPS", () => {
  it("promotores 9–10, neutros 7–8, detratores 0–6; a nota é % promotores − % detratores", () => {
    expect(resumoNps([10, 9, 8, 7, 6, 0])).toEqual({ respostas: 6, promotores: 2, neutros: 2, detratores: 2, nps: 0 });
    expect(resumoNps([10, 10, 10, 6])).toMatchObject({ nps: 50 });
    expect(resumoNps([0, 3])).toMatchObject({ nps: -100 });
    expect(resumoNps([9, 9, 7])).toMatchObject({ nps: 67 });
  });

  it("sem resposta, sem nota (e não zero)", () => {
    expect(resumoNps([])).toEqual({ respostas: 0, promotores: 0, neutros: 0, detratores: 0, nps: null });
  });

  it("por mês de Brasília, do mais antigo ao mais novo", () => {
    const meses = npsPorMes([
      { nota: 10, created_at: "2026-10-05T12:00:00Z" },
      // 23h de 30/09 em Brasília: é setembro, embora já seja outubro em UTC.
      { nota: 2, created_at: "2026-10-01T02:00:00Z" },
      { nota: 9, created_at: "2026-10-20T12:00:00Z" },
    ]);
    expect(meses.map((m) => [m.mes, m.respostas, m.nps])).toEqual([
      ["2026-09", 1, -100],
      ["2026-10", 2, 100],
    ]);
  });
});

/**
 * O banco confere a janela de novo ao gravar, e abre a tarefa da nota baixa.
 * Os números moram nos dois lados; se um mudar sozinho, a home pergunta e o
 * banco recusa (ou a tarefa nasce para a nota errada).
 */
describe("o banco diz o mesmo que a tela", () => {
  const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
  const ultima = (funcao: string) => {
    const re = new RegExp(String.raw`create or replace function public\.${funcao}\s*\([\s\S]*?\n\$\$;`, "g");
    let achada = "";
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      for (const m of readFileSync(join(MIGRATIONS, f), "utf8").matchAll(re)) achada = m[0];
    }
    return achada;
  };

  it("a janela e a nota baixa", () => {
    const responder = ultima("responder_pesquisa_satisfacao");
    expect(responder, "a função existe").not.toBe("");
    expect(responder).toContain(`v_estado.ultima_resposta + ${INTERVALO_PESQUISA_DIAS}`);
    expect(responder).toContain(`v_estado.data_matricula + ${PRIMEIRA_PESQUISA_DIAS}`);
    expect(responder).toContain(`_nota <= ${NOTA_MAXIMA_DETRATOR}`);
  });
});
