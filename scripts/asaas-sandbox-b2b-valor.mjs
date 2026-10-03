// Exercita contra o SANDBOX do Asaas a mudança de valor da mensalidade B2B,
// com o fluxo.ts real de asaas-assinatura-b2b, não uma cópia:
//   - a assinatura nasce, e a consulta devolve valor, situação e vencimento;
//   - sem cobrança vencida, o valor novo vale também para a cobrança do mês;
//   - com cobrança vencida em aberto, ela fica no valor antigo e o novo vale
//     a partir da próxima;
//   - valor zero é recusado antes de qualquer chamada.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:b2b-valor
//
// Só aceita chave de sandbox. Apaga a assinatura e o cliente que cria.
import {
  alterarValorAssinaturaB2b,
  consultarAssinaturaB2b,
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
const H = { "Content-Type": "application/json", access_token: CHAVE, "User-Agent": "arke-sandbox-b2b-valor" };
async function chamar(metodo, caminho) {
  const r = await fetch(API + caminho, { method: metodo, headers: H });
  let j = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok, status: r.status, corpo: j };
}
function gerarCnpj() {
  const n = Array.from({ length: 12 }, (_, i) => (i < 8 ? Math.floor(Math.random() * 10) : i === 11 ? 1 : 0));
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const soma = pesos.reduce((a, p, i) => a + p * n[i], 0);
    const r = soma % 11;
    n.push(r < 2 ? 0 : 11 - r);
  }
  return n.join("");
}
const amanha = (iso) => {
  const d = new Date(`${iso}T12:00:00-03:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

let falhas = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "ok    " : "FALHOU"} ${n}${d ? `  (${d})` : ""}`); if (!c) falhas++; };
const orgId = crypto.randomUUID();
let customer = null;
let assinatura = null;

try {
  const c = await garantirClienteB2b(API, CHAVE, {
    orgId,
    nome: "Academia Teste Valor B2B",
    cpfCnpj: gerarCnpj(),
    email: `teste-valor-b2b-${Date.now()}@exemplo.com.br`,
    telefone: "11999990000",
  });
  ok("cliente B2B", c.ok, c.ok ? "" : c.erro);
  customer = c.ok ? c.id : null;
  const hoje = hojeBrasilia();
  const a = await criarOuAdotarAssinaturaB2b(API, CHAVE, { orgId, customer, valor: 390, descricao: "ARKE — teste de valor", primeiroVencimento: hoje });
  ok("assinatura de R$ 390 vencendo hoje", a.ok && a.valor === 390, a.ok ? a.id : a.erro);
  assinatura = a.ok ? a.id : null;
  await new Promise((r) => setTimeout(r, 2500));

  const s1 = await consultarAssinaturaB2b(API, CHAVE, assinatura);
  ok("consulta: valor, situação e vencimento", s1.ok && s1.valor === 390 && s1.status === "ACTIVE" && s1.proximoVencimento !== null, JSON.stringify(s1));

  const r1 = await alterarValorAssinaturaB2b(API, CHAVE, assinatura, { valor: 412.5, hoje });
  ok("sem cobrança vencida: atualiza a do mês junto", r1.ok && r1.pendentesAtualizadas && r1.vencidasNoValorAntigo.length === 0, JSON.stringify(r1));
  const p1 = await chamar("GET", `/payments?subscription=${assinatura}`);
  ok("a cobrança do mês passou a R$ 412,50", (p1.corpo.data ?? []).length > 0 && p1.corpo.data.every((p) => Number(p.value) === 412.5), JSON.stringify((p1.corpo.data ?? []).map((p) => p.value)));
  const s2 = await consultarAssinaturaB2b(API, CHAVE, assinatura);
  ok("a assinatura passou a R$ 412,50", s2.ok && s2.valor === 412.5, JSON.stringify(s2));

  // Com "hoje" um dia à frente, a cobrança que vence hoje conta como vencida.
  const r2 = await alterarValorAssinaturaB2b(API, CHAVE, assinatura, { valor: 430, hoje: amanha(hoje) });
  ok("com cobrança vencida: ela fica no valor antigo", r2.ok && !r2.pendentesAtualizadas && r2.vencidasNoValorAntigo.length === 1, JSON.stringify(r2));
  const p2 = await chamar("GET", `/payments?subscription=${assinatura}`);
  ok("a vencida continua em R$ 412,50", (p2.corpo.data ?? []).every((p) => Number(p.value) === 412.5), JSON.stringify((p2.corpo.data ?? []).map((p) => p.value)));
  const s3 = await consultarAssinaturaB2b(API, CHAVE, assinatura);
  ok("e a assinatura vale R$ 430 daqui em diante", s3.ok && s3.valor === 430, JSON.stringify(s3));

  const r3 = await alterarValorAssinaturaB2b(API, CHAVE, assinatura, { valor: 0, hoje });
  ok("valor zero recusado", !r3.ok, r3.ok ? "passou" : r3.erro);
  const inexistente = await consultarAssinaturaB2b(API, CHAVE, "sub_naoexiste123");
  ok("assinatura que não existe: erro, não valor zero", !inexistente.ok, JSON.stringify(inexistente));
} catch (e) {
  ok("execução", false, e.message);
} finally {
  if (assinatura) await chamar("DELETE", `/subscriptions/${assinatura}`);
  if (customer) await chamar("DELETE", `/customers/${customer}`);
  console.log(falhas ? `${falhas} falha(s)` : "tudo certo");
  process.exit(falhas ? 1 : 0);
}
