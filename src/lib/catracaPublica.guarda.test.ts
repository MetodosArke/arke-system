import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava das regras da catraca que a auditoria de 06/10/2026 achou quebradas.
 *
 * 1. **O display é público:** "Bem-vindo!" ou "Aluno", nunca o nome, e a
 *    negativa não fala de dinheiro. A Topdata Inner escrevia o primeiro nome
 *    (que a nuvem mandava) e "Mensalidade da academia em atraso" no display.
 * 2. **Código de barras e QR não identificam aluno:** o texto do código
 *    virava o número do aluno no equipamento, pequeno e sequencial, e um
 *    código impresso com "12" entrava como o aluno 12.
 *
 * O comportamento é provado nos testes do Gateway e da ponte; esta trava
 * pega a volta do padrão em qualquer arquivo novo.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), "utf8");

function arquivos(dir: string, extensao: RegExp, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, extensao, achados);
    else if (extensao.test(nome)) achados.push(caminho);
  }
  return achados;
}

const semComentarios = (codigo: string) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("catraca: o display é público", () => {
  it("a nuvem não manda o nome do aluno ao equipamento, nem motivo que fale de dinheiro", () => {
    const funcao = semComentarios(ler("supabase", "functions", "catraca-validar-acesso", "index.ts"));
    expect(funcao).not.toMatch(/aluno_nome|full_name/);
    const motivos = [...funcao.matchAll(/motivo:\s*"([^"]*)"/g)].map((m) => m[1]);
    expect(motivos.length, "o detector acha os motivos").toBeGreaterThan(3);
    expect(motivos.filter((m) => /atraso|mensalidade|inadimpl|pagamento|d[ée]bito|dinheiro/i.test(m))).toEqual([]);
  });

  it("o Gateway não carrega o nome do aluno para nenhuma resposta ao equipamento", () => {
    const fontes = arquivos(join(RAIZ, "packages", "gateway", "src"), /\.ts$/)
      .map((c) => ({ nome: relative(RAIZ, c).replace(/\\/g, "/"), codigo: semComentarios(readFileSync(c, "utf8")) }))
      // O tipo da resposta da nuvem antiga declara o campo, para dizer que é ignorado.
      .filter((f) => !f.nome.endsWith("/types.ts"));
    expect(fontes.length).toBeGreaterThan(20);
    const comNome = fontes.filter((f) => /nomeAluno|\.aluno_nome|aluno\.nome\b/.test(f.codigo)).map((f) => f.nome);
    expect(comNome).toEqual([]);
  });

  it("o nome gravado nos equipamentos que mostram o nome na tela é \"Aluno\"", () => {
    // Intelbras e Hikvision guardam a pessoa no terminal, e a tela dele mostra o nome.
    expect(semComentarios(ler("packages", "gateway", "src", "conectores", "intelbras", "protocolo.ts"))).toMatch(/UserName: "Aluno"/);
    const hikvision = semComentarios(ler("packages", "gateway", "src", "conectores", "hikvision", "protocolo.ts"));
    expect(hikvision).toMatch(/name: "Aluno"/);
    // A frase da decisão que o aparelho mostra sai da frase de todas as marcas.
    expect(hikvision).toMatch(/info: mensagemDoDisplay\(liberado, motivo\)/);
  });

  it("a ponte da Topdata não tem onde guardar o nome, e o display sai da frase do Gateway", () => {
    const ponte = ["Gateway.cs", "MaquinaInner.cs", "Utilitarios.cs"]
      .map((a) => semComentarios(ler("packages", "ponte-topdata", "src", a)))
      .join("\n");
    expect(ponte).not.toMatch(/PrimeiroNome|public string Nome\b|"nome"/);
    expect(ler("packages", "gateway", "src", "receptores", "topdata.ts")).toMatch(/motivo: mensagemDoDisplay\(true/);
  });
});

describe("catraca: código de barras e QR não identificam aluno", () => {
  it("a regra da leitura mora num lugar só, e as marcas que mandam o valor lido passam por ela", () => {
    const gateway = join(RAIZ, "packages", "gateway", "src");
    const definicoes = arquivos(gateway, /\.ts$/).filter((c) =>
      /export function credencialDaLeitura\(/.test(readFileSync(c, "utf8"))
    );
    expect(definicoes.map((c) => relative(gateway, c).replace(/\\/g, "/"))).toEqual(["core/credencial.ts"]);
    const regra = semComentarios(ler("packages", "gateway", "src", "core", "credencial.ts"));
    expect(regra).toMatch(/"codigo_barras"/);
    expect(regra).toMatch(/"qrcode"/);
    for (const usa of [
      ["receptores", "topdata.ts"],
      ["conectores", "toletus", "conector.ts"],
      ["conectores", "hikvision", "receptor.ts"],
    ]) {
      expect(ler("packages", "gateway", "src", ...usa), usa.join("/")).toMatch(/from "\.\.\/(\.\.\/)?core\/credencial"/);
    }
  });
});
