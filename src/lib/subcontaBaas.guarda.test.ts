import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { caminhosDaConta, subcontaDisponivelNaTela } from "./contaAsaas";
import { TERMOS_ASAAS_URL } from "./prestadorPagamentos";
import {
  aceiteDosTermos,
  subcontaDisponivel,
  TERMOS_ASAAS_URL as TERMOS_NA_FUNCAO,
} from "../../supabase/functions/asaas-conta-academia/fluxo";
import { PASSOS } from "../../supabase/functions/agente-implantacao/fluxo";

/**
 * A subconta aberta pela ArkeFit atrás do interruptor (06/10/2026).
 *
 * Para o Asaas, abrir a conta da academia pela conta da ArkeFit é BaaS, com
 * homologação. Até ligar, o caminho é a conta própria da academia: "Abrir
 * pela ArkeFit" não aparece em tela nenhuma (menos na organização em trial,
 * o sandbox, para a homologação), nem no roteiro do agente de implantação,
 * nem nos artigos da gestão, e a função recusa a abertura. Ligado, a conta só
 * abre depois do aceite dos Termos de Uso do Asaas pelo titular.
 *
 * O defeito que esta trava previne: uma tela nova (ou um texto novo) que
 * ofereça a subconta direto, sem passar pelo interruptor.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

function arquivos(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho, ext);
    return ext.test(nome) && !/\.test\.tsx?$/.test(nome) ? [relative(RAIZ, caminho).replace(/\\/g, "/")] : [];
  });
}

describe("a subconta pela ArkeFit passa pelo interruptor", () => {
  it("a tela e a função decidem igual: ligado, todas; desligado, só a organização em trial", () => {
    for (const ligado of [true, false]) {
      for (const status of ["ativa", "trial", "inadimplente", null]) {
        const valor = ligado ? 1 : 0;
        expect(subcontaDisponivelNaTela(ligado, status), `${ligado} ${status}`).toBe(subcontaDisponivel(valor, status));
      }
    }
    expect(caminhosDaConta(false, "ativa")).toEqual(["existente"]);
    expect(caminhosDaConta(false, "trial")).toEqual(["existente", "criar"]);
    expect(caminhosDaConta(true, "ativa")).toEqual(["existente", "criar"]);
  });

  it("toda tela que pede a abertura da subconta escolhe o caminho por caminhosDaConta", () => {
    const pedem = arquivos(join(RAIZ, "src"), /\.tsx?$/).filter((rel) => {
      const c = ler(rel);
      return c.includes("asaas-conta-academia") && /acao: "criar"/.test(c);
    });
    expect(pedem.length, "o detector detecta").toBeGreaterThan(0);
    expect(pedem.filter((rel) => !/caminhosDaConta\(/.test(ler(rel)))).toEqual([]);
  });

  it("\"Abrir pela ArkeFit\" só aparece em tela que passa pelo interruptor", () => {
    const oferecem = arquivos(join(RAIZ, "src"), /\.tsx?$/).filter((rel) => /Abrir pela ArkeFit/i.test(ler(rel)));
    expect(oferecem.filter((rel) => !/caminhosDaConta\(/.test(ler(rel)))).toEqual([]);
  });

  it("a função confere o interruptor e o aceite, e grava o aceite, antes de abrir a conta no Asaas", () => {
    const codigo = ler("supabase/functions/asaas-conta-academia/index.ts");
    const abre = codigo.indexOf("criarOuAdotarSubconta(asaasApiUrl");
    expect(abre).toBeGreaterThan(0);
    for (const antes of ["subcontaDisponivel(", "aceiteDosTermos(corpo)", 'from("aceites_termos_asaas")', "sessaoSimulada(admin"]) {
      const i = codigo.indexOf(antes);
      expect(i, antes).toBeGreaterThan(0);
      expect(i, `${antes} vem antes de abrir a conta`).toBeLessThan(abre);
    }
    // Quem aceita é o titular: a gestão da academia.
    expect(codigo).toMatch(/if \(vinculo\?\.role !== "gestor"\) \{\n\s+return jsonResponse\(\{ error: "Quem abre a conta e aceita os Termos do Asaas/);
  });

  it("o aceite exige a marca e o endereço dos termos que a tela mostrou, que é o mesmo nos dois lados", () => {
    expect(TERMOS_NA_FUNCAO).toBe(TERMOS_ASAAS_URL);
    expect(TERMOS_ASAAS_URL).toMatch(/^https:\/\/central\.ajuda\.asaas\.com\//);
    expect(aceiteDosTermos({ aceite_termos: true, termos_url: TERMOS_ASAAS_URL })).toEqual({ ok: true });
    expect(aceiteDosTermos({ aceite_termos: "true", termos_url: TERMOS_ASAAS_URL }).ok).toBe(false);
    expect(aceiteDosTermos({ aceite_termos: true, termos_url: "https://outro" }).ok).toBe(false);
    expect(aceiteDosTermos({}).ok).toBe(false);
  });

  it("o roteiro do agente de implantação não oferece a abertura pela ArkeFit", () => {
    const textos = Object.values(PASSOS).map((p) => `${p.titulo} ${p.texto}`).join("\n");
    expect(textos).not.toMatch(/(abr\w*|aberta)\s+pel[ao]\s+(arkefit|arke)\b/i);
    expect(PASSOS.recebimentos.texto).toMatch(/site do Asaas/);
  });

  it("os artigos da gestão não oferecem a abertura pela ArkeFit", () => {
    const pasta = join(RAIZ, "src", "content", "ajuda");
    const daGestao = readdirSync(pasta).filter((f) => f.endsWith(".md") && !f.startsWith("vm-"));
    const oferecem = daGestao.filter((f) => /Abrir pela ArkeFit|(pode|podem) ser abert[ao]s? pela ArkeFit/i.test(readFileSync(join(pasta, f), "utf8")));
    expect(oferecem).toEqual([]);
  });

  it("o interruptor nasce desligado, com faixa de 0 a 1", () => {
    const pasta = join(RAIZ, "supabase", "migrations");
    const sql = readdirSync(pasta)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(pasta, f), "utf8").replace(/\r\n/g, "\n"))
      .join("\n");
    const faixas = [...sql.matchAll(/create or replace function public\.faixa_plataforma_config[\s\S]*?\n\$\$;/g)];
    expect(faixas.at(-1)?.[0]).toMatch(/\('asaas_subcontas_baas', 0, 1, true\)/);
    expect(sql).toMatch(/insert into public\.plataforma_config \(chave, valor, descricao\)\nvalues \(\n\s+'asaas_subcontas_baas',\n\s+0,/);
  });
});
