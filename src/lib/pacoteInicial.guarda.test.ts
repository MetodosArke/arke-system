import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * O pacote inicial do app: o que todo mundo baixa ao abrir, antes de qualquer
 * tela (auditoria de prontidão, 07/10/2026). Segue os imports estáticos a
 * partir de `src/main.tsx`, sem os `import()`, que viram arquivos à parte, e
 * confere o que chega lá.
 *
 * Até 07/10 chegavam: o menu do painel e o da Visão Master (os layouts), os
 * três documentos legais inteiros, os exportadores do encerramento e o
 * framer-motion, só para duas animações do login. O pacote principal tinha
 * 1.065 kB (329 kB comprimido) no `vite build` com o Sentry ligado.
 *
 * Pacote novo no inicial é decisão: entra na lista, com o motivo.
 */

const SRC = join(__dirname, "..");
const EXTENSOES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Os pacotes que o pacote inicial pode ter, e por quê. */
const PACOTES_DO_INICIAL: Record<string, string> = {
  react: "o app",
  "react-dom": "o app",
  "react-router-dom": "as rotas",
  "@tanstack/react-query": "as consultas",
  "@supabase/supabase-js": "a sessão e o acesso",
  "@sentry/react": "o erro na subida do app também é reportado",
  sonner: "os avisos",
  "next-themes": "o tema dos avisos",
  "lucide-react": "os ícones do login e dos portões",
  clsx: "classes",
  "tailwind-merge": "classes",
  "class-variance-authority": "variantes dos botões",
  "@radix-ui/react-toast": "os avisos",
  "@radix-ui/react-tooltip": "o provedor das dicas",
  "@radix-ui/react-slot": "os botões",
  "@radix-ui/react-label": "o login e as duas etapas",
  "@radix-ui/react-checkbox": "o login e o aceite dos documentos",
};

/** O que nunca entra: pesado, e de uma tela só. */
const NUNCA_NO_INICIAL = ["framer-motion", "recharts", "jspdf", "pdfjs-dist", "xlsx", "html2canvas", "qrcode", "@dnd-kit/core", "embla-carousel-react", "cmdk"];

function resolver(de: string, alvo: string): string | null {
  const limpo = alvo.replace(/\?raw$/, "");
  let base: string;
  if (limpo.startsWith("@/")) base = join(SRC, limpo.slice(2));
  else if (limpo.startsWith(".")) base = resolve(dirname(de), limpo);
  else return null;
  for (const e of EXTENSOES) {
    const p = base + e;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

function grafoInicial() {
  const arquivos = new Set<string>();
  const pacotes = new Map<string, string>();
  const andar = (arquivo: string) => {
    if (arquivos.has(arquivo)) return;
    arquivos.add(arquivo);
    if (!/\.(ts|tsx)$/.test(arquivo)) return;
    const texto = readFileSync(arquivo, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto))) {
      const alvo = m[3];
      if (m[2] || alvo.endsWith(".css")) continue;
      const r = resolver(arquivo, alvo);
      if (r) andar(r);
      else if (!alvo.startsWith(".") && !alvo.startsWith("@/")) {
        const nome = alvo.startsWith("@") ? alvo.split("/").slice(0, 2).join("/") : alvo.split("/")[0];
        if (!pacotes.has(nome)) pacotes.set(nome, relative(SRC, arquivo).replace(/\\/g, "/"));
      }
    }
  };
  andar(join(SRC, "main.tsx"));
  return { arquivos: [...arquivos].map((a) => relative(SRC, a).replace(/\\/g, "/")), pacotes };
}

describe("o pacote inicial do app", () => {
  const { arquivos, pacotes } = grafoInicial();

  it("o leitor acha o app (o detector detecta)", () => {
    expect(arquivos).toContain("App.tsx");
    expect(arquivos).toContain("contexts/AuthContext.tsx");
    expect(pacotes.has("react")).toBe(true);
  });

  it("só os pacotes da lista, cada um com o motivo", () => {
    const fora = [...pacotes].filter(([p]) => !PACOTES_DO_INICIAL[p]).map(([p, por]) => `${p} (por ${por})`);
    expect(fora, "pacote novo no inicial: baixe sob demanda, ou ponha na lista com o motivo").toEqual([]);
    for (const p of NUNCA_NO_INICIAL) expect(PACOTES_DO_INICIAL[p], p).toBeUndefined();
  });

  it("os layouts, os exportadores do encerramento e o texto dos documentos legais não entram", () => {
    const proibidos = arquivos.filter(
      (a) =>
        /^components\/layout\/(AppLayout|AdminLayout|SuperAdminLayout|AdminSidebar|SuperAdminSidebar|AppSidebar)\.tsx$/.test(a) ||
        /^components\/admin\/Exportar/.test(a) ||
        a.startsWith("content/legal/") ||
        a === "lib/documentosLegaisTexto.ts" ||
        a.startsWith("pages/"),
    );
    // O login e a página não encontrada são as exceções de propósito (App.tsx).
    expect(proibidos.filter((a) => a !== "pages/auth/Login.tsx" && a !== "pages/NotFound.tsx")).toEqual([]);
  });
});
