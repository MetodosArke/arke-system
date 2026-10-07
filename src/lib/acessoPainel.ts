import { podePrescrever, type ContextoPrescricao } from "@/lib/prescricaoPermitida";

/**
 * Quem abre o quê no painel da academia, do lado da tela.
 *
 * Até 06/10/2026 as rotas do painel tinham uma guarda só, de equipe: o menu
 * escondia Gestão 360°, Financeiro, Equipe e Organização do professor, mas o
 * endereço digitado abria a página (auditoria de 05/10). Agora o menu e a rota
 * leem a mesma tabela, e rota que não está na tabela não abre (falha fechada):
 * página nova tem de dizer aqui quem a vê. `acessoPainel.guarda.test.ts` cobra
 * que toda rota de /admin do App.tsx esteja aqui.
 *
 * O banco diz o mesmo nas regras de acesso (migration 20261360010000):
 * `cuida_do_dinheiro()` (gestão e recepção) e `atende_saude()` (gestão,
 * professor e nutricionista). A tela só não oferece o que o banco recusaria.
 */
export type ContextoPainel = ContextoPrescricao;

const ehAutonomo = (c: ContextoPainel) => c.tipoOrganizacao === "profissional_autonomo";

/** Gestão da unidade: o gestor e a ArkeFit. */
export function ehGestao(c: ContextoPainel): boolean {
  return !!c.adminArke || c.papel === "gestor";
}

/** Quem cobra: a gestão e a recepção. Espelho de `cuida_do_dinheiro()`. */
export function cuidaDoDinheiro(c: ContextoPainel): boolean {
  return ehGestao(c) || c.papel === "recepcao";
}

/**
 * Quem atende a saúde do aluno (anamnese, dores, avaliação física, dieta e o
 * resumo da IA): a gestão, o professor e a nutricionista. A recepção, não.
 * Espelho de `atende_saude()`.
 */
export function atendeSaude(c: ContextoPainel): boolean {
  return ehGestao(c) || c.papel === "professor" || c.papel === "nutricionista";
}

/**
 * Os tipos de tarefa que falam da saúde do aluno: a pendência de dor e a de
 * anamnese. Quem não atende a saúde (a recepção) não as vê, nem na ficha nem
 * no histórico, nem pela API: o RLS de `tarefas` esconde as duas da recepção
 * (`tarefa_de_saude()`, 20261398010000). O histórico do banco
 * (`get_historico_aluno`) e o RLS usam a mesma lista, e
 * `historicoDoAluno.guarda.test.ts` e `tarefasPorDono.guarda.test.ts` falham
 * se divergirem.
 */
export const TAREFAS_DE_SAUDE: ReadonlySet<string> = new Set(["dor", "anamnese"]);

type Regra = (c: ContextoPainel) => boolean;

const EQUIPE: Regra = () => true;
const GESTAO: Regra = ehGestao;
/** A catraca: a gestão configura, a recepção libera (atalho da Home). */
const GESTAO_E_RECEPCAO: Regra = cuidaDoDinheiro;
/** No painel do autônomo, vendas e comunicados são do dono; na academia, de toda a equipe (como o menu). */
const VENDAS: Regra = (c) => !ehAutonomo(c) || ehGestao(c);
const PRESCREVE_TREINO: Regra = (c) => podePrescrever("treino", c);
const PRESCREVE_DIETA: Regra = (c) => podePrescrever("dieta", c);

/** As rotas filhas de /admin, como estão no App.tsx, e quem abre cada uma. */
export const ROTAS_DO_PAINEL: Record<string, Regra> = {
  "": EQUIPE, // Atendimento (fila)
  dashboard: EQUIPE,
  onboarding: EQUIPE, // o cartão da implantação na Home leva todos; só a gestão edita
  "checkin-qr": EQUIPE,
  comunicados: VENDAS,
  funil: VENDAS,
  alunos: EQUIPE,
  "alunos/importar": GESTAO,
  financeiro: GESTAO,
  equipe: GESTAO,
  treinos: PRESCREVE_TREINO,
  dietas: PRESCREVE_DIETA,
  retencao: GESTAO,
  "gestao-360": GESTAO,
  "relatorio-semanal": GESTAO,
  acompanhamento: GESTAO,
  catracas: GESTAO_E_RECEPCAO,
  "configuracoes/integracoes": GESTAO,
  organizacao: GESTAO,
  perfil: EQUIPE,
  agenda: EQUIPE,
  engajamento: EQUIPE,
  mensagens: EQUIPE,
  ajuda: EQUIPE,
  "ajuda/:slug": EQUIPE,
};

/** A rota da tabela que atende o endereço (`/admin/ajuda/x` → `ajuda/:slug`), ou null. */
export function rotaDoPainel(caminho: string): string | null {
  const resto = caminho.replace(/^\/admin\/?/, "").replace(/\/+$/, "");
  if (resto in ROTAS_DO_PAINEL) return resto;
  const partes = resto.split("/");
  for (const rota of Object.keys(ROTAS_DO_PAINEL)) {
    const molde = rota.split("/");
    if (molde.length === partes.length && molde.every((p, i) => p.startsWith(":") || p === partes[i])) return rota;
  }
  return null;
}

/** O endereço abre para este papel? Rota fora da tabela não abre. */
export function podeAbrirNoPainel(caminho: string, c: ContextoPainel): boolean {
  const rota = rotaDoPainel(caminho);
  return rota !== null && ROTAS_DO_PAINEL[rota](c);
}
