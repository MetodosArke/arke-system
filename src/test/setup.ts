import "@testing-library/jest-dom";

// jsdom não implementa ResizeObserver, e o ResponsiveContainer do recharts
// depende dele — sem este stub, qualquer teste que renderize um gráfico
// estoura com "ResizeObserver is not defined".
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// O jsdom troca o AbortSignal do Node pelo dele, que não tem timeout(). As
// edge functions usam AbortSignal.timeout em toda chamada externa, e os
// testes que importam o código delas quebrariam sem isto.
if (typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controle = new AbortController();
    setTimeout(() => controle.abort(new DOMException("Tempo esgotado", "TimeoutError")), ms);
    return controle.signal;
  };
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
