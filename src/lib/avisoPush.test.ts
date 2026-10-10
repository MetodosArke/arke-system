import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  agrupamentoDaConversa,
  emLotes,
  inscricaoMorta,
  topicoDoId,
  validadeDoComunicado,
  VALIDADE_SEG,
} from "../../supabase/functions/_shared/avisoPush";

const ALUNO = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("aviso no celular: agrupamento, validade e lotes", () => {
  it("a conversa vira etiqueta e tópico de 32 caracteres, no alfabeto que o cabeçalho aceita", () => {
    const g = agrupamentoDaConversa(`treino:${ALUNO}`);
    expect(g).toEqual({ etiqueta: "treino:0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d", topico: "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d" });
    expect(g!.topico).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(agrupamentoDaConversa(`dieta:${ALUNO.toUpperCase()}`)?.etiqueta).toBe("dieta:0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d");
  });

  it("conversa fora do formato não agrupa", () => {
    expect(agrupamentoDaConversa(`mentor:${ALUNO}`)?.etiqueta).toBe("mentor:0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d");
    for (const c of [undefined, "", "outro:" + ALUNO, "treino:123", `treino:${ALUNO} `.repeat(2), 42]) {
      expect(agrupamentoDaConversa(c)).toBeNull();
    }
    expect(topicoDoId(ALUNO)).toBe("0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d");
    expect(topicoDoId("nao-e-uuid")).toBeNull();
  });

  it("o comunicado vale até expirar, entre 1 hora e 7 dias; sem data, 3 dias", () => {
    const agora = Date.parse("2026-10-05T12:00:00Z");
    expect(validadeDoComunicado(null, agora)).toBe(VALIDADE_SEG.comunicadoSemData);
    expect(validadeDoComunicado("2026-10-06T12:00:00Z", agora)).toBe(86400);
    expect(validadeDoComunicado("2026-10-05T12:10:00Z", agora)).toBe(3600);
    expect(validadeDoComunicado("2026-10-04T12:00:00Z", agora)).toBe(3600);
    expect(validadeDoComunicado("2026-12-31T00:00:00Z", agora)).toBe(7 * 86400);
    expect(validadeDoComunicado("lixo", agora)).toBe(VALIDADE_SEG.comunicadoSemData);
  });

  it("lotes de 25", () => {
    const lotes = emLotes(Array.from({ length: 60 }, (_, i) => i));
    expect(lotes.map((l) => l.length)).toEqual([25, 25, 10]);
    expect(emLotes([])).toEqual([]);
  });

  it("só a inscrição que não existe mais sai do banco", () => {
    expect(inscricaoMorta(404, "")).toBe(true);
    expect(inscricaoMorta(410, "")).toBe(true);
    expect(inscricaoMorta(403, "the VAPID credentials in the authorization header do not correspond")).toBe(true);
    expect(inscricaoMorta(403, "forbidden")).toBe(false);
    expect(inscricaoMorta(429, "")).toBe(false);
    expect(inscricaoMorta(undefined, undefined)).toBe(false);
  });
});

describe("todo aviso no celular sai pelo envio compartilhado", () => {
  it("só _shared/push.ts usa o web-push", () => {
    const raiz = join(__dirname, "..", "..", "supabase", "functions");
    const arquivos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const c = join(dir, n);
        return statSync(c).isDirectory() ? arquivos(c) : /\.tsx?$/.test(n) ? [c] : [];
      });
    const usam = arquivos(raiz)
      .filter((f) => /npm:web-push|sendNotification\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(raiz, f).split("\\").join("/"));
    expect(usam).toEqual(["_shared/push.ts"]);
    expect(existsSync(join(raiz, "_shared", "push.ts"))).toBe(true);
  });

  it("o service worker agrupa pela etiqueta", () => {
    const sw = readFileSync(join(__dirname, "..", "..", "public", "sw.js"), "utf8");
    expect(sw).toMatch(/options\.tag = data\.tag/);
    expect(sw).toMatch(/options\.renotify = true/);
  });
});
