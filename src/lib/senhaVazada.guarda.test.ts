import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { mensagemSenhaVazada, verificarSenhaVazada } from "./senhaVazada";

/**
 * Trava da decisão de 07/10/2026 ("matrícula pública confirmada").
 *
 * A conferência de senha vazada (Pwned Passwords, por k-anonimato, com falha
 * aberta) morava em `matricula-publica`, porque era lá que a senha da
 * matrícula nascia, e era a única do servidor. A matrícula deixou de receber
 * senha: a primeira senha nasce na tela de definir a senha, pelo link do
 * e-mail. A conferência passou a valer em toda tela que define senha, no
 * navegador, com a mesma mensagem e só os 5 primeiros caracteres do hash.
 *
 * Esta trava falha quando uma tela define senha sem conferir antes, quando a
 * mensagem muda, ou quando a política de conteúdo do site deixa de permitir a
 * consulta (o navegador recusaria a chamada, e a falha aberta esconderia).
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...partes: string[]) => readFileSync(join(...partes), "utf8").replace(/\r\n/g, "\n");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

/** Onde o código grava uma senha: a função do AuthContext ou o Auth direto. */
const DEFINE_SENHA = /\bupdatePassword\(|auth\.updateUser\(\{[^}]*\bpassword\b/;

describe("senha vazada conferida onde a senha nasce", () => {
  // O AuthContext só embrulha o Auth; quem decide a senha é a tela.
  const telas = arquivos(join(RAIZ, "src"))
    .filter((a) => !a.endsWith(`${sep}AuthContext.tsx`))
    .filter((a) => DEFINE_SENHA.test(readFileSync(a, "utf8")))
    .map((a) => relative(RAIZ, a).split(sep).join("/"))
    .sort();

  it("as telas que definem senha foram achadas", () => {
    expect(telas).toEqual(["src/pages/admin/AdminPerfil.tsx", "src/pages/auth/DefinirSenha.tsx", "src/pages/auth/ResetPassword.tsx"]);
  });

  it("toda tela confere o vazamento antes de gravar a senha, e só recusa quando a consulta aconteceu", () => {
    for (const tela of telas) {
      const t = ler(RAIZ, tela);
      const conferir = t.indexOf("await verificarSenhaVazada(");
      const gravar = t.search(DEFINE_SENHA);
      expect(conferir, tela).toBeGreaterThan(-1);
      expect(conferir, tela).toBeLessThan(gravar);
      // A falha aberta mora em senhaDeveSerRecusada: o HIBP fora do ar não trava ninguém.
      expect(t, tela).toMatch(/if \(senhaDeveSerRecusada\(vazamento\)\) \{/);
      expect(t, tela).toMatch(/mensagemSenhaVazada\(vazamento\.ocorrencias\)/);
    }
  });

  it("a matrícula pública não recebe mais senha, e nenhuma função consulta o serviço", () => {
    const funcoes = arquivos(join(RAIZ, "supabase", "functions"));
    const consultam = funcoes.filter((a) => /pwnedpasswords/.test(readFileSync(a, "utf8"))).map((a) => relative(RAIZ, a));
    expect(consultam).toEqual([]);
  });

  it("a mensagem é a de antes, que estava na matrícula pública", () => {
    expect(mensagemSenhaVazada(2)).toBe(
      "Esta senha já apareceu 2 vezes em vazamentos públicos de outros sites e é testada automaticamente por invasores. " +
        "Escolha outra — não precisa ser complicada, só precisa ser sua.",
    );
    expect(mensagemSenhaVazada(1)).toMatch(/apareceu 1 vez em/);
  });

  it("só os 5 primeiros caracteres do hash saem, e o serviço fora do ar deixa passar", async () => {
    const pedidos: string[] = [];
    await verificarSenhaVazada("uma senha qualquer", async (prefixo) => {
      pedidos.push(prefixo);
      return "";
    });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatch(/^[0-9A-F]{5}$/);

    const foraDoAr = await verificarSenhaVazada("outra senha", async () => {
      throw new Error("indisponível");
    });
    expect(foraDoAr).toEqual({ vazada: false, ocorrencias: 0, verificou: false });
  });

  it("a política de conteúdo do site deixa o navegador consultar o serviço", () => {
    const vercel = ler(RAIZ, "vercel.json");
    const conectar = vercel.match(/connect-src[^;"]*/)?.[0] ?? "";
    expect(conectar).toContain("https://api.pwnedpasswords.com");
  });
});
