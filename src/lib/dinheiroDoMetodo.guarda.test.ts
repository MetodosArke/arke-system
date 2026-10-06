import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Travas do dinheiro do Método que a auditoria de 05/10/2026 achou abertas:
 *
 * - a exceção de repasse por nível era gravável pelo gestor (repasse de
 *   R$ 49,05 caiu para R$ 4,05 numa transação desfeita);
 * - toda a equipe da academia podia alterar e apagar `pagamentos`;
 * - cancelar o Método parava a cobrança e deixava o aluno no Método;
 * - o próprio aluno, ao cancelar, apagava a dívida vencida;
 * - o aluno que pagava a mensalidade continuava barrado até a madrugada.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const ler = (...partes: string[]) => readFileSync(join(...partes), "utf8");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ler(MIGRATIONS, f).toLowerCase());
const tudo = migrations.join("\n");

function ultimaDefinicao(funcao: string): string {
  const re = new RegExp(`create or replace function public\\.${funcao}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "g");
  let ultima = "";
  for (const sql of migrations) for (const achado of sql.match(re) ?? []) ultima = achado;
  return ultima;
}

describe("dinheiro do Método", () => {
  it("o repasse, da academia e por nível, só a ArkeFit grava", () => {
    expect(ultimaDefinicao("proteger_colunas_organizacao")).toMatch(/new\.repasse_valor is distinct from old\.repasse_valor/);
    const nivel = ultimaDefinicao("proteger_repasse_por_nivel");
    expect(nivel).toMatch(/tg_op = 'insert'/);
    expect(nivel).toMatch(/tg_op = 'update'/);
    expect(nivel).toMatch(/tg_op = 'delete'/);
    expect(tudo).toMatch(
      /create trigger trg_proteger_repasse_por_nivel\s+before insert or update or delete on public\.organization_planos_precificacao/,
    );
  });

  it("os pagamentos do Método, a equipe só lê", () => {
    const ultimaRevogacao = tudo.lastIndexOf("revoke insert, update, delete on public.pagamentos from anon, authenticated");
    expect(ultimaRevogacao, "a revogação existe").toBeGreaterThan(0);
    const depois = tudo.slice(ultimaRevogacao);
    expect(depois).not.toMatch(/create policy [^;]* on public\.pagamentos for (all|insert|update|delete)/);
    expect(depois).not.toMatch(/grant [^;]*(insert|update|delete|all)[^;]* on (table )?public\.pagamentos to [^;]*authenticated/);
  });

  it("assinatura do Método cancelada tira o aluno do Método", () => {
    expect(tudo).toMatch(/create trigger trg_assinatura_cancelada_encerra_metodo\s+after update of status on public\.aluno_assinaturas/);
    expect(ultimaDefinicao("encerrar_metodo_ao_cancelar_assinatura")).toMatch(/set metodo_arke_status = 'cancelado'/);
  });

  it("o próprio aluno com cobrança vencida não cancela sozinho", () => {
    const funcao = ler(FUNCOES, "asaas-assinatura-ciclo", "index.ts");
    const trava = funcao.indexOf("if (oProprioAluno && !equipe && !arkefit)");
    expect(trava, "a trava existe").toBeGreaterThan(0);
    expect(trava).toBeLessThan(funcao.indexOf("await cancelarAssinatura("));
  });

  it("o pagamento da mensalidade libera o aluno na hora", () => {
    const funcao = ler(FUNCOES, "asaas-webhook", "index.ts");
    const ini = funcao.indexOf("if (mensalidadeExistente) {");
    const fim = funcao.indexOf("// Daqui para baixo é o Método ARKE");
    expect(ini).toBeGreaterThan(0);
    expect(funcao.slice(ini, fim)).toMatch(/rpc\("sincronizar_situacao_por_mensalidade"\)/);
  });
});
