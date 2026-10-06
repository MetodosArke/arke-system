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
});
