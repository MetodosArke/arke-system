// Marcas de catraca/controle de acesso mapeadas para o onboarding da
// organização (CLAUDE.md §4/§8.4) — fonte única para cliente e servidor
// (antes duplicado em client/src/pages/Home.tsx e SaasPage.tsx). O campo
// `brand` aqui é só metadado (qual equipamento a academia já tem
// instalado) — nenhuma marca tem lógica de protocolo própria neste
// backend hoje (ver nota em server/access.ts sobre o contrato HTTP
// genérico); adicionar uma marca nova é seguro e não muda decisão nenhuma.
export const TURNSTILE_BRAND_KEYS = ["control_id", "topdata", "henry", "dimep", "intelbras", "zkteco", "nitgen", "hikvision", "madis", "primme", "nedap", "suprema", "outra"] as const;
export type TurnstileBrand = (typeof TURNSTILE_BRAND_KEYS)[number];

export const TURNSTILE_BRAND_LABEL: Record<TurnstileBrand, string> = {
  control_id: "Control iD",
  topdata: "Topdata",
  henry: "Henry",
  dimep: "Dimep",
  intelbras: "Intelbras",
  zkteco: "ZKTeco",
  nitgen: "Nitgen",
  hikvision: "Hikvision",
  madis: "Madis",
  primme: "Primme",
  nedap: "Nedap",
  suprema: "Suprema",
  outra: "Outra",
};
