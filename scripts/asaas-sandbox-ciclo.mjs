// Exercita contra o SANDBOX do Asaas o ciclo de vida da assinatura — o próprio
// fluxo.ts de asaas-assinatura-ciclo, não uma cópia.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:ciclo
//
// Só aceita chave de sandbox ($aact_hmlg_), para nunca cancelar ou alterar
// assinatura de produção por engano. Apaga tudo o que cria.
//
// O que estes cenários provam, e por que cada um existe:
//   * cancelar remove as cobranças pendentes junto (é o que faz o aluno parar
//     de dever) e é idempotente;
//   * pausar mantém a cobrança já vencida e remove a que ainda não venceu —
//     a regra que separa "dívida de período usado" de "cobrança por nada";
//   * alterar valor leva o split junto, senão a divisão combinada muda sozinha;
//   * cobrança já vencida não tem o valor alterado retroativamente.
import {
  alterarValorAssinatura,
  cancelarAssinatura,
  cobrancasDaAssinatura,
  pausarAssinatura,
  retomarAssinatura,
} from "../supabase/functions/asaas-assinatura-ciclo/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const H = { "Content-Type": "application/json", access_token: CHAVE, "User-Agent": "arke-sandbox-ciclo" };

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
const limpar = [];
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}

/** Uma carteira que não é a da conta-mãe: o Asaas recusa split para si mesma. */
async function carteiraDeSplit() {
  const sufixo = Math.random().toString(36).slice(2, 8);
  const cnpj = (() => {
    const base = Array.from({ length: 12 }, (_, i) => (i >= 8 ? [0, 0, 0, 1][i - 8] : Math.floor(Math.random() * 10)));
    const dv = (n, p) => { const r = n.reduce((s, d, i) => s + d * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
    base.push(dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
    base.push(dv(base, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
    return base.join("");
  })();
  const r = await chamar("POST", "/accounts", {
    name: `Academia Ciclo ${sufixo}`, email: `ciclo+${sufixo}@arkefit.com.br`,
    cpfCnpj: cnpj, companyType: "LIMITED", mobilePhone: "11987654321",
    address: "Avenida Paulista", addressNumber: "1000", province: "Bela Vista", postalCode: "01310100",
    incomeValue: 30000,
  });
  if (!r.ok) throw new Error(`subconta: ${JSON.stringify(r.corpo).slice(0, 200)}`);
  return r.corpo.walletId;
}

async function novaAssinatura(rotulo, wallet, { valor = 119, repasseAcademia = 69.95, vencimento = hoje } = {}) {
  const c = await chamar("POST", "/customers", {
    name: `Sandbox Ciclo ${rotulo}`, cpfCnpj: gerarCpf(), externalReference: `sandbox-ciclo-${rotulo}`,
  });
  if (!c.ok) throw new Error(`cliente: ${JSON.stringify(c.corpo).slice(0, 200)}`);
  limpar.push(["/customers/" + c.corpo.id]);
  const s = await chamar("POST", "/subscriptions", {
    customer: c.corpo.id, billingType: "UNDEFINED", value: valor, cycle: "MONTHLY",
    nextDueDate: vencimento, description: `Ciclo ${rotulo}`, externalReference: `ciclo:${rotulo}`,
    split: [{ walletId: wallet, fixedValue: repasseAcademia }],
  });
  if (!s.ok) throw new Error(`assinatura: ${JSON.stringify(s.corpo).slice(0, 200)}`);
  return s.corpo.id;
}

console.log("Carteira de split (subconta do sandbox)...");
const wallet = await carteiraDeSplit();
conferir("subconta criada para receber o split", !!wallet);

// ── 1. Alterar valor: o split acompanha ────────────────────────────────────
{
  const sub = await novaAssinatura("valor", wallet, { vencimento: emDias(30) });
  const r = await alterarValorAssinatura(API, CHAVE, sub, {
    valorCobrado: 159, valorRepasseArke: 49.05, walletAcademia: wallet, hoje,
  });
  conferir("alterar valor responde ok", r.ok, r.ok ? "" : r.erro);
  conferir("parte da academia recalculada", r.ok && r.valorAcademia === 109.95, r.ok ? `R$${r.valorAcademia}` : "");
  conferir("pendentes atualizadas (nenhuma vencida)", r.ok && r.pendentesAtualizadas === true);

  const det = await chamar("GET", `/subscriptions/${sub}`);
  conferir("valor da assinatura no gateway", det.corpo.value === 159, `R$${det.corpo.value}`);
  conferir("split da assinatura acompanhou", det.corpo.split?.[0]?.fixedValue === 109.95, `R$${det.corpo.split?.[0]?.fixedValue}`);

  const cobr = await cobrancasDaAssinatura(API, CHAVE, sub);
  conferir("cobranca pendente seguiu o valor novo", cobr?.[0]?.value === 159, `R$${cobr?.[0]?.value}`);
  await chamar("DELETE", `/subscriptions/${sub}`);
}

// ── 2. Valor menor que o repasse é recusado antes de tocar no gateway ──────
{
  const sub = await novaAssinatura("barato", wallet, { vencimento: emDias(30) });
  const r = await alterarValorAssinatura(API, CHAVE, sub, {
    valorCobrado: 30, valorRepasseArke: 49.05, walletAcademia: wallet, hoje,
  });
  conferir("valor abaixo do repasse e recusado", !r.ok && r.status === 400, r.ok ? "passou" : r.erro.slice(0, 60));
  const det = await chamar("GET", `/subscriptions/${sub}`);
  conferir("e o gateway nao foi alterado", det.corpo.value === 119, `R$${det.corpo.value}`);
  await chamar("DELETE", `/subscriptions/${sub}`);
}

// ── 3. Pausar: remove a futura, mantem a vencida ───────────────────────────
{
  // Vencimento de hoje => a primeira cobranca ja nasce "do periodo usado".
  const sub = await novaAssinatura("pausa", wallet, { vencimento: hoje });
  const antes = await cobrancasDaAssinatura(API, CHAVE, sub);
  conferir("assinatura nasce com cobranca", (antes?.length ?? 0) >= 1, `${antes?.length} cobranca(s)`);

  const r = await pausarAssinatura(API, CHAVE, sub, emDias(1));
  conferir("pausar responde ok", r.ok, r.ok ? "" : r.erro);
  conferir("cobranca de hoje foi mantida (dívida de periodo usado)",
    r.ok && r.cobrancasVencidasMantidas.length === 1, r.ok ? `${r.cobrancasVencidasMantidas.length} mantida(s)` : "");

  const det = await chamar("GET", `/subscriptions/${sub}`);
  conferir("assinatura ficou INACTIVE", det.corpo.status === "INACTIVE", det.corpo.status);

  const r2 = await retomarAssinatura(API, CHAVE, sub);
  conferir("retomar responde ok", r2.ok, r2.ok ? "" : r2.erro);
  const det2 = await chamar("GET", `/subscriptions/${sub}`);
  conferir("assinatura voltou a ACTIVE", det2.corpo.status === "ACTIVE", det2.corpo.status);
  await chamar("DELETE", `/subscriptions/${sub}`);
}

// ── 4. Pausar remove a cobranca que ainda nao venceu ───────────────────────
{
  const sub = await novaAssinatura("pausa-futura", wallet, { vencimento: emDias(20) });
  const r = await pausarAssinatura(API, CHAVE, sub, hoje);
  conferir("pausar removeu a cobranca futura", r.ok && r.cobrancasRemovidas.length === 1,
    r.ok ? `${r.cobrancasRemovidas.length} removida(s)` : r.erro);
  const cobr = await cobrancasDaAssinatura(API, CHAVE, sub);
  const vivas = (cobr ?? []).filter((c) => c.status === "PENDING" || c.status === "OVERDUE");
  conferir("nenhuma cobranca pendente sobrou", vivas.length === 0, `${vivas.length} viva(s)`);
  await chamar("DELETE", `/subscriptions/${sub}`);
}

// ── 5. Cancelar: apaga as pendentes e e idempotente ────────────────────────
{
  const sub = await novaAssinatura("cancelar", wallet, { vencimento: emDias(10) });
  const r = await cancelarAssinatura(API, CHAVE, sub);
  conferir("cancelar responde ok", r.ok, r.ok ? "" : r.erro);
  conferir("nao estava cancelada antes", r.ok && r.jaEstavaCancelada === false);

  const det = await chamar("GET", `/subscriptions/${sub}`);
  conferir("assinatura marcada como deleted", det.corpo.deleted === true, String(det.corpo.deleted));
  const cobr = await cobrancasDaAssinatura(API, CHAVE, sub);
  const vivas = (cobr ?? []).filter((c) => c.status === "PENDING" || c.status === "OVERDUE");
  conferir("cobrancas pendentes sumiram", vivas.length === 0, `${vivas.length} viva(s)`);

  const r2 = await cancelarAssinatura(API, CHAVE, sub);
  conferir("cancelar de novo e idempotente", r2.ok && r2.jaEstavaCancelada === true, r2.ok ? "" : r2.erro);
}

// ── 6. Assinatura inexistente nao vira erro de servidor ────────────────────
{
  const r = await cancelarAssinatura(API, CHAVE, "sub_nao_existe_000000");
  conferir("cancelar assinatura inexistente e tratado", r.ok && r.jaEstavaCancelada === true, r.ok ? "" : r.erro);
}

for (const [caminho] of limpar) await chamar("DELETE", caminho);

console.log(falhas ? `\n${falhas} verificacao(oes) falharam.` : "\nTodas as verificacoes passaram.");
process.exit(falhas ? 1 : 0);
