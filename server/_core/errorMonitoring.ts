// Observabilidade de erro do servidor — hoje nenhuma conta do Sentry foi
// criada, então isto fica inerte até SENTRY_DSN existir como variável de
// ambiente. Sem a DSN, captureException só loga no console (mesmo
// comportamento de antes desta peça existir). Com a DSN configurada, nada
// mais no código precisa mudar.
import * as Sentry from "@sentry/node";

let initialized = false;

export function initErrorMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0 });
  initialized = true;
  process.on("unhandledRejection", (reason) => captureException(reason));
  process.on("uncaughtException", (error) => captureException(error));
}

export function captureException(error: unknown, extra?: Record<string, unknown>) {
  console.error(error);
  if (!initialized) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}
