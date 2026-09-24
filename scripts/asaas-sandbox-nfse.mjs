// Exercita contra o SANDBOX do Asaas a nota fiscal da academia — o próprio
// fluxo.ts de nfse-emitir, não uma cópia.
//
//   ASAAS_SANDBOX_KEY='$aact_hmlg_...' npm run sandbox:nfse
//
// Só aceita chave de sandbox ($aact_hmlg_). A conta da chave faz o papel da
// academia: o fluxo é o mesmo em qualquer conta, e o sandbox da ArkeFit já
// atingiu o limite de subcontas de teste ("teste controlado"). Apaga o
// cliente que cria e cancela a nota que emite.
//
// O que estes cenários provam, e por que cada um existe:
//   * o Asaas diz o que a prefeitura exige, e o serviço 6.04 (ginástica) se
//     acha pelo nome, já com o ISS;
//   * sem o endereço do aluno a nota fica agendada e a emissão é recusada — o
//     motivo de o ARKE passar a guardar endereço;
//   * "tentar de novo" com o endereço completo adota a nota agendada em vez de
//     criar outra, e ela chega a autorizada com número, PDF e XML;
//   * repetir a emissão de uma nota já autorizada não duplica;
//   * cancelar leva a nota a cancelada.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  autenticacaoEnviada,
  buscarServicos,
  cadastroFiscal,
  cancelarNota,
  carteiraDaChave,
  chaveCombinaComAmbiente,
  cidadeDaConta,
  consultarNota,
  emitirNota,
  enviarCadastroFiscal,
  garantirCliente,
  opcoesMunicipais,
  situacaoDaNota,
} from "../supabase/functions/nfse-emitir/fluxo.ts";

const API = "https://api-sandbox.asaas.com/v3";
const CHAVE = process.env.ASAAS_SANDBOX_KEY ?? "";
if (!CHAVE.startsWith("$aact_hmlg_")) {
  console.error("Defina ASAAS_SANDBOX_KEY com uma chave de SANDBOX ($aact_hmlg_...).");
  process.exit(2);
}
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ── Chave e ambiente ────────────────────────────────────────────────────────
conferir("chave de sandbox combina com homologação", chaveCombinaComAmbiente(CHAVE, "sandbox"));
conferir("chave de sandbox não serve para produção", !chaveCombinaComAmbiente(CHAVE, "producao"));
conferir("a chave responde com a carteira da conta", !!(await carteiraDaChave(API, CHAVE)));

// ── O que a prefeitura exige ────────────────────────────────────────────────
const cidade = await cidadeDaConta(API, CHAVE);
conferir("cidade da conta", !!cidade.cidade && !!cidade.uf, `${cidade.cidade}/${cidade.uf}`);
const opcoes = await opcoesMunicipais(API, CHAVE);
conferir("prefeitura informa a autenticação exigida", !!opcoes?.authenticationType, opcoes?.authenticationType);
const servicos = await buscarServicos(API, CHAVE, "ginástica");
const servico = servicos.find((s) => /6\.04/.test(s.descricao) && (s.iss ?? 0) > 0);
conferir("serviço 6.04 achado pelo nome, com ISS", !!servico, servico ? `${servico.descricao.slice(0, 40)}… ISS ${servico.iss}%` : "");

// ── Cadastro fiscal (certificado A1 de teste, autoassinado, só se faltar) ──
let cadastro = await cadastroFiscal(API, CHAVE);
if (!autenticacaoEnviada(opcoes?.authenticationType ?? null, cadastro)) {
  const dir = mkdtempSync(join(tmpdir(), "nfse-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "30", "-subj", "/CN=ACADEMIA SANDBOX"], { stdio: "ignore" });
    execFileSync("openssl", ["pkcs12", "-export", "-out", join(dir, "c.pfx"), "-inkey", join(dir, "k.pem"), "-in", join(dir, "c.pem"), "-passout", "pass:sandbox123"], { stdio: "ignore" });
    const f = new FormData();
    for (const [k, v] of Object.entries({ email: "fiscal-sandbox@arkefit.com.br", simplesNacional: "true", municipalInscription: "11356083", specialTaxRegime: "0", nationalPortalTaxCalculationRegime: "1", certificatePassword: "sandbox123" })) f.append(k, v);
    f.append("certificateFile", new Blob([readFileSync(join(dir, "c.pfx"))], { type: "application/x-pkcs12" }), "certificado.pfx");
    const r = await enviarCadastroFiscal(API, CHAVE, f);
    conferir("cadastro fiscal enviado com certificado", r.ok, r.ok ? "" : r.erro);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  cadastro = await cadastroFiscal(API, CHAVE);
}
conferir("Asaas confirma a autenticação na prefeitura", autenticacaoEnviada(opcoes?.authenticationType ?? null, cadastro));

// ── Sem endereço: agenda, mas não emite ─────────────────────────────────────
const aluno = { alunoId: `sandbox-nfse-${Date.now()}`, nome: "Aluno Sandbox NFSe", cpf: gerarCpf(), email: "aluno-nfse-sandbox@arkefit.com.br" };
const semEndereco = await garantirCliente(API, CHAVE, { ...aluno, endereco: { cep: "", logradouro: "", numero: "", complemento: null, bairro: "" } });
const referencia = `nfse:sandbox-${Date.now()}`;
const pedido = (cliente) => ({
  referencia, cliente, descricao: "Taxa de matrícula", observacoes: "Emitida pelo ARKE (sandbox).",
  valor: 38.01, data: hoje, servico: { id: servico?.id ?? null, codigo: null, nome: "Ginástica" }, iss: servico?.iss ?? 2,
});
let r = "id" in semEndereco ? await emitirNota(API, CHAVE, pedido(semEndereco.id)) : { ok: false, erro: semEndereco.erro };
conferir("sem endereço a prefeitura recusa, e a nota fica agendada", !r.ok && r.definitivo && !!r.nota, r.ok ? "emitiu!" : r.erro);
const agendada = r.ok ? null : r.nota;

// ── Com endereço: tentar de novo adota a agendada e emite ───────────────────
const comEndereco = await garantirCliente(API, CHAVE, { ...aluno, endereco: { cep: "01310100", logradouro: "Avenida Paulista", numero: "1000", complemento: null, bairro: "Bela Vista" } });
conferir("cliente atualizado com o endereço", "id" in comEndereco && "id" in semEndereco && comEndereco.id === semEndereco.id);
r = await emitirNota(API, CHAVE, pedido(comEndereco.id));
conferir("tentar de novo adota a nota agendada", r.ok && !!agendada && r.nota.id === agendada.id, r.ok ? r.nota.status : r.erro);

let nota = r.ok ? r.nota : null;
for (let i = 0; nota && situacaoDaNota(nota.status) !== "emitida" && i < 12; i++) {
  await dormir(5000);
  nota = await consultarNota(API, CHAVE, nota.id);
}
conferir("prefeitura autorizou, com número, PDF e XML", !!nota && situacaoDaNota(nota.status) === "emitida" && !!nota.number && !!nota.pdfUrl && !!nota.xmlUrl, nota ? `${nota.status} nº ${nota.number}` : "");

const repetida = await emitirNota(API, CHAVE, pedido(comEndereco.id));
conferir("emitir de novo não duplica", repetida.ok && !!nota && repetida.nota.id === nota.id);

// ── Cancelar ────────────────────────────────────────────────────────────────
if (nota) {
  const c = await cancelarNota(API, CHAVE, nota.id);
  conferir("cancelamento pedido", c.ok, c.ok ? c.nota.status : c.erro);
  let n = c.ok ? c.nota : null;
  for (let i = 0; n && situacaoDaNota(n.status) !== "cancelada" && i < 12; i++) {
    await dormir(5000);
    n = await consultarNota(API, CHAVE, n.id);
  }
  conferir("nota cancelada", !!n && situacaoDaNota(n.status) === "cancelada", n?.status);
}

if ("id" in comEndereco) await fetch(`${API}/customers/${comEndereco.id}`, { method: "DELETE", headers: { access_token: CHAVE } });

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTodas as verificações passaram.");
process.exit(falhas ? 1 : 0);
