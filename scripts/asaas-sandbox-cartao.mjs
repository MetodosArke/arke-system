// Exercita contra o SANDBOX do Asaas a sequência real de asaas-cartao-assinatura
// (o próprio fluxo.ts, não uma cópia) e os cenários que decidem se é seguro
// ligar o cartão recorrente.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:cartao
//
// Só aceita chave de sandbox ($aact_hmlg_), para nunca criar cliente ou
// assinatura na conta de produção por engano. Apaga tudo o que cria.
import { ligarCartaoNaAssinatura } from "../supabase/functions/asaas-cartao-assinatura/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const H = { "Content-Type": "application/json", access_token: CHAVE, "User-Agent": "arke-sandbox-cartao" };

// Cartões de teste do sandbox do Asaas.
const APROVADO = "5162306219378829";
const RECUSADO = "5184019740373151";

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(API + caminho, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined });
  let j = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok, status: r.status, corpo: j };
}
function gerarCpf() {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (a, p) => { const s = a.reduce((x, n, i) => x + n * (p - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  b.push(dv(b, 10)); b.push(dv(b, 11));
  return b.join("");
}

const limpar = [];
let falhas = 0;
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}

async function novaAssinatura(rotulo) {
  const cpf = gerarCpf();
  const c = await chamar("POST", "/customers", { name: `Sandbox ARKE ${rotulo}`, cpfCnpj: cpf, externalReference: `sandbox-${rotulo}` });
  if (!c.ok) throw new Error(`customer: ${c.status}`);
  limpar.push(`/customers/${c.corpo.id}`);
  const venc = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  // Mesmo formato de asaas-create-subscription (sem split: no sandbox não há
  // wallet de academia, e split para a própria carteira é recusado).
  const s = await chamar("POST", "/subscriptions", {
    customer: c.corpo.id, billingType: "UNDEFINED", value: 119, cycle: "MONTHLY", nextDueDate: venc,
    description: `ARKE sandbox ${rotulo}`, externalReference: `metodo:sandbox-${rotulo}`,
  });
  if (!s.ok) throw new Error(`assinatura: ${s.status}`);
  limpar.unshift(`/subscriptions/${s.corpo.id}`);
  return { id: s.corpo.id, cpf };
}
const dados = (numero, cpf) => ({
  creditCard: { holderName: "ALUNO SANDBOX", number: numero, expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 3), ccv: "318" },
  creditCardHolderInfo: {
    name: "Aluno Sandbox", email: "sandbox@arkefit.com.br", cpfCnpj: cpf, postalCode: "01310100",
    addressNumber: "100", phone: "11987654321", mobilePhone: "11987654321",
  },
  remoteIp: "177.10.10.10",
});
async function estado(id) {
  const s = await chamar("GET", `/subscriptions/${id}`);
  const p = await chamar("GET", `/payments?subscription=${id}`);
  return { tipo: s.corpo.billingType, final: s.corpo.creditCard?.creditCardNumber ?? null, cobrancas: (p.corpo.data ?? []).map((x) => x.billingType) };
}

try {
  console.log("\n1) Primeiro cartão, aprovado");
  const a = await novaAssinatura("aprovado");
  const ra = await ligarCartaoNaAssinatura(API, CHAVE, a.id, dados(APROVADO, a.cpf));
  const ea = await estado(a.id);
  conferir("função devolve sucesso", ra.ok, JSON.stringify(ra));
  conferir("bandeira vem do Asaas", ra.ok && ra.bandeira === "mastercard");
  conferir("assinatura passou a CREDIT_CARD com o cartão", ea.tipo === "CREDIT_CARD" && ea.final === APROVADO.slice(-4), JSON.stringify(ea));
  conferir("cobrança pendente migrou para cartão", ea.cobrancas.every((t) => t === "CREDIT_CARD"), ea.cobrancas.join(","));

  console.log("\n2) Primeiro cartão, recusado");
  const b = await novaAssinatura("recusado");
  const rb = await ligarCartaoNaAssinatura(API, CHAVE, b.id, dados(RECUSADO, b.cpf));
  const eb = await estado(b.id);
  conferir("função devolve 422", !rb.ok && rb.status === 422, JSON.stringify(rb));
  conferir("tipo voltou para UNDEFINED", eb.tipo === "UNDEFINED", JSON.stringify(eb));
  conferir("cobrança pendente voltou para fatura", eb.cobrancas.every((t) => t === "UNDEFINED"), eb.cobrancas.join(","));

  console.log("\n3) Troca de cartão com a anterior ainda pendente de cobrança");
  const rc = await ligarCartaoNaAssinatura(API, CHAVE, a.id, dados(RECUSADO, a.cpf));
  const ec = await estado(a.id);
  conferir("função devolve 409 ou 422", !rc.ok && [409, 422].includes(rc.status), JSON.stringify(rc));
  conferir("cobrança automática continua ligada", ec.tipo === "CREDIT_CARD", JSON.stringify(ec));
  conferir("cartão anterior mantido", ec.final === APROVADO.slice(-4));
} finally {
  for (const caminho of limpar) await chamar("DELETE", caminho);
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTudo conferido.");
process.exit(falhas ? 1 : 0);
