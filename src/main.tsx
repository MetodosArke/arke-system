import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { isSupabaseConfigured } from "./integrations/supabase/client.ts";
import { iniciarMonitoramento } from "./lib/monitoramento.ts";
import "./index.css";
import { destinoNoApp } from "./lib/landing.ts";

// Antes de qualquer render: erro na própria subida do app é o mais caro de
// diagnosticar sem rastreamento, porque não sobra nem tela para reclamar.
iniciarMonitoramento();

const rootElement = document.getElementById("root")!;

// Com o app no endereço próprio (VITE_APP_HOST), uma rota do app aberta em
// arkefit.com.br — link antigo, QR Code impresso, e-mail de convite — vai para
// lá com o caminho e os tokens inteiros. Sem a variável, nada muda.
const destinoApp = destinoNoApp(
  { host: window.location.hostname, hash: window.location.hash, search: window.location.search },
  import.meta.env.VITE_APP_HOST as string | undefined,
);
if (destinoApp) window.location.replace(destinoApp);

// PWA: registra o service worker (também usado para push notifications)
// para que o app seja instalável na tela inicial, sobretudo em /app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("[pwa] Falha ao registrar o service worker:", error);
    });
  });
}

if (!isSupabaseConfigured) {
  rootElement.innerHTML = `
    <div style="display:flex;min-height:100vh;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font-family:system-ui,sans-serif;">
      <h1 style="font-size:18px;font-weight:600;margin:0;">Configuração ausente</h1>
      <p style="max-width:420px;font-size:14px;color:#666;margin:0;">
        As variáveis de ambiente VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY não foram
        definidas no build. Configure-as no projeto (Vercel &gt; Settings &gt; Environment Variables)
        e faça um novo deploy.
      </p>
    </div>
  `;
} else if (!destinoApp) {
  createRoot(rootElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
