import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketsDoRepositorio, bucketsDoRoteiro, bucketsDosTextos } from "../../scripts/migracao/buckets.mjs";
import { normalizar, regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";
import { ROTEIRO, lerTexto } from "../../scripts/migracao/rotinas.mjs";

/**
 * Trava da auditoria de prontidão de 06/10/2026, no molde de
 * `rotinasBanco.guarda`: o roteiro de reconstrução
 * (`scripts/migracao/02-depois-da-restauracao.sql`) cria todos os buckets.
 *
 * O bucket é dado, não schema, e não sai no dump. A lista do roteiro era
 * escrita à mão e esquecia `termos-biometria` (20261250010000), e as regras de
 * `storage.objects` dele eram as de 20261214010000: numa reconstrução, o termo
 * da digital não teria bucket nem regra, e o teto diário de envio
 * (20261322010000) sumiria.
 *
 * Falha quando uma migration cria ou altera um bucket e o roteiro não tem o
 * mesmo, quando uma tela ou função usa um bucket que o roteiro não cria, e
 * quando uma regra de `storage.objects` muda numa migration e o roteiro fica
 * com a versão velha.
 */
const RAIZ = join(__dirname, "..", "..");
const roteiro = lerTexto(join(RAIZ, ROTEIRO));
const doRoteiro = bucketsDoRoteiro(roteiro);
const doRepositorio = bucketsDoRepositorio(RAIZ);

/**
 * O retrato de produção lido em 06/10/2026: nome e se é público. Bucket novo
 * de migration entra aqui junto (`equipe-arkefit-documentos`, 20261430010000).
 */
const PRODUCAO: Record<string, boolean> = {
  atestados: false,
  avatars: true,
  "chat-videos": false,
  dietas: false,
  "email-assets": true,
  "equipe-arkefit-documentos": false,
  "exercicio-imagens": true,
  "exercicio-videos": true,
  "feed-images": true,
  "termos-biometria": false,
};

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("buckets na reconstrução", () => {
  it("o roteiro cria os buckets de produção, com o público e o privado de cada um", () => {
    expect([...doRoteiro.keys()].sort()).toEqual(Object.keys(PRODUCAO).sort());
    for (const [id, publico] of Object.entries(PRODUCAO)) {
      expect(doRoteiro.get(id)?.campos.public, id).toBe(publico);
    }
  });

  it("todo bucket que uma migration cria ou altera está no roteiro, com os mesmos valores", () => {
    expect(doRepositorio.size, "o leitor achou os buckets das migrations").toBeGreaterThanOrEqual(7);
    const divergencias: string[] = [];
    for (const [id, b] of doRepositorio) {
      const r = doRoteiro.get(id);
      if (!r) {
        divergencias.push(`${id}: falta no roteiro`);
        continue;
      }
      for (const [campo, valor] of Object.entries(b.campos)) {
        if (JSON.stringify(r.campos[campo]) !== JSON.stringify(valor)) {
          divergencias.push(`${id}.${campo}: migrations ${JSON.stringify(valor)}, roteiro ${JSON.stringify(r.campos[campo])}`);
        }
      }
    }
    expect(divergencias).toEqual([]);
    expect(doRepositorio.get("termos-biometria")?.criado).toBe(true);
  });

  it("todo bucket privado tem limite de tamanho e de tipo no roteiro", () => {
    for (const [id, b] of doRoteiro) {
      if (b.campos.public !== false) continue;
      expect(b.campos.file_size_limit, id).toBeGreaterThan(0);
      expect(Array.isArray(b.campos.allowed_mime_types), id).toBe(true);
    }
  });

  it("todo bucket que o app e as funções usam está no roteiro", () => {
    const usados = new Set<string>();
    for (const caminho of [...arquivos(join(RAIZ, "src")), ...arquivos(join(RAIZ, "supabase", "functions"))]) {
      const texto = readFileSync(caminho, "utf8");
      for (const m of texto.matchAll(/storage\s*\.from\(\s*["'`]([a-z0-9-]+)["'`]\s*\)/g)) usados.add(m[1]);
      for (const m of texto.matchAll(/const BUCKETS_[A-Z_]+ = \[([^\]]*)\]/g)) {
        for (const b of m[1].matchAll(/"([a-z0-9-]+)"/g)) usados.add(b[1]);
      }
    }
    expect(usados.size).toBeGreaterThanOrEqual(8);
    expect([...usados].filter((b) => !doRoteiro.has(b)).sort()).toEqual([]);
  });

  it("as regras de storage.objects do roteiro são as vigentes nas migrations", () => {
    const vigentes = regrasVigentes(textosDaReconstrucao(RAIZ), "storage.objects");
    const noRoteiro = regrasVigentes([roteiro], "storage.objects");
    expect([...noRoteiro.keys()].sort()).toEqual([...vigentes.keys()].sort());
    for (const [nome, r] of vigentes) {
      const s = noRoteiro.get(nome)!;
      expect(normalizar(s.using), `${nome} (using)`).toBe(normalizar(r.using));
      expect(normalizar(s.withCheck), `${nome} (with check)`).toBe(normalizar(r.withCheck));
      expect(s.comando, nome).toBe(r.comando);
    }
    expect(normalizar(noRoteiro.get("objetos: inclusão")!.withCheck)).toContain("termos-biometria");
    expect(normalizar(noRoteiro.get("objetos: inclusão")!.withCheck)).toContain("envio_dentro_do_teto(bucket_id, name)");
  });

  it("o leitor entende as formas usadas nas migrations", () => {
    const b = bucketsDosTextos([
      "insert into storage.buckets (id, name, public) values ('a', 'a', true) on conflict (id) do nothing;",
      "-- update storage.buckets set public = true where id = 'comentario';",
      "update storage.buckets set public = false where id in ('a', 'b');",
      "update storage.buckets\n   set file_size_limit = 10,\n       allowed_mime_types = array['x/y','z/w']\n where id = 'a';",
      "insert into storage.buckets (id, name, public, file_size_limit) values ('a', 'a', true, 99) on conflict (id) do nothing;",
      "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('c', 'c', false, 5, null)\non conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;",
    ]);
    expect(b.get("a")).toEqual({ criado: true, campos: { public: false, file_size_limit: 10, allowed_mime_types: ["x/y", "z/w"] } });
    expect(b.get("b")).toEqual({ criado: false, campos: { public: false } });
    expect(b.get("c")).toEqual({ criado: true, campos: { public: false, file_size_limit: 5, allowed_mime_types: null } });
    expect(b.has("comentario")).toBe(false);
  });
});
