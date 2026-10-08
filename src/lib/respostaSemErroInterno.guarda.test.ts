import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_INVALIDO, JA_CADASTRADO, MUITOS_PEDIDOS, emailJaCadastrado, respostaDoErroDoAuth } from "../../supabase/functions/_shared/erroDoAuth";

/**
 * A resposta de uma edge function não leva a mensagem crua de um erro (frente
 * D, 07/10/2026).
 *
 * `criar-organizacao-superadmin` devolvia a mensagem do Auth quando a conta do
 * gestor não nascia, e `editar-membro-equipe`, `superadmin-suporte-tenant`,
 * `convidar-membro`, `vapid-public-key` e `vigia-aprovar` faziam o mesmo com o
 * Auth ou o banco. A mensagem crua pode trazer o e-mail digitado ("Email
 * address \"x@y\" is invalid"), fala em inglês e descreve o servidor. O log já
 * levava só `resumoDoErro()` (`logsSemDadoPessoal.guarda`); a resposta, não.
 *
 * A regra: dentro de `jsonResponse(...)`, `errorResponse(...)` ou
 * `new Response(...)`, nada de `.message` nem `String(erro)`. A exceção é a
 * recusa nossa (`raise exception` de uma função ou gatilho do banco, a classe
 * `Recusa`), e ela se declara na mesma linha: `if (error.code === "P0001")
 * return jsonResponse({ error: error.message }, 409)`. O erro do Auth passa
 * por `respostaDoErroDoAuth()` (`_shared/erroDoAuth.ts`).
 */
const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : /\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** Cada resposta montada no código, com a linha onde ela começa. */
function respostas(codigo: string): { linha: string; texto: string }[] {
  const achadas: { linha: string; texto: string }[] = [];
  for (const m of codigo.matchAll(/\b(?:jsonResponse|errorResponse)\(|\bnew Response\(/g)) {
    const inicio = m.index ?? 0;
    let nivel = 1;
    let i = inicio + m[0].length;
    while (i < codigo.length && nivel > 0) {
      if (codigo[i] === "(") nivel++;
      else if (codigo[i] === ")") nivel--;
      i++;
    }
    const comecoDaLinha = codigo.lastIndexOf("\n", inicio) + 1;
    achadas.push({ linha: codigo.slice(comecoDaLinha, inicio), texto: codigo.slice(inicio, i) });
  }
  return achadas;
}

/** A resposta leva a mensagem de um erro sem declarar que a recusa é nossa. */
function levaMensagemCrua({ linha, texto }: { linha: string; texto: string }): boolean {
  if (!/\??\.message\b|\bString\(\s*(e|err|erro|error)\s*\)/.test(texto)) return false;
  const recusaNossa = /\.code\s*===\s*"[0-9A-Z]{5}"/.test(linha) || /instanceof Recusa\b/.test(linha);
  return !recusaNossa;
}

describe("resposta sem a mensagem crua do erro", () => {
  const todas = arquivos(FUNCOES).flatMap((arquivo) =>
    respostas(readFileSync(arquivo, "utf8")).map((r) => ({ ...r, arquivo: relative(FUNCOES, arquivo).replace(/\\/g, "/") })),
  );

  it("as respostas foram achadas", () => {
    expect(todas.length).toBeGreaterThan(500);
  });

  it("nenhuma resposta leva a mensagem crua de um erro", () => {
    const cruas = todas.filter(levaMensagemCrua).map((r) => `${r.arquivo}: ${r.texto.replace(/\s+/g, " ").slice(0, 100)}`);
    expect(cruas).toEqual([]);
  });

  it("o detector detecta (a trava trava)", () => {
    const plantado = [
      'return jsonResponse({ error: inviteError?.message ?? "Falha." }, 400);',
      "return jsonResponse(\n  { error: jaExiste ? \"Já existe.\" : emailError.message },\n  400\n);",
      "return errorResponse(deleteError.message || \"Erro.\");",
      "return new Response(JSON.stringify({ error: String(error) }), { status: 500 });",
      'if (limite) return jsonResponse({ error: alunoError.message }, 409);',
    ].join("\n");
    expect(respostas(plantado).filter(levaMensagemCrua)).toHaveLength(5);
    const nossas = [
      'if (error.code === "P0001") return jsonResponse({ error: error.message }, 409);',
      "if (error instanceof Recusa) return jsonResponse({ error: error.message }, error.status);",
      'return jsonResponse({ error: "Erro ao criar a organização." }, 500);',
    ].join("\n");
    expect(respostas(nossas).filter(levaMensagemCrua)).toHaveLength(0);
  });
});

describe("o erro do Auth vira resposta nossa", () => {
  it("o e-mail que já tem conta, pelo código ou pela mensagem antiga", () => {
    expect(respostaDoErroDoAuth({ code: "email_exists", status: 422, message: "x" }, "padrão")).toEqual({ mensagem: JA_CADASTRADO, status: 409 });
    expect(emailJaCadastrado({ message: "A user with this email address has already been registered", status: 422 })).toBe(true);
    expect(emailJaCadastrado(null)).toBe(false);
  });

  it("o e-mail inválido e o limite, sem a mensagem do Auth", () => {
    const invalido = respostaDoErroDoAuth({ code: "email_address_invalid", status: 400, message: 'Email address "ana@x" is invalid' }, "padrão");
    expect(invalido).toEqual({ mensagem: EMAIL_INVALIDO, status: 400 });
    expect(JSON.stringify(invalido)).not.toContain("ana@x");
    expect(respostaDoErroDoAuth({ code: "over_email_send_rate_limit", status: 429 }, "padrão")).toEqual({ mensagem: MUITOS_PEDIDOS, status: 429 });
  });

  it("pedido recusado é 400; falha do Auth é 502; nunca a mensagem dele", () => {
    expect(respostaDoErroDoAuth({ status: 400, message: "Signups not allowed for this instance" }, "padrão")).toEqual({ mensagem: "padrão", status: 400 });
    expect(respostaDoErroDoAuth({ status: 500, message: "Database error saving new user" }, "padrão")).toEqual({ mensagem: "padrão", status: 502 });
    expect(respostaDoErroDoAuth(null, "padrão")).toEqual({ mensagem: "padrão", status: 502 });
  });
});
