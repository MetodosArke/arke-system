import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { dividir, regrasVigentes, textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";
import { semComentarios } from "../../scripts/migracao/rotinas.mjs";

/**
 * Trava de 16/10/2026: a dor e o esforço do fim do treino ficam só com quem
 * atende a saúde (20261452010000 e a pós-deploy 20261453010000).
 *
 * No fim do treino o aluno responde o esforço (1 a 10) e como se sentiu, com
 * "Senti dor". As respostas moravam em `registro_treino`, que a recepção lê
 * (`is_org_staff`), e o carimbo da progressão suspensa por dor em `alunos`,
 * que ela também lê. Coluna não tem regra própria no RLS: o dado de saúde
 * mora em tabela à parte, com a leitura de `atende_saude`.
 *
 * Falha se:
 * - `sensacao` ou `esforco_percebido` voltarem a uma tabela cuja leitura usa
 *   `is_org_staff` (ou sem `atende_saude`), ou se a progressão suspensa
 *   voltar a `alunos`;
 * - uma função do banco voltar a ler esses campos de `registro_treino`, ou a
 *   gravar o carimbo em `alunos`; o gatilho da dor sair do bem-estar; a
 *   jornada voltar a dizer à recepção que a parada é por dor;
 * - o app, uma edge function ou um roteiro voltar a ler ou gravar esses campos
 *   em `registro_treino`, ou a progressão suspensa em `alunos`.
 */
const RAIZ = join(__dirname, "..", "..");
const textos = textosDaReconstrucao().map((t: string) => semComentarios(t.replace(/\r\n/g, "\n")).toLowerCase());

const CAMPOS = ["sensacao", "esforco_percebido"];
const CAMPOS_RE = String.raw`(?:sensacao|esforco_percebido)`;

// ── O banco ────────────────────────────────────────────────────────────────

/** As tabelas de `public` com cada coluna, depois de aplicar os textos na ordem. */
export function tabelasComColuna(sqls: string[], coluna: string): string[] {
  const tabelas = new Set<string>();
  for (const sql of sqls) {
    const re = new RegExp(
      String.raw`create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);|alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)\s+([^;]*);|drop table (?:if exists )?(?:public\.)?(\w+)`,
      "g",
    );
    for (const m of sql.matchAll(re)) {
      if (m[1]) {
        if (new RegExp(String.raw`(?:^|[(,\n])\s*${coluna}\s`).test(m[2])) tabelas.add(m[1]);
      } else if (m[3]) {
        if (new RegExp(String.raw`\badd column (?:if not exists )?${coluna}\b`).test(m[4])) tabelas.add(m[3]);
        if (new RegExp(String.raw`\bdrop column (?:if exists )?${coluna}\b`).test(m[4])) tabelas.delete(m[3]);
      } else if (m[5]) {
        tabelas.delete(m[5]);
      }
    }
  }
  return [...tabelas].sort();
}

/** Os termos (ligados por OU) das regras de leitura vigentes da tabela. */
function termosDaLeitura(tabela: string, sqls: string[] = textos): string[] {
  const leitura = [...regrasVigentes(sqls, `public.${tabela}`)].filter(
    ([, r]) => !r.restritiva && (r.comando === "select" || r.comando === "all"),
  );
  return leitura.flatMap(([, r]) => dividir(r.using, "or"));
}

/** Os problemas de leitura das tabelas com os campos da saúde do fim do treino. */
export function leiturasComRecepcao(sqls: string[]): string[] {
  const problemas: string[] = [];
  const tabelas = new Set([...CAMPOS.flatMap((c) => tabelasComColuna(sqls, c)), "aluno_progressao_bloqueada"]);
  for (const tabela of tabelas) {
    const termos = termosDaLeitura(tabela, sqls);
    if (termos.some((t) => /is_org_staff/.test(t))) problemas.push(`${tabela}: a leitura usa is_org_staff (a recepção lê)`);
    if (!termos.some((t) => /^atende_saude\(organization_id\)$/.test(t))) problemas.push(`${tabela}: a leitura não é de quem atende a saúde`);
  }
  return problemas;
}

/** A última definição de cada função de `public` que não foi apagada, pelo nome. */
export function funcoesVigentes(sqls: string[]): Map<string, string> {
  const funcoes = new Map<string, string>();
  for (const sql of sqls) {
    const re = /create (?:or replace )?function public\.(\w+)\s*\(|drop function (?:if exists )?public\.(\w+)/g;
    for (const m of sql.matchAll(re)) {
      if (m[2]) {
        funcoes.delete(m[2]);
        continue;
      }
      const inicio = m.index ?? 0;
      const abre = /\$(\w*)\$/.exec(sql.slice(inicio));
      if (!abre) continue;
      const corpoDesde = inicio + abre.index + abre[0].length;
      const fecha = sql.indexOf(abre[0], corpoDesde);
      funcoes.set(m[1], sql.slice(inicio, fecha < 0 ? sql.length : fecha + abre[0].length));
    }
  }
  return funcoes;
}

/** Os apelidos que o corpo dá a uma tabela: `from public.registro_treino rt` dá `rt`. */
function apelidos(corpo: string, tabela: string): string[] {
  const nomes = [...corpo.matchAll(new RegExp(String.raw`\b(?:public\.)?${tabela}\s+(?:as\s+)?(\w+)`, "g"))].map((m) => m[1]);
  // `v_aluno public.alunos%rowtype` também é a linha da tabela.
  nomes.push(...[...corpo.matchAll(new RegExp(String.raw`(\w+)\s+(?:public\.)?${tabela}%rowtype`, "g"))].map((m) => m[1]));
  return [...new Set(nomes)];
}

/** As funções vigentes que leem o esforço ou a sensação de `registro_treino`, ou mexem no carimbo de `alunos`. */
export function funcoesNoLugarAntigo(sqls: string[]): string[] {
  const problemas: string[] = [];
  for (const [nome, corpo] of funcoesVigentes(sqls)) {
    const doTreino = apelidos(corpo, "registro_treino").filter((a) => !/^(where|on|join|left|set|returning|using|for)$/.test(a));
    for (const a of [...doTreino, "registro_treino"]) {
      if (new RegExp(String.raw`\b${a}\.${CAMPOS_RE}\b`).test(corpo)) problemas.push(`${nome}: lê ${a}.<campo> de registro_treino`);
    }
    const doAluno = apelidos(corpo, "alunos").filter((a) => !/^(where|on|join|left|set|returning|using|for)$/.test(a));
    for (const a of [...doAluno, "alunos"]) {
      if (new RegExp(String.raw`\b${a}\.progressao_bloqueada_(?:em|motivo)\b`).test(corpo)) problemas.push(`${nome}: lê o carimbo em alunos (${a})`);
    }
    if (/\bprogressao_bloqueada_(?:em|motivo)\s*=/.test(corpo)) problemas.push(`${nome}: grava o carimbo em alunos`);
  }
  return problemas.sort();
}

/** As tabelas em que cada gatilho vivo chama a função, depois de aplicar os textos. */
function gatilhosDaFuncao(sqls: string[], funcao: string): string[] {
  const vivos = new Map<string, string>();
  for (const sql of sqls) {
    const re = /create trigger (\w+)\s+[\s\S]*?\bon (?:public\.)?(\w+)\s+[\s\S]*?execute (?:function|procedure) (?:public\.)?(\w+)\(|drop trigger (?:if exists )?(\w+) on (?:public\.)?(\w+)/g;
    for (const m of sql.matchAll(re)) {
      if (m[1]) vivos.set(`${m[1]}@${m[2]}`, m[3]);
      else vivos.delete(`${m[4]}@${m[5]}`);
    }
  }
  return [...vivos].filter(([, f]) => f === funcao).map(([chave]) => chave.split("@")[1]).sort();
}

describe("a dor e o esforço do fim do treino, no banco", () => {
  it("só o bem-estar guarda a sensação e o esforço; alunos não guarda mais a progressão suspensa", () => {
    for (const c of CAMPOS) expect(tabelasComColuna(textos, c), c).toEqual(["registro_treino_bem_estar"]);
    expect(tabelasComColuna(textos, "progressao_bloqueada_em")).toEqual([]);
    expect(tabelasComColuna(textos, "bloqueada_em")).toEqual(["aluno_progressao_bloqueada"]);
  });

  it("quem lê é quem atende a saúde, e não a recepção", () => {
    expect(leiturasComRecepcao(textos)).toEqual([]);
  });

  it("nenhuma função lê do lugar antigo nem grava o carimbo em alunos", () => {
    expect(funcoesNoLugarAntigo(textos)).toEqual([]);
  });

  it("o \"Senti dor\" abre a tarefa e suspende a progressão pelo gatilho do bem-estar", () => {
    expect(gatilhosDaFuncao(textos, "bloquear_progressao_por_dor")).toEqual(["registro_treino_bem_estar"]);
    // A cópia da janela saiu com as colunas antigas.
    expect(gatilhosDaFuncao(textos, "copiar_dor_e_esforco_da_janela")).toEqual([]);
    const corpo = funcoesVigentes(textos).get("bloquear_progressao_por_dor") ?? "";
    expect(corpo).toMatch(/insert into public\.aluno_progressao_bloqueada/);
    expect(corpo).toMatch(/insert into public\.tarefas[\s\S]*'critica'[\s\S]*'dor_treino:' \|\| new\.registro_treino_id::text,\s*'dor'/);
    expect(corpo).toMatch(/on conflict \(organization_id, origem_evento\) do nothing/);
  });

  it("a jornada não diz à recepção que a parada é por dor", () => {
    const corpo = funcoesVigentes(textos).get("get_jornada_aluno") ?? "";
    expect(corpo).toMatch(/when v_motivo = 'dor' and not v_ve_saude then null/);
    const veSaude = corpo.match(/v_ve_saude := ([\s\S]*?);/)?.[1] ?? "";
    expect(veSaude).toMatch(/atende_saude\(v_org\)/);
    expect(veSaude).not.toMatch(/is_org_staff/);
    // Liberar é decidir sobre o relato de dor: quem atende a saúde, não a recepção.
    expect(funcoesVigentes(textos).get("liberar_progressao_aluno") ?? "").not.toMatch(/is_org_staff/);
  });

  it("os detectores acham a volta ao lugar antigo (a trava trava)", () => {
    const volta = [...textos, "alter table public.registro_treino add column if not exists sensacao text;"];
    expect(tabelasComColuna(volta, "sensacao")).toEqual(["registro_treino", "registro_treino_bem_estar"]);
    expect(leiturasComRecepcao(volta).join("\n")).toMatch(/registro_treino: a leitura usa is_org_staff/);
    const funcao = `create or replace function public.ficha_velha(_id uuid) returns jsonb language sql as $$
      select jsonb_agg(rt.sensacao) from public.registro_treino rt where rt.aluno_id = _id $$;`;
    expect(funcoesNoLugarAntigo([...textos, funcao])).toEqual(["ficha_velha: lê rt.<campo> de registro_treino"]);
    const carimbo = `create or replace function public.carimbo_velho(_id uuid) returns void language plpgsql as $$
      begin update public.alunos set progressao_bloqueada_em = now() where id = _id; end $$;`;
    expect(funcoesNoLugarAntigo([...textos, carimbo])).toEqual(["carimbo_velho: grava o carimbo em alunos"]);
    const gatilho = "create trigger trg_bloquear_progressao_por_dor after insert on public.registro_treino for each row execute function public.bloquear_progressao_por_dor();";
    expect(gatilhosDaFuncao([...textos, gatilho], "bloquear_progressao_por_dor")).toEqual(["registro_treino", "registro_treino_bem_estar"]);
  });
});

// ── O app, as edge functions e os roteiros ──────────────────────────────────

function arquivos(dir: string, extensoes: RegExp, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules") continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, extensoes, achados);
    else if (extensoes.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

/** O texto de cada corrente que começa em `.from("<tabela>")`, com os argumentos dos métodos. */
export function correntes(codigo: string, tabela: string): string[] {
  const achadas: string[] = [];
  for (const m of codigo.matchAll(new RegExp(String.raw`\.from\(\s*["'\`]${tabela}["'\`]\s*\)`, "g"))) {
    let i = (m.index ?? 0) + m[0].length;
    for (;;) {
      const proximo = /^\s*\.\s*\w+\s*\(/.exec(codigo.slice(i));
      if (!proximo) break;
      i += proximo[0].length;
      for (let nivel = 1; i < codigo.length && nivel > 0; i++) {
        if (codigo[i] === "(") nivel++;
        else if (codigo[i] === ")") nivel--;
      }
    }
    achadas.push(codigo.slice(m.index ?? 0, i));
  }
  return achadas;
}

/** O que o código lê ou grava da saúde do fim do treino no lugar antigo. */
export function usosNoLugarAntigo(codigo: string): string[] {
  const usos: string[] = [];
  for (const c of correntes(codigo, "registro_treino")) {
    // O embutido do bem-estar é o lugar certo.
    const fora = c.replace(/registro_treino_bem_estar(?:!\w+)?\([^()]*\)/g, "");
    for (const campo of CAMPOS) if (new RegExp(String.raw`\b${campo}\b`).test(fora)) usos.push(`registro_treino.${campo}`);
  }
  for (const c of correntes(codigo, "alunos")) {
    if (/\bprogressao_bloqueada_em\b/.test(c)) usos.push("alunos.progressao_bloqueada_em");
    if (/\bprogressao_bloqueada_motivo\b/.test(c)) usos.push("alunos.progressao_bloqueada_motivo");
  }
  // Os roteiros escrevem SQL: a lista de colunas do insert.
  for (const m of codigo.matchAll(/insert into (?:public\.)?registro_treino\s*\(([^)]*)\)/gi)) {
    for (const campo of CAMPOS) if (new RegExp(String.raw`\b${campo}\b`).test(m[1])) usos.push(`insert em registro_treino.${campo}`);
  }
  return usos;
}

/**
 * Quem ainda lê `alunos.progressao_bloqueada_motivo`, e por quê. A coluna
 * está vazia desde 20261452010000 e ninguém grava (a guarda do banco confere).
 */
const LEEM_O_MOTIVO_VAZIO: Record<string, string> = {
  "supabase/functions/mentor-sugerir-resposta/index.ts":
    "o Sentinela está congelado; pede a coluna, que fica vazia até a correção dele (e sem ela a consulta daria erro)",
};

describe("a dor e o esforço do fim do treino, no código", () => {
  it("o app, as edge functions e os roteiros não usam o lugar antigo", () => {
    const fontes = [
      ...arquivos(join(RAIZ, "src"), /\.(ts|tsx)$/),
      ...arquivos(join(RAIZ, "supabase", "functions"), /\.ts$/),
      ...arquivos(join(RAIZ, "scripts"), /\.(mjs|js|sql)$/),
    ].filter((f) => !f.includes(join("integrations", "supabase")));
    expect(fontes.length, "o detector acha os arquivos").toBeGreaterThan(300);
    const problemas: string[] = [];
    for (const f of fontes) {
      const rel = relative(RAIZ, f).replace(/\\/g, "/");
      const usos = usosNoLugarAntigo(readFileSync(f, "utf8")).filter(
        (u) => !(u === "alunos.progressao_bloqueada_motivo" && rel in LEEM_O_MOTIVO_VAZIO),
      );
      problemas.push(...usos.map((u) => `${rel}: ${u}`));
    }
    expect(problemas).toEqual([]);
  });

  it("a sugestão de progressão lê as respostas do bem-estar e a suspensão da tabela própria", () => {
    const tela = readFileSync(join(RAIZ, "src", "components", "prescricao", "SugestaoProgressao.tsx"), "utf8");
    expect(tela).toMatch(/registro_treino_bem_estar\(esforco_percebido, sensacao, sono, energia\)/);
    expect(tela).toMatch(/\.from\("aluno_progressao_bloqueada"\)\.select\("bloqueada_em"\)/);
  });

  it("o detector acha a leitura e a gravação no lugar antigo (a trava trava)", () => {
    expect(usosNoLugarAntigo(`supabase.from("registro_treino").select("data, esforco_percebido").eq("aluno_id", id)`)).toEqual([
      "registro_treino.esforco_percebido",
    ]);
    expect(usosNoLugarAntigo(`supabase.from("registro_treino").update({ concluido: true, sensacao: r.sensacao }).eq("id", x)`)).toEqual([
      "registro_treino.sensacao",
    ]);
    expect(usosNoLugarAntigo(`supabase.from("registro_treino").select("data, registro_treino_bem_estar(esforco_percebido, sensacao)")`)).toEqual([]);
    expect(usosNoLugarAntigo(`supabase.from("alunos").select("id, progressao_bloqueada_em")`)).toEqual(["alunos.progressao_bloqueada_em"]);
    expect(usosNoLugarAntigo("insert into public.registro_treino (aluno_id, data, sensacao) values")).toEqual(["insert em registro_treino.sensacao"]);
  });
});
