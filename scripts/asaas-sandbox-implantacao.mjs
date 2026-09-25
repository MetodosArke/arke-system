// Exercita contra o SANDBOX do Asaas a taxa de implantação — o próprio
// fluxo.ts de asaas-taxa-implantacao, não uma cópia.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:implantacao
//
// Só aceita chave de sandbox ($aact_hmlg_). Apaga no fim o que cria.
// O que prova:
//   * parcelada em 3x com a forma de pagamento escolhida pela academia, as
//     parcelas somam o total, vencem mês a mês e herdam a referência b2b:;
//   * emitir de novo adota a mesma cobrança — não cobra a implantação duas vezes;
//   * à vista vira uma cobrança só;
//   * a validação barra parcela abaixo do mínimo do Asaas e data no passado.
import { garantirClienteB2b } from "../supabase/functions/asaas-assinatura-b2b/fluxo.ts";
import { emitirOuAdotarTaxa, validarTaxa } from "../supabase/functions/asaas-taxa-implantacao/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const H = { access_token: CHAVE, "Content-Type": "application/json" };
let falhas = 0;
const conferir = (nome, cond, detalhe) => { console.log(`${cond ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`); if (!cond) falhas++; };

conferir("parcela abaixo de R$ 5 é barrada", !validarTaxa({ valor: 20, parcelas: 5 }, hoje).ok);
conferir("primeiro vencimento no passado é barrado", !validarTaxa({ valor: 1490, parcelas: 3, primeiro_vencimento: "2020-01-01" }, hoje).ok);
const ok3 = validarTaxa({ valor: "1.490,00", parcelas: 3 }, hoje);
conferir("valor digitado com vírgula é aceito", ok3.ok && ok3.pedido.valor === 1490);

const orgA = crypto.randomUUID(), orgB = crypto.randomUUID();
const criados = { clientes: [], parcelamentos: [], cobrancas: [] };
try {
  const cliA = await garantirClienteB2b(API, CHAVE, { orgId: orgA, nome: "Academia Sandbox Implantação A", cpfCnpj: "11222333000181", email: "implantacao-a@arkefit.com.br", telefone: "11987654321" });
  conferir("cliente da academia no Asaas", cliA.ok, cliA.ok ? cliA.id : cliA.erro);
  if (cliA.ok) criados.clientes.push(cliA.id);

  const r1 = await emitirOuAdotarTaxa(API, CHAVE, { orgId: orgA, cliente: cliA.id, pedido: ok3.pedido });
  const soma = r1.ok ? Math.round(r1.parcelas.reduce((s, p) => s + p.value, 0) * 100) / 100 : 0;
  conferir("parcelada em 3x, as parcelas somam o total", r1.ok && r1.parcelas.length === 3 && soma === 1490, r1.ok ? r1.parcelas.map((p) => `${p.value}@${p.dueDate}`).join(" ") : r1.erro);
  if (r1.ok && r1.installmentId) criados.parcelamentos.push(r1.installmentId);
  conferir("vencimentos mês a mês a partir do primeiro", r1.ok && r1.parcelas[0].dueDate === hoje && r1.parcelas[1].dueDate > r1.parcelas[0].dueDate);
  const lista = r1.ok ? await (await fetch(`${API}/payments?installment=${r1.installmentId}`, { headers: H })).json() : { data: [] };
  conferir("cada parcela herda a referência b2b:", (lista.data ?? []).every((p) => p.externalReference === `b2b:${orgA}`) && lista.data?.length === 3);
  conferir("a academia escolhe a forma de pagamento em cada parcela", (lista.data ?? []).every((p) => p.billingType === "UNDEFINED"));

  const r2 = await emitirOuAdotarTaxa(API, CHAVE, { orgId: orgA, cliente: cliA.id, pedido: ok3.pedido });
  conferir("emitir de novo adota a mesma cobrança", r2.ok && r2.adotada && r2.installmentId === r1.installmentId);

  const cliB = await garantirClienteB2b(API, CHAVE, { orgId: orgB, nome: "Academia Sandbox Implantação B", cpfCnpj: "11444777000161", email: "implantacao-b@arkefit.com.br", telefone: "11987654321" });
  if (cliB.ok) criados.clientes.push(cliB.id);
  const vista = validarTaxa({ valor: 990, parcelas: 1 }, hoje);
  const r3 = await emitirOuAdotarTaxa(API, CHAVE, { orgId: orgB, cliente: cliB.id, pedido: vista.pedido });
  conferir("à vista vira uma cobrança só", r3.ok && r3.parcelas.length === 1 && r3.parcelas[0].value === 990 && !r3.installmentId);
  if (r3.ok) criados.cobrancas.push(r3.parcelas[0].id);
} finally {
  for (const id of criados.parcelamentos) {
    const l = await (await fetch(`${API}/payments?installment=${id}`, { headers: H })).json();
    for (const p of l.data ?? []) await fetch(`${API}/payments/${p.id}`, { method: "DELETE", headers: H });
  }
  for (const id of criados.cobrancas) await fetch(`${API}/payments/${id}`, { method: "DELETE", headers: H });
  for (const id of criados.clientes) await fetch(`${API}/customers/${id}`, { method: "DELETE", headers: H });
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.");
process.exit(falhas ? 1 : 0);
