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

/**
 * Consultas com estado vazio e sem o erro tratado, num arquivo. Cada
 * `const { data: nome, ... } = useQuery(...)`: há estado vazio quando o
 * arquivo testa o nome como vazio (`nome.length === 0`, `!nome.length`,
 * `!nome &&`...) fora de um `if (...) return null`; o erro está tratado
 * quando a desestruturação toma `error` ou `isError` e o nome aparece de novo.
 */
export function vaziosSemErro(codigo: string): string[] {
  const achados: string[] = [];
  for (const m of codigo.matchAll(/const\s*\{([^{}]*)\}\s*=\s*useQuery\b/g)) {
    const campos = m[1];
    const dado = campos.match(/\bdata\s*:\s*(\w+)/)?.[1] ?? (/\bdata\b/.test(campos) ? "data" : null);
    if (!dado) continue;
    const n = `(?<![\\w.$])${dado}`;
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
 * daqui. O motivo diz por que ainda não, ou por que não é um estado vazio.
 */
const PENDENTES: Record<string, string> = {
  "components/admin/AlunoPerfilSheet.tsx": "ficha do aluno: fica para a próxima rodada (outra frente mexia nela nesta)",
  "components/admin/CompeticoesPainel.tsx": "painel de competições da gestão",
  "components/admin/FuncionarioPerfilSheet.tsx": "horários do funcionário",
  "components/admin/onboarding/EtapaPlanos.tsx": "implantação: o passo some quando a leitura falha",
  "components/admin/onboarding/EtapaRecebimentos.tsx": "implantação: situação da conta Asaas",
  "components/jornada/CompromissoTab.tsx": "metas salvas do compromisso semanal",
  "components/jornada/ObjetivosTab.tsx": "objetivo atual do aluno",
  "components/legal/AceiteDocumentosGate.tsx":
    "não é estado vazio: com a leitura falhando, o aceite não tranca o app (falha aberta de propósito, com o erro no log)",
  "components/superadmin/FilaChamadosMentor.tsx": "Visão Master",
  "components/superadmin/OperacaoMentor.tsx": "Visão Master",
  "components/superadmin/OrganizacaoPerfilSheet.tsx": "Visão Master",
  "pages/admin/AdminDashboard.tsx": "anamnese no painel da equipe",
  "pages/admin/AdminOrganizacao.tsx": "assinaturas da organização",
  "pages/superadmin/SuperAdminConfiguracoes.tsx": "Visão Master",
  "pages/superadmin/SuperAdminDashboard.tsx": "Visão Master",
  "pages/superadmin/SuperAdminMentoria.tsx": "Visão Master",
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

  it("toda tela com estado vazio trata o erro da mesma consulta", () => {
    expect(telas.length).toBeGreaterThan(100);
    const violacoes = telas
      .filter((t) => !PENDENTES[t.nome])
      .flatMap((t) => vaziosSemErro(t.codigo).map((dado) => `${t.nome} (${dado})`));
    expect(
      violacoes,
      'Tome o `error` do useQuery e mostre <ErroAoCarregar> de "@/components/ErroAoCarregar" no lugar do estado vazio.',
    ).toEqual([]);
  });

  it("toda pendência listada ainda existe", () => {
    // Tela consertada sai da lista: senão ela vira passe livre para a próxima mudança.
    const consertadas = Object.keys(PENDENTES).filter((nome) => {
      const tela = telas.find((t) => t.nome === nome);
      return !tela || vaziosSemErro(tela.codigo).length === 0;
    });
    expect(consertadas, "tire de PENDENTES").toEqual([]);
  });
});
