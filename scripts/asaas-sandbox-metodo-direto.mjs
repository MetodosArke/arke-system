// Responde, contra o SANDBOX do Asaas, a pergunta "a assinatura do Método
// direto (aluno sem academia, 11/11/2026) nasce sem split, com o valor inteiro
// na conta da ArkeFit?". Exercita o código real de
// `asaas-create-subscription/fluxo.ts`. Não precisa de subconta.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:metodo-direto
//
// Só aceita chave de sandbox. Apaga a assinatura e o cliente que cria.
import { criarOuAdotarAssinatura, hojeEmBrasilia, obterOuCriarCustomer } from "../supabase/functions/asaas-create-subscription/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const H = { "Content-Type": "application/json", access_token: CHAVE, "User-Agent": "arke-sandbox-metodo-direto" };
let falhou = 0;
const conferir = (descricao, condicao, detalhe = "") => {
  if (!condicao) falhou++;
  console.log(`  ${condicao ? "ok   " : "FALHA"} ${descricao}${detalhe ? "  — " + detalhe : ""}`);
};
const chamar = async (metodo, caminho) => {
  const r = await fetch(API + caminho, { method: metodo, headers: H });
  let corpo = {};
  try { corpo = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok, corpo };
};

// CPF sintético válido pelo dígito verificador.
function cpfSintetico(semente) {
  const base = String(semente).padStart(9, "0").slice(-9).split("").map(Number);
  const dv = (nums, peso) => {
    const r = (nums.reduce((s, n, i) => s + n * (peso - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base, 10);
  return [...base, d1, dv([...base, d1], 11)].join("");
}

const carimbo = Date.now();
const customer = await obterOuCriarCustomer(API, H, { alunoId: `aluno-direto-${carimbo}`, nome: "Aluno Método Direto", cpf: cpfSintetico(carimbo % 1e9), telefone: null });
conferir("o cliente é criado", !("erro" in customer), "erro" in customer ? customer.erro : "");
if ("erro" in customer) process.exit(1);

const direta = await criarOuAdotarAssinatura(API, H, {
  customerId: customer.id,
  referencia: `metodo:teste-direto-${carimbo}`,
  valorCobrado: 180,
  primeiroVencimento: hojeEmBrasilia(),
  descricao: "ARKE — Método online — nível integrado",
  walletIdAcademia: null,
  valorLiquidoAcademia: 0,
});
conferir("a assinatura do Método direto é criada", !("erro" in direta), "erro" in direta ? direta.erro : "");
if (!("erro" in direta)) {
  const lida = await chamar("GET", `/subscriptions/${direta.assinatura.id}`);
  conferir("nasce sem split", !(lida.corpo?.split?.length), `split: ${JSON.stringify(lida.corpo?.split ?? null)}`);
  conferir("com o valor inteiro", Number(lida.corpo?.value) === 180, `valor: ${lida.corpo?.value}`);
  const de_novo = await criarOuAdotarAssinatura(API, H, {
    customerId: customer.id, referencia: `metodo:teste-direto-${carimbo}`, valorCobrado: 180,
    primeiroVencimento: hojeEmBrasilia(), descricao: "x", walletIdAcademia: null, valorLiquidoAcademia: 0,
  });
  conferir("a segunda chamada adota a mesma, sem duplicar", !("erro" in de_novo) && de_novo.adotada && de_novo.assinatura.id === direta.assinatura.id);
  await chamar("DELETE", `/subscriptions/${direta.assinatura.id}`);
}
await chamar("DELETE", `/customers/${customer.id}`);
console.log(`\n${falhou === 0 ? "Tudo certo" : falhou + " falha(s)"}; assinatura e cliente removidos do sandbox.`);
process.exitCode = falhou === 0 ? 0 : 1;
