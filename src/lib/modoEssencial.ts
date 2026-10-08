import type { MenuSection } from "@/lib/menuPainel";
import { rotaDoPainel } from "@/lib/acessoPainel";

/**
 * A recepção em modo essencial no bloqueio B2B (decisão do responsável,
 * 08/10/2026).
 *
 * Quando a academia passa dos 7 dias de tolerância da mensalidade B2B, o
 * gestor, o professor e a nutricionista caem na tela de suspensão
 * (`OrganizacaoBillingGate`). A recepção não: o aluno chega ao balcão do
 * mesmo jeito, e ele não deu causa ao atraso. Ela fica em modo essencial, e o
 * princípio é um só: **o atendimento individual do aluno continua; a gestão e
 * a operação em massa pausam.**
 *
 * Quem diz o modo é o banco (`get_bloqueio_organizacao()`, coluna `modo`,
 * migration 20261420010000); aqui mora o que cada modo abre. Este é um gate de
 * experiência: o bloqueio no servidor fica para depois do primeiro cliente
 * pagante (docs/DECISOES_PENDENTES.md) e, quando vier, barra só a gestão, e
 * não o que esta lista mantém.
 */
export const AVISO_MODO_ESSENCIAL =
  "A assinatura da academia está pendente. Algumas funções estão pausadas; fale com o gestor.";

export type SituacaoNoModoEssencial = "continua" | "pausada";

/**
 * Toda rota filha de /admin (as mesmas de `ROTAS_DO_PAINEL`), e o que acontece
 * com ela no modo essencial. Rota fora desta tabela fica pausada (falha
 * fechada), e `modoEssencial.guarda.test.ts` cobra que toda rota do App.tsx
 * esteja aqui: rota nova da recepção entra como "continua" ou fica pausada.
 *
 * As marcadas "pausada" que a recepção já não abria pelo papel (financeiro,
 * equipe...) estão aqui só para a tabela ser completa.
 */
export const NO_MODO_ESSENCIAL: Record<string, SituacaoNoModoEssencial> = {
  // A fila dela: a cobrança e o atestado do aluno.
  "": "continua",
  // A porta de entrada (e o "Voltar ao início"): quem entrou hoje e os atalhos do balcão.
  dashboard: "continua",
  // Buscar o aluno, a situação, a matrícula de quem está no balcão, a
  // mensalidade e a avulsa, o atestado, o PAR-Q, a digital e o rosto: tudo pela lista e pela ficha.
  alunos: "continua",
  // O check-in pelo QR Code.
  "checkin-qr": "continua",
  // Liberar a catraca e o check-in do visitante do Wellhub e do TotalPass.
  catracas: "continua",
  // As conversas com o aluno.
  mensagens: "continua",
  // No studio, a presença na aula é o check-in do balcão.
  agenda: "continua",
  // A própria conta: senha e duas etapas.
  perfil: "continua",
  // A Central de Ajuda, que explica este modo.
  ajuda: "continua",
  "ajuda/:slug": "continua",

  // Vendas e comunicação com todos os alunos.
  funil: "pausada",
  comunicados: "pausada",
  engajamento: "pausada",
  // Operação em massa.
  "alunos/importar": "pausada",
  // Gestão da unidade.
  onboarding: "pausada",
  "gestao-360": "pausada",
  "relatorio-semanal": "pausada",
  acompanhamento: "pausada",
  retencao: "pausada",
  financeiro: "pausada",
  equipe: "pausada",
  organizacao: "pausada",
  "configuracoes/integracoes": "pausada",
  // A prescrição é do professor e da nutricionista, que estão na tela de suspensão.
  treinos: "pausada",
  dietas: "pausada",
};

/** A rota abre no modo essencial? Endereço fora da tabela não abre. */
export function abreNoModoEssencial(caminho: string): boolean {
  const rota = rotaDoPainel(caminho);
  return rota !== null && NO_MODO_ESSENCIAL[rota] === "continua";
}

/**
 * O menu no modo essencial: o item pausado sai, e o nome dele vai para a nota
 * que o menu mostra no lugar ("Pausados: ..."). Some, em vez de aparecer
 * desativado: um botão desativado não recebe foco, e o leitor de tela não
 * chegaria ao motivo; a nota é texto, e lê-se na ordem do menu.
 */
export function menuNoModoEssencial(secoes: MenuSection[]): { secoes: MenuSection[]; pausados: string[] } {
  const pausados: string[] = [];
  const restantes = secoes
    .map((s) => {
      const items = s.items.filter((item) => {
        if (abreNoModoEssencial(item.path)) return true;
        pausados.push(item.label);
        return false;
      });
      return { ...s, items };
    })
    .filter((s) => s.items.length > 0);
  return { secoes: restantes, pausados };
}

/** Uma linha de `get_bloqueio_organizacao()`: uma por academia em que a pessoa é equipe. */
export type LinhaBloqueio = {
  organization_id: string;
  organizacao_nome: string;
  bloqueada: boolean;
  cobrancas_vencidas: number;
  valor_em_aberto: number;
  vencimento_mais_antigo: string | null;
  invoice_url: string | null;
  /** 'bloqueio' | 'essencial' | 'normal'. Opcional: a migration entra antes do app, e o app antes dela não a lia. */
  modo?: string | null;
};

export type AcessoDoPainel =
  | { tipo: "bloqueio"; linha: LinhaBloqueio }
  | { tipo: "essencial" }
  | { tipo: "normal"; tolerancia: LinhaBloqueio | null };

/**
 * O que o painel mostra a quem chama:
 *   - **bloqueio**: há uma academia em que a pessoa é gestor, professor ou
 *     nutricionista e que está bloqueada. "A bloqueada manda" (20261113),
 *     em qualquer academia, como antes: senão o gestor de uma unidade
 *     bloqueada abria o painel trocando de unidade;
 *   - **essencial**: a academia ativa (a do seletor, `escolherVinculo`) está
 *     bloqueada, e o papel dela ali é a recepção. Ninguém tem dois papéis na
 *     mesma academia (`unique (organization_id, user_id)`), então o papel
 *     ativo é o que vale. Quem é recepção de uma academia bloqueada e gestora
 *     de outra, em dia, trabalha na dela com o painel inteiro;
 *   - **normal**: o resto, com a faixa da tolerância quando há cobrança
 *     vencida ainda dentro dos 7 dias.
 */
export function decidirAcessoDoPainel(linhas: LinhaBloqueio[], organizacaoAtiva: string | null | undefined): AcessoDoPainel {
  const bloqueada = linhas.find((l) => l.bloqueada);
  if (bloqueada) return { tipo: "bloqueio", linha: bloqueada };
  const ativa = organizacaoAtiva ? linhas.find((l) => l.organization_id === organizacaoAtiva) : undefined;
  if (ativa?.modo === "essencial") return { tipo: "essencial" };
  const tolerancia = linhas.find((l) => Number(l.cobrancas_vencidas) > 0 && !!l.vencimento_mais_antigo) ?? null;
  return { tipo: "normal", tolerancia };
}
