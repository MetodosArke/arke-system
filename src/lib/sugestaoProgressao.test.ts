import { describe, expect, it } from "vitest";
import {
  LIMIARES,
  diasEntre,
  faixasDoExercicio,
  kg,
  lerFaixa,
  passoDoEquipamento,
  papelVeSugestao,
  sugerirProgressao,
  sugestoesDoTreino,
  veSugestaoDeProgressao,
  type EntradaDoExercicio,
  type FaixaRepeticoes,
  type ItemDaFicha,
  type RegistroDoTreino,
  type SessaoDoExercicio,
} from "./sugestaoProgressao";

const HOJE = "2026-10-16";
const FAIXA_8_12: FaixaRepeticoes[] = [
  { min: 8, max: 12 },
  { min: 8, max: 12 },
  { min: 8, max: 12 },
];

/** Uma sessão de 3 séries; por padrão, 40 kg, 12 repetições em todas, esforço 6, sono e energia 4. */
function sessao(
  data: string,
  o: { carga?: number | number[]; reps?: (number | null)[]; feitas?: boolean[]; esforco?: number | null; sono?: number | null; energia?: number | null; dor?: boolean } = {},
): SessaoDoExercicio {
  const reps = o.reps ?? [12, 12, 12];
  const cargas = Array.isArray(o.carga) ? o.carga : reps.map(() => (o.carga as number | undefined) ?? 40);
  return {
    data,
    series: reps.map((r, i) => ({ numero: i + 1, cargaKg: cargas[i], repeticoes: r, concluida: o.feitas?.[i] ?? true })),
    esforco: o.esforco === undefined ? 6 : o.esforco,
    sono: o.sono === undefined ? 4 : o.sono,
    energia: o.energia === undefined ? 4 : o.energia,
    dor: o.dor ?? false,
  };
}

const entrada = (sessoes: SessaoDoExercicio[], o: Partial<EntradaDoExercicio> = {}): EntradaDoExercicio => ({
  hoje: HOJE,
  faixas: FAIXA_8_12,
  sessoes,
  dorRecente: false,
  passoKg: 2.5,
  ...o,
});

/** Dois treinos seguidos, na mesma carga, no topo da faixa e com folga: o caso de subir. */
const DOIS_NO_TOPO = [sessao("2026-10-10"), sessao("2026-10-14")];

describe("sugestão de progressão: 1. sem dado suficiente, nenhuma sugestão", () => {
  it("sem faixa de repetições em número", () => {
    const s = sugerirProgressao(entrada(DOIS_NO_TOPO, { faixas: null }));
    expect(s).toMatchObject({ tipo: "sem_dados", motivo: "sem_faixa", frase: "Ainda sem dados para sugerir", referencia: null });
  });

  it("sem nenhuma sessão", () => {
    expect(sugerirProgressao(entrada([])).tipo).toBe("sem_dados");
  });

  it("uma sessão só, por melhor que tenha sido", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-14")]))).toMatchObject({ tipo: "sem_dados", motivo: "poucas_sessoes" });
  });

  it("a sessão de mais de 21 dias atrás não conta", () => {
    expect(diasEntre("2026-09-24", HOJE)).toBe(LIMIARES.janelaDias + 1);
    expect(sugerirProgressao(entrada([sessao("2026-09-24"), sessao("2026-10-14")])).tipo).toBe("sem_dados");
    // No limite (21 dias), conta.
    expect(sugerirProgressao(entrada([sessao("2026-09-25"), sessao("2026-10-14")])).tipo).not.toBe("sem_dados");
  });

  it("a sessão sem carga ou sem repetições anotadas não conta", () => {
    const semCarga = { ...sessao("2026-10-10"), series: sessao("2026-10-10").series.map((s) => ({ ...s, cargaKg: null })) };
    expect(sugerirProgressao(entrada([semCarga, sessao("2026-10-14")])).tipo).toBe("sem_dados");
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { reps: [null, null, null] }), sessao("2026-10-14")])).tipo).toBe("sem_dados");
  });
});

describe("sugestão de progressão: 2. segurar, e a segurança vem antes", () => {
  it("dor na última sessão segura, mesmo com esforço baixo e o topo da faixa (nunca sobe)", () => {
    const s = sugerirProgressao(entrada([sessao("2026-10-10", { esforco: 3 }), sessao("2026-10-14", { esforco: 3, dor: true })]));
    expect(s).toMatchObject({ tipo: "segurar", motivo: "dor", frase: "Segurar e conversar com o aluno sobre a dor" });
  });

  it("dor nos últimos 7 dias (em outro treino, no check-in ou a progressão suspensa) segura", () => {
    expect(sugerirProgressao(entrada(DOIS_NO_TOPO, { dorRecente: true })).motivo).toBe("dor");
  });

  it("dor também segura quem não está completando", () => {
    const incompletas = { feitas: [true, true, false] };
    const s = sugerirProgressao(entrada([sessao("2026-10-10", incompletas), sessao("2026-10-14", { ...incompletas, dor: true })]));
    expect(s.motivo).toBe("dor");
  });

  it("sono ou energia até 2 na última sessão: o aluno chegou cansado", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10"), sessao("2026-10-14", { sono: 2 })]))).toMatchObject({
      tipo: "segurar",
      motivo: "cansaco",
      frase: "Segurar: o aluno chegou cansado",
    });
    expect(sugerirProgressao(entrada([sessao("2026-10-10"), sessao("2026-10-14", { energia: 1 })])).motivo).toBe("cansaco");
  });

  it("sono 3 não segura, e o cansaço da sessão anterior não conta", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10"), sessao("2026-10-14", { sono: 3, energia: 3 })])).tipo).toBe("subir");
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { sono: 1 }), sessao("2026-10-14")])).tipo).toBe("subir");
  });

  it("sem resposta de sono e energia, não segura por cansaço", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { sono: null }), sessao("2026-10-14", { sono: null, energia: null })])).tipo).toBe(
      "subir",
    );
  });

  it("cansaço com esforço no limite: segura, não revisa", () => {
    const s = sugerirProgressao(entrada([sessao("2026-10-10", { esforco: 9 }), sessao("2026-10-14", { esforco: 10, energia: 2 })]));
    expect(s.motivo).toBe("cansaco");
  });

  it("mais de 14 dias entre as duas últimas sessões: retomar com a mesma carga", () => {
    const s = sugerirProgressao(entrada([sessao("2026-09-28"), sessao("2026-10-13")]));
    expect(s).toMatchObject({ tipo: "segurar", motivo: "pausa", frase: "Retomar com a mesma carga" });
  });

  it("14 dias exatos ainda não é pausa", () => {
    expect(sugerirProgressao(entrada([sessao("2026-09-29"), sessao("2026-10-13")])).tipo).toBe("subir");
  });

  it("mais de 14 dias desde a última sessão até hoje: retomar com a mesma carga", () => {
    expect(sugerirProgressao(entrada([sessao("2026-09-27"), sessao("2026-10-01")])).motivo).toBe("pausa");
  });
});

describe("sugestão de progressão: 3. rever a carga para baixo", () => {
  it("séries não concluídas em 2 sessões seguidas", () => {
    const incompletas = { feitas: [true, true, false] };
    const s = sugerirProgressao(entrada([sessao("2026-10-10", incompletas), sessao("2026-10-14", incompletas)]));
    expect(s).toMatchObject({ tipo: "rever", motivo: "nao_completa", frase: "Rever a carga: o aluno não está completando" });
    expect(s.referencia).toBe("Se for reduzir, uma referência é tirar de 5 a 10% (cerca de 2 a 4 kg).");
  });

  it("repetições abaixo do mínimo da faixa em 2 sessões seguidas", () => {
    const abaixo = { reps: [10, 8, 7] };
    expect(sugerirProgressao(entrada([sessao("2026-10-10", abaixo), sessao("2026-10-14", abaixo)])).motivo).toBe("nao_completa");
  });

  it("só a última incompleta: mantém, e não sobe", () => {
    const s = sugerirProgressao(entrada([sessao("2026-10-10"), sessao("2026-10-14", { feitas: [true, true, false] })]));
    expect(s).toMatchObject({ tipo: "manter", frase: "Manter: ainda progredindo dentro da faixa" });
  });

  it("série que falta no registro conta como não concluída", () => {
    const duas = { reps: [12, 12] };
    expect(sugerirProgressao(entrada([sessao("2026-10-10", duas), sessao("2026-10-14", duas)])).motivo).toBe("nao_completa");
  });

  it("esforço de 9 ou mais nas 2 últimas sessões, mesmo completando", () => {
    const s = sugerirProgressao(entrada([sessao("2026-10-10", { esforco: 9 }), sessao("2026-10-14", { esforco: 10 })]));
    expect(s).toMatchObject({ tipo: "rever", motivo: "esforco_no_limite" });
  });

  it("esforço 9 numa sessão só não revisa (e 8 na outra não sobe)", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { esforco: 8 }), sessao("2026-10-14", { esforco: 9 })])).tipo).toBe("manter");
  });

  it("a referência de redução com carga pequena fica em meio quilo", () => {
    const incompletas = { carga: 6, feitas: [true, false, false] };
    const s = sugerirProgressao(entrada([sessao("2026-10-10", incompletas), sessao("2026-10-14", incompletas)]));
    expect(s.referencia).toBe("Se for reduzir, uma referência é tirar de 5 a 10% (cerca de 0,5 kg).");
  });

  it("sem carga (peso corporal anotado como 0), sem referência em quilos", () => {
    const incompletas = { carga: 0, feitas: [true, false, false] };
    expect(sugerirProgressao(entrada([sessao("2026-10-10", incompletas), sessao("2026-10-14", incompletas)])).referencia).toBeNull();
  });
});

describe("sugestão de progressão: 4. subir (dupla progressão)", () => {
  it("2 sessões seguidas, a mesma carga, todas as séries no topo da faixa e esforço até 7", () => {
    const s = sugerirProgressao(entrada(DOIS_NO_TOPO));
    expect(s).toMatchObject({
      tipo: "subir",
      motivo: "topo_da_faixa",
      frase: "Pode subir a carga: completou o topo da faixa com folga em 2 treinos",
      referencia: "Referência: cerca de +2,5 kg (de 40 para 42,5 kg).",
    });
  });

  it("acima do topo também conta, e esforço 7 é o limite da folga", () => {
    const s = sugerirProgressao(entrada([sessao("2026-10-10", { reps: [13, 12, 14], esforco: 7 }), sessao("2026-10-14", { esforco: 7 })]));
    expect(s.tipo).toBe("subir");
  });

  it("esforço 8 em uma das duas: mantém", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { esforco: 8 }), sessao("2026-10-14")])).tipo).toBe("manter");
  });

  it("sem esforço respondido não dá para dizer que sobrou folga: mantém", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { esforco: null }), sessao("2026-10-14")])).tipo).toBe("manter");
  });

  it("uma série abaixo do topo: mantém", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { reps: [12, 12, 11] }), sessao("2026-10-14")])).tipo).toBe("manter");
  });

  it("a carga mudou entre as duas: mantém (um passo por vez)", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { carga: 37.5 }), sessao("2026-10-14")])).tipo).toBe("manter");
  });

  it("a faixa de um número só: 12 é o topo e o mínimo", () => {
    const doze = [{ min: 12, max: 12 }, { min: 12, max: 12 }, { min: 12, max: 12 }];
    expect(sugerirProgressao(entrada(DOIS_NO_TOPO, { faixas: doze })).tipo).toBe("subir");
    const onze = { reps: [12, 12, 11] };
    expect(sugerirProgressao(entrada([sessao("2026-10-10", onze), sessao("2026-10-14", onze)], { faixas: doze })).motivo).toBe("nao_completa");
  });

  it("a pirâmide: cada série com a sua faixa e a sua carga", () => {
    const piramide = [{ min: 12, max: 12 }, { min: 10, max: 10 }, { min: 8, max: 8 }];
    const feita = { carga: [30, 35, 40], reps: [12, 10, 8] };
    const s = sugerirProgressao(entrada([sessao("2026-10-10", feita), sessao("2026-10-14", feita)], { faixas: piramide }));
    expect(s.tipo).toBe("subir");
    expect(s.referencia).toBe("Referência: cerca de +2,5 kg na série mais pesada (de 40 para 42,5 kg).");
  });

  it("a referência segue o passo do equipamento", () => {
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { carga: 12 }), sessao("2026-10-14", { carga: 12 })], { passoKg: 1 })).referencia).toBe(
      "Referência: cerca de +1 kg (de 12 para 13 kg).",
    );
    expect(sugerirProgressao(entrada([sessao("2026-10-10", { carga: 200 }), sessao("2026-10-14", { carga: 200 })])).referencia).toBe(
      "Referência: cerca de +5 kg (de 200 para 205 kg).",
    );
    expect(sugerirProgressao(entrada(DOIS_NO_TOPO, { passoKg: null })).referencia).toBe("Referência: o menor incremento disponível.");
  });
});

describe("sugestão de progressão: 5. manter", () => {
  it("dentro da faixa, sem sinal de parar nem de subir", () => {
    const meio = { reps: [10, 10, 9] };
    expect(sugerirProgressao(entrada([sessao("2026-10-10", meio), sessao("2026-10-14", meio)]))).toMatchObject({
      tipo: "manter",
      motivo: "progredindo",
      referencia: null,
    });
  });

  it("só as duas últimas sessões contam: a terceira de trás não muda nada", () => {
    const s = sugerirProgressao(entrada([sessao("2026-10-03", { feitas: [true, false, false], carga: 50 }), ...DOIS_NO_TOPO]));
    expect(s.tipo).toBe("subir");
  });
});

describe("a faixa de repetições e o passo do equipamento", () => {
  it("lê o número e a faixa; o resto não é faixa", () => {
    expect(lerFaixa("12")).toEqual({ min: 12, max: 12 });
    expect(lerFaixa(" 8-12 ")).toEqual({ min: 8, max: 12 });
    expect(lerFaixa("8 a 12")).toEqual({ min: 8, max: 12 });
    expect(lerFaixa("10–12")).toEqual({ min: 10, max: 12 });
    for (const t of ["30-45s", "falha", "12-10-8", "12-10", "", "0", "12 cada perna", null, undefined]) expect(lerFaixa(t)).toBeNull();
  });

  it("a faixa de cada série prescrita, do resumo ou do detalhe", () => {
    const resumo: ItemDaFicha = { ordem: 0, nome_exercicio: "Supino", series: 3, repeticoes: "10-12", descanso_seg: 60 };
    expect(faixasDoExercicio(resumo)).toEqual([{ min: 10, max: 12 }, { min: 10, max: 12 }, { min: 10, max: 12 }]);
    const piramide: ItemDaFicha = {
      ordem: 0,
      nome_exercicio: "Supino",
      series_detalhe: [
        { reps: "12", descanso_seg: 60 },
        { reps: "10", descanso_seg: 60 },
        { reps: "falha", descanso_seg: 60 },
      ],
    };
    expect(faixasDoExercicio(piramide)).toBeNull();
    expect(faixasDoExercicio({ ordem: 0, nome_exercicio: "Prancha", series: 3, repeticoes: "30-45s" })).toBeNull();
  });

  it("o passo: halter e cabo de 1 kg, barra e máquina de 2,5 kg, o resto sem passo", () => {
    expect(passoDoEquipamento("Halteres")).toBe(1);
    expect(passoDoEquipamento("Cabo")).toBe(1);
    expect(passoDoEquipamento("Barra")).toBe(2.5);
    expect(passoDoEquipamento("Máquina")).toBe(2.5);
    expect(passoDoEquipamento("Peso Corporal")).toBeNull();
    expect(passoDoEquipamento("Kettlebell")).toBeNull();
    expect(passoDoEquipamento(null)).toBeNull();
  });

  it("os quilos como o Brasil lê", () => {
    expect(kg(42.5)).toBe("42,5 kg");
    expect(kg(40)).toBe("40 kg");
    expect(kg(1.25)).toBe("1,25 kg");
  });
});

// ── O treino inteiro ───────────────────────────────────────────────────────

const SUPINO: ItemDaFicha = { ordem: 0, divisao: "A", nome_exercicio: "Supino reto", exercicio_id: "ex-supino", equipamento: "Barra", series: 3, repeticoes: "8-12" };
const REMADA: ItemDaFicha = { ordem: 1, divisao: "A", nome_exercicio: "Remada", exercicio_id: null, equipamento: "Cabo", series: 3, repeticoes: "8-12" };
const AGACHAMENTO: ItemDaFicha = { ordem: 2, divisao: "B", nome_exercicio: "Agachamento", exercicio_id: "ex-agacha", equipamento: "Barra", series: 3, repeticoes: "8-12" };

function registro(data: string, o: Partial<RegistroDoTreino> & { exercicios?: { id: string | null; ordem: number; carga?: number }[] } = {}): RegistroDoTreino {
  const exercicios = o.exercicios ?? [{ id: "ex-supino", ordem: 0 }];
  return {
    data,
    treino_id: o.treino_id === undefined ? "treino-atual" : o.treino_id,
    esforco_percebido: o.esforco_percebido === undefined ? 6 : o.esforco_percebido,
    sensacao: o.sensacao ?? "bom",
    sono: o.sono ?? null,
    energia: o.energia ?? null,
    series:
      o.series ??
      exercicios.flatMap((ex) =>
        [1, 2, 3].map((n) => ({ exercicio_id: ex.id, exercicio_ordem: ex.ordem, serie_numero: n, carga_kg: ex.carga ?? 40, repeticoes: 12, concluida: true })),
      ),
  };
}

const base = {
  hoje: HOJE,
  treino: { id: "treino-atual", exercicios: [AGACHAMENTO, REMADA, SUPINO] },
  datasComDorNoCheckin: [] as string[],
  progressaoSuspensa: false,
  consentimentoSaudeRetirado: false,
};
const doExercicio = (r: ReturnType<typeof sugestoesDoTreino>, nome: string) =>
  r.estado === "pronto" ? r.exercicios.find((e) => e.nome === nome)?.sugestao : undefined;

describe("as sugestões do treino ativo de um aluno", () => {
  it("o aluno que retirou o consentimento de saúde não recebe sugestão", () => {
    expect(sugestoesDoTreino({ ...base, registros: [registro("2026-10-10"), registro("2026-10-14")], consentimentoSaudeRetirado: true })).toEqual({
      estado: "sem_autorizacao",
    });
  });

  it("sem treino ativo", () => {
    expect(sugestoesDoTreino({ ...base, treino: null, registros: [] }).estado).toBe("sem_treino");
  });

  it("um item por exercício, na ordem da ficha (divisão e ordem)", () => {
    const r = sugestoesDoTreino({ ...base, registros: [] });
    expect(r.estado === "pronto" && r.exercicios.map((e) => `${e.divisao} ${e.nome}`)).toEqual(["A Supino reto", "A Remada", "B Agachamento"]);
  });

  it("pelo exercicio_id, a sessão de uma versão anterior do treino conta", () => {
    const r = sugestoesDoTreino({ ...base, registros: [registro("2026-10-10", { treino_id: "treino-antigo" }), registro("2026-10-14")] });
    expect(doExercicio(r, "Supino reto")?.tipo).toBe("subir");
    expect(doExercicio(r, "Supino reto")?.referencia).toBe("Referência: cerca de +2,5 kg (de 40 para 42,5 kg).");
    expect(doExercicio(r, "Agachamento")?.tipo).toBe("sem_dados");
  });

  it("sem exercicio_id, só pela ordem dentro do mesmo treino publicado", () => {
    const remada = [{ id: null, ordem: 1, carga: 30 }];
    const r = sugestoesDoTreino({
      ...base,
      registros: [registro("2026-10-10", { exercicios: remada, treino_id: "treino-antigo" }), registro("2026-10-14", { exercicios: remada })],
    });
    expect(doExercicio(r, "Remada")?.tipo).toBe("sem_dados");
    const r2 = sugestoesDoTreino({ ...base, registros: [registro("2026-10-10", { exercicios: remada }), registro("2026-10-14", { exercicios: remada })] });
    expect(doExercicio(r2, "Remada")).toMatchObject({ tipo: "subir", referencia: "Referência: cerca de +1 kg (de 30 para 31 kg)." });
  });

  it("o mesmo exercício em duas divisões: cada um pela sua ordem, sem misturar", () => {
    const supinoB: ItemDaFicha = { ...SUPINO, ordem: 5, divisao: "B", nome_exercicio: "Supino reto (B)", repeticoes: "4-6" };
    const r = sugestoesDoTreino({
      ...base,
      treino: { id: "treino-atual", exercicios: [SUPINO, supinoB] },
      registros: [registro("2026-10-10"), registro("2026-10-14")],
    });
    expect(doExercicio(r, "Supino reto")?.tipo).toBe("subir");
    expect(doExercicio(r, "Supino reto (B)")?.tipo).toBe("sem_dados");
  });

  it("dor no fim de um treino dos últimos 7 dias segura todos os exercícios, de qualquer divisão", () => {
    const r = sugestoesDoTreino({
      ...base,
      registros: [
        registro("2026-10-10"),
        registro("2026-10-12", { exercicios: [{ id: "ex-agacha", ordem: 2 }], sensacao: "dor" }),
        registro("2026-10-14"),
      ],
    });
    expect(r.estado === "pronto" && r.dor).toEqual({ recente: true, suspensa: false, ultimaData: "2026-10-12" });
    expect(doExercicio(r, "Supino reto")?.motivo).toBe("dor");
  });

  it("a dor de 8 dias atrás não segura, salvo na última sessão do exercício", () => {
    const r = sugestoesDoTreino({ ...base, registros: [registro("2026-10-08", { sensacao: "dor" }), registro("2026-10-14")] });
    expect(r.estado === "pronto" && r.dor.recente).toBe(false);
    expect(doExercicio(r, "Supino reto")?.tipo).toBe("subir");
    const r2 = sugestoesDoTreino({ ...base, registros: [registro("2026-10-01"), registro("2026-10-08", { sensacao: "dor" })] });
    expect(doExercicio(r2, "Supino reto")?.motivo).toBe("dor");
  });

  it("dor no check-in dos últimos 7 dias segura", () => {
    const r = sugestoesDoTreino({ ...base, registros: [registro("2026-10-10"), registro("2026-10-14")], datasComDorNoCheckin: ["2026-10-15"] });
    expect(r.estado === "pronto" && r.dor.ultimaData).toBe("2026-10-15");
    expect(doExercicio(r, "Supino reto")?.motivo).toBe("dor");
  });

  it("a progressão suspensa por dor segura até alguém liberar", () => {
    const r = sugestoesDoTreino({ ...base, registros: [registro("2026-10-10"), registro("2026-10-14")], progressaoSuspensa: true });
    expect(r.estado === "pronto" && r.dor).toEqual({ recente: true, suspensa: true, ultimaData: null });
    expect(doExercicio(r, "Supino reto")?.motivo).toBe("dor");
  });

  it("sono e energia do dia do treino entram na sessão", () => {
    const r = sugestoesDoTreino({ ...base, registros: [registro("2026-10-10"), registro("2026-10-14", { sono: 1, energia: 5 })] });
    expect(doExercicio(r, "Supino reto")?.motivo).toBe("cansaco");
  });
});

describe("quem vê a sugestão", () => {
  const academia = (papel: string | null, o: { tipo?: string; especialidade?: string | null } = {}) => ({
    escopo: "academia" as const,
    papel,
    tipoOrganizacao: o.tipo ?? "academia",
    especialidade: o.especialidade ?? null,
  });

  it("na academia: a gestão e o professor; a recepção e a nutricionista, não", () => {
    expect(papelVeSugestao(academia("gestor"))).toBe(true);
    expect(papelVeSugestao(academia("professor"))).toBe(true);
    expect(papelVeSugestao(academia("recepcao"))).toBe(false);
    expect(papelVeSugestao(academia("nutricionista"))).toBe(false);
    expect(papelVeSugestao(academia(null))).toBe(false);
  });

  it("no autônomo, quem é da parte do treino", () => {
    expect(papelVeSugestao(academia("gestor", { tipo: "profissional_autonomo", especialidade: "professor" }))).toBe(true);
    expect(papelVeSugestao(academia("gestor", { tipo: "profissional_autonomo", especialidade: "nutricionista" }))).toBe(false);
    expect(papelVeSugestao(academia("professor", { tipo: "profissional_autonomo" }))).toBe(true);
    expect(papelVeSugestao(academia("nutricionista", { tipo: "profissional_autonomo" }))).toBe(false);
  });

  it("Free contra Método: a academia vê a do aluno do Free; o mentor, a do aluno do Método", () => {
    expect(veSugestaoDeProgressao({ ...academia("professor"), alunoNoMetodo: false })).toBe(true);
    expect(veSugestaoDeProgressao({ ...academia("professor"), alunoNoMetodo: true })).toBe(false);
    expect(veSugestaoDeProgressao({ ...academia("gestor"), alunoNoMetodo: true })).toBe(false);
    const mentoria = { escopo: "metodo" as const, papel: null, tipoOrganizacao: null, especialidade: null };
    expect(veSugestaoDeProgressao({ ...mentoria, alunoNoMetodo: true })).toBe(true);
    expect(veSugestaoDeProgressao({ ...mentoria, alunoNoMetodo: false })).toBe(false);
  });

  it("a recepção não vê nem o aluno do Free", () => {
    expect(veSugestaoDeProgressao({ ...academia("recepcao"), alunoNoMetodo: false })).toBe(false);
  });
});
