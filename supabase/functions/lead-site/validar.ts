/**
 * Validação do formulário da página de vendas. Sem Deno e sem Supabase, para
 * o teste do app exercitar este código e não uma cópia. As mesmas regras
 * estão no banco (`leads_site`); aqui elas viram mensagens para quem digitou.
 */

export const FAIXAS_ALUNOS = ["ate_150", "151_500", "501_1000", "mais_1000"] as const;

export type Lead = {
  nome: string;
  academia: string;
  cidade: string | null;
  uf: string | null;
  telefone: string;
  email: string;
  alunos_faixa: (typeof FAIXAS_ALUNOS)[number] | null;
  sistema_atual: string | null;
  mensagem: string | null;
  origem: string | null;
};

const texto = (v: unknown, max: number) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t.slice(0, max);
};

export function validarLead(corpo: Record<string, unknown>): { ok: true; lead: Lead } | { ok: false; erro: string } {
  const nome = texto(corpo.nome, 120);
  const academia = texto(corpo.academia, 160);
  const email = texto(corpo.email, 200).toLowerCase();
  const digitos = String(corpo.telefone ?? "").replace(/\D/g, "");
  const uf = texto(corpo.uf, 2).toUpperCase();
  const faixa = texto(corpo.alunos_faixa, 20);

  if (nome.length < 2) return { ok: false, erro: "Informe o seu nome." };
  if (academia.length < 2) return { ok: false, erro: "Informe o nome da academia." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: "Confira o e-mail." };
  if (digitos.length < 10 || digitos.length > 13) return { ok: false, erro: "Informe o WhatsApp com DDD." };
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { ok: false, erro: "UF com duas letras, como SP." };
  if (faixa && !(FAIXAS_ALUNOS as readonly string[]).includes(faixa)) return { ok: false, erro: "Escolha a faixa de alunos." };

  return {
    ok: true,
    lead: {
      nome,
      academia,
      cidade: texto(corpo.cidade, 120) || null,
      uf: uf || null,
      telefone: digitos,
      email,
      alunos_faixa: (faixa || null) as Lead["alunos_faixa"],
      sistema_atual: texto(corpo.sistema_atual, 80) || null,
      mensagem: typeof corpo.mensagem === "string" ? corpo.mensagem.trim().slice(0, 2000) || null : null,
      origem: texto(corpo.origem, 200) || null,
    },
  };
}

export const ROTULO_FAIXA: Record<string, string> = {
  ate_150: "até 150 alunos",
  "151_500": "151 a 500 alunos",
  "501_1000": "501 a 1.000 alunos",
  mais_1000: "mais de 1.000 alunos",
};

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** O e-mail que avisa o comercial. Tudo o que veio do formulário é escapado. */
export function emailDoLead(lead: Lead, painel: string): { assunto: string; html: string } {
  const linhas: [string, string | null][] = [
    ["Nome", lead.nome],
    ["Academia", lead.academia],
    ["Cidade", [lead.cidade, lead.uf].filter(Boolean).join(" / ") || null],
    ["WhatsApp", lead.telefone],
    ["E-mail", lead.email],
    ["Alunos", lead.alunos_faixa ? ROTULO_FAIXA[lead.alunos_faixa] : null],
    ["Sistema atual", lead.sistema_atual],
    ["Mensagem", lead.mensagem],
    ["Origem", lead.origem],
  ];
  const tabela = linhas
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#64748b;vertical-align:top">${k}</td><td style="padding:6px 0;white-space:pre-wrap">${escapar(String(v))}</td></tr>`,
    )
    .join("");
  const local = [lead.cidade, lead.uf].filter(Boolean).join("/");
  return {
    assunto: `Contato pelo site: ${lead.academia}${local ? ` (${local})` : ""}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
<p>Novo contato pela página de vendas do ARKE.</p>
<table style="border-collapse:collapse">${tabela}</table>
<p style="margin-top:16px"><a href="${escapar(painel)}">Abrir em Visão Master → Contatos do site</a></p>
<p style="color:#64748b;font-size:12px">Responder a este e-mail responde para o contato.</p>
</div>`,
  };
}
