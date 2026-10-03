import { formatarDataBR } from "@/lib/dataBrasilia";

/**
 * O cadastro do rosto na catraca, como o app e a ficha mostram.
 *
 * Os dados vêm de `get_cadastro_rosto()`, que nunca traz a foto: só se a
 * academia tem leitor facial que aceita foto pelo app, se o texto vigente da
 * autorização cobre o rosto, se o aluno autorizou e como foi o último envio.
 *
 * Decisões do responsável de 02/10/2026: um consentimento só para digital e
 * rosto, e o rosto cadastrado pela câmera do equipamento ou por foto enviada
 * pelo próprio aluno no app.
 */

export interface UltimoEnvioRosto {
  tipo: "enviar_foto_rosto" | "cadastrar_rosto";
  enviado_em: string;
  catracas: number;
  pendentes: number;
  concluidas: number;
  falhas: number;
  erro: string | null;
}

export interface CadastroRosto {
  /** A academia tem catraca com leitor facial que recebe foto pelo app. */
  foto_pelo_app: boolean;
  /** O texto vigente da autorização fala de rosto (antes do texto novo, não). */
  texto_cobre_rosto: boolean;
  autorizado: boolean;
  /**
   * Pelo app, o rosto entra uma vez só (decisão do responsável, 02/10/2026):
   * depois de cadastrado, ou com a foto a caminho, trocar é com a academia.
   * Tentativa que falhou não conta.
   */
  pode_enviar_pelo_app: boolean;
  ultimo: UltimoEnvioRosto | null;
}

export function lerCadastroRosto(valor: unknown): CadastroRosto {
  const o = (valor && typeof valor === "object" ? valor : {}) as Record<string, unknown>;
  const u = o.ultimo && typeof o.ultimo === "object" ? (o.ultimo as Record<string, unknown>) : null;
  return {
    foto_pelo_app: o.foto_pelo_app === true,
    texto_cobre_rosto: o.texto_cobre_rosto === true,
    autorizado: o.autorizado === true,
    pode_enviar_pelo_app: o.pode_enviar_pelo_app === true,
    ultimo: u
      ? {
          tipo: u.tipo === "cadastrar_rosto" ? "cadastrar_rosto" : "enviar_foto_rosto",
          enviado_em: String(u.enviado_em ?? ""),
          catracas: Number(u.catracas ?? 0),
          pendentes: Number(u.pendentes ?? 0),
          concluidas: Number(u.concluidas ?? 0),
          falhas: Number(u.falhas ?? 0),
          erro: typeof u.erro === "string" && u.erro ? u.erro : null,
        }
      : null,
  };
}

export type TomSituacao = "andamento" | "ok" | "parcial" | "falhou";

/** Uma frase sobre o último envio, para o aluno e para a recepção. */
export function situacaoDoRosto(u: UltimoEnvioRosto | null): { tom: TomSituacao; texto: string } | null {
  if (!u) return null;
  const data = u.enviado_em ? formatarDataBR(u.enviado_em, { day: "2-digit", month: "2-digit" }) : "";
  const pelaFoto = u.tipo === "enviar_foto_rosto";
  if (u.pendentes > 0) {
    return {
      tom: "andamento",
      texto: pelaFoto
        ? `Foto enviada${data ? ` em ${data}` : ""}: chegando às catracas.`
        : "Cadastro pela câmera do leitor em andamento.",
    };
  }
  if (u.concluidas > 0 && u.falhas === 0) {
    return { tom: "ok", texto: `Rosto cadastrado nas catracas${data ? ` em ${data}` : ""}.` };
  }
  if (u.concluidas > 0) {
    return {
      tom: "parcial",
      texto: `Rosto cadastrado em ${u.concluidas} de ${u.catracas} catracas.${u.erro ? ` Faltou: ${u.erro}` : ""}`,
    };
  }
  const motivo = u.erro ? `: ${u.erro}${/[.!?]$/.test(u.erro) ? "" : "."}` : ".";
  return {
    tom: "falhou",
    texto: `${pelaFoto ? "A foto não entrou" : "O cadastro não deu certo"}${motivo}${pelaFoto ? " Tente outra foto." : ""}`,
  };
}

/**
 * Tamanho da foto que sai do aparelho. Os leitores pedem rosto nítido e
 * arquivo pequeno (a Topdata recomenda até 150 KB, idealmente 480x640; a
 * Control iD aceita a partir de 160x160; a Intelbras, de 150x300 a 600x1200,
 * até 100 KB). A foto é reduzida para caber em 480x640 na vertical e em
 * 600x450 na horizontal (a Intelbras recusa largura acima de 600), sem
 * aumentar a pequena e sem cortar: o leitor procura o rosto na imagem inteira.
 */
export function dimensoesDaFoto(largura: number, altura: number): { largura: number; altura: number } {
  if (largura <= 0 || altura <= 0) throw new Error("Foto sem tamanho.");
  const [maxL, maxA] = largura > altura ? [600, 450] : [480, 640];
  const escala = Math.min(1, maxL / largura, maxA / altura);
  return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}

/** A foto pequena demais não tem rosto que o leitor consiga usar. */
export function fotoGrandeOBastante(largura: number, altura: number): boolean {
  return Math.min(largura, altura) >= 160;
}

/** Limite do arquivo enviado: o da Intelbras (100 KB), que cabe também na recomendação da Topdata (150 KB). */
export const TAMANHO_MAXIMO_FOTO = 100 * 1024;

/** Quantos bytes um data URL em base64 representa. */
export function bytesDoDataUrl(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const preenchimento = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - preenchimento;
}
