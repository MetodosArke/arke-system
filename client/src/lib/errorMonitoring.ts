// Observabilidade de erro do cliente — mesmo racional do lado do servidor
// (server/_core/errorMonitoring.ts): inerte até VITE_SENTRY_DSN existir.
import * as Sentry from "@sentry/react";

let initialized = false;

export function initErrorMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || initialized) return;
  Sentry.init({ dsn, environment: import.meta.env.MODE });
  initialized = true;
}

export function captureException(error: unknown, extra?: Record<string, unknown>) {
  console.error(error);
  if (!initialized) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}
