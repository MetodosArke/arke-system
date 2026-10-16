import { describe, expect, it } from "vitest";
import {
  AVISO_COBRANCA,
  diasDeAtraso,
  emHorarioComercial,
  etapaDoAviso,
  relogioBrasilia,
  TOPICO_COBRANCA,
} from "../../supabase/functions/aviso-cobranca-atrasada/regras";
import { caminhoDoApp } from "../../supabase/functions/send-chat-push/regras";

const vencida = (vencimento: string, d1: string | null = null, d3: string | null = null) => ({
  vencimento,
  aviso_cobranca_d1_em: d1,
  aviso_cobranca_d3_em: d3,
});

describe("aviso da mensalidade vencida: quando sai", () => {
  it("D+1 e D+2 são do primeiro aviso; D+3 a D+5, do segundo", () => {
    expect(etapaDoAviso(vencida("2026-10-14"), "2026-10-15")).toBe("d1");
    expect(etapaDoAviso(vencida("2026-10-13"), "2026-10-15")).toBe("d1");
    expect(etapaDoAviso(vencida("2026-10-12"), "2026-10-15")).toBe("d3");
    expect(etapaDoAviso(vencida("2026-10-10"), "2026-10-15")).toBe("d3");
  });

  it("no dia do vencimento e antes dele, nada: ainda não é dívida", () => {
    expect(etapaDoAviso(vencida("2026-10-15"), "2026-10-15")).toBeNull();
    expect(etapaDoAviso(vencida("2026-10-20"), "2026-10-15")).toBeNull();
  });

  it("depois do D+5 o aluno já está bloqueado, e o aviso não sai", () => {
    expect(etapaDoAviso(vencida("2026-10-09"), "2026-10-15")).toBeNull();
    expect(etapaDoAviso(vencida("2026-09-15"), "2026-10-15")).toBeNull();
  });

  it("não repete: a etapa já reservada não sai de novo", () => {
    expect(etapaDoAviso(vencida("2026-10-14", "2026-10-15T13:00:00Z"), "2026-10-15")).toBeNull();
    expect(etapaDoAviso(vencida("2026-10-13", "2026-10-14T13:00:00Z"), "2026-10-15")).toBeNull();
    expect(etapaDoAviso(vencida("2026-10-11", "2026-10-13T13:00:00Z", "2026-10-14T13:00:00Z"), "2026-10-15")).toBeNull();
  });

  it("o segundo sai mesmo sem o primeiro, e nunca os dois no mesmo dia", () => {
    expect(etapaDoAviso(vencida("2026-10-12"), "2026-10-15")).toBe("d3");
    for (let dias = 0; dias <= 7; dias++) {
      const venc = `2026-10-${String(20 - dias).padStart(2, "0")}`;
      const etapa = etapaDoAviso(vencida(venc), "2026-10-20");
      expect(etapa === "d1" && dias >= 3, `D+${dias}`).toBe(false);
    }
  });

  it("conta os dias pelo calendário, também na virada do mês", () => {
    expect(diasDeAtraso("2026-09-30", "2026-10-01")).toBe(1);
    expect(diasDeAtraso("2026-12-31", "2027-01-03")).toBe(3);
  });
});

describe("aviso da mensalidade vencida: horário comercial de Brasília", () => {
  it("o relógio é o de Brasília, e não o do servidor", () => {
    // 13h em GMT é 10h em Brasília; 02h em GMT de quinta ainda é quarta em Brasília.
    expect(relogioBrasilia(new Date("2026-10-15T13:00:00Z"))).toEqual({ hoje: "2026-10-15", hora: 10, diaDaSemana: 4 });
    expect(relogioBrasilia(new Date("2026-10-16T02:00:00Z"))).toEqual({ hoje: "2026-10-15", hora: 23, diaDaSemana: 4 });
  });

  it("das 9h às 18h, de segunda a sábado", () => {
    expect(emHorarioComercial({ hora: 9, diaDaSemana: 1 })).toBe(true);
    expect(emHorarioComercial({ hora: 17, diaDaSemana: 6 })).toBe(true);
    expect(emHorarioComercial({ hora: 8, diaDaSemana: 3 })).toBe(false);
    expect(emHorarioComercial({ hora: 18, diaDaSemana: 3 })).toBe(false);
    expect(emHorarioComercial({ hora: 10, diaDaSemana: 0 })).toBe(false);
  });
});

describe("aviso da mensalidade vencida: o que vai na tela bloqueada", () => {
  it("sem valor, sem data e sem nome: a tela bloqueada é pública", () => {
    expect(`${AVISO_COBRANCA.title} ${AVISO_COBRANCA.body}`).not.toMatch(/\d|R\$/);
  });

  it("o toque abre o app, nunca um endereço de fora", () => {
    expect(caminhoDoApp(AVISO_COBRANCA.url)).toBe(AVISO_COBRANCA.url);
    expect(AVISO_COBRANCA.url).toBe("/#/app");
  });

  it("o tópico cabe no cabeçalho do push", () => {
    expect(TOPICO_COBRANCA).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });
});
