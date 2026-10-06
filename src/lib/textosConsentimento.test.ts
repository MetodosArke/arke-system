import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROPOSITOS_RESPONSAVEL as PROPOSITOS_FUNCAO,
  ROTULO_PROPOSITO as ROTULO_FUNCAO,
  TEXTOS_RESPONSAVEL,
} from "../../supabase/functions/_shared/responsavel";
import { PROPOSITOS_RESPONSAVEL, ROTULO_PROPOSITO } from "./menorDeIdade";
import { TEXTOS_CONSENTIMENTO, VERSAO_DO_PROPOSITO, textoCanonico } from "./textosConsentimento";

/**
 * O responsável do aluno menor autoriza lendo os mesmos textos que o aluno lê
 * no app, e o aceite grava a versão e o SHA-256 do texto. Quem grava é a
 * função `responsavel-aceite`, pela tabela de `_shared/responsavel.ts` — e a
 * tabela só diz a verdade se o hash dela for o do texto daqui. Mudou um texto
 * sem mudar a tabela, este teste falha.
 */
const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");

/**
 * A última versão que cada função `versao_consentimento_*()` devolve nas
 * migrations. Só a definição conta, e o corpo é uma linha:
 * `as $$ select '<versão>'::text $$`.
 */
const VERSOES_NO_BANCO = (() => {
  const versoes: Record<string, string> = {};
  const definicao = /create (?:or replace )?function public\.(versao_consentimento_\w+)\(\)/gi;
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    if (!sql.includes("versao_consentimento_")) continue;
    for (const m of sql.matchAll(definicao)) {
      const corpo = /\$\$\s*select '([^']+)'::text\s*\$\$/.exec(sql.slice(m.index!, m.index! + 600));
      if (corpo) versoes[m[1].toLowerCase()] = corpo[1];
    }
  }
  return versoes;
})();
const versaoNoBanco = (funcao: string) => VERSOES_NO_BANCO[funcao] ?? "";

describe("textos do aceite do responsável", () => {
  it("a função e o app falam dos mesmos propósitos, com os mesmos nomes", () => {
    expect([...PROPOSITOS_FUNCAO]).toEqual([...PROPOSITOS_RESPONSAVEL]);
    expect(ROTULO_FUNCAO).toEqual(ROTULO_PROPOSITO);
  });

  it.each([...PROPOSITOS_RESPONSAVEL])("%s: a versão e o hash da função são os do texto do app", (p) => {
    expect(TEXTOS_RESPONSAVEL[p].versao).toBe(VERSAO_DO_PROPOSITO[p]);
    expect(TEXTOS_RESPONSAVEL[p].sha256, `atualize o sha256 de "${p}" em _shared/responsavel.ts`).toBe(sha256(textoCanonico(p)));
  });

  it("a versão de cada texto é a que o banco tem como vigente", () => {
    expect(VERSAO_DO_PROPOSITO.saude).toBe(versaoNoBanco("versao_consentimento_saude"));
    expect(VERSAO_DO_PROPOSITO.biometria).toBe(versaoNoBanco("versao_consentimento_biometrico"));
    expect(VERSAO_DO_PROPOSITO.ia_anamnese).toBe(versaoNoBanco("versao_consentimento_ia"));
    expect(VERSAO_DO_PROPOSITO.ia_chat).toBe(versaoNoBanco("versao_consentimento_ia"));
  });

  it("nenhum texto novo: cada propósito é feito dos termos que já existem", () => {
    expect(TEXTOS_CONSENTIMENTO.saude.paragrafos[0]).toMatch(/^As informações de saúde que você compartilha no ARKE/);
    expect(TEXTOS_CONSENTIMENTO.biometria.paragrafos[0]).toMatch(/^Autorizo o uso da minha impressão digital/);
    expect(TEXTOS_CONSENTIMENTO.ia_anamnese.paragrafos[1]).toMatch(/^O processamento é feito no Brasil, em servidores/);
    expect(TEXTOS_CONSENTIMENTO.ia_chat.titulo).toBe("Apoio à resposta do meu mentor");
  });

  it("o aviso de IA, juntado, é o texto corrido que o aluno lê", () => {
    expect(TEXTOS_CONSENTIMENTO.ia_chat.paragrafos[1]).toBe(
      "O processamento é feito no Brasil, em servidores da Amazon Web Services em São Paulo. O conteúdo não fica " +
        "registrado na nossa conta do provedor, e não é utilizado para treinar modelos. Não enviamos o seu nome, CPF, " +
        "e-mail nem telefone — mas as mensagens que você escreveu são enviadas como você as escreveu, inclusive " +
        "qualquer dado pessoal que você tenha digitado nelas. O que o ARKE guarda fica enquanto durar a sua " +
        "matrícula. Você pode retirar qualquer destas autorizações quando quiser, e o que tiver sido gerado a partir " +
        "do dado é apagado."
    );
  });
});
