import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTIGOS, artigoDaRota, artigosPara, buscarArtigos, publicosDaArea } from "./catalogo";

const RAIZ = join(__dirname, "..", "..", "..");
const PASTA = join(RAIZ, "src", "content", "ajuda");
const arquivos = readdirSync(PASTA).filter((f) => f.endsWith(".md"));
const texto = (slug: string) => readFileSync(join(PASTA, `${slug}.md`), "utf8");

// As rotas que o app declara, para conferir as telas e os links dos artigos.
const app = readFileSync(join(RAIZ, "src", "App.tsx"), "utf8");
const caminhos = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
const PREFIXOS = ["/app", "/admin", "/superadmin"];
function rotaExiste(rota: string) {
  const r = rota.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const casa = (padrao: string) => {
    const a = padrao.split("/");
    const b = r.split("/");
    return a.length === b.length && a.every((p, i) => p.startsWith(":") || p === b[i]);
  };
  if (caminhos.some((c) => c.startsWith("/") && casa(c))) return true;
  return PREFIXOS.some((p) => caminhos.some((c) => !c.startsWith("/") && casa(`${p}/${c}`)));
}

describe("catálogo da Central de Ajuda", () => {
  it("cada artigo tem texto, e cada texto está no catálogo", () => {
    const slugs = ARTIGOS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(arquivos.map((f) => f.replace(/\.md$/, "")).sort()).toEqual([...slugs].sort());
  });

  it("todo artigo tem público, título, resumo e texto de verdade", () => {
    for (const a of ARTIGOS) {
      expect(a.publicos.length, a.slug).toBeGreaterThan(0);
      expect(a.titulo.length, a.slug).toBeGreaterThan(5);
      expect(a.resumo.length, a.slug).toBeGreaterThan(20);
      // O título mora no catálogo; repetir no texto duplicaria na tela.
      expect(texto(a.slug).trimStart().startsWith("# "), a.slug).toBe(false);
      expect(texto(a.slug).length, a.slug).toBeGreaterThan(400);
    }
  });

  it("as telas do '?' existem, e cada tela leva a um artigo só por público", () => {
    for (const a of ARTIGOS) for (const r of a.rotas ?? []) expect(rotaExiste(r), `${a.slug}: ${r}`).toBe(true);
    for (const publico of ["gestor", "recepcao", "professor", "nutricionista", "autonomo", "aluno", "arkefit"] as const) {
      const rotas = artigosPara([publico]).flatMap((a) => a.rotas ?? []);
      expect(new Set(rotas).size, publico).toBe(rotas.length);
    }
  });

  it("imagens existem na pasta pública e links internos levam a telas ou artigos que existem", () => {
    for (const a of ARTIGOS) {
      const md = texto(a.slug);
      for (const [, src] of md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        expect(existsSync(join(RAIZ, "public", src)), `${a.slug}: ${src}`).toBe(true);
      }
      for (const [, destino] of md.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]*)\)/g)) {
        if (destino.startsWith("https://")) continue;
        const artigo = /^ajuda:([\w-]+)$/.exec(destino);
        if (artigo) {
          const alvo = ARTIGOS.find((x) => x.slug === artigo[1]);
          expect(alvo, `${a.slug}: ${destino}`).toBeTruthy();
          // Quem lê este artigo também precisa poder abrir o outro.
          expect(a.publicos.some((p) => alvo!.publicos.includes(p)), `${a.slug} → ${destino}`).toBe(true);
        } else {
          expect(destino.startsWith("/") && !/\/ajuda(\/|$)/.test(destino), `${a.slug}: use ajuda:<artigo> para ${destino}`).toBe(true);
          expect(rotaExiste(destino), `${a.slug}: ${destino}`).toBe(true);
        }
      }
    }
  });

  it("artigo do aluno só leva a telas do app", () => {
    // Um link para /admin levaria o aluno a uma tela que ele não abre.
    for (const a of ARTIGOS.filter((x) => x.publicos.includes("aluno"))) {
      expect(texto(a.slug), a.slug).not.toMatch(/\]\(\/(admin|superadmin)/);
    }
  });
});

describe("quem vê o quê", () => {
  it("cada papel vê a própria área", () => {
    expect(publicosDaArea("app", { papel: "aluno" })).toEqual(["aluno"]);
    expect(publicosDaArea("admin", { papel: "recepcao" })).toEqual(["recepcao"]);
    expect(publicosDaArea("admin", { papel: "admin_arke" })).toEqual(["gestor"]);
    expect(publicosDaArea("admin", { papel: "gestor", autonomo: true, especialidade: "nutricionista" })).toEqual(["autonomo", "nutricionista"]);
    expect(publicosDaArea("superadmin", { papel: null })).toContain("arkefit");
  });

  it("a recepção não vê o financeiro nem a Visão Master", () => {
    const slugs = artigosPara(["recepcao"]).map((a) => a.slug);
    expect(slugs).toContain("cobranca-do-aluno");
    expect(slugs).not.toContain("financeiro");
    expect(slugs.some((s) => s.startsWith("vm-"))).toBe(false);
  });

  it("o '?' acha o artigo da tela aberta", () => {
    expect(artigoDaRota("/admin/alunos/importar", ["gestor"])?.slug).toBe("importar-alunos");
    expect(artigoDaRota("/admin/alunos/", ["gestor"])?.slug).toBe("cadastrar-aluno");
    expect(artigoDaRota("/admin/financeiro", ["recepcao"])).toBeNull();
    expect(artigoDaRota("/app", ["aluno"])?.slug).toBe("app-tela-inicial");
  });
});

describe("busca", () => {
  const textos = { "importar-alunos": "Traga a planilha do EVO e confira o CPF de cada aluno." };
  const artigos = ARTIGOS.filter((a) => ["importar-alunos", "cadastrar-aluno", "financeiro"].includes(a.slug));

  it("ignora acento e caixa, e exige todas as palavras", () => {
    expect(buscarArtigos("PLANILHA evo", artigos, textos).map((r) => r.artigo.slug)).toEqual(["importar-alunos"]);
    expect(buscarArtigos("planilha inexistente", artigos, textos)).toEqual([]);
  });

  it("título vale mais que o corpo e o trecho mostra onde achou", () => {
    const r = buscarArtigos("importar", artigos, textos);
    expect(r[0].artigo.slug).toBe("importar-alunos");
    expect(buscarArtigos("cpf", artigos, textos).find((r) => r.artigo.slug === "importar-alunos")?.trecho).toContain("CPF");
  });
});
