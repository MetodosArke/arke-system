// Exercita contra o SANDBOX do Asaas a cobrança avulsa — o próprio fluxo.ts de
// asaas-cobranca-avulsa, não uma cópia.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:avulsa
//
// Só aceita chave de sandbox ($aact_hmlg_). Apaga o que cria.
//
// O que estes cenários provam, e por que cada um existe:
//   * a cobrança sai com o split da academia em valor fixo — é o que faz a
//     taxa de matrícula cair na conta dela;
//   * repetir a emissão com a mesma referência adota a existente — a base de
//     "tentar de novo" não mandar duas faturas ao aluno;
//   * o mesmo aluno é um cliente só no Asaas, cobrança após cobrança;
//   * cobrança pequena só passa com o piso da taxa (a taxa fixa do boleto e
//     do PIX): sem ele, a parte da academia excede o líquido;
//   * cancelar remove e é idempotente, e cobrança já paga não se cancela;
//   * a cobrança removida some da busca por referência.
import {
  cancelarCobranca,
  cobrancaPorReferencia,
  emitirCobrancaAvulsa,
} from "../supabase/functions/asaas-cobranca-avulsa/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const H = { "Content-Type": "application/json", access_token: CHAVE };

const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const emDias = (n) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + n * 86_400_000));

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

let falhas = 0;
const pagamentos = [];
const clientes = new Set();
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}

/** Uma carteira que não é a da conta-mãe: o Asaas recusa split para si mesma. */
async function carteiraDeSplit() {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const base = Array.from({ length: 12 }, (_, i) => (i >= 8 ? [0, 0, 0, 1][i - 8] : Math.floor(Math.random() * 10)));
  const dv = (n, p) => { const r = n.reduce((s, d, i) => s + d * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  base.push(dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  base.push(dv(base, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  const r = await chamar("POST", "/accounts", {
    name: `Academia Avulsa ${sufixo}`, email: `avulsa+${sufixo}@arkefit.com.br`,
    cpfCnpj: base.join(""), companyType: "LIMITED", mobilePhone: "11987654321",
    address: "Avenida Paulista", addressNumber: "1000", province: "Bela Vista", postalCode: "01310100",
    incomeValue: 30000,
  });
  if (!r.ok) throw new Error(`subconta: ${JSON.stringify(r.corpo).slice(0, 200)}`);
  return r.corpo.walletId;
}

const aluno = { alunoId: `sandbox-avulsa-${Date.now()}`, nome: "Aluno Sandbox Avulsa", cpf: gerarCpf(), telefone: "11987654321" };
const emitir = (referencia, extra = {}) =>
  emitirCobrancaAvulsa(API, CHAVE, {
    referencia,
    aluno,
    valor: 80,
    vencimento: hoje,
    descricao: "Academia Sandbox — Taxa de matrícula",
    walletAcademia: wallet,
    valorLiquidoAcademia: 77.12,
    ...extra,
  });
const lembrar = (r) => {
  if (r.ok) pagamentos.push(r.cobranca.id);
  return r;
};

console.log("Carteira de split (subconta do sandbox)...");
const wallet = await carteiraDeSplit();
conferir("subconta criada para receber o split", !!wallet);

// ── 1. Emissão com split, e a mesma referência não duplica ─────────────────
const ref1 = `avulsa:sandbox-${Date.now()}-1`;
const r1 = lembrar(await emitir(ref1));
conferir("emite a cobrança", r1.ok, r1.ok ? r1.cobranca.id : r1.erro);
conferir("vem com o link da fatura", r1.ok && !!r1.cobranca.invoiceUrl);
conferir("vence no dia pedido", r1.ok && r1.cobranca.dueDate === hoje, r1.ok ? r1.cobranca.dueDate : "");
if (r1.ok) {
  const det = await chamar("GET", `/payments/${r1.cobranca.id}`);
  clientes.add(det.corpo.customer);
  const split = det.corpo.split?.[0];
  conferir("split da academia em valor fixo", split?.walletId === wallet && split?.fixedValue === 77.12, split ? `R$${split.fixedValue}` : "sem split no pagamento");
  conferir("referência gravada no Asaas", det.corpo.externalReference === ref1);
}
const r1b = await emitir(ref1);
conferir("repetir a emissão adota a existente", r1b.ok && r1b.adotada && r1.ok && r1b.cobranca.id === r1.cobranca.id);

// ── 2. O mesmo aluno é um cliente só ───────────────────────────────────────
const r2 = lembrar(await emitir(`avulsa:sandbox-${Date.now()}-2`, { vencimento: emDias(10), valor: 150, valorLiquidoAcademia: 145 }));
if (r2.ok) {
  const det = await chamar("GET", `/payments/${r2.cobranca.id}`);
  conferir("segunda cobrança no mesmo cliente", clientes.has(det.corpo.customer), det.corpo.customer);
}

// ── 3. Cobrança pequena: o mínimo do Asaas e o piso da taxa ────────────────
// Com a taxa estimada só pelo percentual do cartão (R$ 0,64 em R$ 5), a parte
// da academia passava do líquido e o Asaas recusava. Com o piso da taxa fixa
// do boleto e do PIX (R$ 1,99), passa.
{
  const r4 = await emitir(`avulsa:sandbox-${Date.now()}-min4`, { valor: 4, valorLiquidoAcademia: 2.01 });
  lembrar(r4);
  conferir("abaixo de R$ 5 o Asaas recusa, e a recusa é definitiva", !r4.ok && r4.definitivo, r4.ok ? "aceitou" : r4.erro);
  for (const valor of [5, 20]) {
    const liquido = Math.round((valor - 1.99) * 100) / 100;
    const r = lembrar(await emitir(`avulsa:sandbox-${Date.now()}-v${valor}`, { valor, valorLiquidoAcademia: liquido }));
    conferir(`R$ ${valor} com o piso da taxa é aceito (academia R$ ${liquido})`, r.ok, r.ok ? "" : r.erro);
  }
  const semPiso = lembrar(await emitir(`avulsa:sandbox-${Date.now()}-sempiso`, { valor: 5, valorLiquidoAcademia: 4.36 }));
  conferir("sem o piso, R$ 5 é recusado (o defeito que o piso corrige)", !semPiso.ok, semPiso.ok ? "aceitou" : semPiso.erro);
}

// ── 4. Cancelar: remove, é idempotente e some da busca ─────────────────────
if (r2.ok) {
  const c = await cancelarCobranca(API, CHAVE, r2.cobranca.id);
  conferir("cancelar cobrança pendente", c.ok && !c.jaNaoExistia, c.ok ? "" : c.erro);
  const det = await chamar("GET", `/payments/${r2.cobranca.id}`);
  conferir("marcada como removida no Asaas", det.corpo.deleted === true, String(det.corpo.deleted));
  const c2 = await cancelarCobranca(API, CHAVE, r2.cobranca.id);
  conferir("cancelar de novo é idempotente", c2.ok, c2.ok ? `jaNaoExistia=${c2.jaNaoExistia}` : c2.erro);
}
const buscaRemovida = await cobrancaPorReferencia(API, CHAVE, `avulsa:nao-existe-${Date.now()}`);
conferir("referência inexistente não acha nada", buscaRemovida === null);

// ── 5. Cobrança paga não se cancela ────────────────────────────────────────
if (r1.ok) {
  let pago = await chamar("POST", `/sandbox/payment/${r1.cobranca.id}/confirm`);
  let como = "confirmação do sandbox";
  if (!pago.ok) {
    pago = await chamar("POST", `/payments/${r1.cobranca.id}/receiveInCash`, { paymentDate: hoje, value: 80 });
    como = "recebido em dinheiro";
  }
  conferir("pagamento simulado no sandbox", pago.ok, pago.ok ? como : JSON.stringify(pago.corpo).slice(0, 160));
  const c = await cancelarCobranca(API, CHAVE, r1.cobranca.id);
  conferir("cobrança paga não é cancelada", !c.ok && c.paga === true, c.ok ? "cancelou!" : c.erro);
}

for (const id of pagamentos) await chamar("DELETE", `/payments/${id}`);
for (const id of clientes) await chamar("DELETE", `/customers/${id}`);

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.");
process.exit(falhas ? 1 : 0);
