// Exercita contra o SANDBOX do Asaas o código real da Rodada 4 — os fluxo.ts de
// asaas-conta-academia e asaas-assinatura-b2b, não uma cópia:
//   - abrir a subconta da academia, e adotá-la numa segunda tentativa;
//   - consultar a situação cadastral com a chave da subconta;
//   - a carteira da subconta não é carteira da conta-mãe;
//   - cliente e assinatura B2B idempotentes, e a cobrança gerada herdando o
//     externalReference `b2b:` e vencendo hoje.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:conta
//
// Só aceita chave de sandbox. Apaga a assinatura e o cliente que cria; a
// subconta fica (o Asaas não exclui subconta pela API).
import {
  carteirasProprias,
  consultarSituacao,
  criarOuAdotarSubconta,
  montarSubconta,
} from "../supabase/functions/asaas-conta-academia/fluxo.ts";
import {
  criarOuAdotarAssinaturaB2b,
  garantirClienteB2b,
  hojeBrasilia,
} from "../supabase/functions/asaas-assinatura-b2b/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const H = { "Content-Type": "application/json", access_token: CHAVE, "User-Agent": "arke-sandbox-conta" };

async function chamar(metodo, caminho) {
  const r = await fetch(API + caminho, { method: metodo, headers: H });
  let j = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok, status: r.status, corpo: j };
}

function gerarCnpj() {
  const b = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).concat([0, 0, 0, 1]);
  const dv = (a) => {
    const pesos = a.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = a.reduce((x, n, i) => x + n * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  b.push(dv(b));
  b.push(dv(b));
  return b.join("");
}

let falhas = 0;
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}

const sufixo = Math.random().toString(36).slice(2, 8);
const orgId = `sandbox-${sufixo}`;
const org = {
  nome: `Academia Sandbox ${sufixo}`,
  razao_social: `Academia Sandbox ${sufixo} LTDA`,
  cnpj_cpf: gerarCnpj(),
  email_contato: `sandbox+${sufixo}@arkefit.com.br`,
  telefone: "11987654321",
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  numero: "1000",
  complemento: null,
  bairro: "Bela Vista",
  tipo_empresa: "LIMITED",
  faturamento_mensal: 30000,
};

// ── Subconta ──────────────────────────────────────────────────────────
const faltando = montarSubconta({ ...org, cnpj_cpf: "123" });
conferir("montarSubconta recusa CPF/CNPJ inválido", !faltando.ok);

const montado = montarSubconta(org);
conferir("montarSubconta monta o payload", montado.ok);
if (!montado.ok) process.exit(1);

const criada = await criarOuAdotarSubconta(API, CHAVE, montado.payload);
conferir("subconta criada", criada.ok && !criada.adotada, criada.ok ? `wallet ${criada.walletId}` : criada.erro);
if (!criada.ok) process.exit(1);
conferir("criação devolve a chave da subconta", !!criada.apiKey);

const denovo = await criarOuAdotarSubconta(API, CHAVE, montado.payload);
conferir("segunda tentativa adota, não duplica", denovo.ok && denovo.adotada && denovo.walletId === criada.walletId);

if (criada.apiKey) {
  // O Asaas pede alguns segundos antes de a subconta responder.
  await new Promise((r) => setTimeout(r, 15000));
  const situacao = await consultarSituacao(API, criada.apiKey);
  conferir("situação cadastral com a chave da subconta", situacao.ok, situacao.ok ? JSON.stringify(situacao.situacao) : situacao.erro);
}

const proprias = await carteirasProprias(API, CHAVE);
conferir("lista as carteiras da conta-mãe", Array.isArray(proprias) && proprias.length > 0);
conferir("carteira da subconta não é da conta-mãe", Array.isArray(proprias) && !proprias.includes(criada.walletId));

// ── Mensalidade B2B ───────────────────────────────────────────────────
const cliente = await garantirClienteB2b(API, CHAVE, {
  orgId,
  nome: org.razao_social,
  cpfCnpj: org.cnpj_cpf,
  email: org.email_contato,
  telefone: org.telefone,
});
conferir("cliente B2B criado", cliente.ok, cliente.ok ? cliente.id : cliente.erro);
if (!cliente.ok) process.exit(1);
const cliente2 = await garantirClienteB2b(API, CHAVE, {
  orgId,
  nome: org.razao_social,
  cpfCnpj: org.cnpj_cpf,
  email: org.email_contato,
  telefone: org.telefone,
});
conferir("cliente B2B reaproveitado", cliente2.ok && cliente2.id === cliente.id);

const hoje = hojeBrasilia();
const assinatura = await criarOuAdotarAssinaturaB2b(API, CHAVE, {
  orgId,
  customer: cliente.id,
  valor: 790,
  descricao: "ARKE — plano Growth (sandbox)",
  primeiroVencimento: hoje,
});
conferir("assinatura B2B criada", assinatura.ok && !assinatura.adotada, assinatura.ok ? assinatura.id : assinatura.erro);
if (assinatura.ok) {
  const denovoAss = await criarOuAdotarAssinaturaB2b(API, CHAVE, {
    orgId,
    customer: cliente.id,
    valor: 790,
    descricao: "ARKE — plano Growth (sandbox)",
    primeiroVencimento: hoje,
  });
  conferir("segunda tentativa adota a assinatura", denovoAss.ok && denovoAss.adotada && denovoAss.id === assinatura.id);

  await new Promise((r) => setTimeout(r, 3000));
  const cobrancas = await chamar("GET", `/payments?subscription=${assinatura.id}`);
  const primeira = cobrancas.corpo.data?.[0];
  conferir("primeira cobrança gerada", !!primeira, primeira ? `${primeira.id} vence ${primeira.dueDate}` : `HTTP ${cobrancas.status}`);
  conferir("cobrança vence hoje (vigência imediata)", primeira?.dueDate === hoje);
  conferir("cobrança herda o externalReference b2b:", primeira?.externalReference === `b2b:${orgId}`, primeira?.externalReference);
  conferir("cobrança com tipo escolhido na fatura", primeira?.billingType === "UNDEFINED", primeira?.billingType);

  await chamar("DELETE", `/subscriptions/${assinatura.id}`);
}
await chamar("DELETE", `/customers/${cliente.id}`);

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTudo conferido.");
process.exit(falhas ? 1 : 0);
