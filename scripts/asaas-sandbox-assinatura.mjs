// Responde, contra o SANDBOX do Asaas, a pergunta "com o aluno cadastrado e
// CPF em ordem, o código gera a cobrança?".
//
// Exercita o código real de `asaas-create-subscription/fluxo.ts` — não uma
// cópia — no caminho completo: academia com conta de recebimentos, aluno com
// CPF, assinatura com split, e a cobrança que nasce dela.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:assinatura
//
// Só aceita chave de sandbox. Apaga a assinatura e o cliente que cria; a
// subconta que faz o papel da academia fica (o Asaas não exclui subconta pela
// API).
import {
  criarOuAdotarAssinatura,
  hojeEmBrasilia,
  obterOuCriarCustomer,
  repasseDoSplit,
} from "../supabase/functions/asaas-create-subscription/fluxo.ts";
import {
  criarOuAdotarSubconta,
  montarSubconta,
} from "../supabase/functions/asaas-conta-academia/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const H = { "Content-Type": "application/json", access_token: CHAVE, "User-Agent": "arke-sandbox-assinatura" };

let passou = 0;
let falhou = 0;
function conferir(descricao, condicao, detalhe = "") {
  if (condicao) {
    passou++;
    console.log(`  ok    ${descricao}${detalhe ? "  — " + detalhe : ""}`);
  } else {
    falhou++;
    console.log(`  FALHA ${descricao}${detalhe ? "  — " + detalhe : ""}`);
  }
}

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: H,
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  let j = {};
  try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok, status: r.status, corpo: j };
}

// CPF sintético válido pelo dígito verificador — o Asaas recusa o inválido,
// que é justamente o que se quer provar que o caminho respeita.
function gerarCpf() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (let rodada = 0; rodada < 2; rodada++) {
    const peso = n.length + 1;
    const soma = n.reduce((s, d, i) => s + d * (peso - i), 0);
    const resto = (soma * 10) % 11;
    n.push(resto >= 10 ? 0 : resto);
  }
  return n.join("");
}

function gerarCnpj() {
  const base = Array.from({ length: 12 }, (_, i) => (i === 8 ? 0 : i === 9 || i === 10 ? 0 : Math.floor(Math.random() * 10)));
  base[8] = 0; base[9] = 0; base[10] = 0; base[11] = 1;
  const calc = (nums, pesos) => {
    const soma = nums.reduce((s, d, i) => s + d * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  base.push(calc(base, [5,4,3,2,9,8,7,6,5,4,3,2]));
  base.push(calc(base, [6,5,4,3,2,9,8,7,6,5,4,3,2]));
  return base.join("");
}

const carimbo = Date.now();

console.log("\n=== 1. A academia: subconta com carteira própria ===");
// A carteira do split precisa ser de OUTRA conta Asaas: o gateway recusa split
// para a própria carteira. Por isso a academia é representada por uma subconta
// de verdade, criada pelo mesmo código do onboarding.
const sufixo = Math.random().toString(36).slice(2, 8);
const montado = montarSubconta({
  nome: `Academia Sandbox ${sufixo}`,
  razao_social: `Academia Sandbox ${sufixo} LTDA`,
  cnpj_cpf: gerarCnpj(),
  email_contato: `sandbox+assinatura-${sufixo}@arkefit.com.br`,
  telefone: "11987654321",
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  numero: "1000",
  complemento: null,
  bairro: "Bela Vista",
  tipo_empresa: "LIMITED",
  faturamento_mensal: 30000,
});
if (!montado.ok) {
  console.error("  payload da subconta incompleto:", montado.faltando);
  process.exit(1);
}
const subconta = await criarOuAdotarSubconta(API, CHAVE, montado.payload);
if (!subconta.ok) {
  console.error("  não consegui abrir a subconta:", subconta.erro);
  process.exit(1);
}
const walletAcademia = subconta.walletId;
conferir("subconta da academia aberta, com carteira própria", !!walletAcademia);

console.log("\n=== 2. O aluno: customer com CPF ===");
const alunoId = `aluno-sandbox-${carimbo}`;
const cpf = gerarCpf();
const customer = await obterOuCriarCustomer(API, H, {
  alunoId,
  nome: "Aluno de Homologação",
  cpf,
  telefone: "11988887777",
});
conferir("customer criado com CPF", !("erro" in customer), "erro" in customer ? customer.erro : customer.id);
if ("erro" in customer) process.exit(1);

const customerDeNovo = await obterOuCriarCustomer(API, H, {
  alunoId, nome: "Aluno de Homologação", cpf, telefone: "11988887777",
});
conferir(
  "segunda chamada reaproveita o mesmo customer (não duplica)",
  !("erro" in customerDeNovo) && customerDeNovo.id === customer.id,
);

console.log("\n=== 3. A assinatura do Método, com split ===");
// Integrado a R$ 119: atacado 45 + taxa (2,99% + 0,49) = 49,05 para a ArkeFit,
// 69,95 para a academia. É o exemplo do CLAUDE.md.
const VALOR = 119;
const TAXA = Math.round((VALOR * 0.0299 + 0.49) * 100) / 100;
const REPASSE_ARKE = Math.round((45 + TAXA) * 100) / 100;
const LIQUIDO_ACADEMIA = Math.round((VALOR - REPASSE_ARKE) * 100) / 100;
const referencia = `metodo:${alunoId}`;
const hoje = hojeEmBrasilia();

const criada = await criarOuAdotarAssinatura(API, H, {
  customerId: customer.id,
  referencia,
  valorCobrado: VALOR,
  primeiroVencimento: hoje,
  descricao: "ARKE — Academia Sandbox — nível integrado",
  walletIdAcademia: walletAcademia,
  valorLiquidoAcademia: LIQUIDO_ACADEMIA,
});
conferir("assinatura criada", !("erro" in criada), "erro" in criada ? criada.erro : criada.assinatura.id);
if ("erro" in criada) process.exit(1);

conferir("não foi adoção — nasceu agora", criada.adotada === false);
conferir(`valor cobrado é R$ ${VALOR}`, Number(criada.assinatura.value) === VALOR);

// Comportamento do Asaas que não é óbvio: criando a assinatura com
// `nextDueDate` = hoje, ele **já gera a cobrança de hoje** e devolve, no campo
// `nextDueDate` da assinatura, o vencimento do ciclo SEGUINTE. Então o campo
// não serve para conferir "a primeira vence hoje" — quem responde isso é a
// cobrança, conferida na seção 4.
//
// Isso vale para o `index.ts`, que grava `proxima_cobranca` a partir daí: o
// valor gravado é mesmo o da próxima, não o da primeira, que é o que o nome
// promete.
conferir(
  "assinatura devolve o vencimento do ciclo seguinte, não o de hoje",
  criada.assinatura.nextDueDate !== hoje && !!criada.assinatura.nextDueDate,
  `${criada.assinatura.nextDueDate}`,
);

const assinaturaId = criada.assinatura.id;
const detalhe = await chamar("GET", `/subscriptions/${assinaturaId}`);
const splitGravado = detalhe.corpo?.split ?? [];
conferir("split registrado na assinatura", splitGravado.length === 1);
conferir(
  `academia recebe R$ ${LIQUIDO_ACADEMIA.toFixed(2)}`,
  Number(splitGravado[0]?.fixedValue) === LIQUIDO_ACADEMIA,
  `fixedValue=${splitGravado[0]?.fixedValue}`,
);
conferir(
  `sobra R$ ${REPASSE_ARKE.toFixed(2)} para a ArkeFit (atacado 45 + taxa ${TAXA.toFixed(2)})`,
  repasseDoSplit({ value: VALOR, split: splitGravado }) === REPASSE_ARKE,
);

console.log("\n=== 4. A cobrança que nasce da assinatura ===");
const cobrancas = await chamar("GET", `/payments?subscription=${assinaturaId}`);
const primeira = cobrancas.corpo?.data?.[0];
conferir("cobrança gerada pela assinatura", !!primeira, primeira?.id);
conferir("cobrança vence hoje", primeira?.dueDate === hoje, `${primeira?.dueDate}`);
conferir(`cobrança de R$ ${VALOR}`, Number(primeira?.value) === VALOR);
conferir(
  "tipo em aberto: o aluno escolhe PIX, boleto ou cartão na fatura",
  primeira?.billingType === "UNDEFINED",
  `${primeira?.billingType}`,
);
conferir(
  "cobrança herda o externalReference `metodo:`",
  (primeira?.externalReference ?? "").startsWith("metodo:"),
  `${primeira?.externalReference}`,
);
conferir("fatura disponível para o aluno", !!primeira?.invoiceUrl);

console.log("\n=== 5. Idempotência: a segunda chamada não duplica ===");
const segunda = await criarOuAdotarAssinatura(API, H, {
  customerId: customer.id,
  referencia,
  valorCobrado: VALOR,
  primeiroVencimento: hoje,
  descricao: "ARKE — Academia Sandbox — nível integrado",
  walletIdAcademia: walletAcademia,
  valorLiquidoAcademia: LIQUIDO_ACADEMIA,
});
conferir("segunda chamada adotou em vez de criar", !("erro" in segunda) && segunda.adotada === true);
conferir(
  "é a MESMA assinatura — nenhuma órfã cobrando em paralelo",
  !("erro" in segunda) && segunda.assinatura.id === assinaturaId,
);
const todas = await chamar("GET", `/subscriptions?externalReference=${encodeURIComponent(referencia)}`);
conferir("existe exatamente uma assinatura com esta referência", (todas.corpo?.data ?? []).length === 1,
  `${(todas.corpo?.data ?? []).length}`);

console.log("\n=== 6. O que o código recusa ===");
// O achado de 22/09/2026, e a razão de o CPF ser conferido dentro do próprio
// ajudante: **filtro vazio no Asaas não filtra**. `GET /customers?cpfCnpj=`
// devolve a lista inteira da conta, e a busca adota o primeiro resultado — ou
// seja, um CPF em branco faria a assinatura do aluno nascer grudada no customer
// de outra pessoa, cobrando quem não devia. A checagem abaixo prova as duas
// coisas: que o Asaas se comporta assim, e que o nosso código não vai lá.
const listaSemFiltro = await chamar("GET", "/customers?cpfCnpj=");
conferir(
  "filtro vazio no Asaas devolve a conta inteira (é por isso que o ajudante barra antes)",
  (listaSemFiltro.corpo?.data ?? []).length > 1,
  `${(listaSemFiltro.corpo?.data ?? []).length} clientes`,
);

const semCpf = await obterOuCriarCustomer(API, H, {
  alunoId: `aluno-sem-cpf-${carimbo}`,
  nome: "Aluno Sem CPF",
  cpf: "",
  telefone: null,
});
conferir(
  "CPF vazio é recusado sem nem consultar o Asaas",
  "erro" in semCpf,
  "erro" in semCpf ? semCpf.erro.slice(0, 60) : "devolveu um customer (PERIGO)",
);

const splitMaior = await criarOuAdotarAssinatura(API, H, {
  customerId: customer.id,
  referencia: `metodo:teste-split-${carimbo}`,
  valorCobrado: 50,
  primeiroVencimento: hoje,
  descricao: "split maior que o valor",
  walletIdAcademia: walletAcademia,
  valorLiquidoAcademia: 80,
});
conferir(
  "split maior que o valor da assinatura é recusado",
  "erro" in splitMaior,
  "erro" in splitMaior ? splitMaior.erro.slice(0, 70) : "criou (inesperado)",
);

console.log("\n=== limpando ===");
await chamar("DELETE", `/subscriptions/${assinaturaId}`);
await chamar("DELETE", `/customers/${customer.id}`);
console.log("  assinatura e cliente removidos do sandbox");

console.log(`\n${passou} verificações passaram, ${falhou} falharam.`);
process.exitCode = falhou === 0 ? 0 : 1;
