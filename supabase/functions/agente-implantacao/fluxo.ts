// Bruno, o agente de implantação: o que fazer com cada academia, e os
// e-mails. Sem Deno nem Supabase, para o teste (src/lib/agenteImplantacao.test.ts)
// importar direto. Quem lê o banco, envia e registra é o index.ts.
//
// Sem IA, de propósito: as mensagens são modelos fixos, e todo número que
// aparece nelas vem do banco.

import { blocoPrestador } from "../_shared/prestadorPagamentos.ts";

export type TipoMensagem =
  | "boas_vindas"
  | "proximo_passo"
  | "lembrete"
  | "pedido_evasao"
  | "asaas_aprovada"
  | "asaas_recusada"
  | "kit_lancamento"
  | "chamado_arkefit";

export type Etapa = { etapa: string; ordem: number; principal: boolean; concluida: boolean; detalhe: string | null };

export type MensagemRegistrada = {
  tipo: TipoMensagem;
  chave: string;
  etapa: string | null;
  status: "reservada" | "enviada" | "falhou";
  criado_em: string;
  enviado_em: string | null;
};

export type Implantacao = {
  organization_id: string;
  nome: string;
  slug: string;
  tipo: string;
  status: string;
  emails: string[];
  etapas: Etapa[];
  iniciada_em: string;
  etapa_atual: string | null;
  etapa_atual_desde: string | null;
  concluida_em: string | null;
  asaas_conta_origem: string | null;
  asaas_conta_status: string | null;
  asaas_conferido_em: string | null;
  mensagens: MensagemRegistrada[];
  evasao_inicio: string;
  evasao_fim: string;
};

export type Email = { tipo: Exclude<TipoMensagem, "chamado_arkefit">; chave: string; etapa: string | null; motivo: string };

/** Teto de e-mails por academia por dia (o plano dos agentes: teto por dia e por pessoa). */
export const TETO_DIARIO = 2;
/** Lembretes da mesma etapa parada, a cada 3 dias úteis. */
export const MAXIMO_LEMBRETES = 2;
const DIAS_UTEIS_LEMBRETE = 3;

// ── Calendário de Brasília ────────────────────────────────────────────────
// O fuso é fixo em São Paulo, e não o do servidor, pelo mesmo motivo de todo
// o resto do sistema: a hora que importa é a da academia.

const FORMATO = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function emBrasilia(d: Date): { data: string; hora: number; diaSemana: number } {
  const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), diaSemana: DIAS[p.weekday] };
}

/** Dia útil, das 9h às 19h de Brasília: quando o agente fala com gente. */
export function emHorarioComercial(agora: Date): boolean {
  const b = emBrasilia(agora);
  return b.diaSemana >= 1 && b.diaSemana <= 5 && b.hora >= 9 && b.hora < 19;
}

const DIA_MS = 24 * 3600_000;

/**
 * Um dia útil depois de `desde`, sem contar o fim de semana: sexta às 15h
 * vence segunda às 15h, e o que começou no sábado vence na terça à meia-noite
 * (o relógio só começa na segunda). Feriado não entra: o custo de errar é uma
 * ligação a mais, não uma a menos.
 */
export function diaUtilDepois(desde: Date): Date {
  let inicio = desde;
  const b = emBrasilia(inicio);
  if (b.diaSemana === 6 || b.diaSemana === 0) {
    // Começa na segunda à meia-noite de Brasília (03:00 UTC: o Brasil não tem
    // horário de verão desde 2019).
    const ate = b.diaSemana === 6 ? 2 : 1;
    const [a, m, d] = b.data.split("-").map(Number);
    inicio = new Date(Date.UTC(a, m - 1, d + ate, 3, 0, 0));
  }
  let fim = new Date(inicio.getTime() + DIA_MS);
  const f = emBrasilia(fim).diaSemana;
  if (f === 6) fim = new Date(fim.getTime() + 2 * DIA_MS);
  else if (f === 0) fim = new Date(fim.getTime() + DIA_MS);
  return fim;
}

export function diasUteisDepois(desde: Date, n: number): Date {
  let d = desde;
  for (let i = 0; i < n; i++) d = diaUtilDepois(d);
  return d;
}

// ── A sequência ───────────────────────────────────────────────────────────

/** A etapa principal pendente, na ordem. Null: a implantação terminou. */
export function proximaEtapa(etapas: Etapa[]): Etapa | null {
  return [...etapas].filter((e) => e.principal && !e.concluida).sort((a, b) => a.ordem - b.ordem)[0] ?? null;
}

function concluida(etapas: Etapa[], nome: string): boolean {
  return etapas.some((e) => e.etapa === nome && e.concluida);
}

function enviadas(imp: Implantacao): MensagemRegistrada[] {
  return imp.mensagens.filter((m) => m.status === "enviada");
}

/** E-mails que saíram (ou estão saindo) hoje, em Brasília: é o que conta para o teto. */
export function emailsHoje(imp: Implantacao, agora: Date): number {
  const hoje = emBrasilia(agora).data;
  return imp.mensagens.filter(
    (m) => m.tipo !== "chamado_arkefit" && m.status !== "falhou" && emBrasilia(new Date(m.enviado_em ?? m.criado_em)).data === hoje
  ).length;
}

/**
 * O e-mail devido agora para a academia, se houver. Um por rodada, pela
 * prioridade: o kit, a próxima etapa, o Asaas, o lembrete e o pedido da
 * evasão. A rodada seguinte manda o próximo — dentro do teto do dia.
 */
export function emailDevido(imp: Implantacao, agora: Date): Email | null {
  if (!imp.emails.length || !emHorarioComercial(agora) || emailsHoje(imp, agora) >= TETO_DIARIO) return null;
  const ja = (tipo: TipoMensagem, chave?: string) =>
    imp.mensagens.some((m) => m.tipo === tipo && (chave === undefined || m.chave === chave) && m.status !== "falhou");
  const prox = proximaEtapa(imp.etapas);

  // 1. O kit: liberação e primeira entrada prontas.
  if (prox?.etapa === "lancamento") {
    return { tipo: "kit_lancamento", chave: "kit", etapa: "lancamento", motivo: "A primeira entrada foi registrada: hora de chamar todos os alunos." };
  }

  // 2. A etapa da vez, uma vez cada: o primeiro contato é a boas-vindas.
  if (prox) {
    const primeiroContato = !imp.mensagens.some((m) => (m.tipo === "boas_vindas" || m.tipo === "proximo_passo") && m.status !== "falhou");
    if (primeiroContato) {
      return { tipo: "boas_vindas", chave: "boas_vindas", etapa: prox.etapa, motivo: `Início da implantação; próximo passo: ${PASSOS[prox.etapa]?.titulo ?? prox.etapa}.` };
    }
    const avisada = imp.mensagens.some(
      (m) => (m.tipo === "proximo_passo" || m.tipo === "boas_vindas") && m.etapa === prox.etapa && m.status !== "falhou"
    );
    if (!avisada) {
      return { tipo: "proximo_passo", chave: prox.etapa, etapa: prox.etapa, motivo: `Etapa anterior concluída; próximo passo: ${PASSOS[prox.etapa]?.titulo ?? prox.etapa}.` };
    }
  }

  // 3. A conta do Asaas mudou.
  if (imp.asaas_conta_origem === "criada" && imp.asaas_conta_status === "APPROVED" && !ja("asaas_aprovada")) {
    return { tipo: "asaas_aprovada", chave: "aprovada", etapa: "recebimentos", motivo: "O Asaas aprovou a conta de recebimentos." };
  }
  if (imp.asaas_conta_origem === "criada" && imp.asaas_conta_status === "REJECTED" && !ja("asaas_recusada")) {
    return { tipo: "asaas_recusada", chave: "recusada", etapa: "recebimentos", motivo: "O Asaas recusou a conta de recebimentos." };
  }

  // 4. A mesma etapa parada: um lembrete a cada 3 dias úteis, até dois.
  if (prox) {
    const sobreEla = enviadas(imp)
      .filter((m) => (m.tipo === "boas_vindas" || m.tipo === "proximo_passo" || m.tipo === "lembrete") && m.etapa === prox.etapa)
      .map((m) => new Date(m.enviado_em!).getTime());
    const lembretes = imp.mensagens.filter((m) => m.tipo === "lembrete" && m.chave.startsWith(`${prox.etapa}:`) && m.status !== "falhou").length;
    if (sobreEla.length && lembretes < MAXIMO_LEMBRETES) {
      const ultimo = new Date(Math.max(...sobreEla));
      if (agora >= diasUteisDepois(ultimo, DIAS_UTEIS_LEMBRETE)) {
        return { tipo: "lembrete", chave: `${prox.etapa}:${lembretes + 1}`, etapa: prox.etapa, motivo: `${PASSOS[prox.etapa]?.titulo ?? prox.etapa} parada há ${DIAS_UTEIS_LEMBRETE} dias úteis.` };
      }
    }
  }

  // 5. A evasão anterior: pedida quando os alunos chegaram do sistema antigo
  // (é quando ele está aberto), e lembrada uma vez depois da liberação.
  if (!concluida(imp.etapas, "evasao_anterior") && concluida(imp.etapas, "alunos")) {
    if (!ja("pedido_evasao", "1")) {
      return { tipo: "pedido_evasao", chave: "1", etapa: "evasao_anterior", motivo: "Base da medida de resultado: a evasão dos 6 meses anteriores." };
    }
    const primeiro = imp.mensagens.find((m) => m.tipo === "pedido_evasao" && m.chave === "1" && m.enviado_em);
    if (
      primeiro &&
      concluida(imp.etapas, "liberacao") &&
      !ja("pedido_evasao", "2") &&
      agora >= diasUteisDepois(new Date(primeiro.enviado_em!), DIAS_UTEIS_LEMBRETE)
    ) {
      return { tipo: "pedido_evasao", chave: "2", etapa: "evasao_anterior", motivo: "A evasão anterior ainda não foi informada." };
    }
  }
  return null;
}

/** Parada há 1 dia útil na mesma etapa: a ArkeFit liga. O kit sai sozinho, então não chama. */
export function chamadoDevido(imp: Implantacao, desde: Date | null, agora: Date): { etapa: string; motivo: string } | null {
  const prox = proximaEtapa(imp.etapas);
  if (!prox || !desde || prox.etapa === "lancamento") return null;
  if (agora < diaUtilDepois(desde)) return null;
  const titulo = PASSOS[prox.etapa]?.titulo ?? prox.etapa;
  return { etapa: prox.etapa, motivo: `Parada em "${titulo}" desde ${dataCurta(desde)}${prox.detalhe ? `: ${prox.detalhe}` : ""}.` };
}

/** A consulta diária da aprovação, só para a conta que o ArkeFit abriu. */
export function conferirAsaasDevido(imp: Implantacao, agora: Date): boolean {
  if (imp.asaas_conta_origem !== "criada" || imp.asaas_conta_status === "APPROVED") return false;
  if (!imp.asaas_conferido_em) return true;
  return agora.getTime() - new Date(imp.asaas_conferido_em).getTime() >= 20 * 3600_000;
}

// ── Os textos ─────────────────────────────────────────────────────────────

type Link = { rotulo: string; rota: string };
type Passo = { titulo: string; texto: string; links: Link[]; artigos: { slug: string; titulo: string }[] };

export const PASSOS: Record<string, Passo> = {
  dados: {
    titulo: "Dados da academia",
    texto: "Preencha o CNPJ e o CEP: razão social e endereço vêm sozinhos.",
    links: [{ rotulo: "Abrir a configuração", rota: "/admin/onboarding" }],
    artigos: [{ slug: "onboarding-academia", titulo: "Configuração inicial da academia" }],
  },
  recebimentos: {
    titulo: "Conta de recebimentos",
    texto:
      "Abra a conta da academia no site do Asaas, que é gratuita, ou use a que ela já tem, e informe a carteira no ArkeFit. É nela que cai a parte da academia em cada mensalidade.",
    links: [{ rotulo: "Abrir a configuração", rota: "/admin/onboarding" }],
    artigos: [{ slug: "onboarding-academia", titulo: "Configuração inicial da academia" }],
  },
  planos: {
    titulo: "Planos e preços",
    texto: "Os planos mensal, trimestral e anual já vêm prontos: ajuste os preços e ative os que a academia vende.",
    links: [{ rotulo: "Abrir a configuração", rota: "/admin/onboarding" }],
    artigos: [{ slug: "onboarding-academia", titulo: "Configuração inicial da academia" }],
  },
  equipe: {
    titulo: "Equipe",
    texto: "Cadastre professores, nutricionista e recepção, ou marque que a gestão trabalha sozinha.",
    links: [{ rotulo: "Abrir a configuração", rota: "/admin/onboarding" }],
    artigos: [{ slug: "equipe", titulo: "Equipe" }],
  },
  alunos: {
    titulo: "Alunos",
    texto: "Importe a planilha do sistema anterior (as exportações do EVO, da Tecnofit, do Next Fit e do Pacto são reconhecidas) ou cadastre os alunos.",
    links: [{ rotulo: "Importar a planilha", rota: "/admin/alunos/importar" }],
    artigos: [{ slug: "importar-alunos", titulo: "Importar alunos" }],
  },
  contrato: {
    titulo: "Contrato",
    texto: "Leia e aceite a licença de uso e o acordo de tratamento dos dados dos alunos.",
    links: [{ rotulo: "Abrir a configuração", rota: "/admin/onboarding" }],
    artigos: [{ slug: "onboarding-academia", titulo: "Configuração inicial da academia" }],
  },
  liberacao: {
    titulo: "Liberar o app",
    texto: "As seis etapas estão prontas. Conclua a configuração para os alunos entrarem no app.",
    links: [{ rotulo: "Concluir a configuração", rota: "/admin/onboarding" }],
    artigos: [{ slug: "onboarding-academia", titulo: "Configuração inicial da academia" }],
  },
  primeira_entrada: {
    titulo: "Primeira entrada",
    texto:
      "Teste a entrada com um aluno de verdade. Com catraca: instale o Gateway Local no computador da recepção e passe um aluno. Sem catraca: abra o Check-in QR na recepção e peça a um aluno para escanear com o celular. O kit para chamar todos os alunos sai logo depois.",
    links: [
      { rotulo: "Catracas", rota: "/admin/catracas" },
      { rotulo: "Check-in QR", rota: "/admin/checkin-qr" },
    ],
    artigos: [
      { slug: "catracas", titulo: "Catracas" },
      { slug: "checkin-qr", titulo: "Check-in por QR Code" },
    ],
  },
  primeiro_aluno_app: {
    titulo: "Primeiro aluno no app",
    texto: "Mande o convite de primeiro acesso: um link e um QR Code para todos os seus alunos criarem a senha.",
    links: [{ rotulo: "Convite de primeiro acesso", rota: "/admin/alunos" }],
    artigos: [{ slug: "primeiro-acesso-aluno", titulo: "Primeiro acesso do aluno" }],
  },
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function dataCurta(d: Date): string {
  const [, m, dia] = emBrasilia(d).data.split("-");
  return `${dia}/${m}`;
}

function mesPorExtenso(iso: string): string {
  const [a, m] = iso.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

type Bloco = { titulo?: string; paragrafos: string[]; links?: { rotulo: string; url: string }[] };

/**
 * `prestador`: o e-mail fala da conta de recebimentos ou de pagamento, e leva
 * o selo e o texto do Asaas como prestador, com o atendimento dele (BaaS,
 * art. 14 da Resolução Conjunta nº 16/2025; `_shared/prestadorPagamentos.ts`).
 */
function montar(assunto: string, abertura: string, blocos: Bloco[], assinatura: string, rodape: string | null, prestador = false) {
  const asaas = prestador ? blocoPrestador() : null;
  const texto = [
    abertura,
    "",
    ...blocos.flatMap((b) => [
      ...(b.titulo ? [b.titulo] : []),
      ...b.paragrafos,
      ...(b.links ?? []).map((l) => `${l.rotulo}: ${l.url}`),
      "",
    ]),
    assinatura,
    ...(asaas ? ["", asaas.texto] : []),
    ...(rodape ? ["", rodape] : []),
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(abertura)}</p>
  ${blocos
    .map(
      (b) => `${b.titulo ? `<p style="margin-bottom:4px"><strong>${escapar(b.titulo)}</strong></p>` : ""}
  ${b.paragrafos.map((p) => `<p style="margin-top:4px">${escapar(p)}</p>`).join("")}
  ${(b.links ?? [])
    .map(
      (l, i) =>
        `<p style="margin-top:4px">${
          i === 0
            ? `<a href="${escapar(l.url)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(l.rotulo)}</a>`
            : `<a href="${escapar(l.url)}" style="color:#111">${escapar(l.rotulo)}</a>`
        }</p>`
    )
    .join("")}`
    )
    .join("\n  ")}
  <p style="margin-top:24px">${escapar(assinatura)}</p>
  ${asaas ? asaas.html : ""}
  ${rodape ? `<p style="color:#666;font-size:12px">${escapar(rodape)}</p>` : ""}
</div>`;
  return { assunto, html, texto };
}

/** A etapa fala da conta de recebimentos: o e-mail leva o prestador. */
const etapaDePagamento = (etapa: string | null | undefined) => etapa === "recebimentos";

function blocoDoPasso(etapa: string, site: string): Bloco {
  const p = PASSOS[etapa];
  if (!p) return { paragrafos: [] };
  return {
    titulo: p.titulo,
    paragrafos: [p.texto],
    links: [
      ...p.links.map((l) => ({ rotulo: l.rotulo, url: `${site}/#${l.rota}` })),
      ...p.artigos.map((a) => ({ rotulo: `Como fazer: ${a.titulo}`, url: `${site}/#/admin/ajuda/${a.slug}` })),
    ],
  };
}

export function montarEmail(
  email: Email,
  imp: Pick<Implantacao, "nome" | "slug" | "tipo" | "etapas" | "evasao_inicio" | "evasao_fim">,
  opcoes: { site: string; assinatura: string }
): { assunto: string; html: string; texto: string } {
  const { site, assinatura } = opcoes;
  const academia = imp.nome;
  const rodape = `Você recebe este e-mail porque está implantando o ArkeFit na ${academia}.`;
  const feitas = imp.etapas.filter((e) => e.principal && e.concluida).length;
  const total = imp.etapas.filter((e) => e.principal).length;
  const andamento = `Até aqui: ${feitas} de ${total} etapas da implantação. O painel completo fica em ${site}/#/admin/onboarding.`;

  switch (email.tipo) {
    case "boas_vindas":
      return montar(
        `${academia}: o primeiro passo no ArkeFit`,
        `Olá! Daqui até o primeiro aluno entrando, este e-mail traz sempre o próximo passo da ${academia}, com o link da tela e do artigo que explica.`,
        [blocoDoPasso(email.etapa!, site), { paragrafos: [andamento] }],
        assinatura,
        rodape,
        etapaDePagamento(email.etapa)
      );
    case "proximo_passo":
      return montar(
        `${academia}: próximo passo, ${PASSOS[email.etapa!]?.titulo ?? email.etapa}`,
        "Uma etapa a menos. O próximo passo é este:",
        [blocoDoPasso(email.etapa!, site), { paragrafos: [andamento] }],
        assinatura,
        rodape,
        etapaDePagamento(email.etapa)
      );
    case "lembrete":
      return montar(
        `${academia}: falta ${PASSOS[email.etapa!]?.titulo ?? email.etapa} para continuar`,
        `A implantação da ${academia} está esperando esta etapa. Se travou em alguma coisa, é só responder este e-mail.`,
        [blocoDoPasso(email.etapa!, site), { paragrafos: [andamento] }],
        assinatura,
        rodape,
        etapaDePagamento(email.etapa)
      );
    case "pedido_evasao":
      return montar(
        `${academia}: a base para medir o resultado do ArkeFit`,
        "Para saber se o ArkeFit está segurando mais alunos, comparamos a evasão dos 6 meses com ele com a dos 6 meses antes.",
        [
          {
            titulo: "O que precisamos",
            paragrafos: [
              `No sistema anterior, para cada mês de ${mesPorExtenso(imp.evasao_inicio)} a ${mesPorExtenso(imp.evasao_fim)}: quantos alunos estavam ativos no começo do mês e quantos saíram. Leva uns 5 minutos.`,
              "Sem esse número a medida não tem base de comparação, e é ela que mostra o resultado.",
            ],
            links: [{ rotulo: "Informar a evasão", url: `${site}/#/admin/onboarding` }],
          },
        ],
        assinatura,
        rodape
      );
    case "asaas_aprovada":
      return montar(
        `${academia}: conta de recebimentos aprovada`,
        `O Asaas aprovou a conta de recebimentos da ${academia}. A parte da academia em cada mensalidade cai nela, e o saque já está liberado.`,
        [{ paragrafos: [andamento] }],
        assinatura,
        rodape,
        true
      );
    case "asaas_recusada":
      return montar(
        `${academia}: o Asaas recusou a conta de recebimentos`,
        `O Asaas recusou a conta de recebimentos da ${academia}. O motivo vem no e-mail do próprio Asaas, e a equipe da ArkeFit vai entrar em contato para resolver junto.`,
        [{ paragrafos: [andamento] }],
        assinatura,
        rodape,
        true
      );
    case "kit_lancamento": {
      const autonomo = imp.tipo === "profissional_autonomo";
      const primeiroAcesso = `${site}/#/p/${imp.slug}/primeiro-acesso`;
      const entrar = `${site}/#/p/${imp.slug}/entrar`;
      const matricula = `${site}/#/p/${imp.slug}`;
      return montar(
        `${academia}: o kit para chamar todos os alunos`,
        autonomo
          ? "O primeiro aluno já entrou no app. Agora é chamar os outros: está tudo aqui."
          : "A primeira entrada funcionou. Agora é chamar todos os alunos: está tudo aqui.",
        [
          {
            titulo: "1. O convite de primeiro acesso",
            paragrafos: [
              "Um link só para todos os alunos que já estão cadastrados: cada um digita o e-mail ou o celular e recebe o link para criar a senha.",
              `Na tela de alunos ficam o QR Code para imprimir e a folha do guia do aluno, pronta para a recepção.`,
            ],
            links: [
              { rotulo: "Baixar o QR Code e o guia", url: `${site}/#/admin/alunos` },
              { rotulo: "O link do convite", url: primeiroAcesso },
            ],
          },
          {
            titulo: "2. O app com a marca da academia",
            paragrafos: ["Quem entra por este link instala o app com o nome e o ícone da academia na tela do celular."],
            links: [{ rotulo: "O link de entrada da academia", url: entrar }],
          },
          {
            titulo: "3. Uma mensagem pronta para o grupo e as redes",
            paragrafos: [
              `"A ${academia} agora tem app! Seu treino, sua frequência e seus pagamentos no celular. Crie sua senha em ${primeiroAcesso} e instale o app na tela de início."`,
            ],
          },
          {
            titulo: "4. Aluno novo",
            paragrafos: ["Quem ainda não é aluno se matricula sozinho, pelo link da matrícula."],
            links: [{ rotulo: "O link da matrícula", url: matricula }],
          },
          {
            paragrafos: ["Com isso a implantação termina. Dúvidas de agora em diante: é só responder este e-mail."],
            links: [{ rotulo: "Como fazer: Primeiro acesso do aluno", url: `${site}/#/admin/ajuda/primeiro-acesso-aluno` }],
          },
        ],
        assinatura,
        rodape
      );
    }
  }
}

/** O e-mail para a ArkeFit quando a academia para: alguém liga. */
export function montarChamado(
  imp: Pick<Implantacao, "nome">,
  chamado: { etapa: string; motivo: string },
  opcoes: { site: string }
): { assunto: string; html: string; texto: string } {
  const titulo = PASSOS[chamado.etapa]?.titulo ?? chamado.etapa;
  return montar(
    `Implantação parada: ${imp.nome}, em ${titulo}`,
    `${imp.nome} está parada há 1 dia útil. O agente de implantação abriu um chamado para a ArkeFit ligar.`,
    [
      {
        paragrafos: [chamado.motivo, "Registre a ligação e o desfecho no chamado, com a próxima checagem se houver."],
        links: [{ rotulo: "Abrir a implantação na Visão Master", url: `${opcoes.site}/#/superadmin/implantacao` }],
      },
    ],
    "Agente de implantação",
    null
  );
}
