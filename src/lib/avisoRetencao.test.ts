import { describe, expect, it } from "vitest";
import {
  AVISO_PUSH,
  avisosDoDia,
  dentroDoHorario,
  diasEntre,
  emailDoAviso,
  horaBrasilia,
  type Candidato,
} from "../../supabase/functions/aviso-retencao-aluno/regras";
import { caminhoDoApp } from "../../supabase/functions/send-chat-push/regras";

const HOJE = "2026-10-26";

const aluno = (mudar: Partial<Candidato> = {}): Candidato => ({
  primeiro_acesso: true,
  convite_permitido: false,
  matriculado_em: "2026-09-01",
  parado_desde: null,
  atestado_validade: null,
  lembretes_de_treino: true,
  tem_push: true,
  ficticia: false,
  avisos: [],
  ...mudar,
});

/** O dia `dias` antes de hoje. */
const ha = (dias: number) => new Date(Date.parse(`${HOJE}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

describe("aviso de retenção: os dias sem treinar", () => {
  it("o 1º aviso sai no 3º dia sem treinar, no celular", () => {
    expect(avisosDoDia(aluno({ parado_desde: ha(2) }), HOJE)).toEqual([]);
    expect(avisosDoDia(aluno({ parado_desde: ha(3) }), HOJE)).toEqual([
      { tipo: "inatividade_1", referencia: ha(3), canais: ["push"] },
    ]);
  });

  it("sem aviso no celular ligado, o 1º vai por e-mail", () => {
    expect(avisosDoDia(aluno({ parado_desde: ha(3), tem_push: false }), HOJE)[0].canais).toEqual(["email"]);
  });

  it("o 2º sai no 5º dia, no celular e por e-mail, depois do 1º", () => {
    const enviadoOntem = [{ tipo: "inatividade_1", referencia: ha(5), enviado_em: `${ha(2)}T13:30:00Z` }];
    expect(avisosDoDia(aluno({ parado_desde: ha(5), avisos: enviadoOntem }), HOJE)).toEqual([
      { tipo: "inatividade_2", referencia: ha(5), canais: ["push", "email"] },
    ]);
    expect(avisosDoDia(aluno({ parado_desde: ha(4), avisos: [{ ...enviadoOntem[0], referencia: ha(4) }] }), HOJE)).toEqual([]);
  });

  it("parado há 5 dias sem o 1º: sai o 1º hoje, e o 2º só num dia seguinte", () => {
    expect(avisosDoDia(aluno({ parado_desde: ha(5) }), HOJE).map((a) => a.tipo)).toEqual(["inatividade_1"]);
    const enviadoHoje = [{ tipo: "inatividade_1", referencia: ha(5), enviado_em: `${HOJE}T13:30:00Z` }];
    expect(avisosDoDia(aluno({ parado_desde: ha(5), avisos: enviadoHoje }), HOJE)).toEqual([]);
  });

  it("cada aviso sai uma vez por período parado", () => {
    const os2 = [
      { tipo: "inatividade_1", referencia: ha(8), enviado_em: `${ha(5)}T13:30:00Z` },
      { tipo: "inatividade_2", referencia: ha(8), enviado_em: `${ha(3)}T13:30:00Z` },
    ];
    expect(avisosDoDia(aluno({ parado_desde: ha(8), avisos: os2 }), HOJE)).toEqual([]);
  });

  it("voltou a treinar: o período muda e a sequência recomeça, sem teto semanal", () => {
    const doPeriodoAnterior = [
      { tipo: "inatividade_1", referencia: ha(12), enviado_em: `${ha(9)}T13:30:00Z` },
      { tipo: "inatividade_2", referencia: ha(12), enviado_em: `${ha(7)}T13:30:00Z` },
    ];
    // Treinou há 3 dias (depois dos dois avisos) e parou de novo.
    expect(avisosDoDia(aluno({ parado_desde: ha(3), avisos: doPeriodoAnterior }), HOJE)).toEqual([
      { tipo: "inatividade_1", referencia: ha(3), canais: ["push"] },
    ]);
  });

  it("passados 14 dias parado, o aviso automático já não sai", () => {
    expect(avisosDoDia(aluno({ parado_desde: ha(14) }), HOJE)).toHaveLength(1);
    expect(avisosDoDia(aluno({ parado_desde: ha(15) }), HOJE)).toEqual([]);
  });

  it("quem desligou os lembretes não recebe os de treino", () => {
    expect(avisosDoDia(aluno({ parado_desde: ha(3), lembretes_de_treino: false }), HOJE)).toEqual([]);
  });
});

describe("aviso de retenção: o convite", () => {
  const semAcesso = (mudar: Partial<Candidato> = {}) =>
    aluno({ primeiro_acesso: false, convite_permitido: true, matriculado_em: ha(3), ...mudar });

  it("sem o primeiro acesso, só o convite, por e-mail, uma vez", () => {
    expect(avisosDoDia(semAcesso(), HOJE)).toEqual([{ tipo: "convite", referencia: ha(3), canais: ["email"] }]);
    const jaFoi = [{ tipo: "convite", referencia: ha(3), enviado_em: `${ha(1)}T13:30:00Z` }];
    expect(avisosDoDia(semAcesso({ avisos: jaFoi }), HOJE)).toEqual([]);
  });

  it("sem o primeiro acesso, nada de treino nem de atestado", () => {
    expect(avisosDoDia(semAcesso({ parado_desde: ha(4), atestado_validade: ha(-5) }), HOJE).map((a) => a.tipo)).toEqual(["convite"]);
  });

  it("o importado fora do Método (convite não permitido) não recebe", () => {
    expect(avisosDoDia(semAcesso({ convite_permitido: false }), HOJE)).toEqual([]);
  });
});

describe("aviso de retenção: o atestado", () => {
  it("vencendo em até 15 dias: no celular e por e-mail, uma vez por atestado", () => {
    expect(avisosDoDia(aluno({ atestado_validade: ha(-14) }), HOJE)).toEqual([
      { tipo: "atestado", referencia: ha(-14), canais: ["push", "email"] },
    ]);
    expect(avisosDoDia(aluno({ atestado_validade: ha(-15) }), HOJE)).toEqual([]);
    const jaFoi = [{ tipo: "atestado", referencia: ha(-10), enviado_em: `${ha(4)}T13:30:00Z` }];
    expect(avisosDoDia(aluno({ atestado_validade: ha(-10), avisos: jaFoi }), HOJE)).toEqual([]);
  });

  it("o atestado sai mesmo com os lembretes de treino desligados", () => {
    expect(avisosDoDia(aluno({ atestado_validade: ha(-3), lembretes_de_treino: false }), HOJE)).toHaveLength(1);
  });
});

describe("aviso de retenção: a academia fictícia", () => {
  it("nenhum e-mail sai; o aviso no celular sai", () => {
    expect(avisosDoDia(aluno({ parado_desde: ha(3), ficticia: true }), HOJE)[0].canais).toEqual(["push"]);
    expect(avisosDoDia(aluno({ parado_desde: ha(3), ficticia: true, tem_push: false }), HOJE)).toEqual([]);
    expect(avisosDoDia(aluno({ primeiro_acesso: false, convite_permitido: true, matriculado_em: ha(3), ficticia: true }), HOJE)).toEqual([]);
  });
});

describe("aviso de retenção: horário e datas", () => {
  it("só das 8h às 20h de Brasília", () => {
    expect(dentroDoHorario(7)).toBe(false);
    expect(dentroDoHorario(8)).toBe(true);
    expect(dentroDoHorario(19)).toBe(true);
    expect(dentroDoHorario(20)).toBe(false);
    // 13h30 em GMT, o agendamento da rotina, é 10h em Brasília.
    expect(horaBrasilia(new Date("2026-10-26T13:30:00Z"))).toBe(10);
  });

  it("dias entre datas", () => {
    expect(diasEntre("2026-10-23", HOJE)).toBe(3);
    expect(diasEntre(HOJE, "2026-11-09")).toBe(14);
  });
});

describe("aviso de retenção: o texto", () => {
  it("o aviso no celular abre só tela do app", () => {
    for (const aviso of Object.values(AVISO_PUSH)) expect(caminhoDoApp(aviso.url)).toBe(aviso.url);
  });

  it("a tela bloqueada não leva dado de saúde nem o nome da academia", () => {
    for (const aviso of Object.values(AVISO_PUSH)) {
      expect(`${aviso.title} ${aviso.body}`).not.toMatch(/atestado|médic|saúde|PAR-Q/i);
    }
    const email = emailDoAviso("atestado", { nome: "Ana", academia: "Ponto Alto", link: "x", linkPerfil: "y", atestadoValidade: "2026-11-05" });
    expect(email.assunto).not.toMatch(/atestado|médic/i);
    expect(email.texto).toContain("05/11/2026");
  });

  it("o tom é de pergunta construtiva, sem culpa", () => {
    expect(AVISO_PUSH.inatividade_1.title).toBe("Como está sendo seguir seu plano?");
    const textos = ["inatividade_1", "inatividade_2"].flatMap((t) => {
      const e = emailDoAviso(t as "inatividade_1", { nome: "Ana", academia: "A", link: "x", linkPerfil: "y" });
      return [e.assunto, e.texto];
    });
    for (const t of [...textos, AVISO_PUSH.inatividade_1.body, AVISO_PUSH.inatividade_2.body]) {
      expect(t).not.toMatch(/faltou|perdeu|ponto|culpa|deveria/i);
    }
  });

  it("os lembretes de treino dizem como desligar; o convite traz o link de criar a senha", () => {
    expect(emailDoAviso("inatividade_2", { nome: "", academia: "A", link: "x", linkPerfil: "https://app/#/app/perfil" }).texto).toContain(
      "Lembretes de treino",
    );
    const convite = emailDoAviso("convite", { nome: "Ana Lima", academia: "Ponto Alto", link: "https://link", linkPerfil: "y" });
    expect(convite.assunto).toBe("Seu acesso à Ponto Alto está pronto");
    expect(convite.texto).toContain("Criar minha senha: https://link");
    expect(convite.texto).not.toContain("Lembretes de treino");
  });

  it("o nome vai escapado no e-mail", () => {
    expect(emailDoAviso("inatividade_1", { nome: "<b>Ana", academia: "A&B", link: "x", linkPerfil: "y" }).html).not.toMatch(/<b>Ana|A&B/);
  });
});
