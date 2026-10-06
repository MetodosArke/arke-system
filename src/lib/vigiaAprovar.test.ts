import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { detalheDaFalha, executarComDesfecho, type Desfecho, type Preparo } from "../../supabase/functions/vigia-aprovar/fluxo";

/**
 * Achado da auditoria de 05/10/2026: a ação aprovada no Vigia ficava presa em
 * "executando" quando o Asaas ou o webhook estourava o prazo — o `fetch`
 * lançava, o `catch` da função não registrava o desfecho, e a nova aprovação
 * era recusada como "já decidida". Toda saída depois da reserva registra o
 * desfecho, inclusive a falha.
 */
const PREP: Preparo = { acao_id: 42, ferramenta: "cancelar_assinatura_orfa", alvo: "sub_1" };
const RAIZ = join(__dirname, "..", "..");

const timeout = () => Object.assign(new Error("Signal timed out."), { name: "TimeoutError" });

describe("aprovação do Vigia: o desfecho sempre fica registrado", () => {
  it("o fetch que estoura o prazo vira erro registrado, sem a mensagem crua", async () => {
    const concluir = vi.fn(async (_d: Desfecho) => ({ error: null }));
    const r = await executarComDesfecho(PREP, () => Promise.reject(timeout()), concluir);
    expect(r.registrado).toBe(true);
    expect(r.resultado.resultado).toBe("erro");
    expect(concluir).toHaveBeenCalledWith({
      acao_id: 42,
      resultado: "erro",
      detalhe: detalheDaFalha(timeout()),
      comando_id: null,
    });
    expect(r.resultado.detalhe).not.toContain("Signal timed out");
  });

  it("exceção qualquer também registra", async () => {
    const concluir = vi.fn(async () => ({ error: null }));
    const r = await executarComDesfecho(PREP, () => Promise.reject(new TypeError("error sending request for url")), concluir);
    expect(concluir).toHaveBeenCalledTimes(1);
    expect(r.resultado.detalhe).toBe("A execução falhou antes de terminar (TypeError). Confira antes de agir de novo.");
  });

  it("o resultado normal é registrado com o comando, e 'ignorada' vira ok", async () => {
    const concluir = vi.fn(async () => ({ error: null }));
    const r = await executarComDesfecho(
      PREP,
      async () => ({ resultado: "ignorada", detalhe: "Ordem igual já na fila.", comando_id: "cmd-1" }),
      concluir,
    );
    expect(r.resultado.resultado).toBe("ok");
    expect(concluir).toHaveBeenCalledWith({ acao_id: 42, resultado: "ok", detalhe: "Ordem igual já na fila.", comando_id: "cmd-1" });
  });

  it("o registro que falha é tentado de novo; se falhar duas vezes, diz que não registrou", async () => {
    const umaVez = vi.fn().mockResolvedValueOnce({ error: { code: "08006" } }).mockResolvedValueOnce({ error: null });
    expect((await executarComDesfecho(PREP, async () => ({ resultado: "ok", detalhe: "x" }), umaVez)).registrado).toBe(true);
    expect(umaVez).toHaveBeenCalledTimes(2);

    const nunca = vi.fn().mockRejectedValue(new Error("rede"));
    const r = await executarComDesfecho(PREP, async () => ({ resultado: "ok", detalhe: "x" }), nunca);
    expect(r.registrado).toBe(false);
    expect(nunca).toHaveBeenCalledTimes(2);
  });

  it("a edge function executa pelo fluxo, e o reenvio ao webhook não deixa o prazo escapar", () => {
    const funcao = readFileSync(join(RAIZ, "supabase", "functions", "vigia-aprovar", "index.ts"), "utf8");
    expect(funcao).toContain("executarComDesfecho(");
    // vigia_concluir_acao só dentro do fluxo: uma chamada solta fora dele é o
    // caminho que deixava a ação sem desfecho.
    expect(funcao.match(/vigia_concluir_acao/g)?.length).toBe(1);
    const reenvio = funcao.slice(funcao.indexOf("async function reprocessarAvisos"));
    expect(reenvio).toMatch(/try \{\s*const r = await fetch/);
  });

  it("a ação presa por função morta no meio é fechada pelo Vigia", () => {
    const pasta = join(RAIZ, "supabase", "migrations");
    const sql = readdirSync(pasta)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(pasta, f), "utf8"))
      .join("\n");
    expect(sql).toMatch(/where resultado = 'executando' and criada_em < now\(\) - interval '15 minutes'/);
    expect(sql).toContain("$cmd$select public.vigia_fechar_acoes_sem_desfecho(); select public.vigia_varrer()$cmd$");
  });
});
