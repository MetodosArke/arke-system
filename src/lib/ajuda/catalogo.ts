/**
 * Central de Ajuda: a lista de artigos, quem vê cada um e a tela que cada um
 * explica. O texto mora em `src/content/ajuda/<slug>.md`, versionado com o
 * código — quando a tela muda, o artigo muda no mesmo PR. As imagens ficam em
 * `public/ajuda/telas/` e são geradas por `npm run ajuda:telas`, com dados
 * fictícios.
 *
 * Este arquivo é pequeno de propósito: o botão "?" do cabeçalho usa só ele. O
 * texto dos artigos só é baixado quando alguém abre a Central.
 */

export type PublicoAjuda = "gestor" | "recepcao" | "professor" | "nutricionista" | "autonomo" | "aluno" | "arkefit";

export type ArtigoAjuda = {
  slug: string;
  titulo: string;
  resumo: string;
  secao: string;
  publicos: PublicoAjuda[];
  /** Telas que o artigo explica: é para ele que o "?" do cabeçalho leva. */
  rotas?: string[];
  /** Artigo pensado para imprimir (manual técnico, guia de bolso). */
  imprimivel?: boolean;
};

const EQUIPE: PublicoAjuda[] = ["gestor", "recepcao", "professor", "nutricionista", "autonomo"];

export const ARTIGOS: ArtigoAjuda[] = [
  // ——— Painel da academia ———
  {
    slug: "painel-primeiros-passos",
    titulo: "Primeiros passos no painel",
    resumo: "O menu, o que cada papel enxerga, a tela inicial e como trocar de unidade.",
    secao: "Primeiros passos",
    publicos: EQUIPE,
    rotas: ["/admin/dashboard", "/admin/perfil"],
  },
  {
    slug: "onboarding-academia",
    titulo: "Configuração inicial da academia",
    resumo: "As seis etapas do onboarding, o que cada uma pede e o que fica travado até terminar.",
    secao: "Primeiros passos",
    publicos: ["gestor"],
    rotas: ["/admin/onboarding"],
  },
  {
    slug: "cadastrar-aluno",
    titulo: "Cadastrar um aluno",
    resumo: "Cadastro pela ficha, CPF obrigatório e o que acontece depois de salvar.",
    secao: "Alunos",
    publicos: ["gestor", "recepcao", "autonomo"],
    rotas: ["/admin/alunos"],
  },
  {
    slug: "importar-alunos",
    titulo: "Importar alunos de outro sistema",
    resumo: "Planilha de EVO, Tecnofit, Next Fit ou Pacto: mapear colunas, retomar e corrigir falhas.",
    secao: "Alunos",
    publicos: ["gestor", "autonomo"],
    rotas: ["/admin/alunos/importar"],
  },
  {
    slug: "primeiro-acesso-aluno",
    titulo: "Convite de primeiro acesso e guia do aluno",
    resumo: "Um QR Code para a academia inteira, o guia impresso e o link individual.",
    secao: "Alunos",
    publicos: ["gestor", "recepcao", "autonomo"],
  },
  {
    slug: "situacao-do-aluno",
    titulo: "Situação do aluno: em dia, inadimplente e pausado",
    resumo: "Quem entra no app, a tolerância de 5 dias e a pausa com motivo.",
    secao: "Alunos",
    publicos: ["gestor", "recepcao"],
  },
  {
    slug: "ficha-do-aluno",
    titulo: "A ficha do aluno",
    resumo: "Tudo o que a equipe vê de um aluno num lugar só, bloco por bloco.",
    secao: "Alunos",
    publicos: EQUIPE,
  },
  {
    slug: "fila-de-atendimento",
    titulo: "Atendimento: a fila e o desfecho",
    resumo: "De onde vêm as tarefas, o prazo de cada uma e por que só se encerra com desfecho.",
    secao: "Atendimento",
    publicos: EQUIPE,
    rotas: ["/admin"],
  },
  {
    slug: "mensagens",
    titulo: "Mensagens dos alunos",
    resumo: "A caixa de conversas de treino e dieta, com as não lidas no topo.",
    secao: "Atendimento",
    publicos: EQUIPE,
    rotas: ["/admin/mensagens"],
  },
  {
    slug: "prescrever-treino",
    titulo: "Prescrever um treino",
    resumo: "Divisões A a J, séries diferentes entre si, técnicas e publicação.",
    secao: "Treino e dieta",
    publicos: ["gestor", "professor", "autonomo"],
    rotas: ["/admin/treinos"],
  },
  {
    slug: "acervo-exercicios",
    titulo: "Acervo de exercícios: vídeos e imagens",
    resumo: "Cadastrar exercício da academia, enviar vídeo ou imagem e usar link do YouTube.",
    secao: "Treino e dieta",
    publicos: ["gestor", "professor", "autonomo"],
  },
  {
    slug: "prescrever-dieta",
    titulo: "Prescrever uma dieta",
    resumo: "Refeições, alimentos da tabela, PDF e publicação para o aluno.",
    secao: "Treino e dieta",
    publicos: ["gestor", "nutricionista", "autonomo"],
    rotas: ["/admin/dietas"],
  },
  {
    slug: "avaliacao-fisica",
    titulo: "Avaliação física",
    resumo: "Medidas, dobras, perimetria e o que o aluno vê da própria evolução.",
    secao: "Treino e dieta",
    publicos: ["gestor", "professor", "nutricionista", "autonomo"],
  },
  {
    slug: "documentos-da-matricula",
    titulo: "Contrato de matrícula, PAR-Q e atestado",
    resumo: "O contrato que o aluno assina no app, o questionário de saúde e a conferência do atestado.",
    secao: "Alunos",
    publicos: ["gestor", "recepcao", "professor"],
  },
  {
    slug: "academia-organizacao",
    titulo: "Dados da academia, planos e precificação",
    resumo: "A tela Organização: perfil, planos da academia, contrato de matrícula e preço do Método.",
    secao: "Academia e equipe",
    publicos: ["gestor"],
    rotas: ["/admin/organizacao"],
  },
  {
    slug: "cobranca-do-aluno",
    titulo: "Cobrança do aluno: mensalidade, cartão e avulsa",
    resumo: "Matrícula em plano, taxa de matrícula, cartão automático, cobrança avulsa e segunda via.",
    secao: "Cobrança e financeiro",
    publicos: ["gestor", "recepcao"],
  },
  {
    slug: "financeiro",
    titulo: "Financeiro e fechamento do mês",
    resumo: "Lançamentos automáticos e manuais, comissões, folha e a exportação para o contador.",
    secao: "Cobrança e financeiro",
    publicos: ["gestor"],
    rotas: ["/admin/financeiro"],
  },
  {
    slug: "notas-fiscais",
    titulo: "Nota fiscal automática",
    resumo: "Ligar a emissão pela conta Asaas da academia, cadastro na prefeitura e notas emitidas.",
    secao: "Cobrança e financeiro",
    publicos: ["gestor"],
  },
  {
    slug: "checkin-qr",
    titulo: "Check-in por QR Code",
    resumo: "A tela da recepção que registra a presença de quem não passa pela catraca.",
    secao: "Recepção e frequência",
    publicos: ["gestor", "recepcao"],
    rotas: ["/admin/checkin-qr"],
  },
  {
    slug: "comunicados",
    titulo: "Comunicados",
    resumo: "Avisar alunos e equipe de feriado, horário especial ou evento.",
    secao: "Recepção e frequência",
    publicos: ["gestor", "recepcao"],
    rotas: ["/admin/comunicados"],
  },
  {
    slug: "funil-de-vendas",
    titulo: "Funil de vendas",
    resumo: "Interessados da aula experimental à matrícula, com motivo de quem não fechou.",
    secao: "Recepção e frequência",
    publicos: ["gestor", "recepcao"],
    rotas: ["/admin/funil"],
  },
  {
    slug: "agenda-studio",
    titulo: "Agenda de aulas (studio)",
    resumo: "Turmas com horário e vagas, presença e fila de espera.",
    secao: "Recepção e frequência",
    publicos: ["gestor", "recepcao", "professor"],
    rotas: ["/admin/agenda"],
  },
  {
    slug: "catracas",
    titulo: "Catracas no dia a dia",
    resumo: "Por que a catraca libera ou barra, o que fazer quando cai e como liberar pela tela.",
    secao: "Catraca e biometria",
    publicos: ["gestor", "recepcao"],
    rotas: ["/admin/catracas"],
  },
  {
    slug: "biometria-cadastro",
    titulo: "Digital e cartão na catraca",
    resumo: "Autorização do aluno (app ou termo assinado), cadastro pela ficha e remoção.",
    secao: "Catraca e biometria",
    publicos: ["gestor", "recepcao"],
  },
  {
    slug: "gateway-local-tecnico",
    titulo: "Instalação do Gateway Local (manual técnico)",
    resumo: "Para o técnico: instalar o Gateway no computador da recepção e ligar as catracas.",
    secao: "Catraca e biometria",
    publicos: ["gestor", "arkefit"],
    imprimivel: true,
  },
  {
    slug: "equipe",
    titulo: "Equipe: cadastrar e definir papéis",
    resumo: "Gestor, recepção, professor e nutricionista: o que cada papel pode fazer.",
    secao: "Academia e equipe",
    publicos: ["gestor"],
    rotas: ["/admin/equipe"],
  },
  {
    slug: "relatorios-gestao",
    titulo: "Relatórios: Gestão 360°, Resumo da semana e Retenção",
    resumo: "De onde sai cada número e como usar cada tela.",
    secao: "Relatórios",
    publicos: ["gestor"],
    rotas: ["/admin/gestao-360", "/admin/relatorio-semanal", "/admin/retencao"],
  },
  {
    slug: "metodo-arke-academia",
    titulo: "Método ARKE na academia",
    resumo: "Free, Integrado e Elite; o que a ArkeFit faz pelo aluno e a tela Acompanhamento ARKE.",
    secao: "Relatórios",
    publicos: ["gestor", "recepcao"],
    rotas: ["/admin/acompanhamento"],
  },
  {
    slug: "engajamento",
    titulo: "Desafios, competições e feed",
    resumo: "Engajamento positivo: o que conta ponto e o que nunca tira ponto.",
    secao: "Relatórios",
    publicos: ["gestor", "professor"],
    rotas: ["/admin/engajamento"],
  },
  {
    slug: "integracoes-parceiros",
    titulo: "Wellhub e TotalPass",
    resumo: "Ligar o check-in dos agregadores e onde a chave fica guardada.",
    secao: "Academia e equipe",
    publicos: ["gestor"],
    rotas: ["/admin/configuracoes/integracoes"],
  },
  {
    slug: "encerramento-e-exportacao",
    titulo: "Exportar os dados e encerrar o contrato",
    resumo: "A exportação completa, o aviso de encerramento e os 30 dias depois do término.",
    secao: "Academia e equipe",
    publicos: ["gestor"],
  },
  {
    slug: "privacidade-equipe",
    titulo: "Privacidade: o que a equipe faz com os dados",
    resumo: "Dado de saúde, consentimentos, pedidos do aluno e o que nunca fazer.",
    secao: "Academia e equipe",
    publicos: EQUIPE,
  },

  // ——— App do aluno ———
  {
    slug: "app-primeiro-acesso",
    titulo: "Primeiro acesso ao app",
    resumo: "Criar a senha pelo QR Code da academia, instalar o app no celular e entrar.",
    secao: "Começando",
    publicos: ["aluno"],
  },
  {
    slug: "app-tela-inicial",
    titulo: "A tela inicial",
    resumo: "A próxima ação, o progresso da semana e o botão de ajuda.",
    secao: "Começando",
    publicos: ["aluno"],
    rotas: ["/app"],
  },
  {
    slug: "app-treino",
    titulo: "Fazer o treino",
    resumo: "Escolher a divisão, ver as séries e registrar como foi.",
    secao: "No dia a dia",
    publicos: ["aluno"],
    rotas: ["/app/treinos"],
  },
  {
    slug: "app-checkin-do-dia",
    titulo: "Check-in do dia e pedir ajuda",
    resumo: "Como está sendo seguir o plano, relatar dor e falar com alguém.",
    secao: "No dia a dia",
    publicos: ["aluno"],
  },
  {
    slug: "app-dieta-e-agua",
    titulo: "Dieta e água",
    resumo: "O plano alimentar, marcar as refeições seguidas e o diário de água.",
    secao: "No dia a dia",
    publicos: ["aluno"],
    rotas: ["/app/dieta"],
  },
  {
    slug: "app-presenca-qr",
    titulo: "Registrar presença pelo QR Code da academia",
    resumo: "Para academias sem catraca: aponte a câmera para a tela da recepção.",
    secao: "No dia a dia",
    publicos: ["aluno"],
  },
  {
    slug: "app-evolucao-e-desafios",
    titulo: "Evolução, desafios e feed",
    resumo: "Sua evolução é só sua; desafios e feed são para somar.",
    secao: "No dia a dia",
    publicos: ["aluno"],
    rotas: ["/app/evolucao", "/app/desafios", "/app/competicoes", "/app/feed", "/app/agenda"],
  },
  {
    slug: "app-pagamentos",
    titulo: "Mensalidade, cartão e segunda via",
    resumo: "Onde ver o que está em aberto, pagar a fatura e deixar no cartão.",
    secao: "Pagamentos e documentos",
    publicos: ["aluno"],
    rotas: ["/app/perfil"],
  },
  {
    slug: "app-documentos",
    titulo: "Contrato, PAR-Q e atestado",
    resumo: "Os documentos da matrícula que ficam na tela inicial até serem resolvidos.",
    secao: "Pagamentos e documentos",
    publicos: ["aluno"],
  },
  {
    slug: "app-metodo-arke",
    titulo: "Plano Free e Método ARKE",
    resumo: "O que vem no app da academia e o que o Método acrescenta.",
    secao: "Pagamentos e documentos",
    publicos: ["aluno"],
    rotas: ["/app/jornada"],
  },
  {
    slug: "app-biometria",
    titulo: "Sua digital na catraca, em linguagem simples",
    resumo: "O que é guardado, onde, por quanto tempo e como retirar a autorização.",
    secao: "Privacidade",
    publicos: ["aluno", "gestor", "recepcao"],
  },
  {
    slug: "app-privacidade",
    titulo: "Seus dados e a inteligência artificial",
    resumo: "Quem vê o quê, os dois interruptores de IA e como pedir cópia ou exclusão.",
    secao: "Privacidade",
    publicos: ["aluno"],
  },

  // ——— Visão Master ———
  {
    slug: "vm-duas-etapas",
    titulo: "Entrar com verificação em duas etapas",
    resumo: "Cadastrar o aplicativo autenticador e o que fazer se perder o celular.",
    secao: "Visão Master",
    publicos: ["arkefit"],
  },
  {
    slug: "vm-visao-geral",
    titulo: "Visão Geral e a ficha da organização",
    resumo: "Os números da plataforma, a faixa vermelha e tudo o que se configura por academia.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin"],
  },
  {
    slug: "vm-nova-academia",
    titulo: "Implantar uma academia nova",
    resumo: "Criar a organização, repasse, mensalidade B2B, taxa de implantação e acompanhamento do onboarding.",
    secao: "Visão Master",
    publicos: ["arkefit"],
  },
  {
    slug: "vm-mentoria",
    titulo: "Mentoria: chamados, conversas e operação",
    resumo: "A fila da célula, as três saídas de um chamado e o painel de SLA.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin/mentoria"],
  },
  {
    slug: "vm-equipamentos",
    titulo: "Equipamentos: Gateways, acessos e biometria",
    resumo: "Catracas de todas as academias, ações remotas e remoções paradas.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin/equipamentos"],
  },
  {
    slug: "vm-vigia",
    titulo: "Vigia: a saúde técnica da plataforma",
    resumo: "O que ele corrige sozinho, o que pede aprovação e o resumo diário.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin/vigia"],
  },
  {
    slug: "vm-webhooks-rotinas",
    titulo: "Webhooks, rotinas e conferência com o Asaas",
    resumo: "O que cada evento fez no banco, rotinas paradas e assinaturas órfãs.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin/webhooks"],
  },
  {
    slug: "vm-encerramento",
    titulo: "Encerrar uma academia",
    resumo: "Aviso de 30 dias, término, prazo de exportação e eliminação.",
    secao: "Visão Master",
    publicos: ["arkefit"],
  },
  {
    slug: "vm-contatos",
    titulo: "Contatos do site",
    resumo: "Os pedidos de demonstração da página de vendas: situação, anotações e o e-mail do comercial.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin/contatos"],
  },
  {
    slug: "vm-configuracoes",
    titulo: "Configurações, acervo, profissionais e auditoria",
    resumo: "Taxas, preços B2B, textos da plataforma, acervo global e o registro de ações sensíveis.",
    secao: "Visão Master",
    publicos: ["arkefit"],
    rotas: ["/superadmin/configuracoes", "/superadmin/acervo", "/superadmin/profissionais", "/superadmin/auditoria"],
  },
  {
    slug: "vm-backup",
    titulo: "Restaurar um backup",
    resumo: "Quando restaurar, o que se perde e o passo a passo.",
    secao: "Visão Master",
    publicos: ["arkefit"],
  },
];

export type Area = "admin" | "app" | "superadmin";

/**
 * Quem a pessoa é, para a Central. No painel, o papel na organização; o
 * profissional autônomo vê os artigos dele e os da própria especialidade. A
 * ArkeFit vê tudo: é ela que responde às dúvidas das academias.
 */
export function publicosDaArea(
  area: Area,
  { papel, autonomo = false, especialidade = null }: { papel: string | null; autonomo?: boolean; especialidade?: string | null },
): PublicoAjuda[] {
  if (area === "superadmin") return ["arkefit", "gestor", "recepcao", "professor", "nutricionista", "autonomo", "aluno"];
  if (area === "app") return ["aluno"];
  if (autonomo) return ["autonomo", especialidade === "nutricionista" ? "nutricionista" : "professor"];
  switch (papel) {
    case "gestor":
    case "admin_arke":
      return ["gestor"];
    case "recepcao":
      return ["recepcao"];
    case "professor":
      return ["professor"];
    case "nutricionista":
      return ["nutricionista"];
    default:
      return [];
  }
}

export const artigosPara = (publicos: PublicoAjuda[]) =>
  ARTIGOS.filter((a) => a.publicos.some((p) => publicos.includes(p)));

export const artigoPorSlug = (slug: string | undefined, publicos: PublicoAjuda[]) =>
  artigosPara(publicos).find((a) => a.slug === slug) ?? null;

/** O artigo que explica a tela aberta, para o "?" do cabeçalho. */
export function artigoDaRota(pathname: string, publicos: PublicoAjuda[]): ArtigoAjuda | null {
  const caminho = pathname.replace(/\/+$/, "") || "/";
  return artigosPara(publicos).find((a) => a.rotas?.includes(caminho)) ?? null;
}

export const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * Busca sem acento e sem caixa. Todas as palavras precisam aparecer; título
 * vale mais que resumo, que vale mais que o corpo. Devolve um trecho do corpo
 * em volta da primeira palavra achada lá.
 */
export function buscarArtigos(
  termo: string,
  artigos: ArtigoAjuda[],
  textos: Record<string, string>,
): { artigo: ArtigoAjuda; trecho: string | null }[] {
  const palavras = normalizar(termo).split(/\s+/).filter((p) => p.length > 1);
  if (!palavras.length) return [];
  const resultados: { artigo: ArtigoAjuda; trecho: string | null; pontos: number }[] = [];
  for (const artigo of artigos) {
    const corpoOriginal = (textos[artigo.slug] ?? "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#>*`]/g, "");
    const titulo = normalizar(artigo.titulo);
    const resumo = normalizar(artigo.resumo);
    const corpo = normalizar(corpoOriginal);
    let pontos = 0;
    let todas = true;
    for (const p of palavras) {
      const noTitulo = titulo.includes(p);
      const noResumo = resumo.includes(p);
      const noCorpo = corpo.includes(p);
      if (!noTitulo && !noResumo && !noCorpo) {
        todas = false;
        break;
      }
      pontos += (noTitulo ? 10 : 0) + (noResumo ? 4 : 0) + (noCorpo ? 1 : 0);
    }
    if (!todas) continue;
    let trecho: string | null = null;
    const pos = palavras.map((p) => corpo.indexOf(p)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (pos !== undefined) {
      // A normalização não muda o tamanho do texto sem acento combinado, então
      // a posição vale para o original.
      const inicio = Math.max(0, pos - 60);
      trecho = `${inicio > 0 ? "…" : ""}${corpoOriginal.slice(inicio, pos + 100).replace(/\s+/g, " ").trim()}…`;
    }
    resultados.push({ artigo, trecho, pontos });
  }
  return resultados.sort((a, b) => b.pontos - a.pontos).map(({ artigo, trecho }) => ({ artigo, trecho }));
}
