// Exercita contra o SANDBOX do Asaas a cobrança na conta da academia e o
// caminho BaaS (06/10/2026) — os próprios fluxo.ts das funções, não cópias.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:conta-academia
//
// Só aceita chave de sandbox ($aact_hmlg_). O sandbox não abre mais subconta
// para quem não tem o BaaS habilitado, então a conta-mãe do sandbox faz o
// papel da conta da academia: é nela que a cobrança "da academia" nasce, sem
// split, como nasceria na conta própria da academia com o modo ligado.
//
// O que cada cenário prova:
//   1. o webhook da academia: o Asaas aceita o token que o ARKE sorteia (as
//      regras de complexidade de 02/03/2026), registrar de novo atualiza o
//      mesmo webhook em vez de criar outro, e o Asaas não devolve o token
//      (só `hasAuthToken`). Registrado desligado (`enabled: false`), para não
//      mandar aviso a ninguém, e removido no fim;
//   2. o cliente da conta da academia: o da nota fiscal nasce com os avisos
//      desligados, e a cobrança o reativa antes de cobrar (senão a fatura não
//      chegaria ao aluno); com a cobrança na conta, a nota não os desliga de novo;
//   3. a mensalidade sem split: nasce sem split, é achada pela referência
//      `plano:`, muda de valor sem ganhar split, recebe o cartão, pausa,
//      retoma e cancela — tudo na conta onde nasceu;
//   4. a avulsa sem split: nasce sem split, é achada pela referência e cancela;
//   5. a conferência: as listagens da varredura trazem as cobranças da conta,
//      e só a mensalidade e a avulsa são do ARKE ali;
//   6. os documentos no formato BaaS: `GET /myAccount/documents` é lido e
//      normalizado (na conta-mãe do sandbox; a lista pode vir vazia);
//   7. (com SUBCONTA=1) a abertura de subconta: se o sandbox recusar, a
//      mensagem do Asaas é a que a tela mostra. Desligado por padrão: subconta
//      de sandbox não se apaga.
// Apaga o que cria.
import { gerarTokenWebhook, registrarWebhookNaConta, removerWebhook, urlDoWebhookDaAcademia, EVENTOS_DO_WEBHOOK } from "../supabase/functions/_shared/webhookAcademia.ts";
import { criarAssinaturaDoPlano, obterOuCriarCustomer, assinaturaAtivaNoAsaas } from "../supabase/functions/academia-criar-matricula/fluxo.ts";
import { emitirCobrancaAvulsa, cobrancaPorReferencia, cancelarCobranca } from "../supabase/functions/asaas-cobranca-avulsa/fluxo.ts";
import { alterarValorAssinatura, pausarAssinatura, retomarAssinatura, cancelarAssinatura } from "../supabase/functions/asaas-assinatura-ciclo/fluxo.ts";
import { ligarCartaoNaAssinatura } from "../supabase/functions/asaas-cartao-assinatura/fluxo.ts";
import { garantirCliente } from "../supabase/functions/nfse-emitir/fluxo.ts";
import { listarTodas, origemDaReferencia, origensDaConta } from "../supabase/functions/asaas-reconciliar/fluxo.ts";
import { documentosDaSubconta, criarOuAdotarSubconta } from "../supabase/functions/asaas-conta-academia/fluxo.ts";
import { divisaoDaCobranca } from "../supabase/functions/_shared/contaCobranca.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
// O endereço do webhook é o da função de verdade (público, em docs/INFRAESTRUTURA.md),
// com uma academia que não existe: registrado desligado, o Asaas não chama.
const SUPABASE_URL = "https://lzyxqjibkfblrrjboylp.supabase.co";
const H = { access_token: CHAVE, "Content-Type": "application/json" };

let falhas = 0;
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}
function gerarCpf() {
  const b = Array.from(crypto.getRandomValues(new Uint8Array(9)), (n) => n % 10);
  const dv = (a, p) => { const s = a.reduce((x, n, i) => x + n * (p - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  b.push(dv(b, 10)); b.push(dv(b, 11));
  return b.join("");
}
async function asaas(metodo, caminho, corpo) {
  const r = await fetch(`${API}${caminho}`, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined, signal: AbortSignal.timeout(20_000) });
  return { ok: r.ok, status: r.status, corpo: await r.json().catch(() => ({})) };
}
const diasDepois = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + n * 864e5));
const hoje = diasDepois(0);
const limpar = [];

try {
  // ── 1. O webhook da academia ──────────────────────────────────────────────
  const orgFalsa = crypto.randomUUID();
  const url = urlDoWebhookDaAcademia(SUPABASE_URL, orgFalsa);
  const r1 = await registrarWebhookNaConta(API, CHAVE, { url, token: gerarTokenWebhook(), enabled: false });
  conferir("o Asaas aceita o token sorteado e cria o webhook", r1.ok && !r1.atualizado, r1.ok ? r1.id : r1.erro);
  if (r1.ok) {
    limpar.push(() => removerWebhook(API, CHAVE, r1.id));
    const r2 = await registrarWebhookNaConta(API, CHAVE, { url, token: gerarTokenWebhook(), enabled: false });
    conferir("registrar de novo atualiza o mesmo, sem criar outro", r2.ok && r2.atualizado && r2.id === r1.id, r2.ok ? r2.id : r2.erro);
    const lista = await asaas("GET", "/webhooks?limit=100");
    const nossos = (lista.corpo.data ?? []).filter((w) => w.url === url);
    conferir("um webhook só para a academia", nossos.length === 1, `${nossos.length}`);
    conferir("o Asaas não devolve o token, só que ele existe", nossos[0]?.hasAuthToken === true && nossos[0]?.authToken == null);
    conferir("os eventos são os de cobrança", JSON.stringify([...(nossos[0]?.events ?? [])].sort()) === JSON.stringify([...EVENTOS_DO_WEBHOOK].sort()));
  }
  const fraco = await registrarWebhookNaConta(API, CHAVE, { url, token: "1234567890abcdefghij", enabled: false });
  conferir("token fora das regras não sai do ARKE", !fraco.ok);

  // ── 2. O cliente da conta da academia ─────────────────────────────────────
  const alunoId = crypto.randomUUID();
  const cpf = gerarCpf();
  const tomador = {
    alunoId, nome: "Aluna Sandbox Conta Academia", cpf, email: null,
    endereco: { cep: "01310100", logradouro: "Avenida Paulista", numero: "1000", complemento: null, bairro: "Bela Vista" },
  };
  const daNota = await garantirCliente(API, CHAVE, tomador);
  conferir("a nota fiscal cria o cliente", "id" in daNota, JSON.stringify(daNota));
  if ("id" in daNota) limpar.push(() => asaas("DELETE", `/customers/${daNota.id}`));
  const antes = "id" in daNota ? await asaas("GET", `/customers/${daNota.id}`) : null;
  conferir("o cliente da nota nasce com os avisos desligados", antes?.corpo.notificationDisabled === true);
  const daCobranca = await obterOuCriarCustomer(API, CHAVE, { alunoId, nome: tomador.nome, cpf, telefone: "11987654321" }, { reativar: true });
  conferir("a cobrança acha o mesmo cliente", "id" in daCobranca && "id" in daNota && daCobranca.id === daNota.id);
  const depois = "id" in daNota ? await asaas("GET", `/customers/${daNota.id}`) : null;
  conferir("e liga os avisos antes de cobrar", depois?.corpo.notificationDisabled === false);
  await garantirCliente(API, CHAVE, tomador, { cobrancaNaConta: true });
  const aposNota = "id" in daNota ? await asaas("GET", `/customers/${daNota.id}`) : null;
  conferir("com a cobrança na conta, a nota não desliga os avisos de novo", aposNota?.corpo.notificationDisabled === false);

  // ── 3. A mensalidade sem split ────────────────────────────────────────────
  const divisao = divisaoDaCobranca("academia", 120, null, null);
  conferir("na conta da academia: sem taxa, sem split, valor inteiro", divisao.repasse === 0 && divisao.liquido === 120 && divisao.split === null);
  const referencia = `plano:${alunoId}`;
  // 15 dias à frente: o Asaas recusa trocar o tipo com cobrança vencendo no dia (visto no sandbox:cartao).
  const criada = "id" in daCobranca
    ? await criarAssinaturaDoPlano(API, CHAVE, {
        customerId: daCobranca.id, valor: 120, periodicidade: "mensal", primeiroVencimento: diasDepois(15),
        descricao: "Academia Sandbox — Plano mensal", referencia, split: divisao.split,
      })
    : { ok: false, erro: "sem cliente" };
  conferir("a mensalidade nasce na conta, sem split", criada.ok, criada.ok ? criada.assinatura.id : criada.erro);
  if (criada.ok) {
    const sub = criada.assinatura.id;
    limpar.unshift(() => asaas("DELETE", `/subscriptions/${sub}`));
    const lida = await asaas("GET", `/subscriptions/${sub}`);
    conferir("sem split no Asaas", !(lida.corpo.split?.length > 0), JSON.stringify(lida.corpo.split ?? null));
    const achada = await assinaturaAtivaNoAsaas(API, H, referencia);
    conferir("achada pela referência plano:", achada?.id === sub);

    const valor = await alterarValorAssinatura(API, CHAVE, sub, { valorCobrado: 135, valorRepasseArke: 0, walletAcademia: null, hoje });
    conferir("muda o valor sem split", valor.ok && valor.valorAcademia === 135, valor.ok ? "" : valor.erro);
    const lida2 = await asaas("GET", `/subscriptions/${sub}`);
    conferir("o Asaas guarda o valor novo, ainda sem split", Number(lida2.corpo.value) === 135 && !(lida2.corpo.split?.length > 0));
    const comRepasse = await alterarValorAssinatura(API, CHAVE, sub, { valorCobrado: 135, valorRepasseArke: 4, walletAcademia: null, hoje });
    conferir("repasse sem split é recusado antes do Asaas", !comRepasse.ok);

    const cartao = await ligarCartaoNaAssinatura(API, CHAVE, sub, {
      creditCard: { holderName: "ALUNA SANDBOX", number: "5162306219378829", expiryMonth: "12", expiryYear: String(new Date().getFullYear() + 3), ccv: "318" },
      creditCardHolderInfo: { name: "Aluna Sandbox", email: "sandbox@arkefit.com.br", cpfCnpj: cpf, postalCode: "01310100", addressNumber: "100", phone: "11987654321", mobilePhone: "11987654321" },
      remoteIp: "177.10.10.10",
    });
    conferir("o cartão é ligado na assinatura da conta da academia", cartao.ok, cartao.ok ? cartao.bandeira : cartao.erro);

    const pausa = await pausarAssinatura(API, CHAVE, sub, hoje);
    conferir("pausa na conta onde nasceu", pausa.ok, pausa.ok ? "" : pausa.erro);
    const volta = await retomarAssinatura(API, CHAVE, sub);
    conferir("retoma", volta.ok, volta.ok ? "" : volta.erro);

    // ── 5. A conferência ──────────────────────────────────────────────────
    const criadasHoje = await listarTodas(API, CHAVE, `/payments?dateCreated%5Bge%5D=${hoje}`);
    const nossas = criadasHoje.filter((p) => p.subscription === sub);
    conferir("a varredura acha a mensalidade da conta", nossas.length > 0, `${nossas.length}`);
    conferir("e ela é do ARKE ali, como mensalidade", nossas.every((p) => origemDaReferencia(p.externalReference, origensDaConta({ nome: "academia", organizationId: orgFalsa })) === "plano"));

    const cancelada = await cancelarAssinatura(API, CHAVE, sub);
    conferir("cancela na conta onde nasceu", cancelada.ok, cancelada.ok ? "" : cancelada.erro);
  }

  // ── 4. A avulsa sem split ─────────────────────────────────────────────────
  const avulsaRef = `avulsa:${crypto.randomUUID()}`;
  const avulsa = await emitirCobrancaAvulsa(API, CHAVE, {
    referencia: avulsaRef,
    aluno: { alunoId, nome: tomador.nome, cpf, telefone: "11987654321" },
    valor: 80, vencimento: diasDepois(3), descricao: "Academia Sandbox — Avaliação física",
    walletAcademia: null, valorLiquidoAcademia: 80,
  });
  conferir("a avulsa nasce na conta, sem split", avulsa.ok && !(avulsa.cobranca.split?.length > 0), avulsa.ok ? avulsa.cobranca.id : avulsa.erro);
  if (avulsa.ok) {
    const achada = await cobrancaPorReferencia(API, CHAVE, avulsaRef);
    conferir("achada pela referência avulsa:", achada?.id === avulsa.cobranca.id);
    const de = await emitirCobrancaAvulsa(API, CHAVE, {
      referencia: avulsaRef, aluno: { alunoId, nome: tomador.nome, cpf, telefone: null },
      valor: 80, vencimento: diasDepois(3), descricao: "Repetida", walletAcademia: null, valorLiquidoAcademia: 80,
    });
    conferir("emitir de novo adota, não duplica", de.ok && de.adotada && de.cobranca.id === avulsa.cobranca.id);
    const c = await cancelarCobranca(API, CHAVE, avulsa.cobranca.id);
    conferir("cancela", c.ok, c.ok ? "" : c.erro);
  }

  // ── 6. Os documentos no formato BaaS ──────────────────────────────────────
  const docs = await documentosDaSubconta(API, CHAVE);
  conferir("GET /myAccount/documents é lido e normalizado", docs.ok, docs.ok ? `${docs.grupos.length} grupo(s): ${docs.grupos.map((g) => `${g.tipo}=${g.status}${g.link ? " com link" : ""}`).join(", ")}` : docs.erro);

  // ── 7. A abertura de subconta (opcional) ──────────────────────────────────
  if (process.env.SUBCONTA === "1") {
    const r = await criarOuAdotarSubconta(API, CHAVE, {
      name: "Academia Sandbox BaaS", email: `baas-${Date.now()}@arkefit.com.br`, cpfCnpj: "11222333000181", companyType: "LIMITED",
      mobilePhone: "11987654321", incomeValue: 30000, address: "Avenida Paulista", addressNumber: "1000", province: "Bela Vista", postalCode: "01310100",
    });
    console.log(`info  abertura de subconta no sandbox: ${r.ok ? `aberta (${r.walletId}${r.adotada ? ", adotada" : ""})` : `recusada — a tela mostra: "${r.erro}"`}`);
  }
} finally {
  for (const f of limpar) {
    try {
      await f();
    } catch {
      // a limpeza não derruba o relatório
    }
  }
}

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
