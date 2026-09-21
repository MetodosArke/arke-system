// Sequência de chamadas ao Asaas que põe o cartão na assinatura.
//
// Fica separada do index.ts, sem Deno nem Supabase, para ser exercitada tal
// como está contra o sandbox do Asaas (scripts/asaas-sandbox-cartao.mjs): foi
// esse teste que mostrou que a ordem anterior não funcionava.
//
// ## Ordem das chamadas (verificada no sandbox em 21/09/2026)
//
// Primeiro o tipo de cobrança (`billingType: CREDIT_CARD`), depois o cartão
// (`PUT /subscriptions/{id}/creditCard`). A ordem inversa, que era a desta
// função até o teste no sandbox, não funciona: o Asaas recusa o cartão com
// "Esta assinatura não é do tipo cartão de crédito" — falharia para todo aluno.
// Mandar tipo e cartão juntos no `PUT /subscriptions/{id}` também não serve:
// responde 200, troca o tipo e ignora o cartão em silêncio.
//
// Por isso a recusa do cartão desfaz a troca de tipo — mas só quando fomos nós
// que trocamos. Numa troca de cartão a assinatura já era CREDIT_CARD e o
// cartão antigo continua lá (o Asaas o mantém quando recusa o novo); reverter
// ali desligaria a cobrança automática de quem já pagava no cartão.

type ErrosAsaas = { errors?: { code?: string; description?: string }[] };
type RespostaAsaas = { ok: boolean; status: number; corpo: ErrosAsaas & Record<string, unknown> };

async function chamarAsaas(url: string, init: RequestInit): Promise<RespostaAsaas> {
  const resp = await fetch(url, init);
  let corpo: ErrosAsaas & Record<string, unknown> = {};
  try {
    corpo = await resp.json();
  } catch {
    // sem corpo JSON
  }
  return { ok: resp.ok, status: resp.status, corpo };
}

/** Só status e códigos — a descrição do Asaas pode ecoar dado do cartão. */
function logarFalha(etapa: string, status: number, corpo: ErrosAsaas) {
  console.error(`Asaas: falha em ${etapa}`, status, corpo?.errors?.map((e) => e.code) ?? []);
}

export type DadosCartao = {
  creditCard: { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string };
  creditCardHolderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    addressComplement?: string;
    phone: string;
    mobilePhone: string;
  };
  remoteIp: string;
};

export type ResultadoCartao =
  | { ok: true; bandeira: string | null }
  | { ok: false; status: number; erro: string };

export async function ligarCartaoNaAssinatura(
  api: string,
  chave: string,
  subscriptionId: string,
  dados: DadosCartao
): Promise<ResultadoCartao> {
  const headers = { "Content-Type": "application/json", access_token: chave };
  const assinaturaUrl = `${api}/subscriptions/${encodeURIComponent(subscriptionId)}`;

  // 0) Como a assinatura está hoje no Asaas. Decide se a troca de tipo é
  // nossa — e, portanto, se cabe a nós desfazê-la numa recusa.
  const atual = await chamarAsaas(assinaturaUrl, { headers });
  if (!atual.ok) {
    logarFalha("leitura da assinatura", atual.status, atual.corpo);
    return { ok: false, status: 502, erro: "O Asaas não respondeu. Tente de novo em alguns minutos." };
  }
  const tipoAnterior = String(atual.corpo.billingType ?? "UNDEFINED");
  const trocamosOTipo = tipoAnterior !== "CREDIT_CARD";

  // 1) Tipo primeiro.
  if (trocamosOTipo) {
    const tipo = await chamarAsaas(assinaturaUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({ billingType: "CREDIT_CARD", updatePendingPayments: true }),
    });
    if (!tipo.ok) {
      // Nada mudou. Visto no sandbox: com cobrança vencendo no próprio dia,
      // o Asaas responde 500 aqui.
      logarFalha("troca do tipo de cobrança", tipo.status, tipo.corpo);
      return {
        ok: false,
        status: 502,
        erro: "Não foi possível ligar a cobrança automática agora. Tente de novo mais tarde; nada foi alterado na sua assinatura.",
      };
    }
  }

  // 2) Depois, o cartão.
  const cartao = await chamarAsaas(`${assinaturaUrl}/creditCard`, {
    method: "PUT",
    headers,
    body: JSON.stringify(dados),
  });
  if (cartao.ok) {
    const bandeira = (cartao.corpo?.creditCard as { creditCardBrand?: string } | undefined)?.creditCardBrand;
    return { ok: true, bandeira: bandeira ? String(bandeira).toLowerCase() : null };
  }
  logarFalha("cartão da assinatura", cartao.status, cartao.corpo);

  if (trocamosOTipo) {
    const reverte = await chamarAsaas(assinaturaUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({ billingType: tipoAnterior, updatePendingPayments: true }),
    });
    if (!reverte.ok) {
      // A assinatura ficou exigindo cartão sem ter nenhum. O id vai no log
      // para quem investigar; o aluno recebe a verdade e não um "nada mudou".
      logarFalha(`reversão do tipo (assinatura ${subscriptionId})`, reverte.status, reverte.corpo);
      return {
        ok: false,
        status: 502,
        erro: "Cartão não aceito, e não conseguimos restaurar o pagamento pela fatura. Fale com a recepção da academia.",
      };
    }
  }

  if (cartao.status >= 500) {
    return { ok: false, status: 502, erro: "O Asaas não respondeu. Tente de novo em alguns minutos." };
  }
  // Visto no sandbox: com uma troca de cartão ainda pendente de cobrança, o
  // Asaas recusa a próxima e mantém o cartão anterior.
  if (cartao.corpo?.errors?.some((e) => /em andamento/i.test(e.description ?? ""))) {
    return {
      ok: false,
      status: 409,
      erro: "Já existe uma troca de cartão aguardando a próxima cobrança. O cartão atual continua valendo; tente de novo depois dela.",
    };
  }
  return {
    ok: false,
    status: 422,
    erro: "Cartão não aceito. Confira os dados ou use outro cartão. Nada foi alterado na sua assinatura.",
  };
}
