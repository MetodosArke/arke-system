import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";

/**
 * As trocas na equipe ficam na auditoria (`auditoria_acoes_sensiveis`).
 *
 * `editar-membro-equipe` troca o e-mail de login, o nome e o papel de alguém
 * da equipe. A troca do e-mail ia para a trilha desde 06/10/2026
 * (20261401010000); a do nome e a do papel, não, e a do papel tinha um
 * segundo caminho: a gestão e a ArkeFit alteram o vínculo direto pela API
 * (sobras da frente B, 07/10/2026, 20261407010000).
 *
 * A trilha guarda quem trocou e de quem pelo id, o papel de antes e o de
 * agora, e se foi a ArkeFit; nunca o e-mail nem o nome, nem o novo nem o
 * antigo: a trilha não tem prazo, e os dois já moram na conta.
 */
const FUNCAO = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "editar-membro-equipe", "index.ts"), "utf8");
const TELA = readFileSync(join(__dirname, "..", "pages", "superadmin", "SuperAdminAuditoria.tsx"), "utf8");
const textos = textosDaReconstrucao();

/** O texto da chamada `registrarAuditoria("<acao>", {...})` que vem depois de `depoisDe`, ou vazio. */
function registroDepoisDe(codigo: string, depoisDe: string, acao: string): { chamada: string; posicao: number } {
  const inicio = codigo.indexOf(depoisDe);
  if (inicio < 0) return { chamada: "", posicao: -1 };
  const posicao = codigo.indexOf(`registrarAuditoria("${acao}"`, inicio);
  if (posicao < 0) return { chamada: "", posicao: -1 };
  return { chamada: codigo.slice(posicao, codigo.indexOf("});", posicao)), posicao };
}

/** Quantas vezes a função registra a ação: uma só, depois da troca (antes dela, a trilha diria que trocou o que falhou). */
const chamadas = (codigo: string, acao: string) => codigo.split(`registrarAuditoria("${acao}"`).length - 1;

function definicaoVigente(sqls: string[], nome: string): string {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of sqls) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima;
}

describe("as trocas na equipe ficam na auditoria", () => {
  it("o registro guarda quem trocou e de quem pelo id", () => {
    const ajudante = FUNCAO.slice(FUNCAO.indexOf("const registrarAuditoria = async"));
    const corpo = ajudante.slice(0, ajudante.indexOf("};"));
    expect(corpo, "o ajudante foi achado").toMatch(/"registrar_auditoria"/);
    expect(corpo).toMatch(/_ator_user_id: callerId/);
    expect(corpo).toMatch(/_entidade: "auth\.users"/);
    expect(corpo).toMatch(/_entidade_id: targetUserId/);
  });

  it("a troca do e-mail de login vai para a trilha, sem o e-mail", () => {
    // Auditoria de prontidão, 06/10/2026 (20261401010000): trocava sem deixar registro.
    const { chamada, posicao } = registroDepoisDe(FUNCAO, "updateUserById(targetUserId", "equipe.email_alterado");
    expect(chamada, "o registro sai depois da troca").not.toBe("");
    expect(chamadas(FUNCAO, "equipe.email_alterado"), "um registro só").toBe(1);
    // Nem a variável `email` nem `novo_email`: `equipe.email_alterado` não casa (o `_` emenda a palavra).
    expect(chamada, "o e-mail não vai para a trilha").not.toMatch(/\b(novo_?)?email\b/i);
    // Dentro do `if (email)`, antes de o nome e o papel mudarem.
    expect(posicao).toBeLessThan(FUNCAO.indexOf("if (fullName)"));
  });

  it("a troca do nome vai para a trilha, sem o nome", () => {
    const { chamada, posicao } = registroDepoisDe(FUNCAO, ".update({ full_name: fullName })", "equipe.nome_alterado");
    expect(chamada, "o registro sai depois da troca").not.toBe("");
    expect(chamadas(FUNCAO, "equipe.nome_alterado"), "um registro só").toBe(1);
    expect(chamada, "o nome não vai para a trilha").not.toMatch(/fullName|full_name|profiles/);
    expect(chamada).toMatch(/mudou: "nome"/);
    // Dentro do `if (fullName)`, antes do papel.
    expect(posicao).toBeLessThan(FUNCAO.indexOf("if (role && role !== targetMembership.role)"));
  });

  it("a troca do papel vai para a trilha com o papel de antes e o de agora", () => {
    const { chamada } = registroDepoisDe(FUNCAO, ".update({ role })", "equipe.papel_alterado");
    expect(chamada, "o registro sai depois da troca").not.toBe("");
    expect(chamadas(FUNCAO, "equipe.papel_alterado"), "um registro só").toBe(1);
    expect(chamada.replace(/\s+/g, " ")).toMatch(/papel: \{ de: targetMembership\.role, para: role \}/);
    expect(chamada).not.toMatch(/fullName|full_name|\bemail\b/);
  });

  it("a troca de papel direto pela API também vai para a trilha", () => {
    const sql = textos.join("\n");
    expect(sql).toMatch(
      /create trigger trg_auditar_troca_de_papel\s+after update of role on public\.organization_members\s+for each row\s+when \(old\.role is distinct from new\.role\)\s+execute function public\.auditar_troca_de_papel\(\)/,
    );
    const funcao = definicaoVigente(textos, "auditar_troca_de_papel").replace(/\s+/g, " ");
    expect(funcao, "a função do gatilho foi achada").not.toBe("");
    expect(funcao).toMatch(/_ator uuid := auth\.uid\(\)/);
    // A troca pela função (service role, sem `auth.uid()`) é registrada pela função: aqui ela passa.
    expect(funcao).toMatch(/if _ator is null or new\.role is not distinct from old\.role then return new; end if;/);
    expect(funcao).toMatch(/registrar_auditoria\( _ator, 'equipe\.papel_alterado', 'auth\.users', new\.user_id,/);
    expect(funcao).toMatch(/'papel', jsonb_build_object\('de', old\.role, 'para', new\.role\)/);
    // Função de gatilho nasce com EXECUTE para o PUBLIC.
    expect(sql).toMatch(/revoke execute on function public\.auditar_troca_de_papel\(\) from public, anon, authenticated;/);
  });

  it("toda troca da equipe tem rótulo na Auditoria da Visão Master", () => {
    const registradas = new Set([
      ...[...FUNCAO.matchAll(/registrarAuditoria\("([\w.]+)"/g)].map((m) => m[1]),
      ...[...definicaoVigente(textos, "auditar_troca_de_papel").matchAll(/'(equipe\.\w+)'/g)].map((m) => m[1]),
    ]);
    expect([...registradas].sort()).toEqual(["equipe.email_alterado", "equipe.nome_alterado", "equipe.papel_alterado"]);
    for (const acao of registradas) expect(TELA, acao).toMatch(new RegExp(`"${acao.replace(".", "\\.")}": \\{ label: "`));
  });

  it("o leitor acha o registro que falta e o nome na trilha (a trava trava)", () => {
    const semRegistro = FUNCAO.replace(/await registrarAuditoria\("equipe\.papel_alterado", \{[\s\S]*?\}\);/, "");
    expect(registroDepoisDe(semRegistro, ".update({ role })", "equipe.papel_alterado").chamada).toBe("");
    const comNome = FUNCAO.replace('mudou: "nome",', "nome_novo: fullName,");
    expect(registroDepoisDe(comNome, ".update({ full_name: fullName })", "equipe.nome_alterado").chamada).toMatch(/fullName/);
  });
});
