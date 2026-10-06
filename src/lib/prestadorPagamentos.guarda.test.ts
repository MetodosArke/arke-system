import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CNPJ_ASAAS, ID_SELO_ASAAS, RAZAO_SOCIAL_ASAAS, SELO_ASAAS, TEXTO_ATENDIMENTO_ASAAS, TEXTO_PRESTADOR } from "./prestadorPagamentos";
import {
  blocoPrestador,
  SELO_ASAAS_POSITIVO as SELO_NOS_EMAILS,
  TEXTO_ATENDIMENTO_ASAAS as ATENDIMENTO_NOS_EMAILS,
  TEXTO_PRESTADOR as TEXTO_NOS_EMAILS,
} from "../../supabase/functions/_shared/prestadorPagamentos";
import { montarEmail } from "../../supabase/functions/agente-implantacao/fluxo";
import { emailAoAluno, emailDeAviso } from "../../supabase/functions/encerramento-organizacao/fluxo";

/**
 * O Asaas identificado como prestador em toda tela de pagamento (06/10/2026).
 *
 * A ArkeFit vai passar pela homologação do BaaS do Asaas, e a identificação do
 * prestador é condição dela: art. 14 da Resolução Conjunta BCB/CMN nº
 * 16/2025, e o Playbook do Asaas, que pede o selo oficial onde houver
 * movimentação ou gestão de valores. O defeito que esta trava previne não dá
 * erro: uma tela nova de cobrança sem o selo funciona igual — e descumpre a
 * regra até alguém notar.
 *
 * Trava:
 *   * o texto com a razão social e o CNPJ, e o selo carregado do endereço do
 *     Asaas, com o id da ArkeFit, sem `referrerPolicy` (o Asaas confere pelo
 *     Referer) e sem cópia da imagem no repositório;
 *   * as telas da lista renderizam `<PrestadorPagamentos`;
 *   * toda tela que chama uma função de cobrança ou mostra o link de uma
 *     fatura renderiza o componente, ou está em `DENTRO_DE` — e a tela que a
 *     contém renderiza.
 */
const RAIZ = join(__dirname, "..", "..");
const SRC = join(RAIZ, "src");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

const COMPONENTE = "src/components/pagamento/PrestadorPagamentos.tsx";

/** As telas que mostram ou criam cobrança, e onde a conta Asaas é aberta ou conectada. */
const TELAS = [
  // O aluno: os pagamentos, o cadastro do cartão, a tela de bloqueio, o Método no perfil.
  "src/components/pagamento/PagamentosAcademia.tsx",
  "src/components/pagamento/CartaoAssinatura.tsx",
  "src/components/app/AlunoBillingGate.tsx",
  "src/pages/app/AlunoPerfil.tsx",
  // A gestão: recebimentos, financeiro, avulsas, matrícula, Método, recibo, a conta Asaas.
  "src/pages/admin/AdminFinanceiro.tsx",
  "src/pages/admin/AdminOrganizacao.tsx",
  "src/pages/admin/AdminAlunos.tsx",
  "src/components/admin/AlunoPerfilSheet.tsx",
  "src/components/pagamento/CobrancasAvulsas.tsx",
  "src/components/admin/ReciboComprovanteDialog.tsx",
  "src/components/admin/onboarding/EtapaRecebimentos.tsx",
  "src/components/admin/OrganizacaoBillingGate.tsx",
  // A ArkeFit muda a conta das cobranças da academia.
  "src/components/superadmin/CobrancaContaAcademiaOrganizacao.tsx",
];

/** Telas que não renderizam o selo porque aparecem sempre dentro de outra que renderiza. */
const DENTRO_DE: Record<string, { pai: string[]; motivo: string }> = {
  "src/components/admin/NotasFiscaisPainel.tsx": { pai: ["src/pages/admin/AdminFinanceiro.tsx"], motivo: "aba Notas fiscais do Financeiro, que mostra o selo no topo" },
  "src/components/pagamento/CicloAssinatura.tsx": { pai: ["src/components/admin/AlunoPerfilSheet.tsx"], motivo: "bloco de cobrança da ficha do aluno" },
  "src/components/admin/SituacaoAluno.tsx": {
    pai: ["src/components/admin/AlunoPerfilSheet.tsx", "src/pages/admin/AdminAlunos.tsx"],
    motivo: "a situação pausa e retoma a mensalidade, na ficha e na lista de alunos",
  },
};

/** Telas internas da ArkeFit (Visão Master), sem cliente do outro lado: o painel de avisos e a visão geral. */
const INTERNAS = new Set(["src/pages/superadmin/SuperAdminWebhooks.tsx", "src/pages/superadmin/SuperAdminDashboard.tsx"]);

/**
 * As funções que criam ou mexem em cobrança do aluno, e a conta Asaas da
 * academia. Ficam de fora as da cobrança B2B (`asaas-assinatura-b2b`,
 * `asaas-emitir-cobranca-b2b`, `asaas-taxa-implantacao`): ali a ArkeFit cobra
 * a própria mensalidade da academia, como cliente do Asaas, e não é o serviço
 * de pagamento oferecido à academia. A tela de bloqueio B2B mostra o selo
 * assim mesmo (está na lista de TELAS).
 */
const FUNCOES_DE_COBRANCA =
  /functions\.invoke(?:<[^>]*>)?\(\s*["'](asaas-(?!assinatura-b2b|emitir-cobranca-b2b|taxa-implantacao)[\w-]+|academia-criar-matricula)["']|\b(invoice_url|fatura_pendente_url|invoiceUrl)\b/;

const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function telas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return telas(caminho);
    return nome.endsWith(".tsx") && !/\.test\.tsx$/.test(nome) ? [relative(RAIZ, caminho).replace(/\\/g, "/")] : [];
  });
}

const renderiza = (rel: string) => /<PrestadorPagamentos\b/.test(ler(rel));

describe("o prestador dos pagamentos identificado", () => {
  it("o texto tem a razão social e o CNPJ do Asaas, e diz que é instituição autorizada pelo Banco Central", () => {
    expect(RAZAO_SOCIAL_ASAAS).toBe("Asaas Gestão Financeira Instituição de Pagamento S.A.");
    expect(CNPJ_ASAAS).toBe("19.540.550/0001-21");
    expect(TEXTO_PRESTADOR).toBe(
      "Pagamentos processados pelo Asaas (Asaas Gestão Financeira Instituição de Pagamento S.A., CNPJ 19.540.550/0001-21), instituição de pagamento autorizada pelo Banco Central.",
    );
  });

  it("o selo vem do endereço do Asaas, com o id da ArkeFit", () => {
    for (const url of Object.values(SELO_ASAAS)) {
      expect(url).toMatch(/^https:\/\/baas\.asaas\.com\/selos\/Servicos_financeiros_Asaas-Reduzida-[\w-]+\.svg\?id=/);
      expect(url.endsWith(`?id=${ID_SELO_ASAAS}`)).toBe(true);
    }
  });

  it("o componente usa o selo positivo e o negativo branco, sem referrerPolicy, com o texto e o atendimento", () => {
    const codigo = semComentarios(ler(COMPONENTE));
    expect(codigo).toMatch(/src=\{SELO_ASAAS\.positivo\}/);
    expect(codigo).toMatch(/src=\{SELO_ASAAS\.negativoBranco\}/);
    expect(codigo, "o Asaas confere pelo Referer que o selo carregou").not.toMatch(/referrerPolicy|no-referrer/i);
    expect(codigo).toMatch(/\{TEXTO_PRESTADOR\}/);
    expect(codigo).toMatch(/ATENDIMENTO_ASAAS\.telefone/);
    expect(codigo).toMatch(/ATENDIMENTO_ASAAS\.email/);
    expect(codigo).toMatch(/href=\{SITE_ASAAS\} target="_blank" rel="noopener noreferrer"/);
  });

  it("a imagem do selo não é copiada para o repositório", () => {
    const copias = [...telas(SRC), ...(existsSync(join(RAIZ, "public")) ? readdirSync(join(RAIZ, "public")) : [])].filter((f) =>
      /Servicos_financeiros_Asaas/i.test(f),
    );
    expect(copias).toEqual([]);
  });

  it("as telas de pagamento mostram o prestador", () => {
    expect(TELAS.filter((t) => !renderiza(t))).toEqual([]);
  });

  it("toda tela que cria cobrança ou mostra fatura mostra o prestador, ou está dentro de uma que mostra", () => {
    const comCobranca = telas(SRC).filter((rel) => rel !== COMPONENTE && FUNCOES_DE_COBRANCA.test(ler(rel)));
    expect(comCobranca.length, "o detector detecta").toBeGreaterThan(8);
    const faltando = comCobranca.filter((rel) => !INTERNAS.has(rel) && !renderiza(rel) && !DENTRO_DE[rel]);
    expect(faltando, "ponha <PrestadorPagamentos /> na tela (ou, se ela sempre aparece dentro de outra, em DENTRO_DE)").toEqual([]);
  });

  it("os e-mails que falam de cobrança e da conta de recebimentos levam o prestador, com o mesmo texto das telas", () => {
    expect(TEXTO_NOS_EMAILS).toBe(TEXTO_PRESTADOR);
    expect(SELO_NOS_EMAILS).toBe(SELO_ASAAS.positivo);
    expect(ATENDIMENTO_NOS_EMAILS).toBe(TEXTO_ATENDIMENTO_ASAAS);
    const bloco = blocoPrestador();
    expect(bloco.texto).toContain(TEXTO_PRESTADOR);
    expect(bloco.html).toContain(`src="${SELO_ASAAS.positivo}"`);
    expect(bloco.html).not.toMatch(/referrerpolicy/i);

    const imp = { nome: "Academia X", slug: "x", tipo: "academia", etapas: [], evasao_inicio: "2026-04-01", evasao_fim: "2026-09-01" };
    const opcoes = { site: "https://app", assinatura: "Equipe de implantação ArkeFit" };
    const email = (tipo: string, etapa: string | null) =>
      montarEmail({ tipo, etapa, chave: "k", motivo: "m" } as Parameters<typeof montarEmail>[0], imp as Parameters<typeof montarEmail>[1], opcoes);
    for (const [tipo, etapa] of [["asaas_aprovada", null], ["asaas_recusada", null], ["proximo_passo", "recebimentos"], ["lembrete", "recebimentos"], ["boas_vindas", "recebimentos"]] as const) {
      const m = email(tipo, etapa);
      expect(m.texto, `${tipo} ${etapa}`).toContain(TEXTO_PRESTADOR);
      expect(m.html, `${tipo} ${etapa}`).toContain(SELO_ASAAS.positivo);
    }
    // A etapa que não fala de dinheiro não leva.
    expect(email("proximo_passo", "equipe").texto).not.toContain(TEXTO_PRESTADOR);

    const aviso = { organizacao_nome: "Academia X", iniciativa: "academia", termino_em: "2026-11-01", eliminacao_em: "2026-12-01" };
    expect(emailDeAviso(aviso, "https://app").texto).toContain(TEXTO_PRESTADOR);
    expect(emailAoAluno({ ...aviso, etapa: "aviso" }, { nome: "Ana", metodo: false }, "https://app").html).toContain(SELO_ASAAS.positivo);
  });

  it("as telas de DENTRO_DE estão mesmo dentro de uma que mostra o prestador", () => {
    for (const [filho, { pai }] of Object.entries(DENTRO_DE)) {
      const nome = filho.split("/").pop()!.replace(".tsx", "");
      for (const p of pai) {
        expect(ler(p), `${p} usa ${nome}`).toMatch(new RegExp(`<${nome}\\b`));
        expect(renderiza(p), `${p} mostra o prestador`).toBe(true);
      }
    }
  });
});
