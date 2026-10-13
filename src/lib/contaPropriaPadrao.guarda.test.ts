import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { divisaoDaCobranca } from "../../supabase/functions/_shared/contaCobranca";
import { avisoDaConexao } from "./notaFiscal";
import { dividirCobranca, previaDoMetodo } from "./repasse";

/**
 * A conta própria como padrão (13/10/2026).
 *
 * A ArkeFit não abre subcontas, e o Asaas confirmou o desenho: a mensalidade e
 * a avulsa da academia saem da conta dela, pelo valor integral, sem split e
 * sem taxa da ArkeFit; o Método ARKE sai da conta da ArkeFit, com a parte da
 * academia por split. Com a cobrança pela conta da ArkeFit, a taxa retida na
 * mensalidade é o que o art. 8 da Resolução Conjunta nº 16/2025 tira da
 * tomadora.
 *
 * Os defeitos que esta trava previne:
 *   * a conexão da chave da conta própria deixar de ligar a cobrança na conta
 *     da academia, e a academia nova voltar a cobrar pela conta da ArkeFit;
 *   * um segundo caminho de ligar, que esqueça o webhook (a academia cobra e
 *     ninguém ouve o pagamento) ou a recusa da assinatura viva;
 *   * a cobrança da academia voltar a ter taxa, no dinheiro ou na tela.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.ts$/.test(nome) && !/\.test\.ts$/.test(nome) ? [relative(RAIZ, caminho).replace(/\\/g, "/")] : [];
  });
}

/** O bloco `if (<condição>) {...}` que começa em `inicio`, até a chave que o fecha. */
function bloco(codigo: string, inicio: string): string {
  const i = codigo.indexOf(inicio);
  if (i < 0) return "";
  let nivel = 0;
  for (let j = codigo.indexOf("{", i); j < codigo.length; j++) {
    if (codigo[j] === "{") nivel++;
    if (codigo[j] === "}" && --nivel === 0) return codigo.slice(i, j + 1);
  }
  return codigo.slice(i);
}

const LIGAR = "ligarCobrancaNaContaDaAcademia(admin, ambiente, org, { supabaseUrl, atorId: callerId })";

describe("conectar a conta própria liga a cobrança na conta da academia", () => {
  it("guardar a chave no cofre liga o modo, e a resposta diz o que aconteceu", () => {
    const chave = bloco(ler("supabase/functions/asaas-fiscal-academia/index.ts"), 'if (acao === "chave")');
    const cofre = chave.indexOf('"guardar_chave_subconta_asaas"');
    const liga = chave.indexOf(`const modo = await ${LIGAR}`);
    expect(cofre, "o detector acha o cofre").toBeGreaterThan(0);
    expect(liga, "conectar a chave liga a cobrança na conta da academia").toBeGreaterThan(cofre);
    expect(chave.slice(liga)).toMatch(/return jsonResponse\(\{ \.\.\.\(await situacao\([^)]*\)\), cobranca_na_conta: cobrancaNaConta \}\)/);
  });

  it("a ficha da ArkeFit liga pelo mesmo caminho, e não há outro", () => {
    const modo = bloco(ler("supabase/functions/asaas-conta-academia/index.ts"), 'if (acao === "modo_cobranca")');
    expect(modo).toContain(`await ${LIGAR}`);
    const funcoes = arquivos(join(RAIZ, "supabase", "functions"));
    const registram = funcoes.filter((f) => /registrarWebhookNaConta\(/.test(ler(f).replace(/export async function registrarWebhookNaConta\(/, "")));
    expect(registram).toEqual(["supabase/functions/_shared/contaDaAcademia.ts"]);
    const ligam = funcoes.filter((f) => /"definir_cobranca_conta_academia", \{[^}]*_ligar: true/.test(ler(f)));
    expect(ligam).toEqual(["supabase/functions/_shared/contaDaAcademia.ts"]);
  });

  it("o caminho confere as assinaturas vivas e a chave contra a carteira, registra o aviso e só então grava o modo", () => {
    const codigo = ler("supabase/functions/_shared/contaDaAcademia.ts");
    const inicio = codigo.indexOf("export async function ligarCobrancaNaContaDaAcademia(");
    expect(inicio, "o detector acha a função").toBeGreaterThan(0);
    const corpo = codigo.slice(inicio, codigo.indexOf("\n}\n", inicio));
    const ordem = [
      '.eq("conta_asaas", "arkefit")',
      'contaDaCobranca(admin, ambiente, org, "academia", { conferirCarteira: true })',
      "registrarWebhookNaConta(conta.api, conta.chave",
      'admin.rpc("definir_cobranca_conta_academia"',
    ].map((trecho) => [trecho, corpo.indexOf(trecho)] as const);
    for (const [trecho, i] of ordem) expect(i, trecho).toBeGreaterThan(0);
    expect(ordem.map(([, i]) => i)).toEqual([...ordem.map(([, i]) => i)].sort((a, b) => a - b));
    expect(corpo).toMatch(/if \(!registro\.ok\) \{[^}]*return \{ erro:/);
  });

  it("a etapa Recebimentos pede a chave depois da carteira", () => {
    const tela = ler("src/components/admin/onboarding/EtapaRecebimentos.tsx");
    expect(tela).toMatch(/\{!criada && ehGestor && <ChaveDaContaPropria organizationId=\{organization!\.id\} \/>\}/);
    expect(tela).toContain("conectarConta(organizationId, valor)");
  });

  it("o aviso depois de conectar diz se a cobrança passou, se ficou na ArkeFit por assinatura viva, ou o que faltou", () => {
    expect(avisoDaConexao({ ligado: true }).description).toMatch(/pelo valor inteiro/);
    expect(avisoDaConexao({ ligado: false, assinaturas_na_conta_arkefit: 2 }).description).toMatch(/combinada com a equipe da ArkeFit/);
    const falha = avisoDaConexao({ ligado: false, aviso: "O Asaas não registrou o aviso de pagamento na conta da academia: x" });
    expect(falha.variant).toBe("destructive");
    expect(falha.description).toMatch(/Conecte a chave de novo/);
  });
});

describe("a cobrança da academia sem taxa", () => {
  it("na conta da academia, a divisão é o valor inteiro, sem split, qualquer que seja a taxa", () => {
    for (const valor of [5, 49.9, 100, 1234.56]) {
      for (const taxa of [null, 0, 1.99, 3.48]) {
        expect(divisaoDaCobranca("academia", valor, taxa, "w-1"), `${valor} ${taxa}`).toEqual({ repasse: 0, liquido: valor, split: null });
      }
    }
  });

  it("a mensalidade e a avulsa só pedem a taxa ao banco na conta da ArkeFit", () => {
    for (const rel of ["supabase/functions/academia-criar-matricula/index.ts", "supabase/functions/asaas-cobranca-avulsa/index.ts"]) {
      const codigo = ler(rel);
      const naArkefit = bloco(codigo, 'if (conta.nome === "arkefit")');
      expect(naArkefit, rel).toContain('admin.rpc("arke_taxa_processamento"');
      expect(codigo.split('"arke_taxa_processamento"').length - 1, `${rel}: a taxa só no ramo da conta da ArkeFit`).toBe(1);
      expect(codigo, rel).toMatch(/divisaoDaCobranca\(conta\.nome, /);
    }
  });

  it("a prévia da mensalidade e da avulsa na conta da academia não fala de taxa", () => {
    for (const rel of ["src/components/pagamento/CobrancasAvulsas.tsx", "src/components/admin/AlunoPerfilSheet.tsx"]) {
      const previas = [...ler(rel).matchAll(/<p[^>]*>([^<]*recebe o valor inteiro[^<]*)<\/p>/g)].map((m) => m[1]);
      expect(previas.length, rel).toBeGreaterThan(0);
      for (const p of previas) expect(p, rel).not.toMatch(/taxa/i);
    }
  });

  it("a prévia do Método é o preço do serviço da ArkeFit e da entrega presencial, sem taxa", () => {
    const divisao = dividirCobranca(119, { tipo: "fixo", valor: 45 }, { percentual: 2.99, fixa: 0.49, minima: 1.99 });
    const texto = previaDoMetodo(119, divisao).replace(/\s/g, " ");
    expect(texto).toBe(
      "Aluno paga R$ 119,00 pelo Método ARKE, serviço da ArkeFit · a academia recebe R$ 69,95 pela entrega presencial · a ArkeFit fica com R$ 49,05 pelo acompanhamento e pela operação da cobrança",
    );
    expect(texto).not.toMatch(/taxa/i);
    expect(ler("src/pages/admin/AdminOrganizacao.tsx")).toContain("previaDoMetodo(valorVarejo, divisao)");
  });
});
