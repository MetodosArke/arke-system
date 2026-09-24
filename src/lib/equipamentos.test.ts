import { describe, it, expect } from "vitest";
import { catracasSemSinal, ordenarEquipamentos, type EquipamentoGlobal } from "./equipamentos";

const base: EquipamentoGlobal = {
  catraca_id: "c",
  organization_id: "o",
  academia: "Academia",
  catraca: "Catraca",
  status_catraca: "ativo",
  situacao: "online",
  versao: "1.0.0",
  modelo: "controlid",
  estado: "online",
  fila_offline: 0,
  cache_alunos: 10,
  ultima_sincronizacao: null,
  ultimo_erro: null,
  ultimo_erro_em: null,
  equipamentos: [],
  ponte: null,
  capacidades: [],
  reportado_em: "2026-09-23T12:00:00Z",
  ultimo_heartbeat_em: null,
  comandos_pendentes: 0,
  comandos_falhos_7d: 0,
  acessos_hoje: 0,
  contingencias_7d: 0,
  checkins_parceiro_mes: 0,
};

describe("equipamentos da Visão Master", () => {
  it("a faixa só acusa Gateway 1.0 ativo e sem sinal", () => {
    const lista = [
      { ...base, catraca_id: "a", situacao: "offline" as const },
      // Gateway anterior: sem telemetria, não entra na faixa.
      { ...base, catraca_id: "b", situacao: "offline" as const, reportado_em: null },
      // Desativada pela academia: não é problema.
      { ...base, catraca_id: "c", situacao: "offline" as const, status_catraca: "inativo" },
      { ...base, catraca_id: "d", situacao: "contingencia" as const },
    ];
    expect(catracasSemSinal(lista).map((e) => e.catraca_id)).toEqual(["a"]);
  });

  it("ordena pelo que precisa de ação: sem sinal, contingência, nunca conectou, no ar", () => {
    const lista = [
      { ...base, catraca_id: "ok", academia: "A" },
      { ...base, catraca_id: "nunca", situacao: "nunca_conectou" as const },
      { ...base, catraca_id: "cont", situacao: "contingencia" as const },
      { ...base, catraca_id: "off", situacao: "offline" as const },
      { ...base, catraca_id: "ok-falhas", academia: "Z", comandos_falhos_7d: 2 },
    ];
    expect(ordenarEquipamentos(lista).map((e) => e.catraca_id)).toEqual(["off", "cont", "nunca", "ok-falhas", "ok"]);
  });
});
