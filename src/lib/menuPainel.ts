import { Home, Users, UsersRound, Building2, ClipboardList, BarChart3, DoorOpen, CalendarDays, Dumbbell, UtensilsCrossed, Sparkles, DollarSign, Plug, MessageCircle, Megaphone, QrCode, Filter, CalendarCheck, HeartHandshake } from "lucide-react";

/**
 * O menu do painel da academia. Mora fora do componente para o teste conferir,
 * papel por papel, que todo item do menu abre pela rota (`acessoPainel.ts`):
 * a rota confere o papel com a mesma regra, e o menu continua como era.
 */
export type MenuItem = { icon: typeof Home; label: string; path: string };
export type MenuSection = { label: string; items: MenuItem[] };

// Menu lateral reorganizado em 3 blocos claros. "Onboarding" não tem mais
// item fixo — só é alcançado pelo banner na Home ou em Organização.
// Studio: turmas de horário fixo e capacidade limitada — Agenda só faz
// sentido para esse tipo de negócio. Configurações (Organização, Catracas)
// e Inteligência (Gestão 360°, Equipe) são assuntos de gestão da unidade —
// só aparecem para quem pode gerenciar a equipe (gestor/admin_arke); o
// painel de professor e de nutricionista fica restrito ao escopo deles
// (atendimento, alunos e a prescrição do que cada um prescreve).
export function buildSections({
  ehStudio,
  podeGerenciarEquipe,
  podePrescreverTreino,
  podePrescreverDieta,
  alunosLabel,
}: {
  ehStudio: boolean;
  podeGerenciarEquipe: boolean;
  podePrescreverTreino: boolean;
  podePrescreverDieta: boolean;
  alunosLabel: string;
}): MenuSection[] {
  const operacao: MenuItem[] = [
    { icon: Home, label: "Home (Início)", path: "/admin/dashboard" },
    { icon: ClipboardList, label: "Atendimento (Fila)", path: "/admin" },
    { icon: MessageCircle, label: "Mensagens", path: "/admin/mensagens" },
    { icon: Users, label: alunosLabel, path: "/admin/alunos" },
    { icon: Filter, label: "Funil de Vendas", path: "/admin/funil" },
  ];
  if (podePrescreverTreino) {
    // Acervo de Exercícios virou uma aba dentro de Prescrever Treinos.
    operacao.push({ icon: Dumbbell, label: "Prescrever Treinos", path: "/admin/treinos" });
  }
  if (podePrescreverDieta) {
    operacao.push({ icon: UtensilsCrossed, label: "Prescrever Dietas", path: "/admin/dietas" });
  }
  if (ehStudio) {
    operacao.push({ icon: CalendarDays, label: "Agenda", path: "/admin/agenda" });
  }
  // Desafios + Competições + Feed viraram abas dentro de Engajamento.
  operacao.push({ icon: Sparkles, label: "Engajamento", path: "/admin/engajamento" });
  operacao.push({ icon: Megaphone, label: "Comunicados", path: "/admin/comunicados" });
  operacao.push({ icon: QrCode, label: "Check-in QR", path: "/admin/checkin-qr" });

  const sections: MenuSection[] = [{ label: "Operação", items: operacao }];

  if (podeGerenciarEquipe) {
    sections.push({
      label: "Inteligência",
      items: [
        { icon: BarChart3, label: "Gestão 360°", path: "/admin/gestao-360" },
        { icon: CalendarCheck, label: "Resumo da semana", path: "/admin/relatorio-semanal" },
        // A prestacao de contas do BPO. Sem ela a academia paga por um servico
        // que, do lado dela, nao aparece em lugar nenhum.
        { icon: HeartHandshake, label: "Acompanhamento ARKE", path: "/admin/acompanhamento" },
        { icon: UsersRound, label: "Equipe", path: "/admin/equipe" },
        // Comissões virou uma aba dentro de Financeiro.
        { icon: DollarSign, label: "Financeiro", path: "/admin/financeiro" },
      ],
    });
    sections.push({
      label: "Configurações",
      items: [
        // Planos da Academia virou uma aba dentro de Organização.
        { icon: Building2, label: "Organização", path: "/admin/organizacao" },
        { icon: DoorOpen, label: "Catracas", path: "/admin/catracas" },
        { icon: Plug, label: "Integrações", path: "/admin/configuracoes/integracoes" },
      ],
    });
  }

  return sections;
}

// Personal/nutricionista autônomo: o painel de uma academia pequena — vendas,
// financeiro, planos e cobrança —, sem o que só existe em academia: catraca,
// check-in por QR, equipe (no lugar dela, a parceria, em Meu negócio) e o
// Método ARKE. Cada um prescreve a sua parte: o dono pela especialidade, o
// parceiro convidado pelo papel. Vendas e dinheiro são só do dono do painel.
export function buildSectionsProfissionalAutonomo({
  podePrescreverTreino,
  podePrescreverDieta,
  ehDono,
}: {
  podePrescreverTreino: boolean;
  podePrescreverDieta: boolean;
  ehDono: boolean;
}): MenuSection[] {
  const operacao: MenuItem[] = [
    { icon: Home, label: "Home (Início)", path: "/admin/dashboard" },
    { icon: ClipboardList, label: "Atendimento (Fila)", path: "/admin" },
    { icon: MessageCircle, label: "Mensagens", path: "/admin/mensagens" },
    { icon: Users, label: "Meus Alunos", path: "/admin/alunos" },
  ];
  if (ehDono) operacao.push({ icon: Filter, label: "Funil de Vendas", path: "/admin/funil" });
  if (podePrescreverTreino) {
    operacao.push({ icon: Dumbbell, label: "Prescrever Treinos", path: "/admin/treinos" });
  }
  if (podePrescreverDieta) {
    operacao.push({ icon: UtensilsCrossed, label: "Prescrever Dietas", path: "/admin/dietas" });
  }
  if (ehDono) operacao.push({ icon: Megaphone, label: "Comunicados", path: "/admin/comunicados" });

  const sections: MenuSection[] = [{ label: "Operação", items: operacao }];
  if (ehDono) {
    sections.push({
      label: "Meu negócio",
      items: [
        { icon: DollarSign, label: "Financeiro", path: "/admin/financeiro" },
        { icon: CalendarCheck, label: "Resumo da semana", path: "/admin/relatorio-semanal" },
        { icon: Building2, label: "Meu negócio", path: "/admin/organizacao" },
      ],
    });
  }
  return sections;
}
