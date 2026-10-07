import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava da auditoria de 05/10/2026: erro de consulta não é estado vazio.
 *
 * Quase nenhuma tela fora da Visão Master tratava o erro da consulta. Num
 * soluço de rede, a lista de alunos dizia "Nenhum aluno cadastrado ainda." e o
 * treino do aluno, "Nenhum treino publicado ainda." — o gestor achava que tinha
 * perdido a base e importava de novo; o aluno achava que a academia tinha
 * apagado o treino. É o princípio "sem dado inventado": a tela mostra dado
 * real ou um estado vazio claro, e "vazio" só é verdade quando a consulta
 * respondeu.
 *
 * A regra: a tela que mostra estado vazio para o dado de um `useQuery` toma o
 * `error` (ou o `isError`) dessa mesma consulta e o usa — de preferência com
 * `<ErroAoCarregar>`, que diz o que falhou e oferece tentar de novo.
 *
 * Desde 07/10/2026 (frente B), o vazio de uma lista que sai da consulta
 * (`const filtrados = dados.filter(...)` e `filtrados.length === 0`) conta
 * como vazio da consulta: a guarda deixava passar a Agenda ("Nenhuma turma
 * cadastrada para este dia"), os dois Acervos e o seletor de perfis da Visão
 * Master, que diziam "nenhum" com a consulta falhando.
 *
 * As telas que ainda não fazem isso estão em PENDENTES, e a lista só diminui:
 * tela consertada sai dela (o último teste cobra), e tela nova não entra.
 */
const SRC = join(__dirname, "..");

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.tsx$/.test(nome) && !/\.test\.tsx$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

/** O fim do texto entre aspas que abre em `i` (aspas simples e duplas não passam da linha). */
function fimDoTexto(codigo: string, i: number): number {
  const aspa = codigo[i];
  for (let j = i + 1; j < codigo.length; j++) {
    if (codigo[j] === "\\") j++;
    else if (codigo[j] === aspa) return j;
    else if (codigo[j] === "\n" && aspa !== "`") return j;
  }
  return codigo.length;
}

/** O lado direito de uma declaração: do `=` até o `;` de fora de parênteses, colchetes e chaves. */
function ladoDireito(codigo: string, desde: number): string {
  let nivel = 0;
  for (let i = desde; i < codigo.length; i++) {
    const c = codigo[i];
    if (c === '"' || c === "'" || c === "`") i = fimDoTexto(codigo, i);
    else if (c === "(" || c === "[" || c === "{") nivel++;
    else if (c === ")" || c === "]" || c === "}") {
      if (--nivel < 0) return codigo.slice(desde, i);
    } else if (c === ";" && nivel === 0) return codigo.slice(desde, i);
  }
  return codigo.slice(desde);
}

/** Os métodos que fazem de uma lista outra lista. */
const DE_LISTA_EM_LISTA = "filter|map|flatMap|slice|sort|toSorted|reverse|toReversed|concat";

/**
 * O dado da consulta e as listas que saem dele: `const filtrados =
 * alunos.filter(...)`, `const lista = useMemo(() => alunos.filter(...))`,
 * `(alunos ?? []).map(...)`, `[...alunos].sort()`, e o que sai destas
 * (`const ordenados = [...filtrados].sort()`). O vazio de uma lista filtrada
 * também é o vazio da consulta: com a consulta falhando, a lista filtrada sai
 * vazia e a tela diz "Nenhum..." (frente B, 07/10/2026).
 */
export function nomesDoDado(codigo: string, dado: string): string[] {
  const declaracoes = [...codigo.matchAll(/\b(?:const|let)\s+(\w+)\s*(?::[^=;]*?)?=(?![=>])/g)].map((m) => ({
    nome: m[1],
    direito: ladoDireito(codigo, m.index! + m[0].length),
  }));
  const saiDe = (n: string) =>
    new RegExp(
      [
        `(?<![\\w.$])${n}\\s*\\??\\.\\s*(?:${DE_LISTA_EM_LISTA})\\s*\\(`,
        `\\(\\s*${n}\\s*(?:\\?\\?|\\|\\|)\\s*\\[\\s*\\]\\s*\\)\\s*\\.\\s*(?:${DE_LISTA_EM_LISTA})\\s*\\(`,
        `\\[\\s*\\.\\.\\.\\s*${n}\\b`,
      ].join("|"),
    );
  const nomes = new Set([dado]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const d of declaracoes) {
      if (nomes.has(d.nome)) continue;
      if ([...nomes].some((n) => saiDe(n).test(d.direito))) {
        nomes.add(d.nome);
        mudou = true;
      }
    }
  }
  return [...nomes];
}

/**
 * Consultas com estado vazio e sem o erro tratado, num arquivo. Cada
 * `const { data: nome, ... } = useQuery(...)`: há estado vazio quando o
 * arquivo testa o nome, ou um nome que sai dele (`nomesDoDado`), como vazio
 * (`nome.length === 0`, `!nome.length`, `!nome &&`...) fora de um
 * `if (...) return null`; o erro está tratado quando a desestruturação toma
 * `error` ou `isError` e o nome aparece de novo.
 */
export function vaziosSemErro(codigo: string): string[] {
  const achados: string[] = [];
  for (const m of codigo.matchAll(/const\s*\{([^{}]*)\}\s*=\s*useQuery\b/g)) {
    const campos = m[1];
    const dado = campos.match(/\bdata\s*:\s*(\w+)/)?.[1] ?? (/\bdata\b/.test(campos) ? "data" : null);
    if (!dado) continue;
    const n = `(?<![\\w.$])(?:${nomesDoDado(codigo, dado).join("|")})`;
    const vazio = new RegExp(
      `${n}\\??\\.length\\s*===?\\s*0|!${n}\\??\\.length\\b|&&\\s*!${n}\\s*(&&|\\))|\\{\\s*!${n}\\s*(&&|\\?)|!${n}\\s*\\?\\s*\\(|\\?\\s*null\\s*:\\s*!${n}\\b`,
    );
    const linhasComVazio = codigo
      .split("\n")
      .filter((l) => vazio.test(l))
      // `if (!lista.length) return null` some com o componente: não diz "nenhum".
      .filter((l) => !/\bif\s*\(.*\)\s*return\s+(null|\[\]|\{\}|0|false|undefined)\b/.test(l));
    if (!linhasComVazio.length) continue;
    const erro = campos.match(/\b(?:error|isError)\b(?:\s*:\s*(\w+))?/);
    const nomeDoErro = erro ? erro[1] ?? erro[0] : null;
    const usado = nomeDoErro && (codigo.match(new RegExp(`(?<![\\w.$])${nomeDoErro}\\b`, "g")) ?? []).length > 1;
    if (!usado) achados.push(dado);
  }
  return achados;
}

/**
 * Telas que ainda mostram "vazio" quando a consulta falha. Consertou, tire
 * daqui. Vazia desde 06/10/2026 (as 16 da auditoria foram tratadas), e tela
 * nova não entra.
 */
const PENDENTES: Record<string, string> = {};

/**
 * O que o detector acha, mas não é estado vazio, com o porquê. Não é lista de
 * espera: só entra o que é decisão, e a lista só diminui.
 */
const NAO_E_ESTADO_VAZIO: Record<string, string> = {
  "components/legal/AceiteDocumentosGate.tsx":
    "é a porta do aceite, e não uma lista: com a consulta dos aceites falhando, ela deixa entrar (falha aberta de propósito, para um soluço não trancar a academia inteira fora do app), registra o código do erro e pede o aceite de novo no próximo carregamento",
};

const telas = arquivos(SRC)
  .map((c) => ({ nome: relative(SRC, c).replace(/\\/g, "/"), codigo: readFileSync(c, "utf8") }))
  .filter((t) => !t.nome.startsWith("components/ui/"));

describe("erro de consulta não é estado vazio", () => {
  it("o detector detecta (senão os testes abaixo passariam sem verificar nada)", () => {
    const sem = `const { data: alunos = [], isLoading } = useQuery({ queryKey: ["a"] });
      return <>{!isLoading && alunos.length === 0 && <p>Nenhum aluno.</p>}</>;`;
    expect(vaziosSemErro(sem)).toEqual(["alunos"]);
    const com = `const { data: alunos = [], isLoading, error: erroAlunos } = useQuery({ queryKey: ["a"] });
      return <>{erroAlunos && <ErroAoCarregar />}{!isLoading && alunos.length === 0 && <p>Nenhum aluno.</p>}</>;`;
    expect(vaziosSemErro(com)).toEqual([]);
    // Tomar o erro e não usar não conta.
    const tomaENaoUsa = `const { data: treino, error } = useQuery({ queryKey: ["t"] });
      return <>{!isLoading && !treino && <p>Nenhum treino.</p>}</>;`;
    expect(vaziosSemErro(tomaENaoUsa)).toEqual(["treino"]);
    // Sumir sem dizer "nenhum" não é estado vazio.
    expect(vaziosSemErro(`const { data: avisos = [] } = useQuery({ queryKey: ["c"] });\n  if (!avisos.length) return null;`)).toEqual([]);
    // O nome de outro objeto (`dieta.refeicoes`) não é o dado da consulta.
    expect(vaziosSemErro(`const { data: refeicoes = [] } = useQuery({ queryKey: ["r"] });\n  if (dieta.refeicoes.length === 0) throw x;`)).toEqual([]);
  });

  it("o detector detecta o vazio de uma lista que sai da consulta (frente B, 07/10/2026)", () => {
    // A lista filtrada: com a consulta falhando, ela sai vazia e diz "Nenhum".
    const filtrada = `const { data: dados = [], isLoading } = useQuery({ queryKey: ["d"] });
      const filtrados = dados.filter((d) => d.ativo);
      return <>{!isLoading && filtrados.length === 0 && <p>Nenhum resultado.</p>}</>;`;
    expect(vaziosSemErro(filtrada)).toEqual(["dados"]);
    // Com o erro da consulta tratado, passa.
    const tratada = `const { data: dados = [], error: erroDados } = useQuery({ queryKey: ["d"] });
      const filtrados = dados.filter((d) => d.ativo);
      return <>{erroDados && dados.length === 0 ? <ErroAoCarregar /> : filtrados.length === 0 && <p>Nenhum.</p>}</>;`;
    expect(vaziosSemErro(tratada)).toEqual([]);
    // Por useMemo, por `?? []`, por espalhamento e de uma derivada para outra.
    const encadeada = `const { data } = useQuery({ queryKey: ["e"] });
      const lista = useMemo(() => (data ?? []).map((x) => x.nome), [data]);
      const ordenados = [...lista].sort();
      const visiveis = ordenados.slice(0, 10);
      return <>{!visiveis.length && <p>Nenhum.</p>}</>;`;
    expect(vaziosSemErro(encadeada)).toEqual(["data"]);
    // Com o `?.` também.
    expect(
      vaziosSemErro(`const { data: itens } = useQuery({ queryKey: ["i"] });
      const abertos = itens?.filter((i) => i.aberto) ?? [];
      return <>{abertos.length === 0 && <p>Nenhum aberto.</p>}</>;`),
    ).toEqual(["itens"]);
    // Um item achado na lista não é uma lista: "precisa autorizar" não é estado vazio.
    expect(
      vaziosSemErro(`const { data: consentimentos = [] } = useQuery({ queryKey: ["c"] });
      const vigente = consentimentos.find((c) => !c.revogado_em);
      return <>{!vigente && <p>O aluno precisa autorizar.</p>}</>;`),
    ).toEqual([]);
    // Nome que só cita a consulta, sem fazer lista dela, também não entra.
    expect(
      vaziosSemErro(`const { data: alunos = [] } = useQuery({ queryKey: ["a"] });
      const salvar = useMutation({ mutationFn: () => alunos });
      return <>{!salvar.isPending && <p>Pronto.</p>}</>;`),
    ).toEqual([]);
  });

  it("toda tela com estado vazio trata o erro da mesma consulta", () => {
    expect(telas.length).toBeGreaterThan(100);
    const violacoes = telas
      .filter((t) => !PENDENTES[t.nome] && !NAO_E_ESTADO_VAZIO[t.nome])
      .flatMap((t) => vaziosSemErro(t.codigo).map((dado) => `${t.nome} (${dado})`));
    expect(
      violacoes,
      'Tome o `error` do useQuery e mostre <ErroAoCarregar> de "@/components/ErroAoCarregar" no lugar do estado vazio.',
    ).toEqual([]);
  });

  it("toda pendência e toda exceção listada ainda existe", () => {
    // Tela consertada sai da lista: senão ela vira passe livre para a próxima mudança.
    const consertadas = [...Object.keys(PENDENTES), ...Object.keys(NAO_E_ESTADO_VAZIO)].filter((nome) => {
      const tela = telas.find((t) => t.nome === nome);
      return !tela || vaziosSemErro(tela.codigo).length === 0;
    });
    expect(consertadas, "tire de PENDENTES").toEqual([]);
  });
});
