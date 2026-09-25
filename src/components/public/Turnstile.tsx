import { useEffect, useRef } from "react";

// Widget do Cloudflare Turnstile para a matrícula pública. Só aparece quando
// VITE_TURNSTILE_SITE_KEY está definida; a verificação de verdade acontece em
// matricula-publica, com o secret — o que roda aqui só entrega o token.
//
// O token é de uso único: depois de uma tentativa que falhou, quem usa o
// componente o remonta (trocando a `key`) para o widget gerar outro.

type TurnstileApi = {
  render: (el: HTMLElement, opcoes: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let carregando: Promise<TurnstileApi> | null = null;

function carregarTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!carregando) {
    carregando = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = SCRIPT;
      tag.async = true;
      tag.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile não carregou")));
      tag.onerror = () => {
        carregando = null;
        reject(new Error("Turnstile não carregou"));
      };
      document.head.appendChild(tag);
    });
  }
  return carregando;
}

export function Turnstile({
  siteKey,
  onToken,
  tema = "auto",
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  tema?: "auto" | "light" | "dark";
}) {
  const alvo = useRef<HTMLDivElement>(null);
  const aoToken = useRef(onToken);
  aoToken.current = onToken;

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelado = false;
    carregarTurnstile()
      .then((api) => {
        if (cancelado || !alvo.current) return;
        widgetId = api.render(alvo.current, {
          sitekey: siteKey,
          language: "pt-br",
          theme: tema,
          callback: (token: string) => aoToken.current(token),
          "expired-callback": () => aoToken.current(null),
          "error-callback": () => aoToken.current(null),
        });
      })
      .catch(() => aoToken.current(null));
    return () => {
      cancelado = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, tema]);

  return <div ref={alvo} className="flex justify-center min-h-[65px]" />;
}
