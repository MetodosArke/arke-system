import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Constants } from "@/integrations/supabase/types";
import { escolherVinculo, PRIORIDADE_DO_PAPEL } from "./vinculos";
import { exercicioDoEscopo } from "@/components/prescricao/escopo";

/**
 * Quem tem dois papéis em academias diferentes (auditoria de prontidão,
 * 07/10/2026): aluno numa academia e recepção, professor ou gestão em outra.
 *
 * Dois defeitos achados:
 * - a recepção não estava na hierarquia de `escolherVinculo` e caía depois do
 *   aluno: quem era recepção numa academia e aluno em outra entrava como aluno;
 * - telas do aluno que leem o que é da academia inteira (desafios,
 *   competições) não filtravam a academia, e a regra de acesso devolvia também
 *   os da academia em que a pessoa trabalha, misturados.
 *
 * O feed já filtrava. A troca de academia recarrega a página inteira
 * (`trocarOrganizacao`), e o cache do react-query não sobrevive a isso.
 */

const RAIZ = join(__dirname, "..");
const PAPEIS_GLOBAIS = ["admin_arke", "superadmin"];

describe("a academia que abre primeiro", () => {
  it("todo papel de academia está na hierarquia, e o aluno vem por último", () => {
    const papeis = Constants.public.Enums.app_role.filter((p) => !PAPEIS_GLOBAIS.includes(p));
    for (const papel of papeis) {
      expect(PRIORIDADE_DO_PAPEL[papel], `o papel ${papel} não está na hierarquia de escolherVinculo`).toBeTypeOf("number");
    }
    const ultimo = Math.max(...papeis.map((p) => PRIORIDADE_DO_PAPEL[p]));
    expect(PRIORIDADE_DO_PAPEL.aluno).toBe(ultimo);
    expect(papeis.filter((p) => PRIORIDADE_DO_PAPEL[p] === ultimo)).toEqual(["aluno"]);
  });

  it("recepção numa academia e aluno em outra: entra na recepção, qualquer que seja a ordem", () => {
    const aluno = { role: "aluno", created_at: "2025-01-01T00:00:00Z", organization_id: "org-a" };
    const recepcao = { role: "recepcao", created_at: "2025-06-01T00:00:00Z", organization_id: "org-b" };
    expect(escolherVinculo([aluno, recepcao])?.organization_id).toBe("org-b");
    expect(escolherVinculo([recepcao, aluno])?.organization_id).toBe("org-b");
  });

  it("a unidade escolhida no seletor continua vencendo", () => {
    const aluno = { role: "aluno", created_at: "2025-01-01T00:00:00Z", organization_id: "org-a" };
    const recepcao = { role: "recepcao", created_at: "2025-06-01T00:00:00Z", organization_id: "org-b" };
    expect(escolherVinculo([aluno, recepcao], "org-a")?.organization_id).toBe("org-a");
  });
});

describe("as telas não misturam as duas academias", () => {
  it("o seletor de exercícios da prescrição mostra o acervo padrão e o da academia do aluno, e não o das outras", () => {
    const academia = { tipo: "academia" as const, organizationId: "org-a" };
    expect(exercicioDoEscopo(academia, null)).toBe(true);
    expect(exercicioDoEscopo(academia, "org-a")).toBe(true);
    expect(exercicioDoEscopo(academia, "org-b")).toBe(false);
    const metodo = { tipo: "metodo" as const, aluno: { id: "al-1", nome: "Ana", organizationId: "org-b" } };
    expect(exercicioDoEscopo(metodo, null)).toBe(true);
    expect(exercicioDoEscopo(metodo, "org-b")).toBe(true);
    expect(exercicioDoEscopo(metodo, "org-a")).toBe(false);
  });

  // O que é da academia inteira, e não de uma pessoa: a regra de acesso devolve
  // o de todas as academias de quem pede, e a leitura fixa a academia.
  const TABELAS_DA_ACADEMIA = ["desafios", "competicoes", "feed_posts", "comunicados"];

  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((n) => {
      const p = join(pasta, n);
      if (statSync(p).isDirectory()) return arquivos(p);
      return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
  }

  it("toda leitura dessas tabelas fixa a organização", () => {
    const soltas: string[] = [];
    let lidas = 0;
    for (const arquivo of [...arquivos(join(RAIZ, "pages")), ...arquivos(join(RAIZ, "components")), ...arquivos(join(RAIZ, "hooks"))]) {
      const texto = readFileSync(arquivo, "utf8");
      const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto))) {
        if (!TABELAS_DA_ACADEMIA.includes(m[1])) continue;
        const fim = texto.indexOf(";", m.index);
        const cadeia = texto.slice(m.index, fim < 0 ? m.index + 600 : fim);
        if (!/\.select\(/.test(cadeia) || /\.(insert|update|upsert|delete)\(/.test(cadeia)) continue;
        lidas++;
        if (!/\.eq\(\s*["'`]organization_id["'`]/.test(cadeia)) {
          const linha = texto.slice(0, m.index).split("\n").length;
          soltas.push(`${relative(RAIZ, arquivo).replace(/\\/g, "/")}:${linha} (${m[1]})`);
        }
      }
    }
    expect(lidas, "a varredura não achou leitura nenhuma: o padrão mudou?").toBeGreaterThan(2);
    expect(soltas, `leitura sem a organização: ${soltas.join(", ")}`).toEqual([]);
  });
});
