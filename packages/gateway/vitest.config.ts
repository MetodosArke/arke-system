import { defineConfig } from "vitest/config";

export default defineConfig({
  // PostCSS inline e vazio, de propósito. Sem isto o Vite sobe pela árvore
  // de pastas procurando configuração e encontra a do app na raiz do
  // repositório, que carrega o Tailwind. Na máquina de desenvolvimento
  // passa, porque a raiz tem tudo instalado; num ambiente limpo, que só
  // instala o Gateway, os testes nem sobem. O Gateway não tem CSS.
  css: { postcss: {} },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
