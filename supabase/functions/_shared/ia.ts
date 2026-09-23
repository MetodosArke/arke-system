/**
 * O Sentinela fala com o modelo — e este módulo é, na maior parte, uma lista
 * do que **não** sai daqui, e agora também de **para onde** não sai.
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
 * sentido do que se quer sugerir — é inerente à tarefa, e por isso está no
 * termo de consentimento, em negrito, em vez de numa promessa técnica.
 *
 * **Nada vai para log.** Nem prompt, nem resposta, nem em erro — só o status
 * HTTP e o tipo de erro da AWS. Mesma regra do número de cartão.
 *
 * **Falha aberta, de propósito.** Modelo fora do ar não pode travar o mentor.
 * O retorno diz `indisponivel` e quem chamou segue sem sugestão. Transformar
 * indisponibilidade de terceiro em atendimento bloqueado troca um risco
 * pequeno por uma falha certa.
 */

// ── Onde o processamento acontece ─────────────────────────────────────────
//
// **A região é fixa no código, e não configurável.** A Política de
// Privacidade e o termo de consentimento dizem ao aluno que a análise é feita
// no Brasil, em São Paulo — e é isso que dispensa a transferência
// internacional. Uma variável de ambiente com a região seria um jeito de
// mandar dado de saúde para fora do país trocando um texto num painel, sem
// erro nenhum e com os documentos afirmando o contrário.
const REGIAO = "sa-east-1";

// **Só modelos invocados dentro da região.** No Bedrock, um identificador com
// prefixo (`global.`, `us.`, `eu.`, `sa.`…) ou um ARN de perfil de inferência
// é **roteamento entre regiões**: o perfil `global.*` manda a requisição para
// qualquer região comercial da AWS no mundo. Em São Paulo, em 23/09/2026, os
// modelos modernos da Anthropic só existiam assim — só Claude 3 Haiku e
// Claude 3 Sonnet aceitavam invocação direta (`ON_DEMAND`) na região.
//
// Por isso a recusa mora aqui, em tempo de execução, e não num teste: o id do
// modelo vive num secret que nenhum teste enxerga, e "atualizar o modelo"
// para um `global.` é exatamente a troca que alguém faria de boa-fé.
const MODELO_PADRAO = "anthropic.claude-3-haiku-20240307-v1:0";
const PREFIXO_ROTEADO = /^(global|us|us-gov|eu|apac|sa|jp|au|ca)\./;

export function modeloRodaNaRegiao(id: string): boolean {
  return /^[a-z0-9-]+\.[A-Za-z0-9.:_-]+$/.test(id) && !PREFIXO_ROTEADO.test(id);
}

export type RespostaIA =
  | { ok: true; texto: string }
  | { ok: false; indisponivel: true; motivo: string };

type Env = (n: string) => string | undefined;

/** Qual fornecedor está ativo, para a tela dizer a verdade sem expor chave. */
export function fornecedorIA(env: Env): "bedrock" | null {
  return env("BEDROCK_ACCESS_KEY_ID") && env("BEDROCK_SECRET_ACCESS_KEY") ? "bedrock" : null;
}

// ── Assinatura AWS (SigV4), com WebCrypto ─────────────────────────────────
//
// Sem SDK: são quarenta linhas, e o SDK traria dezenas de dependências para
// dentro de uma função que lida com dado de saúde.
const te = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", te.encode(s)));
async function hmac(chave: BufferSource, s: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, te.encode(s));
}
// RFC 3986. Serviços que não são o S3 exigem cada segmento do caminho
// codificado DUAS vezes na forma canônica — é o que faz o ":" do id do modelo
// virar %253A na assinatura e %3A na URL. Errar isso dá 403 de assinatura.
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function assinar(caminho: string[], corpo: string, chaveId: string, segredo: string) {
  const host = `bedrock-runtime.${REGIAO}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dia = amzDate.slice(0, 8);
  const cabecalhos: Record<string, string> = { "content-type": "application/json", host, "x-amz-date": amzDate };
  const nomes = Object.keys(cabecalhos).sort();
  const canonico = [
    "POST",
    "/" + caminho.map((s) => enc(enc(s))).join("/"),
    "",
    nomes.map((n) => `${n}:${cabecalhos[n]}\n`).join(""),
    nomes.join(";"),
    await sha256(corpo),
  ].join("\n");
  const escopo = `${dia}/${REGIAO}/bedrock/aws4_request`;
  const aAssinar = ["AWS4-HMAC-SHA256", amzDate, escopo, await sha256(canonico)].join("\n");
  let k: ArrayBuffer = await hmac(te.encode("AWS4" + segredo), dia);
  for (const parte of [REGIAO, "bedrock", "aws4_request"]) k = await hmac(k, parte);
  const assinatura = hex(await hmac(k, aAssinar));
  return {
    url: `https://${host}/` + caminho.map(enc).join("/"),
    headers: {
      ...cabecalhos,
      authorization: `AWS4-HMAC-SHA256 Credential=${chaveId}/${escopo}, SignedHeaders=${nomes.join(";")}, Signature=${assinatura}`,
    },
  };
}

export async function conversarComIA(
  env: Env,
  dados: { sistema: string; usuario: string; maxTokens?: number },
): Promise<RespostaIA> {
  const chaveId = env("BEDROCK_ACCESS_KEY_ID");
  const segredo = env("BEDROCK_SECRET_ACCESS_KEY");
  if (!chaveId || !segredo) {
    return { ok: false, indisponivel: true, motivo: "Sentinela desligado (sem credencial de IA configurada)." };
  }

  const modelo = env("BEDROCK_MODEL_ID") ?? MODELO_PADRAO;
  if (!modeloRodaNaRegiao(modelo)) {
    // Recusa em vez de "funcionar": o modelo configurado roteia para fora de
    // São Paulo, e os documentos dizem ao aluno que o dado não sai do Brasil.
    console.error("ia: modelo recusado por rotear para fora da regiao");
    return {
      ok: false,
      indisponivel: true,
      motivo: "Sentinela desligado: o modelo configurado processaria fora do Brasil.",
    };
  }

  const corpo = JSON.stringify({
    system: [{ text: dados.sistema }],
    messages: [{ role: "user", content: [{ text: dados.usuario }] }],
    inferenceConfig: { maxTokens: dados.maxTokens ?? 500, temperature: 0.4 },
  });

  let resposta: Response;
  try {
    const { url, headers } = await assinar(["model", modelo, "converse"], corpo, chaveId, segredo);
    resposta = await fetch(url, { method: "POST", headers, body: corpo });
  } catch {
    return { ok: false, indisponivel: true, motivo: "Não foi possível falar com o Sentinela agora." };
  }

  if (!resposta.ok) {
    // O tipo de erro da AWS não carrega conteúdo, e é o que distingue
    // credencial errada de conta em verificação de modelo inexistente.
    console.error("ia: recusado", resposta.status, resposta.headers.get("x-amzn-errortype") ?? "");
    return { ok: false, indisponivel: true, motivo: "O Sentinela não respondeu agora." };
  }

  const r = await resposta.json().catch(() => null);
  const texto = r?.output?.message?.content?.[0]?.text;
  if (typeof texto !== "string" || !texto.trim()) {
    return { ok: false, indisponivel: true, motivo: "O Sentinela respondeu vazio." };
  }
  return { ok: true, texto: texto.trim() };
}
