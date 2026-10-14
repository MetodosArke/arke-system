import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";
import { lerFalhaDeLogin } from "../../supabase/functions/registrar-falha-login/fluxo";
import { textoCsv } from "./exportarPlanilha";

/**
 * A esteira de auditoria do contrato BaaS com o Asaas (14/10/2026, migration
 * `20261445010000`). O contrato multa a entrega atrasada ou incompleta de
 * "informações, logs, evidências"; a revisão de segurança de 13/10 achou duas
 * lacunas:
 *
 * 1. a mudança em `plataforma_config` e `plataforma_textos` (a taxa, os
 *    interruptores, o link da agenda) não ia para a trilha. Agora um gatilho
 *    genérico grava toda inclusão, alteração e exclusão, de toda chave. Esta
 *    guarda falha se uma chave deixar de cair na trilha: o gatilho sai de uma
 *    das tabelas, é desligado, ou a função passa a tratar uma chave à parte;
 * 2. a tentativa de entrar que falha ficava só nos logs do Supabase. Agora vai
 *    para `tentativas_login_falhas` por 6 meses, sem senha, com o IP e (quando
 *    a conta não existe) o e-mail só como hash.
 *
 * A prova no banco, em transação desfeita, está no registro
 * (`docs/registro/seguranca-e-acesso.md`, 14/10/2026).
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), "utf8");
const textos = textosDaReconstrucao();
const TABELAS = ["plataforma_config", "plataforma_textos"] as const;

function definicaoVigente(sqls: string[], nome: string): string {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of sqls) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima;
}

const numaLinha = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();

/** As chaves que as migrations criam nas duas tabelas, e as que têm faixa. */
function chavesDasMigrations(sqls: string[]): string[] {
  const chaves = new Set<string>();
  for (const t of sqls) {
    for (const m of t.matchAll(/insert into public\.plataforma_(?:config|textos)\s*\(chave[^)]*\)\s*values([\s\S]*?)(?:on conflict|;)/gi)) {
      for (const k of m[1].matchAll(/\(\s*'(\w+)'/g)) chaves.add(k[1]);
    }
  }
  for (const k of definicaoVigente(sqls, "faixa_plataforma_config").matchAll(/\('(\w+)',/g)) chaves.add(k[1]);
  return [...chaves].sort();
}

/** O que deixaria uma mudança de configuração fora da trilha. */
function problemasDaTrilha(sqls: string[]): string[] {
  const problemas: string[] = [];
  const tudo = sqls.join("\n").toLowerCase();
  const ultimo = (re: RegExp) => Math.max(-1, ...[...tudo.matchAll(re)].map((m) => m.index ?? -1));
  for (const tabela of TABELAS) {
    const gatilho = `trg_auditar_${tabela}`;
    const criado = ultimo(
      new RegExp(
        String.raw`create trigger ${gatilho}\s+after insert or update or delete on public\.${tabela}\s+for each row execute function public\.auditar_configuracao_plataforma\(\)`,
        "g",
      ),
    );
    const retirado = Math.max(
      ultimo(new RegExp(String.raw`drop trigger (?:if exists )?${gatilho}\b`, "g")),
      ultimo(new RegExp(String.raw`alter table (?:only )?(?:public\.)?${tabela} disable trigger`, "g")),
    );
    if (criado < 0) problemas.push(`${tabela}: sem o gatilho da trilha (insert, update e delete, por linha)`);
    else if (retirado > criado) problemas.push(`${tabela}: o gatilho da trilha sai ou é desligado depois de criado`);
  }

  const funcao = numaLinha(definicaoVigente(sqls, "auditar_configuracao_plataforma"));
  if (!funcao) return [...problemas, "auditar_configuracao_plataforma não achada"];
  // Sem security definer, a gravação na trilha (sem regra de escrita) falha.
  if (!/security definer/.test(funcao)) problemas.push("a função do gatilho não é security definer");
  if (!/perform public\.registrar_auditoria\( auth\.uid\(\), 'configuracao\.alterada', tg_table_name,/.test(funcao)) {
    problemas.push("a função não grava quem mudou (auth.uid()) na trilha");
  }
  // Toda chave: a função não olha para o nome da chave.
  for (const chave of chavesDasMigrations(sqls)) if (funcao.includes(`'${chave}'`)) problemas.push(`a trilha trata a chave ${chave} à parte`);
  if (/(new|old)\.chave\s*(=|<>|!=|\bin\b|\blike\b|~)/.test(funcao)) problemas.push("a trilha filtra pelo nome da chave");
  // A única saída antes do registro é a de nada ter mudado.
  const antes = funcao.slice(0, funcao.indexOf("registrar_auditoria"));
  const saidas = antes.match(/return /g)?.length ?? 0;
  if (saidas !== 1 || !/if new\.chave is not distinct from old\.chave and new\.valor is not distinct from old\.valor then return null; end if;/.test(antes)) {
    problemas.push("a função sai antes de registrar sem ser por falta de mudança");
  }
  if (!/revoke execute on function public\.auditar_configuracao_plataforma\(\) from public, anon, authenticated;/.test(tudo)) {
    problemas.push("a função do gatilho não revoga o EXECUTE do PUBLIC");
  }
  return problemas;
}

describe("toda mudança de configuração da plataforma cai na trilha de auditoria", () => {
  it("o leitor acha as chaves das migrations", () => {
    const chaves = chavesDasMigrations(textos);
    expect(chaves.length).toBeGreaterThan(20);
    expect(chaves).toEqual(expect.arrayContaining(["taxa_processamento_percentual", "vigia_ativo", "agenda_demonstracao_url", "gateway_versao_minima"]));
  });

  it("as duas tabelas têm o gatilho, e a função grava toda chave, com quem mudou", () => {
    expect(problemasDaTrilha(textos)).toEqual([]);
  });

  it("a Auditoria da Visão Master tem rótulo para a mudança de configuração e para a exportação", () => {
    const tela = ler("src", "pages", "superadmin", "SuperAdminAuditoria.tsx");
    expect(tela).toMatch(/"configuracao\.alterada": \{ label: "/);
    expect(tela).toMatch(/"auditoria\.exportada": \{ label: "/);
  });

  it("o leitor acha a chave que ficou de fora (a trava trava)", () => {
    const pulaChave = `create or replace function public.auditar_configuracao_plataforma()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.chave = 'vigia_ativo' then return null; end if;
  perform public.registrar_auditoria(auth.uid(), 'configuracao.alterada', tg_table_name, null, null, '{}'::jsonb);
  return null;
end;
$$;`;
    expect(problemasDaTrilha([...textos, pulaChave]).join("\n")).toMatch(/vigia_ativo/);
    expect(problemasDaTrilha([...textos, "drop trigger if exists trg_auditar_plataforma_config on public.plataforma_config;"])).toEqual([
      "plataforma_config: o gatilho da trilha sai ou é desligado depois de criado",
    ]);
    expect(problemasDaTrilha([...textos, "alter table public.plataforma_textos disable trigger all;"])).toEqual([
      "plataforma_textos: o gatilho da trilha sai ou é desligado depois de criado",
    ]);
  });
});

describe("a tentativa de entrar que falha fica 6 meses, sem senha e sem IP nem e-mail em claro", () => {
  const sql = textos.join("\n");

  it("a tabela não tem coluna de IP, de e-mail nem de senha em claro", () => {
    const tabela = /create table if not exists public\.tentativas_login_falhas \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
    expect(tabela, "a tabela foi achada").toMatch(/ip_hash text/);
    expect(numaLinha(tabela)).not.toMatch(/\b(ip inet|ip text|email text|senha|password)\b/);
  });

  it("a rotina dos registros de acesso apaga as tentativas com mais de 6 meses", () => {
    const limpeza = numaLinha(definicaoVigente(textos, "limpar_registros_acesso_aplicacao"));
    expect(limpeza).toMatch(/delete from public\.tentativas_login_falhas t where t\.em < now\(\) - interval '6 months'/);
  });

  it("a tela de entrar manda o e-mail e o código do erro, nunca a senha", () => {
    const auth = ler("src", "contexts", "AuthContext.tsx");
    const chamada = /functions\.invoke\("registrar-falha-login", \{ body: \{ ([^}]*) \} \}\)/.exec(auth);
    expect(chamada?.[1]).toBe("email, motivo: error.code");
  });

  it("a função guarda o IP e o e-mail só como hash, e não os escreve no log", () => {
    const funcao = ler("supabase", "functions", "registrar-falha-login", "index.ts");
    expect(funcao).toMatch(/_email_hash: await hashComPimenta\(`email:\$\{falha\.email\}`, serviceRoleKey\)/);
    expect(funcao).toMatch(/const ipHash = ip \? await hashComPimenta\(ip, serviceRoleKey\) : null;/);
    const logs = funcao.match(/console\.\w+\([^;]*;/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) expect(log).not.toMatch(/email|ip\b/i);
  });

  it("o pedido: o e-mail como o Auth guarda, e o código do erro sem texto livre", () => {
    expect(lerFalhaDeLogin({ email: "  Ana@Exemplo.com ", motivo: "invalid_credentials" })).toEqual({
      email: "ana@exemplo.com",
      motivo: "invalid_credentials",
    });
    expect(lerFalhaDeLogin({ email: "ana@exemplo.com", motivo: "Senha errada: 1234" })?.motivo).toBe("outro");
    expect(lerFalhaDeLogin({ email: "sem-arroba", motivo: "x" })).toBeNull();
    expect(lerFalhaDeLogin(null)).toBeNull();
  });
});

describe("o CSV da exportação", () => {
  it("texto que o Excel leria como fórmula vai como texto; número negativo e valor em reais, não", () => {
    expect(textoCsv([["=HYPERLINK(\"x\")", "+1+1", "@SOMA(A1)", "-2+3", "-R$ 5,00", "-3,5%", -4, "a;b", null]])).toBe(
      `"'=HYPERLINK(""x"")";"'+1+1";"'@SOMA(A1)";"'-2+3";"-R$ 5,00";"-3,5%";"-4";"a;b";""`,
    );
  });
});
