// Quem recebe qual aviso de retenção, e o texto de cada um, sem Deno e sem
// Supabase, para o teste do app exercitar o código real (26/10/2026).
//
// Quem PODE receber (matrícula ativa, em dia, não anonimizado) o banco decide
// em `alunos_para_avisos_de_retencao()`. Aqui fica qual aviso sai hoje e por
// qual canal:
//
//   * sem o primeiro acesso: só o convite de novo, por e-mail, uma vez;
//   * 3 dias sem treinar: o 1º aviso, no celular; sem aviso no celular ligado,
//     por e-mail;
//   * 5 dias sem treinar: o 2º aviso, no celular e por e-mail, nunca no mesmo
//     dia do 1º;
//   * atestado vencendo em até 15 dias: no celular e por e-mail.
//
// Cada aviso sai uma vez por período. O período da inatividade é o dia do
// último treino: o aluno que volta a treinar muda o período, e a sequência
// recomeça. Sem teto semanal. Passados 14 dias parado, o aviso automático já
// não sai: é caso de conversa, e na estreia a base parada há meses não recebe
// dois e-mails de uma vez.
//
// Na academia fictícia (a de demonstração), nenhum e-mail sai: os endereços
// são de um domínio que não recebe e-mail, e cada devolução pesa na reputação
// do remetente. O aviso no celular sai e fica registrado, para a prova de tela.

import { dataBrasilia } from "../_shared/data.ts";

export type TipoAviso = "convite" | "inatividade_1" | "inatividade_2" | "atestado";
export type Canal = "push" | "email";

/** A janela do envio, em Brasília: das 8h às 20h, todo dia. */
export const HORARIO_DO_AVISO = { inicio: 8, fim: 20 };

/** Dias sem treinar de cada aviso, e o último dia em que o aviso automático ainda sai. */
export const DIAS_SEM_TREINAR = { primeiro: 3, segundo: 5, ultimo: 14 };

/** Até quantos dias antes do vencimento o atestado é pedido (o mesmo da tarefa da fila). */
export const ATESTADO_DIAS = 15;

export type AvisoEnviado = { tipo: string; referencia: string; enviado_em: string };

export type Candidato = {
  primeiro_acesso: boolean;
  convite_permitido: boolean;
  matriculado_em: string;
  parado_desde: string | null;
  atestado_validade: string | null;
  lembretes_de_treino: boolean;
  tem_push: boolean;
  ficticia: boolean;
  avisos: AvisoEnviado[];
};

export type AvisoPlanejado = { tipo: TipoAviso; referencia: string; canais: Canal[] };

/** Dias de `de` até `ate` (datas `YYYY-MM-DD`). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

const HORA = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" });

/** A hora (0 a 23) de um instante em Brasília. */
export function horaBrasilia(momento: Date): number {
  return Number(HORA.format(momento));
}

export function dentroDoHorario(hora: number): boolean {
  return hora >= HORARIO_DO_AVISO.inicio && hora < HORARIO_DO_AVISO.fim;
}

/** Os avisos que saem hoje para este aluno, já com os canais. */
export function avisosDoDia(c: Candidato, hoje: string): AvisoPlanejado[] {
  const enviado = (tipo: TipoAviso, referencia: string) => c.avisos.find((a) => a.tipo === tipo && a.referencia === referencia);
  const planejados: AvisoPlanejado[] = [];

  if (!c.primeiro_acesso) {
    // Sem o primeiro acesso, só o convite: o aluno nem tem o app.
    if (c.convite_permitido && !enviado("convite", c.matriculado_em)) {
      planejados.push({ tipo: "convite", referencia: c.matriculado_em, canais: ["email"] });
    }
    return semEmailNaFicticia(planejados, c.ficticia);
  }

  if (c.parado_desde && c.lembretes_de_treino) {
    const dias = diasEntre(c.parado_desde, hoje);
    const ref = c.parado_desde;
    if (dias >= DIAS_SEM_TREINAR.primeiro && dias <= DIAS_SEM_TREINAR.ultimo) {
      const primeiro = enviado("inatividade_1", ref);
      if (!primeiro) {
        planejados.push({ tipo: "inatividade_1", referencia: ref, canais: c.tem_push ? ["push"] : ["email"] });
      } else if (
        dias >= DIAS_SEM_TREINAR.segundo &&
        !enviado("inatividade_2", ref) &&
        dataBrasilia(new Date(primeiro.enviado_em)) < hoje
      ) {
        planejados.push({ tipo: "inatividade_2", referencia: ref, canais: c.tem_push ? ["push", "email"] : ["email"] });
      }
    }
  }

  if (c.atestado_validade) {
    const faltam = diasEntre(hoje, c.atestado_validade);
    if (faltam >= 0 && faltam < ATESTADO_DIAS && !enviado("atestado", c.atestado_validade)) {
      planejados.push({ tipo: "atestado", referencia: c.atestado_validade, canais: c.tem_push ? ["push", "email"] : ["email"] });
    }
  }

  return semEmailNaFicticia(planejados, c.ficticia);
}

function semEmailNaFicticia(planejados: AvisoPlanejado[], ficticia: boolean): AvisoPlanejado[] {
  if (!ficticia) return planejados;
  return planejados
    .map((p) => ({ ...p, canais: p.canais.filter((canal) => canal !== "email") }))
    .filter((p) => p.canais.length > 0);
}

// ── O aviso no celular ─────────────────────────────────────────────────────
//
// A tela bloqueada do celular é pública: sem nome da academia e, no atestado,
// sem dado de saúde ("atestado médico" diz que o PAR-Q teve um "sim"). O
// detalhe fica no app e no e-mail. O toque abre o app, nunca um link de fora.
// O tom é o do produto: pergunta construtiva, sem culpa.

export const AVISO_PUSH: Record<Exclude<TipoAviso, "convite">, { title: string; body: string; url: string; tag: string }> = {
  inatividade_1: {
    title: "Como está sendo seguir seu plano?",
    body: "Seu treino está no app quando você quiser. Toque para abrir.",
    url: "/#/app/treinos",
    tag: "retencao-treino",
  },
  inatividade_2: {
    title: "Sentimos sua falta",
    body: "Seu treino está te esperando. Toque para abrir o treino do dia.",
    url: "/#/app/treinos",
    tag: "retencao-treino",
  },
  atestado: {
    title: "Um lembrete da sua academia",
    body: "Tem um recado sobre a sua matrícula no app. Toque para ver.",
    url: "/#/app",
    tag: "retencao-matricula",
  },
};

/** O tópico do push (até 32 caracteres): com o aparelho desligado, fica só o último aviso de cada assunto. */
export const TOPICO_PUSH: Record<Exclude<TipoAviso, "convite">, string> = {
  inatividade_1: "retencaotreino",
  inatividade_2: "retencaotreino",
  atestado: "retencaomatricula",
};

// ── O e-mail ───────────────────────────────────────────────────────────────

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? "";
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export type DadosDoEmail = {
  nome: string;
  academia: string;
  /** O link do botão: o de criar a senha no convite; a tela do app nos outros. */
  link: string;
  /** O link do Perfil, onde os lembretes de treino desligam. */
  linkPerfil: string;
  atestadoValidade?: string | null;
};

/**
 * O e-mail de cada aviso. O assunto aparece na tela bloqueada como o aviso no
 * celular: no atestado ele é genérico, e o detalhe fica no corpo.
 */
export function emailDoAviso(tipo: TipoAviso, o: DadosDoEmail): { assunto: string; html: string; texto: string } {
  const quem = primeiroNome(o.nome);
  const abertura = quem ? `Olá, ${quem}.` : "Olá.";
  let assunto: string;
  let paragrafos: string[];
  let botao: string;
  let rodape: string | null = null;

  switch (tipo) {
    case "convite":
      assunto = `Seu acesso à ${o.academia} está pronto`;
      paragrafos = [
        `A ${o.academia} fez a sua matrícula no ArkeFit, o app com os seus treinos, a sua agenda e o contato com a equipe.`,
        "O seu acesso está pronto: crie a sua senha pelo botão abaixo e entre.",
        "Se o botão não funcionar mais, ou se você não reconhece esta matrícula, fale com a recepção da academia.",
      ];
      botao = "Criar minha senha";
      break;
    case "inatividade_1":
      assunto = "Como está sendo seguir seu plano?";
      paragrafos = [
        "Passando para saber: como está sendo seguir seu plano?",
        `Seu treino está no app quando você quiser. Se algo mudou na sua rotina, a equipe da ${o.academia} ajusta o plano com você pelo chat do app.`,
      ];
      botao = "Abrir meu treino";
      rodape = "lembretes";
      break;
    case "inatividade_2":
      assunto = `Sentimos sua falta na ${o.academia}`;
      paragrafos = [
        "Sentimos sua falta. Seu treino está te esperando: é só abrir o app e começar pelo treino do dia.",
        "Se precisar de um ajuste no horário ou no treino, fale com a equipe pelo chat do app.",
      ];
      botao = "Abrir o treino do dia";
      rodape = "lembretes";
      break;
    case "atestado":
      assunto = `Um lembrete da ${o.academia} sobre a sua matrícula`;
      paragrafos = [
        o.atestadoValidade
          ? `O atestado médico que está na sua matrícula vence em ${formatarData(o.atestadoValidade)}.`
          : "O atestado médico que está na sua matrícula vence nos próximos dias.",
        "Leve o atestado novo à recepção antes dessa data, para continuar registrando os seus treinos no app sem interrupção.",
      ];
      botao = "Abrir o app";
      break;
  }

  const linhasRodape =
    rodape === "lembretes"
      ? [`Não quer receber estes lembretes? Desligue em Perfil, "Lembretes de treino", no app: ${o.linkPerfil}`]
      : [];
  const texto = [abertura, "", ...paragrafos, "", `${botao}: ${o.link}`, ...(linhasRodape.length ? ["", ...linhasRodape] : [])].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111;line-height:1.5">
  <p>${escapar(abertura)}</p>
  ${paragrafos.map((p) => `<p>${escapar(p)}</p>`).join("\n  ")}
  <p><a href="${escapar(o.link)}" style="display:inline-block;background:#111;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none">${escapar(botao)}</a></p>${
    rodape === "lembretes"
      ? `\n  <p style="font-size:12px;color:#555">Não quer receber estes lembretes? Desligue em <a href="${escapar(o.linkPerfil)}">Perfil, "Lembretes de treino"</a>, no app.</p>`
      : ""
  }
</div>`;
  return { assunto, html, texto };
}
