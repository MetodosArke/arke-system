import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // O aviso do Vite volta a valer a partir de 500 kB (estava em 1000 para
    // calar o pacote principal, de 1.065 kB até 07/10/2026).
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // As bibliotecas que todo mundo baixa ao abrir o app, em arquivos
        // próprios: elas mudam só quando a versão muda, e o navegador as
        // guarda de um deploy para o outro. Antes, cada deploy trocava o
        // pacote principal inteiro, bibliotecas junto. Só entra aqui o que já
        // está no pacote inicial (`pacoteInicial.guarda`): uma biblioteca de
        // tela só, agrupada aqui, passaria a ser baixada por todo mundo.
        manualChunks(id) {
          const caminho = id.replace(/\\/g, "/");
          if (!caminho.includes("/node_modules/")) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(caminho)) return "vendor-react";
          if (caminho.includes("/node_modules/@supabase/")) return "vendor-supabase";
          if (/\/node_modules\/@sentry(-internal)?\//.test(caminho)) return "vendor-sentry";
          if (caminho.includes("/node_modules/@tanstack/")) return "vendor-query";
          return undefined;
        },
      },
    },
  },
}));
