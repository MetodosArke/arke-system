import type { TurnstileBrand } from "@shared/turnstile";

// Ponto de extensão para tradução de protocolo por marca (CLAUDE.md §8.4):
// nenhuma marca mapeada tem hoje um protocolo confirmado o suficiente para
// o backend falar com o hardware diretamente (ver nota em server/access.ts
// — Control iD é a mais próxima disso, mas só na rede local do
// equipamento). Por isso todo adaptador aqui só monta um comando genérico
// de sinalização (entregue via Supabase Realtime, server/turnstileRealtime.ts)
// para o agente local — que é quem sabe o protocolo nativo do
// equipamento e faz o teste de verdade. Trocar de marca não deveria
// exigir tocar em nenhuma linha deste arquivo até um adaptador real (que
// monte um payload específico daquele fabricante) ser escrito.
export type TurnstileCommand = { action: "test_connection"; requestedAt: string };

export type TurnstileAdapter = {
  buildTestConnectionCommand(): TurnstileCommand;
};

const genericAdapter: TurnstileAdapter = {
  buildTestConnectionCommand: () => ({ action: "test_connection", requestedAt: new Date().toISOString() }),
};

// Nenhuma marca tem adaptador específico ainda — todas caem no genérico.
const adapters: Partial<Record<TurnstileBrand, TurnstileAdapter>> = {};

export const TurnstileAdapterFactory = {
  forBrand(brand: TurnstileBrand): TurnstileAdapter {
    return adapters[brand] ?? genericAdapter;
  },
};
