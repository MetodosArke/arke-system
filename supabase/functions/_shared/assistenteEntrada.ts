// O que o assistente da academia manda ao modelo, e o que tira antes.
//
// Desde 03/10/2026 o assistente usa o mesmo modelo do Vigia, pelo perfil
// `global.` do Bedrock, que processa fora do Brasil (decisão do responsável).
// Por isso a pergunta sai sem identificação: sem CPF, e-mail e telefone, e sem
// o nome de quem está na academia, alunos e equipe. O resto da entrada já não
// tinha nome: os trechos são da Central de Ajuda, e a situação diz "o aluno
// citado".
//
// Mora em `_shared` porque a porta do modelo (`consultarAssistente`, em
// `ia.ts`) monta a entrada por aqui: não existe caminho até o modelo que pule
// a limpeza. Sem Deno e sem Supabase, para o teste do app exercitar o código
// real. `tirarNomes` também tira o nome do contato da mensagem que vai ao
// modelo da Letícia (`agente-comercial/fluxo.ts`, 07/10/2026).

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function tirarContatos(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[e-mail]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF]")
    .replace(/\+?\(?\d[\d\s().-]{7,}\d/g, "[telefone]");
}

const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "di", "du", "del", "della", "van", "von", "der", "e", "y"]);

// Palavras do dia a dia que também são nome ou sobrenome. Escritas em
// minúscula, ficam: "há 5 dias", "campos do formulário", "a regra não está
// clara". Com a inicial maiúscula, viram "[nome]" como qualquer outro.
const COMUNS = new Set(
  (
    "dias dia filho filha neto neta junior leite vale campos campo rosa luz paz flor clara claro sol mar cruz " +
    "torres pinto guerra franco branco rocha prado fontes fonte rios rio reis rei santos santo ramos porto monte " +
    "matos mato estrela vitoria gloria aurora graca bela belo mel alegria amor lima costa costas serra pedra novo " +
    "nova velho bispo pastor valente justo brasil maio abril cordeiro coelho lobo leao carneiro jesus"
  ).split(/\s+/)
);

/**
 * Troca por "[nome]" toda palavra que é parte do nome de alguém da academia.
 * Sem diferença de acento nem de maiúscula, menos nas palavras comuns, que só
 * são trocadas com a inicial maiúscula. Nomes seguidos ("Bruna da Silva")
 * viram um "[nome]" só.
 */
export function tirarNomes(texto: string, nomes: string[]): string {
  const partes = new Set<string>();
  for (const nome of nomes) {
    for (const p of normalizar(nome).split(/[^a-z]+/)) {
      if (p.length >= 3 && !PARTICULAS.has(p)) partes.add(p);
    }
  }
  if (!partes.size) return texto;
  const trocado = texto.replace(/\p{L}+/gu, (palavra) => {
    const n = normalizar(palavra);
    if (!partes.has(n)) return palavra;
    const maiuscula = palavra[0] !== palavra[0].toLowerCase();
    return !maiuscula && COMUNS.has(n) ? palavra : "[nome]";
  });
  return trocado.replace(/\[nome\](?:\s+(?:(?:da|de|do|das|dos|e)\s+)?\[nome\])+/giu, "[nome]");
}

/** Um trecho da Central de Ajuda, como a busca devolve. */
export type TrechoEntrada = { artigo: string; secao: string | null; texto: string };

/**
 * A pergunta sem identificação, os trechos e a situação: tudo o que vai ao
 * modelo. Os contatos saem antes dos nomes: trocar o "bruna" de
 * "bruna@x.com" primeiro desfaria o e-mail, e o domínio iria junto.
 */
export function montarEntrada(pergunta: string, achados: TrechoEntrada[], situacao: string, nomes: string[]): string {
  const trechos = achados.length
    ? achados.map((a, i) => `[${i + 1}] ${a.artigo}${a.secao ? ` — ${a.secao}` : ""}\n${a.texto}`).join("\n\n")
    : "(nenhum trecho encontrado)";
  return [
    `PERGUNTA:\n${tirarNomes(tirarContatos(pergunta), nomes).slice(0, 1000)}`,
    `TRECHOS DA CENTRAL DE AJUDA:\n${trechos}`,
    situacao ? `SITUAÇÃO DO SISTEMA AGORA:\n${situacao}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
