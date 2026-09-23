/**
 * Envio pelo WhatsApp Cloud API (Meta).
 *
 * **Mensagem iniciada pelo negócio exige template aprovado.** Texto livre só
 * funciona dentro da janela de 24h depois de o usuário escrever, e o briefing
 * é justamente o contrário: chega na segunda sem ninguém ter puxado conversa.
 * Por isso o que sai daqui é `template` com parâmetros posicionais, e não um
 * `text` — mandar texto livre daria erro 131047 em produção depois de passar
 * em todo teste feito dentro da janela.
 *
 * Os parâmetros vão na ordem em que aparecem no template aprovado. É frágil
 * por natureza (a Meta não nomeia posições), então quem mexer no template tem
 * de mexer aqui junto — está documentado no compositor.
 *
 * **Dois interruptores, o mesmo desenho do cartão recorrente:** sem
 * `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_ID` a função não tenta enviar e diz que
 * está desligada, em vez de falhar como se fosse defeito.
 */

export type EnvioWhatsapp =
  | { ok: true; id: string }
  | { ok: false; erro: string; desligado?: boolean };

/** Só dígitos, com 55 na frente. A Meta recusa número com máscara. */
export function normalizarTelefone(bruto: string | null | undefined): string | null {
  const digitos = (bruto ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.startsWith("55") ? digitos : `55${digitos}`;
}

export async function enviarTemplateWhatsapp(
  env: (nome: string) => string | undefined,
  dados: { para: string; template: string; idioma?: string; parametros: string[] },
): Promise<EnvioWhatsapp> {
  const token = env("WHATSAPP_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_ID");
  if (!token || !phoneId) {
    return { ok: false, erro: "Envio por WhatsApp desligado (sem WHATSAPP_TOKEN/WHATSAPP_PHONE_ID).", desligado: true };
  }

  const para = normalizarTelefone(dados.para);
  if (!para) return { ok: false, erro: "Telefone do gestor ausente ou inválido." };

  const resposta = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "template",
      template: {
        name: dados.template,
        language: { code: dados.idioma ?? "pt_BR" },
        components: [
          { type: "body", parameters: dados.parametros.map((text) => ({ type: "text", text })) },
        ],
      },
    }),
  });

  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    // A descrição da Meta pode ecoar o número do destinatário; fica no retorno
    // para o registro do banco, nunca em log.
    const msg = corpo?.error?.message ?? `HTTP ${resposta.status}`;
    return { ok: false, erro: String(msg).slice(0, 300) };
  }
  return { ok: true, id: corpo?.messages?.[0]?.id ?? "sem-id" };
}
