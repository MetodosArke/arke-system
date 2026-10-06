import { describe, expect, it } from "vitest";
import { depoisDeDefinirASenha } from "./senhaDefinida";

function cliente(opcoes: { erroSair?: boolean; erroRpc?: boolean; ativadas?: number } = {}) {
  const chamadas: string[] = [];
  return {
    chamadas,
    auth: {
      signOut: async (o: { scope: "others" }) => {
        chamadas.push(`signOut:${o.scope}`);
        return { error: opcoes.erroSair ? { message: "rede" } : null };
      },
    },
    rpc: async (funcao: "ativar_gestao_pendente") => {
      chamadas.push(`rpc:${funcao}`);
      return opcoes.erroRpc
        ? { data: null, error: { message: "recusado", code: "42501" } }
        : { data: opcoes.ativadas ?? 0, error: null };
    },
  };
}

describe("depois de definir a senha pelo link do e-mail", () => {
  it("encerra as outras sessões antes de ativar a gestão pendente", async () => {
    const c = cliente({ ativadas: 1 });
    expect(await depoisDeDefinirASenha(c)).toEqual({ tipo: "ok", gestoesAtivadas: 1 });
    expect(c.chamadas).toEqual(["signOut:others", "rpc:ativar_gestao_pendente"]);
  });

  it("sem encerrar as outras sessões, não ativa a gestão", async () => {
    const c = cliente({ erroSair: true });
    expect(await depoisDeDefinirASenha(c)).toEqual({ tipo: "sessoes_nao_encerradas" });
    expect(c.chamadas).toEqual(["signOut:others"]);
  });

  it("a recusa do banco não derruba a senha que já foi definida", async () => {
    const c = cliente({ erroRpc: true });
    expect(await depoisDeDefinirASenha(c)).toEqual({ tipo: "gestao_nao_ativada" });
  });

  it("sem gestão pendente, nada a ativar", async () => {
    expect(await depoisDeDefinirASenha(cliente())).toEqual({ tipo: "ok", gestoesAtivadas: 0 });
  });
});
