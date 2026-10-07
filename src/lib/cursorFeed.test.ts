import { describe, expect, it } from "vitest";
import { depoisDoCursor, proximoCursor, type CursorFeed } from "./cursorFeed";

/** Os posts de um feed, do mais novo ao mais antigo, como a consulta ordena. */
function feed(n: number): CursorFeed[] {
  // Três posts por instante, para o desempate pelo id contar.
  return Array.from({ length: n }, (_, i) => ({
    created_at: new Date(Date.UTC(2026, 9, 6, 12, 0, 0) - Math.floor(i / 3) * 1000).toISOString(),
    id: `00000000-0000-4000-8000-${String(999_999 - i).padStart(12, "0")}`,
  }));
}

/** O que `depoisDoCursor` pede ao banco, feito aqui: data menor, ou a mesma data e id menor. */
function depois(c: CursorFeed | null, todos: CursorFeed[]) {
  return todos.filter((p) => !c || p.created_at < c.created_at || (p.created_at === c.created_at && p.id < c.id));
}

describe("cursor do feed", () => {
  it("passa de mil posts sem repetir nem pular nenhum, em páginas de 15", () => {
    const todos = feed(1_234);
    const vistos: string[] = [];
    let cursor: CursorFeed | null = null;
    for (let paginas = 0; paginas < 200; paginas++) {
      const pagina = depois(cursor, todos).slice(0, 15);
      vistos.push(...pagina.map((p) => p.id));
      const proximo = proximoCursor(pagina, 15);
      if (!proximo) break;
      cursor = proximo;
    }
    expect(vistos).toHaveLength(1_234);
    expect(new Set(vistos).size).toBe(1_234);
    expect(vistos).toEqual(todos.map((p) => p.id));
  });

  it("acaba quando a página vem incompleta", () => {
    expect(proximoCursor(feed(14), 15)).toBeUndefined();
    expect(proximoCursor([], 15)).toBeUndefined();
    const pagina = feed(15);
    expect(proximoCursor(pagina, 15)).toEqual(pagina[14]);
  });

  it("o filtro leva a data e o id entre aspas", () => {
    const c = { created_at: "2026-10-06T21:00:00.123456+00:00", id: "00000000-0000-4000-8000-000000000001" };
    expect(depoisDoCursor(c)).toBe(
      'created_at.lt."2026-10-06T21:00:00.123456+00:00",and(created_at.eq."2026-10-06T21:00:00.123456+00:00",id.lt."00000000-0000-4000-8000-000000000001")',
    );
  });
});
