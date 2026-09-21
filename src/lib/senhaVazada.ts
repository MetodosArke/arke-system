/**
 * Verificação de senha vazada contra o Pwned Passwords, do HaveIBeenPwned.
 *
 * O Supabase tem isso embutido, mas só a partir do plano pago. Esta é a
 * substituta: a API Pwned Passwords é pública, gratuita e **não exige
 * chave** — diferente da API de vazamento de contas do mesmo serviço, que
 * exige.
 *
 * A senha nunca sai do navegador. O protocolo é k-anonimato:
 *
 *   1. calcula-se o SHA-1 da senha localmente;
 *   2. envia-se apenas os **5 primeiros caracteres** do hash;
 *   3. a API devolve todos os sufixos conhecidos que começam com aqueles
 *      5 caracteres — algumas centenas — com a contagem de vazamentos;
 *   4. a comparação com o sufixo real acontece aqui, no cliente.
 *
 * Ou seja, o serviço recebe um prefixo compartilhado por milhares de
 * senhas diferentes e não tem como saber qual delas foi consultada. O
 * cabeçalho `Add-Padding` reforça isso: a resposta vem preenchida com
 * registros falsos para que o tamanho dela também não entregue nada.
 *
 * SHA-1 aqui não é escolha de segurança nem tem relação com como a senha
 * é guardada (isso é bcrypt, no Supabase Auth) — é só o índice que o HIBP
 * usa para o corpus dele.
 */

/** Uma aparição já basta para recusar, que é o comportamento do recurso pago. */
export const OCORRENCIAS_PARA_RECUSAR = 1;

const ENDPOINT = "https://api.pwnedpasswords.com/range";
const TEMPO_LIMITE_MS = 4000;

export interface ResultadoSenhaVazada {
  /** Senha aparece em vazamento conhecido. Só é confiável quando `verificou` é true. */
  vazada: boolean;
  /** Quantas vezes apareceu no corpus do HIBP. */
  ocorrencias: number;
  /**
   * `false` quando não foi possível consultar (rede fora, HIBP indisponível,
   * navegador sem WebCrypto). Quem chama deve deixar passar nesse caso —
   * ver `senhaDeveSerRecusada`.
   */
  verificou: boolean;
}

/** Trocável nos testes para não depender de rede. */
export type BuscarFaixa = (prefixo: string) => Promise<string>;

async function buscarFaixaPadrao(prefixo: string): Promise<string> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);
  try {
    const resposta = await fetch(`${ENDPOINT}/${prefixo}`, {
      // Enche a resposta com registros falsos: sem isso, o tamanho dela
      // permitiria a um observador de rede inferir a faixa consultada.
      headers: { "Add-Padding": "true" },
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`HIBP respondeu ${resposta.status}`);
    return await resposta.text();
  } finally {
    clearTimeout(timer);
  }
}

async function sha1Hex(texto: string): Promise<string> {
  const dados = new TextEncoder().encode(texto);
  const digest = await crypto.subtle.digest("SHA-1", dados);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Lê a resposta da API e devolve a contagem do sufixo procurado.
 *
 * Exportada porque é a parte com regra de verdade — o formato é
 * `SUFIXO:CONTAGEM` por linha, e os registros de preenchimento vêm com
 * contagem zero e precisam ser ignorados, senão uma senha limpa seria
 * recusada por causa do próprio mecanismo de privacidade.
 */
export function contarOcorrencias(corpoDaFaixa: string, sufixoProcurado: string): number {
  const alvo = sufixoProcurado.toUpperCase();
  for (const linha of corpoDaFaixa.split("\n")) {
    const [sufixo, contagem] = linha.trim().split(":");
    if (!sufixo || sufixo.toUpperCase() !== alvo) continue;
    const n = Number.parseInt(contagem ?? "0", 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function verificarSenhaVazada(
  senha: string,
  buscarFaixa: BuscarFaixa = buscarFaixaPadrao
): Promise<ResultadoSenhaVazada> {
  if (!senha) return { vazada: false, ocorrencias: 0, verificou: false };

  try {
    // WebCrypto exige contexto seguro. Em http:// sem ser localhost isto
    // não existe, e a verificação simplesmente não acontece.
    if (typeof crypto === "undefined" || !crypto.subtle) {
      return { vazada: false, ocorrencias: 0, verificou: false };
    }

    const hash = await sha1Hex(senha);
    const prefixo = hash.slice(0, 5);
    const sufixo = hash.slice(5);

    const corpo = await buscarFaixa(prefixo);
    const ocorrencias = contarOcorrencias(corpo, sufixo);

    return {
      vazada: ocorrencias >= OCORRENCIAS_PARA_RECUSAR,
      ocorrencias,
      verificou: true,
    };
  } catch {
    // Falha aberta, de propósito. O HIBP fora do ar não pode impedir
    // alguém de criar a conta ou recuperar a senha: isto é uma trava de
    // qualidade de senha, não uma fronteira de segurança, e transformar a
    // indisponibilidade de um terceiro em cadastro bloqueado troca um
    // risco pequeno por uma falha certa.
    return { vazada: false, ocorrencias: 0, verificou: false };
  }
}

/** Atalho para a tela: só recusa quando a consulta de fato aconteceu. */
export function senhaDeveSerRecusada(resultado: ResultadoSenhaVazada): boolean {
  return resultado.verificou && resultado.vazada;
}

/**
 * Mensagem para o usuário. Evita de propósito dizer "sua senha vazou" —
 * ela não vazou daqui, e sugerir isso assusta sem informar. O que houve é
 * que essa combinação já aparece em bases públicas, o que a torna alvo de
 * ataque por tentativa e erro.
 */
export function mensagemSenhaVazada(ocorrencias: number): string {
  const vezes = ocorrencias.toLocaleString("pt-BR");
  return (
    `Esta senha já apareceu ${vezes} ${ocorrencias === 1 ? "vez" : "vezes"} em vazamentos públicos ` +
    `de outros sites e é testada automaticamente por invasores. Escolha outra — não precisa ser ` +
    `complicada, só precisa ser sua.`
  );
}
