import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava da decisão de 04/10/2026: em perfil simulado, só a própria pessoa
 * autoriza, retira a autorização, aceita ou assina.
 *
 * Quem recusa de verdade é o banco (`sessoes_simuladas`, gatilho
 * `trg_autorizacao_da_propria_pessoa`), e ele só sabe que a sessão é simulada
 * porque ela nasce marcada em `impersonar-perfil`. Duas coisas desfariam isso
 * sem dar erro: a simulação voltar a nascer no navegador (sessão sem marca) e
 * uma tela nova de autorização que não avisa antes, e deixa quem simula
 * clicar num botão que vai falhar.
 */
const SRC = join(__dirname, "..");
const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

// Desde 06/10/2026 (aluno menor), também a data de nascimento informada pelo
// aluno, o pedido de aceite ao responsável e a retirada desse aceite. E, da
// rodada 3 da auditoria, a retirada do consentimento de saúde e o cartão que o
// próprio aluno cadastra (a função grava pela service role).
const GRAVA_AUTORIZACAO =
  /rpc\("(consentir_biometria|revogar_consentimento_biometrico|assinar_contrato_matricula|enviar_foto_rosto|registrar_aceite|informar_data_nascimento|revogar_aceite_responsavel|revogar_consentimento_saude)"|from\("aluno_consentimento_ia"\)\s*\.\s*(insert|update)|consentimento_lgpd_aceito_em:|invoke\("responsavel-pedido"|invoke(<[^>]*>)?\(\s*"asaas-cartao-assinatura"/;

/** Telas que gravam autorização pela conta de quem está usando, e não do aluno. */
const PELA_PROPRIA_CONTA: Record<string, string> = {
  "components/admin/AcessoCatraca.tsx": "a equipe retira a digital pela conta dela, como a lei permite",
  "components/admin/ResponsavelLegalAluno.tsx":
    "a equipe retira o aceite do responsável pela conta dela, quando ele pede à academia",
};

describe("perfil simulado", () => {
  it("toda tela que grava autorização avisa em perfil simulado", () => {
    const telas = arquivos(SRC)
      .map((c) => ({ nome: relative(SRC, c).replace(/\\/g, "/"), codigo: readFileSync(c, "utf8") }))
      .filter((t) => !t.nome.startsWith("integrations/") && GRAVA_AUTORIZACAO.test(t.codigo));
    expect(telas.length, "o detector detecta").toBeGreaterThan(5);
    const sem = telas.filter((t) => !PELA_PROPRIA_CONTA[t.nome] && !/emPerfilSimulado\(/.test(t.codigo)).map((t) => t.nome);
    expect(sem, "use emPerfilSimulado() e AvisoPerfilSimulado").toEqual([]);
  });

  it("a sessão simulada nasce no servidor, marcada", () => {
    const cliente = readFileSync(join(SRC, "lib", "impersonation.ts"), "utf8");
    expect(cliente).not.toMatch(/verifyOtp\(/);
    const funcao = readFileSync(join(FUNCOES, "impersonar-perfil", "index.ts"), "utf8");
    expect(funcao).toMatch(/from\("sessoes_simuladas"\)\s*\.insert/);
    expect(funcao).not.toMatch(/return jsonResponse\(\{[^}]*token_hash/);
    // A marca vem antes da entrega da sessão.
    expect(funcao.indexOf('from("sessoes_simuladas")')).toBeLessThan(funcao.indexOf("access_token: sessao.access_token"));
  });

  it("a trilha da simulação guarda o id da pessoa, e não o e-mail", () => {
    // Decisão de 06/10/2026: o e-mail na trilha, sem prazo, religava ao
    // endereço da pessoa a conta que a anonimização desligou dele.
    const funcao = readFileSync(join(FUNCOES, "impersonar-perfil", "index.ts"), "utf8");
    const registro = funcao.slice(funcao.indexOf('rpc("registrar_auditoria"'));
    const detalhes = registro.slice(registro.indexOf("_detalhes:"), registro.indexOf("});"));
    expect(detalhes, "o registro da simulação foi achado").toMatch(/papel_alvo/);
    expect(detalhes).not.toMatch(/email/i);
    expect(registro).toMatch(/_entidade_id:\s*targetUserId/);
    // E o banco tira o e-mail de todo registro de simulação, por qualquer caminho.
    const pasta = join(__dirname, "..", "..", "supabase", "migrations");
    const migrations = readdirSync(pasta)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(pasta, f), "utf8"))
      .join("\n");
    expect(migrations).toMatch(/create trigger trg_auditoria_simulacao_sem_email\s+before insert or update of detalhes on public\.auditoria_acoes_sensiveis/);
    expect(migrations).toMatch(/new\.detalhes := new\.detalhes - 'email_alvo'/);
  });

  it("a troca do e-mail de login fica na trilha sem o e-mail", () => {
    // Auditoria de prontidão, 06/10/2026 (20261397010000): o registro
    // `gestor.email_alterado` guardava o e-mail novo em claro.
    const funcao = readFileSync(join(FUNCOES, "superadmin-suporte-tenant", "index.ts"), "utf8");
    const registro = funcao.slice(funcao.indexOf('registrarAuditoria("gestor.email_alterado"'));
    const detalhes = registro.slice(0, registro.indexOf("});"));
    expect(detalhes, "o registro da troca foi achado").toMatch(/mudou: "e-mail de login"/);
    expect(detalhes).not.toMatch(/novo_?email|email_novo|novoEmail/i);
    // E o banco tira o e-mail de todo registro de troca de e-mail, por
    // qualquer caminho: vale a definição VIGENTE do gatilho (a última).
    const pasta = join(__dirname, "..", "..", "supabase", "migrations");
    const textos = readdirSync(pasta)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(pasta, f), "utf8"));
    const migrations = textos.join("\n");
    expect(migrations).toMatch(
      /create trigger trg_auditoria_troca_de_email_sem_email\s+before insert or update of detalhes on public\.auditoria_acoes_sensiveis/,
    );
    const definicoes = [...migrations.matchAll(/create or replace function public\.auditoria_troca_de_email_sem_email\(\)[\s\S]*?\n\$\$;/g)];
    const vigente = definicoes.at(-1)?.[0] ?? "";
    expect(vigente, "a definição do gatilho foi achada").not.toBe("");
    expect(vigente).toMatch(/where d\.chave not ilike '%email%'/);
    // A condição alcança as duas ações de troca de e-mail de login.
    const condicao = vigente.match(/if (new\.acao [^\n]*) then/)?.[1] ?? "";
    const alcanca = (acao: string) =>
      condicao === `new.acao = '${acao}'` ||
      new RegExp(`'${acao.replace(".", "\\.")}'`).test(condicao) ||
      (/like '%\.email\\_alterado'/.test(condicao) && acao.endsWith(".email_alterado"));
    for (const acao of ["gestor.email_alterado", "equipe.email_alterado"]) expect(alcanca(acao), `${acao}: ${condicao}`).toBe(true);
  });

  // A troca do e-mail de login de alguém da equipe (20261401010000) mora
  // desde 07/10/2026 em `auditoriaDaEquipe.guarda.test.ts`, junto da troca do
  // nome e da do papel.
});
