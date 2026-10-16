import { atendeSaude } from "@/lib/acessoPainel";
import { podePrescrever } from "@/lib/prescricaoPermitida";
import { seriesDoExercicio } from "@/lib/seriesTreino";
import { decimal } from "@/lib/numeros";

/**
 * Sugestão de progressão da carga, por exercício (16/10/2026).
 *
 * Decisão do responsável (15/10): pelas séries feitas, pelo esforço, pelo sono,
 * pela energia e pela dor que o aluno informa, o sistema **sugere** a quem
 * prescreve o treino subir, manter ou segurar a carga. A sugestão sai por
 * regra, sem IA, e a decisão é do professor (do mentor, no Método). Nada muda
 * no treino do aluno sozinho: o treino é um snapshot imutável e só muda quando
 * o professor publica uma versão nova. O aluno não vê a sugestão.
 *
 * A regra olha as sessões recentes do mesmo exercício e responde na primeira
 * condição que casar, nesta ordem:
 *
 *  1. **Sem dado suficiente:** a prescrição não tem uma faixa de repetições em
 *     número, ou o aluno registrou carga e repetições do exercício em menos de
 *     2 treinos nos últimos 21 dias. Não é uma sugestão: é "ainda sem dados".
 *  2. **Segurar**, e a segurança vem antes de tudo: dor (na última sessão, nos
 *     últimos 7 dias ou a progressão suspensa por dor), sono ou energia até 2
 *     na última sessão, ou mais de 14 dias sem o exercício.
 *  3. **Rever a carga para baixo:** nas 2 últimas sessões, alguma série
 *     prescrita sem concluir ou abaixo do mínimo da faixa; ou esforço de 9 ou
 *     10 nas duas.
 *  4. **Subir** (dupla progressão): nas 2 últimas sessões, a mesma carga, todas
 *     as séries prescritas feitas no topo da faixa (ou acima) e esforço até 7
 *     nas duas.
 *  5. **Manter:** todo o resto.
 *
 * Um passo por vez: a referência de subida é sempre o menor incremento, e
 * "subir" pede duas sessões com a mesma carga, então depois de uma troca de
 * carga a regra espera de novo duas sessões antes de sugerir outra.
 *
 * O esforço percebido é do treino inteiro (uma resposta por sessão, de 1 a 10),
 * não de cada exercício: um exercício leve num treino pesado herda o esforço
 * do treino. É o dado que existe, e por isso o limiar de folga é conservador.
 */

/** Os limiares da regra, cada um com o porquê. */
export const LIMIARES = {
  /**
   * Quanto para trás a regra olha: 3 semanas. Cobre de 3 a 9 sessões do mesmo
   * exercício em quem treina a divisão de 1 a 3 vezes por semana, e deixa de
   * fora o treino de um mês atrás, que já não diz como o aluno está hoje.
   */
  janelaDias: 21,
  /**
   * Sessões do exercício com carga e repetições, no mínimo, para dizer
   * qualquer coisa. Uma sessão só pode ser um dia atípico, e a dupla
   * progressão compara duas.
   */
  sessoesMinimas: 2,
  /**
   * Dor relatada nestes últimos dias segura a carga de todos os exercícios:
   * uma semana é o intervalo em que o professor costuma rever o aluno, e a
   * pendência de dor da fila tem prazo de 12 horas.
   */
  dorDias: 7,
  /**
   * Sono ou energia até este valor (de 1 a 5) na última sessão segura a carga:
   * 1 e 2 são "ruim" e "abaixo do normal" na escala que o aluno responde.
   */
  bemEstarBaixo: 2,
  /**
   * Mais que estes dias sem o exercício (entre as duas últimas sessões, ou da
   * última até hoje): volta com a mesma carga. Duas semanas paradas já tiram
   * parte da adaptação, e subir na volta é o caminho mais curto para a lesão.
   */
  pausaDias: 14,
  /**
   * Esforço a partir deste valor (de 1 a 10) nas duas últimas sessões: o aluno
   * está no limite, e a carga pede revisão. 9 e 10 são "quase o máximo" e
   * "máximo" na escala do fim do treino.
   */
  esforcoNoLimite: 9,
  /**
   * Esforço até este valor nas duas últimas sessões conta como "com folga".
   * 7 deixa margem (no esforço por série, 7 é cerca de 3 repetições sobrando);
   * como a resposta é do treino inteiro, um limiar mais alto deixaria passar
   * o treino puxado.
   */
  esforcoComFolga: 7,
} as const;

/** As referências de quanto mudar, que o texto mostra como referência, nunca como ordem. */
export const REFERENCIAS = {
  /** Subida: cerca de 2 a 5% da carga, arredondado para o passo do equipamento. */
  subidaMinima: 0.02,
  subidaMaxima: 0.05,
  /** Redução: de 5 a 10%, só como referência; o número é do professor. */
  reducaoMinima: 0.05,
  reducaoMaxima: 0.1,
} as const;

/**
 * O menor passo de carga de cada equipamento, quando dá para saber pelo nome
 * que vem do acervo: halter e cabo sobem de 1 kg (halteres de 1 em 1, placa
 * pequena na polia); barra e máquina, de 2,5 kg (anilha de 1,25 de cada lado,
 * placa da máquina). Fora disso (peso corporal, elástico, kettlebell), o
 * texto diz "o menor incremento disponível".
 */
const PASSOS: { padrao: RegExp; passoKg: number }[] = [
  { padrao: /^halter/, passoKg: 1 },
  { padrao: /^(cabo|polia)/, passoKg: 1 },
  { padrao: /^barra/, passoKg: 2.5 },
  { padrao: /^(maquina|aparelho|smith)/, passoKg: 2.5 },
];

export function passoDoEquipamento(equipamento: string | null | undefined): number | null {
  const nome = (equipamento ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (!nome) return null;
  return PASSOS.find((p) => p.padrao.test(nome))?.passoKg ?? null;
}

// ── A faixa de repetições ──────────────────────────────────────────────────

export type FaixaRepeticoes = { min: number; max: number };

/**
 * A faixa de uma série prescrita: "12" é de 12 a 12, "8-12" e "8 a 12" são de
 * 8 a 12. O resto (tempo como "30-45s", "até a falha", "12 cada perna", a
 * pirâmide escrita numa linha só) não é faixa em número, e a regra não
 * adivinha: sem faixa, sem sugestão.
 */
export function lerFaixa(texto: string | null | undefined): FaixaRepeticoes | null {
  const t = (texto ?? "").trim().toLowerCase();
  const unico = /^(\d{1,3})$/.exec(t);
  if (unico) {
    const n = Number(unico[1]);
    return n > 0 ? { min: n, max: n } : null;
  }
  const faixa = /^(\d{1,3})\s*(?:-|–|a|até)\s*(\d{1,3})$/.exec(t);
  if (faixa) {
    const min = Number(faixa[1]);
    const max = Number(faixa[2]);
    return min > 0 && min <= max ? { min, max } : null;
  }
  return null;
}

/** O exercício como está no snapshot do treino publicado. */
export type ItemDaFicha = {
  ordem: number;
  divisao?: string | null;
  nome_exercicio: string;
  exercicio_id?: string | null;
  equipamento?: string | null;
  series?: number | null;
  repeticoes?: string | null;
  descanso_seg?: number | null;
  series_detalhe?: unknown;
};

/** Uma faixa por série prescrita, ou nulo se alguma série não tem faixa em número. */
export function faixasDoExercicio(item: ItemDaFicha): FaixaRepeticoes[] | null {
  const faixas = seriesDoExercicio(item).map((s) => lerFaixa(s.reps));
  return faixas.length > 0 && faixas.every((f): f is FaixaRepeticoes => f !== null) ? faixas : null;
}

// ── Datas puras ────────────────────────────────────────────────────────────

/** O dia de uma data `AAAA-MM-DD`, contado em dias inteiros (sem fuso: a data já é a de Brasília). */
function numeroDoDia(data: string): number {
  const [ano, mes, dia] = data.slice(0, 10).split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia) / 86_400_000;
}

/** Quantos dias de `de` até `ate`, as duas `AAAA-MM-DD`. */
export function diasEntre(de: string, ate: string): number {
  return Math.round(numeroDoDia(ate) - numeroDoDia(de));
}

const dentroDe = (data: string, hoje: string, dias: number) => {
  const d = diasEntre(data, hoje);
  return d >= 0 && d <= dias;
};

// ── A regra de um exercício ────────────────────────────────────────────────

export type SerieRegistrada = { numero: number; cargaKg: number | null; repeticoes: number | null; concluida: boolean };

/** Uma sessão (um dia de treino) do exercício, com o que o aluno respondeu no fim daquele treino. */
export type SessaoDoExercicio = {
  data: string;
  series: SerieRegistrada[];
  /** Esforço percebido do treino inteiro, de 1 a 10. */
  esforco: number | null;
  sono: number | null;
  energia: number | null;
  /** O aluno marcou "Senti dor" no fim deste treino. */
  dor: boolean;
};

export type EntradaDoExercicio = {
  /** Hoje, em Brasília (`AAAA-MM-DD`). */
  hoje: string;
  /** Uma faixa por série prescrita; nulo se a prescrição não tem faixa em número. */
  faixas: FaixaRepeticoes[] | null;
  sessoes: SessaoDoExercicio[];
  /** Dor relatada nos últimos 7 dias (no fim do treino ou no check-in), ou a progressão suspensa por dor. */
  dorRecente: boolean;
  /** O menor passo do equipamento, em kg, quando dá para saber. */
  passoKg: number | null;
};

export type TipoSugestao = "segurar" | "rever" | "subir" | "manter" | "sem_dados";

export type MotivoSugestao =
  | "sem_faixa"
  | "poucas_sessoes"
  | "dor"
  | "cansaco"
  | "pausa"
  | "nao_completa"
  | "esforco_no_limite"
  | "topo_da_faixa"
  | "progredindo";

export type Sugestao = {
  tipo: TipoSugestao;
  motivo: MotivoSugestao;
  /** A frase da tela, curta e sem promessa. */
  frase: string;
  /** Uma referência de quanto mudar, quando cabe; nunca uma ordem. */
  referencia: string | null;
};

export const FRASES: Record<MotivoSugestao, string> = {
  sem_faixa: "Ainda sem dados para sugerir",
  poucas_sessoes: "Ainda sem dados para sugerir",
  dor: "Segurar e conversar com o aluno sobre a dor",
  cansaco: "Segurar: o aluno chegou cansado",
  pausa: "Retomar com a mesma carga",
  nao_completa: "Rever a carga: o aluno não está completando",
  esforco_no_limite: "Rever a carga: esforço no limite em 2 treinos seguidos",
  topo_da_faixa: "Pode subir a carga: completou o topo da faixa com folga em 2 treinos",
  progredindo: "Manter: ainda progredindo dentro da faixa",
};

const TIPO_DO_MOTIVO: Record<MotivoSugestao, TipoSugestao> = {
  sem_faixa: "sem_dados",
  poucas_sessoes: "sem_dados",
  dor: "segurar",
  cansaco: "segurar",
  pausa: "segurar",
  nao_completa: "rever",
  esforco_no_limite: "rever",
  topo_da_faixa: "subir",
  progredindo: "manter",
};

const sugestao = (motivo: MotivoSugestao, referencia: string | null = null): Sugestao => ({
  tipo: TIPO_DO_MOTIVO[motivo],
  motivo,
  frase: FRASES[motivo],
  referencia,
});

type SerieFeita = SerieRegistrada & { cargaKg: number; repeticoes: number };

/** A série foi feita, com a carga e as repetições anotadas. */
const feita = (s: SerieRegistrada | undefined): s is SerieFeita =>
  !!s && s.concluida && s.cargaKg != null && s.repeticoes != null;

const serieDe = (sessao: SessaoDoExercicio, numero: number) => sessao.series.find((s) => s.numero === numero);

/** Alguma série prescrita ficou sem concluir, ou abaixo do mínimo da faixa. */
function naoCompletou(sessao: SessaoDoExercicio, faixas: FaixaRepeticoes[]): boolean {
  return faixas.some((faixa, i) => {
    const serie = serieDe(sessao, i + 1);
    if (!serie || !serie.concluida) return true;
    return serie.repeticoes != null && serie.repeticoes < faixa.min;
  });
}

/** Todas as séries prescritas feitas, com as repetições no topo da faixa ou acima. */
function completouNoTopo(sessao: SessaoDoExercicio, faixas: FaixaRepeticoes[]): boolean {
  return faixas.every((faixa, i) => {
    const serie = serieDe(sessao, i + 1);
    return feita(serie) && serie.repeticoes >= faixa.max;
  });
}

/** A mesma carga, série a série, nas duas sessões. */
function mesmaCarga(a: SessaoDoExercicio, b: SessaoDoExercicio, series: number): boolean {
  for (let n = 1; n <= series; n++) {
    const ca = serieDe(a, n)?.cargaKg;
    const cb = serieDe(b, n)?.cargaKg;
    if (ca == null || cb == null || Math.abs(ca - cb) > 0.001) return false;
  }
  return true;
}

const comFolga = (s: SessaoDoExercicio) => s.esforco != null && s.esforco <= LIMIARES.esforcoComFolga;
const noLimite = (s: SessaoDoExercicio) => s.esforco != null && s.esforco >= LIMIARES.esforcoNoLimite;
const baixo = (v: number | null) => v != null && v <= LIMIARES.bemEstarBaixo;

/** O número de quilos como o Brasil lê, sem casas sobrando: "42,5", "40", "1,25". */
function quilos(valor: number): string {
  const v = Math.round(valor * 100) / 100;
  const casas = Number.isInteger(v) ? 0 : Number.isInteger(Math.round(v * 1000) / 100) ? 1 : 2;
  return decimal(v, casas);
}

/** "42,5 kg", "40 kg", "1,25 kg". */
export const kg = (valor: number) => `${quilos(valor)} kg`;

/** As cargas das séries prescritas feitas na sessão. */
function cargasDaSessao(sessao: SessaoDoExercicio, series: number): number[] {
  const cargas: number[] = [];
  for (let n = 1; n <= series; n++) {
    const s = serieDe(sessao, n);
    if (feita(s)) cargas.push(s.cargaKg);
  }
  return cargas;
}

/**
 * Quanto subir, como referência: cerca de 2 a 5% da carga mais pesada,
 * arredondado para cima no passo do equipamento (nunca menos que um passo).
 * Sem passo conhecido, ou sem carga (peso corporal), só "o menor incremento".
 */
function referenciaDeSubida(cargas: number[], passoKg: number | null): string {
  const carga = Math.max(0, ...cargas);
  if (passoKg == null || carga <= 0) return "Referência: o menor incremento disponível.";
  const incremento = Math.max(passoKg, Math.ceil((carga * REFERENCIAS.subidaMinima) / passoKg - 1e-9) * passoKg);
  const ondeMudar = new Set(cargas).size > 1 ? " na série mais pesada" : "";
  return `Referência: cerca de +${kg(incremento)}${ondeMudar} (de ${quilos(carga)} para ${kg(carga + incremento)}).`;
}

/** Quanto reduzir, como referência: de 5 a 10% da carga mais pesada, de meio em meio quilo. */
function referenciaDeRevisao(cargas: number[]): string | null {
  const carga = Math.max(0, ...cargas);
  if (carga <= 0) return null;
  const meioQuilo = (v: number) => Math.max(0.5, Math.round(v * 2) / 2);
  const de = meioQuilo(carga * REFERENCIAS.reducaoMinima);
  const ate = meioQuilo(carga * REFERENCIAS.reducaoMaxima);
  const quanto = de === ate ? `cerca de ${kg(de)}` : `cerca de ${quilos(de)} a ${kg(ate)}`;
  return `Se for reduzir, uma referência é tirar de 5 a 10% (${quanto}).`;
}

/** A sugestão para um exercício. Pura: o mesmo histórico dá sempre a mesma resposta. */
export function sugerirProgressao(e: EntradaDoExercicio): Sugestao {
  // 1. Sem dado suficiente: nenhuma sugestão inventada.
  if (!e.faixas || e.faixas.length === 0) return sugestao("sem_faixa");
  const faixas = e.faixas;
  const sessoes = e.sessoes
    .filter((s) => dentroDe(s.data, e.hoje, LIMIARES.janelaDias) && s.series.some(feita))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  if (sessoes.length < LIMIARES.sessoesMinimas) return sugestao("poucas_sessoes");

  const ultima = sessoes[sessoes.length - 1];
  const anterior = sessoes[sessoes.length - 2];

  // 2. Segurar: a segurança vem antes de qualquer sinal de subir.
  if (ultima.dor || e.dorRecente) return sugestao("dor");
  if (baixo(ultima.sono) || baixo(ultima.energia)) return sugestao("cansaco");
  if (diasEntre(anterior.data, ultima.data) > LIMIARES.pausaDias || diasEntre(ultima.data, e.hoje) > LIMIARES.pausaDias) {
    return sugestao("pausa");
  }

  // 3. Rever a carga para baixo.
  const cargas = cargasDaSessao(ultima, faixas.length);
  if (naoCompletou(ultima, faixas) && naoCompletou(anterior, faixas)) return sugestao("nao_completa", referenciaDeRevisao(cargas));
  if (noLimite(ultima) && noLimite(anterior)) return sugestao("esforco_no_limite", referenciaDeRevisao(cargas));

  // 4. Subir: dupla progressão, com folga, na mesma carga.
  if (
    mesmaCarga(ultima, anterior, faixas.length) &&
    completouNoTopo(ultima, faixas) &&
    completouNoTopo(anterior, faixas) &&
    comFolga(ultima) &&
    comFolga(anterior)
  ) {
    return sugestao("topo_da_faixa", referenciaDeSubida(cargas, e.passoKg));
  }

  // 5. Manter.
  return sugestao("progredindo");
}

// ── O treino inteiro de um aluno ───────────────────────────────────────────

/** Uma série como `registro_serie` a guarda. */
export type SerieDoRegistro = {
  exercicio_id: string | null;
  exercicio_ordem: number;
  serie_numero: number;
  carga_kg: number | null;
  repeticoes: number | null;
  concluida: boolean;
};

/** Um treino feito (`registro_treino`), com o sono e a energia daquele dia e as séries. */
export type RegistroDoTreino = {
  data: string;
  treino_id: string | null;
  esforco_percebido: number | null;
  sensacao: string | null;
  sono: number | null;
  energia: number | null;
  series: SerieDoRegistro[];
};

/**
 * As séries de um exercício da ficha atual num treino feito.
 *
 * Pelo `exercicio_id`, que sobrevive à republicação da ficha (a ordem muda de
 * uma versão para outra, o exercício não), como a "carga da última vez" da
 * execução. Quando a ficha não tem o vínculo com o acervo, ou tem o mesmo
 * exercício duas vezes (em divisões diferentes, com faixas que podem ser
 * diferentes), pela ordem dentro do mesmo treino publicado.
 */
export function seriesDoExercicioNoRegistro(
  item: ItemDaFicha,
  ficha: ItemDaFicha[],
  treinoId: string,
  registro: RegistroDoTreino,
): SerieDoRegistro[] {
  const repetido = !!item.exercicio_id && ficha.filter((x) => x.exercicio_id === item.exercicio_id).length > 1;
  if (item.exercicio_id && !repetido) return registro.series.filter((s) => s.exercicio_id === item.exercicio_id);
  return registro.treino_id === treinoId ? registro.series.filter((s) => s.exercicio_ordem === item.ordem) : [];
}

export type SugestaoDoExercicio = { ordem: number; divisao: string; nome: string; sugestao: Sugestao };

export type SinalDeDor = {
  /** Dor nos últimos 7 dias, ou a progressão suspensa: segura todos os exercícios. */
  recente: boolean;
  /** A progressão está suspensa por dor (`alunos.progressao_bloqueada_em`) e ninguém liberou ainda. */
  suspensa: boolean;
  /** O relato de dor mais recente dos últimos 7 dias (fim do treino ou check-in). */
  ultimaData: string | null;
};

export type ResultadoDoTreino =
  | { estado: "sem_autorizacao" }
  | { estado: "sem_treino" }
  | { estado: "pronto"; dor: SinalDeDor; exercicios: SugestaoDoExercicio[] };

export type EntradaDoTreino = {
  hoje: string;
  /** O treino ativo do aluno (o snapshot publicado), ou nulo. */
  treino: { id: string; exercicios: ItemDaFicha[] } | null;
  /** Os treinos feitos nos últimos 21 dias. */
  registros: RegistroDoTreino[];
  /** As datas de check-in com "desconforto ou dor" nos últimos 7 dias. */
  datasComDorNoCheckin: string[];
  progressaoSuspensa: boolean;
  /** O aluno retirou o consentimento de dados de saúde: a sugestão depende deles e não é feita. */
  consentimentoSaudeRetirado: boolean;
};

/** A sugestão de cada exercício do treino ativo, na ordem da ficha. */
export function sugestoesDoTreino(e: EntradaDoTreino): ResultadoDoTreino {
  if (e.consentimentoSaudeRetirado) return { estado: "sem_autorizacao" };
  if (!e.treino || e.treino.exercicios.length === 0) return { estado: "sem_treino" };

  const datasDeDor = [
    ...e.registros.filter((r) => r.sensacao === "dor").map((r) => r.data),
    ...e.datasComDorNoCheckin,
  ].filter((d) => dentroDe(d, e.hoje, LIMIARES.dorDias));
  const ultimaData = datasDeDor.length > 0 ? datasDeDor.reduce((a, b) => (a > b ? a : b)) : null;
  const dor: SinalDeDor = { recente: e.progressaoSuspensa || ultimaData !== null, suspensa: e.progressaoSuspensa, ultimaData };

  const { id: treinoId, exercicios: ficha } = e.treino;
  const exercicios = [...ficha]
    .sort((a, b) => (a.divisao || "A").localeCompare(b.divisao || "A") || a.ordem - b.ordem)
    .map((item) => {
      const sessoes: SessaoDoExercicio[] = e.registros
        .map((r) => ({
          data: r.data,
          esforco: r.esforco_percebido,
          sono: r.sono,
          energia: r.energia,
          dor: r.sensacao === "dor",
          series: seriesDoExercicioNoRegistro(item, ficha, treinoId, r).map((s) => ({
            numero: s.serie_numero,
            cargaKg: s.carga_kg == null ? null : Number(s.carga_kg),
            repeticoes: s.repeticoes,
            concluida: s.concluida,
          })),
        }))
        .filter((s) => s.series.length > 0);
      return {
        ordem: item.ordem,
        divisao: item.divisao || "A",
        nome: item.nome_exercicio,
        sugestao: sugerirProgressao({
          hoje: e.hoje,
          faixas: faixasDoExercicio(item),
          sessoes,
          dorRecente: dor.recente,
          passoKg: passoDoEquipamento(item.equipamento),
        }),
      };
    });
  return { estado: "pronto", dor, exercicios };
}

/** A ordem em que a tela mostra os tipos: a segurança primeiro. */
export const ORDEM_DOS_TIPOS: TipoSugestao[] = ["segurar", "rever", "subir", "manter", "sem_dados"];

// ── Quem vê ────────────────────────────────────────────────────────────────

export type ContextoDaSugestao = {
  /** "academia": Prescrever Treinos do painel; "metodo": a ficha do aluno do Método, na Mentoria. */
  escopo: "academia" | "metodo";
  papel: string | null | undefined;
  tipoOrganizacao: string | null | undefined;
  especialidade: string | null | undefined;
};

/**
 * O papel de quem olha permite ver a sugestão? Ela deriva de dado de saúde
 * (dor, sono, energia, esforço), e é para quem prescreve o treino.
 *
 * Na academia: quem atende a saúde (`atende_saude()` no banco: gestão,
 * professor e nutricionista, membros da academia) **e** prescreve treino
 * (gestão e professor; no autônomo, quem é da parte do treino). A recepção e
 * a nutricionista, não. O Admin ARKE não entra pelo atalho da tela: o
 * `atende_saude()` do banco é só de quem é da equipe da academia, e sem ele o
 * sono e a energia voltam vazios e a sugestão sairia sem o cansaço.
 *
 * No Método: a equipe de mentoria (a tela é da Mentoria), que lê a saúde do
 * aluno do Método pelo `equipe_metodo()`.
 */
export function papelVeSugestao(c: ContextoDaSugestao): boolean {
  if (c.escopo === "metodo") return true;
  const contexto = { tipoOrganizacao: c.tipoOrganizacao, especialidade: c.especialidade, papel: c.papel, adminArke: false };
  return atendeSaude(contexto) && podePrescrever("treino", contexto);
}

/**
 * Vê a sugestão deste aluno: o papel permite, e quem olha é o dono do
 * treino. No Free, a academia; no Método (Integrado e Elite), o mentor da
 * ArkeFit. A academia não vê a do aluno do Método, nem o mentor a do Free.
 */
export function veSugestaoDeProgressao(c: ContextoDaSugestao & { alunoNoMetodo: boolean }): boolean {
  if (!papelVeSugestao(c)) return false;
  return c.escopo === "metodo" ? c.alunoNoMetodo : !c.alunoNoMetodo;
}
