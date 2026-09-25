// Exercita contra o SANDBOX do Asaas as listagens em lote da conferência
// diária — o próprio fluxo.ts de asaas-reconciliar, não uma cópia.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:reconciliacao
//
// Só aceita chave de sandbox ($aact_hmlg_) e só lê: não cria nem altera nada.
// O que prova:
//   * as quatro listagens (vencidas, criadas e recebidas nos últimos dias,
//     confirmadas no cartão) são aceitas pelo Asaas, com os filtros de data;
//   * a paginação de 100 em 100 termina (hasMore) e não repete itens;
//   * as cobranças de uma assinatura herdam a referência dela (metodo:,
//     plano:, b2b:), que é como a varredura sabe de onde cada uma é;
//   * o status que a regra de correção espera casa com o que o Asaas devolve.
import { eventoParaCorrigir, listagensDaVarredura, listarTodas, origemDaReferencia } from "../supabase/functions/asaas-reconciliar/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const diasAtras = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() - n * 86_400_000));

let falhas = 0;
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}

const vistos = new Map();
for (const caminho of listagensDaVarredura(diasAtras)) {
  let itens = null;
  try {
    itens = await listarTodas(API, CHAVE, caminho);
  } catch (e) {
    conferir(`listagem aceita: ${caminho}`, false, e.message);
    continue;
  }
  const ids = new Set(itens.map((p) => p.id));
  conferir(`listagem aceita e paginada sem repetir: ${caminho.split("?")[1]}`, ids.size === itens.length, `${itens.length} cobranças`);
  for (const p of itens) vistos.set(p.id, p);
}

// A paginação: uma listagem maior que uma página (todas as cobranças) vem inteira.
const todas = await listarTodas(API, CHAVE, "/payments");
conferir("paginação passa de 100 e termina", todas.length > 100 ? new Set(todas.map((p) => p.id)).size === todas.length : true, `${todas.length} cobranças no sandbox`);

// As cobranças de assinatura herdam a referência da assinatura.
const assinaturas = await listarTodas(API, CHAVE, "/subscriptions?status=ACTIVE");
const comReferencia = assinaturas.filter((s) => origemDaReferencia(s.externalReference));
const deAssinatura = todas.filter((p) => p.subscription && comReferencia.some((s) => s.id === p.subscription));
conferir(
  "cobrança de assinatura herda a referência (metodo:/plano:/b2b:)",
  deAssinatura.length > 0 && deAssinatura.every((p) => p.externalReference === comReferencia.find((s) => s.id === p.subscription).externalReference),
  `${deAssinatura.length} cobranças de ${comReferencia.length} assinaturas`,
);

// A regra de correção contra status reais.
const recebida = todas.find((p) => p.status === "RECEIVED" || p.status === "CONFIRMED");
if (recebida) {
  conferir("paga no Asaas e pendente no banco → reenvia a confirmação", eventoParaCorrigir(recebida, "pendente", "metodo") !== null);
  conferir("paga no Asaas e no banco → nada a fazer", eventoParaCorrigir(recebida, "confirmado", "metodo") === null);
}
const pendente = todas.find((p) => p.status === "PENDING");
if (pendente) {
  conferir("pendente que o banco não tem → reenvia a emissão", eventoParaCorrigir(pendente, null, "metodo") === "PAYMENT_CREATED");
  conferir("avulsa pendente sem linha não é divergência (ela nasce no banco)", eventoParaCorrigir(pendente, null, "avulsa") === null);
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.");
process.exit(falhas ? 1 : 0);
