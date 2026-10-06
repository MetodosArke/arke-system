// Exercita contra o SANDBOX do Asaas a anonimização do aluno no gateway — o
// próprio _shared/clienteAsaas.ts da saída do aluno, não uma cópia.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:anonimizar
//
// Só aceita chave de sandbox ($aact_hmlg_). O que estes cenários provam, e
// por que cada um existe:
//   * o Asaas aceita o cadastro vazio (e-mail, telefones, endereço) e devolve
//     o cliente sem eles — o módulo trata campo que ficou como falha, e é
//     aqui que se vê se o Asaas limpa com "" (decisão de 06/10/2026, ainda
//     não exercitada contra o Asaas de verdade);
//   * o CPF e a referência ficam, e a cobrança paga continua lá, paga: nada
//     do que é fiscal sai;
//   * na conta das cobranças o cliente é removido (marcado `deleted`), e uma
//     nova busca não o devolve — quem voltar com o mesmo CPF ganha um cliente
//     novo, e não "Pessoa anonimizada";
//   * na conta da nota fiscal o cliente só é anonimizado;
//   * repetir não faz nada de novo.
// Apaga o que cria (a cobrança paga fica: cobrança recebida não se apaga).
import {
  NOME_ANONIMIZADO,
  anonimizarCliente,
  camposQueFicaram,
  clientesDoAluno,
} from "../supabase/functions/_shared/clienteAsaas.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

let falhas = 0;
function conferir(nome, condicao, detalhe) {
  console.log(`${condicao ? "ok  " : "FALHOU"}  ${nome}${detalhe ? `  (${detalhe})` : ""}`);
  if (!condicao) falhas++;
}
function gerarCpf() {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (a, p) => { const s = a.reduce((x, n, i) => x + n * (p - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  b.push(dv(b, 10)); b.push(dv(b, 11));
  return b.join("");
}
async function asaas(metodo, caminho, corpo) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: { access_token: CHAVE, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: r.ok, status: r.status, corpo: await r.json().catch(() => ({})) };
}

const conta = (remover) => ({ nome: remover ? "arkefit" : "academia", api: API, chave: CHAVE, remover, porCpf: true });

async function clienteCompleto(alunoId, cpf) {
  const r = await asaas("POST", "/customers", {
    name: "Aluna Sandbox Anonimizar",
    cpfCnpj: cpf,
    email: "aluna-anonimizar-sandbox@arkefit.com.br",
    mobilePhone: "11999990000",
    phone: "1133334444",
    postalCode: "01310100",
    address: "Avenida Paulista",
    addressNumber: "1000",
    complement: "Sala 1",
    province: "Bela Vista",
    observations: "Criada pelo sandbox:anonimizar",
    externalReference: alunoId,
  });
  if (!r.ok) throw new Error(`não criou o cliente (HTTP ${r.status})`);
  return r.corpo;
}

// ── Conta das cobranças: com uma cobrança paga ─────────────────────────────
const alunoA = `sandbox-anonimizar-${Date.now()}`;
const cpfA = gerarCpf();
const clienteA = await clienteCompleto(alunoA, cpfA);
const cobranca = await asaas("POST", "/payments", { customer: clienteA.id, billingType: "BOLETO", value: 10, dueDate: hoje, externalReference: `sandbox:${alunoA}` });
conferir("cobrança criada", cobranca.ok, cobranca.ok ? cobranca.corpo.id : `HTTP ${cobranca.status}`);
if (cobranca.ok) {
  const paga = await asaas("POST", `/payments/${cobranca.corpo.id}/receiveInCash`, { paymentDate: hoje, value: 10, notifyCustomer: false });
  conferir("cobrança recebida em dinheiro", paga.ok, paga.ok ? paga.corpo.status : `HTTP ${paga.status}`);
}

const achadosA = await clientesDoAluno(conta(true), alunoA, cpfA);
conferir("achado pela referência e pelo CPF, uma vez só", achadosA.length === 1 && achadosA[0].id === clienteA.id, `${achadosA.length}`);

const rA = await anonimizarCliente(conta(true), clienteA);
conferir("anonimizado e removido na conta das cobranças", rA.ok, rA.ok ? "" : rA.erro);

const depoisA = await asaas("GET", `/customers/${clienteA.id}`);
conferir("o cliente ficou marcado como removido", depoisA.corpo.deleted === true);
conferir("o nome virou o anônimo", depoisA.corpo.name === NOME_ANONIMIZADO, depoisA.corpo.name);
conferir("e-mail, telefones e endereço saíram", camposQueFicaram(depoisA.corpo).length === 0, camposQueFicaram(depoisA.corpo).join(", "));
conferir("o CPF ficou (liga o pagamento a quem pagou)", String(depoisA.corpo.cpfCnpj ?? "").replace(/\D/g, "") === cpfA);
if (cobranca.ok) {
  const pagaDepois = await asaas("GET", `/payments/${cobranca.corpo.id}`);
  conferir("a cobrança paga continua lá, paga", pagaDepois.ok && pagaDepois.corpo.deleted !== true && pagaDepois.corpo.status === "RECEIVED_IN_CASH", pagaDepois.corpo.status);
}
const deNovoA = await clientesDoAluno(conta(true), alunoA, cpfA);
conferir("a busca não devolve o cliente removido (quem voltar ganha um novo)", deNovoA.length === 0);

// ── Conta da nota fiscal: só anonimiza ─────────────────────────────────────
const alunoB = `sandbox-anonimizar-nf-${Date.now()}`;
const cpfB = gerarCpf();
const clienteB = await clienteCompleto(alunoB, cpfB);
const rB = await anonimizarCliente(conta(false), clienteB);
conferir("anonimizado na conta da nota fiscal", rB.ok, rB.ok ? "" : rB.erro);
const depoisB = await asaas("GET", `/customers/${clienteB.id}`);
conferir("lá o cliente não é removido", depoisB.corpo.deleted !== true);
conferir("o Asaas para de mandar aviso", depoisB.corpo.notificationDisabled === true);
const rB2 = await anonimizarCliente(conta(false), depoisB.corpo);
conferir("repetir dá no mesmo", rB2.ok);

await asaas("DELETE", `/customers/${clienteB.id}`);

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.");
process.exit(falhas ? 1 : 0);
