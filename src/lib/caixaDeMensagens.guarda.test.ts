import { describe, expect, it } from "vitest";
import { regrasVigentes, textosDaReconstrucao, ultimaPermissao } from "../../scripts/migracao/regras.mjs";
import { canaisDoPapel } from "@/hooks/useCaixaMensagens";

/**
 * Trava da auditoria de prontidão de 06/10/2026: a caixa de mensagens da
 * equipe mostra só o que quem pede pode ler, e a conversa da nutrição é de
 * quem atende a saúde.
 *
 * `get_caixa_mensagens` rodava com a permissão da função e pulava a regra das
 * duas etapas; e o RLS da conversa da nutrição dava a conversa à recepção e à
 * ArkeFit de qualquer aluno do Free (20261399010000). Depois, a regra única
 * `for all` recusava marcar como lida a mensagem do outro lado, e a contagem
 * de não lidas nunca baixava (20261400010000).
 *
 * Lê a versão VIGENTE das regras e da função (as migrations em ordem).
 */
const textos = textosDaReconstrucao();

function definicaoVigente(nome: string): string {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of textos) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima;
}

const permissivas = (tabela: string) => [...regrasVigentes(textos, `public.${tabela}`)].filter(([, r]) => !r.restritiva);

const TABELAS_DE_CONVERSA = ["mensagens_treino", "mensagens_dieta", "mensagens_mentor"];

/**
 * O último `grant` ou `revoke` que dá ou tira de `authenticated` a exclusão
 * na tabela (por `delete` ou por `all`), na ordem da reconstrução; vazio se
 * nenhum. Sem nenhum, vale o padrão do Supabase, que dá a exclusão.
 */
const ultimaPermissaoDeExcluir = (sqls: string[], tabela: string): string => ultimaPermissao(sqls, tabela, "delete");

describe("caixa de mensagens pelo RLS", () => {
  it("a função roda com a permissão de quem chama e lê só tabelas com regra de leitura", () => {
    const funcao = definicaoVigente("get_caixa_mensagens");
    expect(funcao, "a definição foi achada").not.toBe("");
    const corpo = funcao.toLowerCase();
    expect(corpo).toMatch(/\bsecurity\s+invoker\b/);
    expect(corpo).not.toMatch(/\bsecurity\s+definer\b/);
    const tabelas = [...new Set([...corpo.matchAll(/\b(?:from|join)\s+public\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(tabelas).toEqual(["alunos", "mensagens_dieta", "mensagens_treino", "profiles"]);
    for (const t of tabelas) {
      const leitura = permissivas(t).filter(([, r]) => r.comando === "select" || r.comando === "all");
      expect(leitura.length, `public.${t} sem regra de leitura`).toBeGreaterThan(0);
    }
  });

  it("uma regra por operação nos dois chats, e nenhuma de exclusão", () => {
    for (const tabela of ["mensagens_treino", "mensagens_dieta"]) {
      expect(permissivas(tabela).map(([nome, r]) => `${nome}:${r.comando}`).sort(), tabela).toEqual([
        "alteração:update",
        "inclusão:insert",
        "leitura:select",
      ]);
    }
  });

  it("nenhuma mensagem se apaga pela API, nos três chats (sobras da frente B, 07/10/2026)", () => {
    // 20261406010000: quem lia a conversa apagava qualquer mensagem dela — a
    // recepção a do aluno, o aluno a orientação do professor. Nenhuma tela
    // exclui; a saída do aluno apaga pelo servidor. A conversa é o registro
    // do atendimento, como o canal do Mentor sempre foi.
    for (const tabela of TABELAS_DE_CONVERSA) {
      const excluem = permissivas(tabela).filter(([, r]) => r.comando === "delete" || r.comando === "all");
      expect(excluem.map(([nome]) => nome), `public.${tabela}: regra que deixa excluir`).toEqual([]);
      // Sem a permissão, o pedido é recusado (42501), e não respondido com 200 e zero linhas.
      expect(ultimaPermissaoDeExcluir(textos, tabela), `public.${tabela}`).toMatch(/^revoke\b.*\bfrom\b.*\bauthenticated\b/);
    }
  });

  it("o leitor acha a permissão de excluir devolvida (a trava trava)", () => {
    const devolvida = [...textos, "grant select, insert, delete on public.mensagens_dieta to authenticated;"];
    expect(ultimaPermissaoDeExcluir(devolvida, "mensagens_dieta")).toMatch(/^grant\b/);
    const tudo = [...textos, "grant all on public.mensagens_treino to anon, authenticated;"];
    expect(ultimaPermissaoDeExcluir(tudo, "mensagens_treino")).toMatch(/^grant all\b/);
    // A regra de exclusão de volta, por `create policy`.
    const regra = regrasVigentes(
      [...textos, `create policy "exclusão" on public.mensagens_mentor for delete to authenticated using (true);`],
      "public.mensagens_mentor",
    );
    expect([...regra].filter(([, r]) => !r.restritiva && r.comando === "delete").map(([nome]) => nome)).toEqual(["exclusão"]);
  });

  it("a conversa da nutrição é de quem atende a saúde: nem a recepção, nem a ArkeFit no aluno do Free", () => {
    for (const [nome, r] of permissivas("mensagens_dieta")) {
      for (const [metade, expr] of [["using", r.using], ["with check", r.withCheck]] as const) {
        if (!expr) continue;
        const e = expr.toLowerCase();
        expect(e, `${nome} (${metade}): toda a equipe`).not.toMatch(/is_org_staff/);
        expect(e, `${nome} (${metade}): o admin_arke solto`).not.toMatch(/admin_arke/);
        expect(e, `${nome} (${metade}): quem atende`).toMatch(/atende_saude\(organization_id\)/);
        // A ArkeFit entra só junto do aluno do Método.
        expect(e, `${nome} (${metade}): a ArkeFit sem o aluno do Método`).not.toMatch(
          /equipe_metodo\(\)(?!\s+and\s+(public\.)?aluno_no_metodo\(aluno_id\))/,
        );
      }
    }
  });

  it("pela API, só a coluna lida se altera nos chats", () => {
    // O último comando de permissão de alteração em cada chat é o que vale.
    for (const tabela of ["mensagens_treino", "mensagens_dieta"]) {
      let ultimo = "";
      for (const t of textos) {
        for (const m of t.matchAll(/\b(grant|revoke)\s+update\b[^;]*?\bon\s+(?:table\s+)?([^;]*?)\b(to|from)\b[^;]*;/gi)) {
          if (new RegExp(`\\bpublic\\.${tabela}\\b`).test(m[2])) ultimo = m[0].replace(/\s+/g, " ").toLowerCase();
        }
      }
      expect(ultimo, tabela).toMatch(/^grant update \(lida\) on .* to authenticated;$/);
    }
  });

  it("no app, a recepção não tem o canal de nutrição", () => {
    expect(canaisDoPapel("recepcao")).toEqual(["treino"]);
    expect(canaisDoPapel("gestor")).toEqual(["treino", "dieta"]);
    expect(canaisDoPapel("nutricionista")).toEqual(["dieta"]);
  });
});
