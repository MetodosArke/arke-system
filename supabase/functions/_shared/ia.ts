/**
 * O Sentinela fala com o modelo — e este módulo é, na maior parte, uma lista
 * do que **não** sai daqui.
 *
 * A postura é a mesma de `src/lib/monitoramento.ts` com o Sentry: um SDK no
 * padrão manda muito mais do que se imagina para um terceiro, e a diferença
 * entre ferramenta útil e vazamento contínuo mora inteira na configuração.
 *
 * **Nunca sai daqui:** nome, CPF, e-mail, telefone, endereço ou qualquer id do
 * ARKE. O contexto estruturado vai pseudonimizado — "aluno, fase B.A.S.E.®, 8
 * dias sem treinar". Limitação que vale dizer em voz alta: quando o texto é
 * uma **conversa**, as palavras do aluno vão como ele as escreveu, e ele pode
 * ter digitado o próprio nome. Não dá para higienizar isso sem destruir o
 * sentido do que se quer sugerir — é inerente à tarefa, e por isso entra no
 * termo de consentimento em vez de numa promessa técnica que não se cumpre.
 *
 * **Nada vai para log.** Nem prompt, nem resposta, nem em erro — só o status
 * HTTP. Mesma regra do número de cartão em `asaas-cartao-assinatura`.
 *
 * **Falha aberta, de propósito.** Modelo fora do ar não pode travar o mentor.
 * O retorno diz `indisponivel` e quem chamou segue sem sugestão, como era
 * antes de existir sugestão. Transformar indisponibilidade de terceiro em
 * atendimento bloqueado troca um risco pequeno por uma falha certa.
 *
 * **Dois fornecedores, escolhidos pelo que estiver configurado.** Azure vence
 * quando ambos existem, porque é ele que mantém o dado no Brasil — e é a
 * residência, não a retenção, que elimina a transferência internacional. Os
 * dois exigem pedido de zero-retention; nenhum a dá por padrão.
 */

export type RespostaIA =
  | { ok: true; texto: string }
  | { ok: false; indisponivel: true; motivo: string };

type Destino = { url: string; headers: Record<string, string>; modelo?: string };

function destino(env: (n: string) => string | undefined): Destino | null {
  const azureEndpoint = env("AZURE_OPENAI_ENDPOINT");
  const azureKey = env("AZURE_OPENAI_KEY");
  const azureDeployment = env("AZURE_OPENAI_DEPLOYMENT");
  if (azureEndpoint && azureKey && azureDeployment) {
    const versao = env("AZURE_OPENAI_API_VERSION") ?? "2024-10-21";
    return {
      // No Azure chama-se o **deployment** que você criou, não o nome do
      // modelo — é a diferença que mais confunde quem vem da OpenAI direta.
      url: `${azureEndpoint.replace(/\/$/, "")}/openai/deployments/${azureDeployment}/chat/completions?api-version=${versao}`,
      headers: { "api-key": azureKey, "Content-Type": "application/json" },
    };
  }

  const openaiKey = env("OPENAI_API_KEY");
  if (openaiKey) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      modelo: env("OPENAI_MODEL") ?? "gpt-4o-mini",
    };
  }
  return null;
}

/** Qual fornecedor está ativo, para a tela dizer a verdade sem expor chave. */
export function fornecedorIA(env: (n: string) => string | undefined): "azure" | "openai" | null {
  if (env("AZURE_OPENAI_ENDPOINT") && env("AZURE_OPENAI_KEY") && env("AZURE_OPENAI_DEPLOYMENT")) return "azure";
  if (env("OPENAI_API_KEY")) return "openai";
  return null;
}

export async function conversarComIA(
  env: (n: string) => string | undefined,
  dados: { sistema: string; usuario: string; maxTokens?: number },
): Promise<RespostaIA> {
  const alvo = destino(env);
  if (!alvo) return { ok: false, indisponivel: true, motivo: "Sentinela desligado (sem chave de IA configurada)." };

  let resposta: Response;
  try {
    resposta = await fetch(alvo.url, {
      method: "POST",
      headers: alvo.headers,
      body: JSON.stringify({
        ...(alvo.modelo ? { model: alvo.modelo } : {}),
        messages: [
          { role: "system", content: dados.sistema },
          { role: "user", content: dados.usuario },
        ],
        max_tokens: dados.maxTokens ?? 500,
        temperature: 0.4,
      }),
    });
  } catch {
    // Sem detalhe no log: a mensagem de erro de rede pode carregar a URL com
    // o deployment, e não ajuda em nada a diagnosticar.
    return { ok: false, indisponivel: true, motivo: "Não foi possível falar com o Sentinela agora." };
  }

  if (!resposta.ok) {
    console.error("ia: recusado", resposta.status);
    return { ok: false, indisponivel: true, motivo: "O Sentinela não respondeu agora." };
  }

  const corpo = await resposta.json().catch(() => null);
  const texto = corpo?.choices?.[0]?.message?.content;
  if (typeof texto !== "string" || !texto.trim()) {
    return { ok: false, indisponivel: true, motivo: "O Sentinela respondeu vazio." };
  }
  return { ok: true, texto: texto.trim() };
}
