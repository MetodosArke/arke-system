import pino from "pino";

// Sem transport customizado de propósito: `pino-pretty` usa worker threads,
// que complicam o empacotamento com pkg para o .exe. Isto roda como
// serviço de segundo plano (bandeja do sistema), então log estruturado em
// JSON (redirecionado a um arquivo pelo instalador) é mais útil que bonito.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});
