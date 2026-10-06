import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Toda gravação (`.update`) do app confere a linha que gravou: passa por
 * `exigirGravacao` ou pede as linhas de volta (`.select`) e acusa
 * `NADA_GRAVADO` quando não vem nenhuma.
 *
 * O PostgREST responde sucesso quando a regra de acesso recusa a linha. Foi
 * esse silêncio que deixou o primeiro acesso do aluno nulo para todo mundo,
 * que fez a meta semanal nunca gravar e que deixou a ArkeFit "alterando"
 * tarefa sem alterar. Até 05/10/2026, 60 das 62 gravações do app não
 * conferiam.
 *
 * Exceções, por arquivo e tabela, cada uma com o motivo: onde zero linhas é
 * o resultado normal.
 */
const RAIZ = join(__dirname, "..");

const EXCECOES: Record<string, string> = {
  "components/chat/ChatPanel.tsx|mensagens_treino": "marca as mensagens como lidas; sem mensagem nova, zero linhas é o normal",
  "components/chat/ChatPanel.tsx|mensagens_dieta": "marca as mensagens como lidas; sem mensagem nova, zero linhas é o normal",
  "components/chat/ChatMentor.tsx|mensagens_mentor": "marca as mensagens como lidas; sem mensagem nova, zero linhas é o normal",
  "components/chat/ChatMentor.tsx|sentinela_sugestoes":
    "desfecho da sugestão, que é medida do Sentinela; a resposta já saiu, e falhar aqui não pode travar o mentor",
  "components/sentinela/SentinelaAnamnese.tsx|aluno_consentimento_ia":
    "revoga a autorização de versão anterior antes de gravar a nova; pode não haver nenhuma (a revogação pelo botão confere)",
  "pages/admin/AdminImportarAlunos.tsx|importacoes_alunos_linhas":
    "volta as linhas com erro para pendentes antes de tentar de novo; pode não haver nenhuma (o andamento de cada linha confere)",
  "pages/app/Onboarding.tsx|anamnese_acolhimento":
    "completa só a anamnese ainda aberta; com ela já concluída, zero linhas é o normal e o envio avisa que nada mudou (lib/acolhimento.ts)",
};

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** Onde termina a cadeia que começa em `inicio`: no `;` ou no parêntese que fecha a chamada em volta. */
function fimDaCadeia(fonte: string, inicio: number): number {
  let nivel = 0;
  let aspas: string | null = null;
  for (let i = inicio; i < fonte.length; i++) {
    const c = fonte[i];
    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (fonte.startsWith("//", i)) {
      i = fonte.indexOf("\n", i);
      if (i < 0) return fonte.length;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") aspas = c;
    else if (c === "(" || c === "[" || c === "{") nivel++;
    else if (c === ")" || c === "]" || c === "}") {
      nivel--;
      if (nivel < 0) return i;
    } else if (c === ";" && nivel === 0) return i;
  }
  return fonte.length;
}

function gravacoesSemConferencia(): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const arquivo of arquivos(RAIZ)) {
    const rel = relative(RAIZ, arquivo).split("\\").join("/");
    if (rel.startsWith("integrations/") || rel === "lib/gravacao.ts") continue;
    const fonte = readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n");
    for (const m of fonte.matchAll(/\.from\(\s*"(\w+)"\s*\)/g)) {
      const antes = fonte.slice(Math.max(0, m.index! - 160), m.index!);
      if (/storage\s*$/.test(antes)) continue;
      const fim = fimDaCadeia(fonte, m.index!);
      const cadeia = fonte.slice(m.index!, fim);
      if (!cadeia.includes(".update(")) continue;
      // O exigirGravacao tem de ser da mesma instrução: depois dele, nenhum `;`.
      const envolve = antes.lastIndexOf("exigirGravacao(");
      const conferida =
        (envolve >= 0 && !antes.slice(envolve).includes(";")) ||
        (cadeia.includes(".select(") && fonte.slice(fim, fim + 500).includes("NADA_GRAVADO"));
      if (conferida) continue;
      const chave = `${rel}|${m[1]}`;
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
  }
  return contagem;
}

describe("gravação que não grava não passa em silêncio", () => {
  const achadas = gravacoesSemConferencia();

  it("toda gravação confere a linha gravada, fora das exceções", () => {
    const fora = [...achadas.keys()].filter((chave) => !EXCECOES[chave]);
    expect(fora).toEqual([]);
  });

  it("cada exceção cobre uma gravação só, e ela ainda existe", () => {
    for (const chave of Object.keys(EXCECOES)) expect(achadas.get(chave), chave).toBe(1);
  });
});
