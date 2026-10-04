// Freio das edge functions que custam fora do banco: Asaas, e-mail e IA.
//
// A conta do Asaas é uma só para todas as academias (25.000 chamadas a cada
// 12 horas): um laço numa academia não pode parar a cobrança das outras. Os
// limites ficam em cada função e são folgados — uso de verdade não chega
// neles; o que chega é laço, com defeito ou de propósito.
//
// A contagem mora no banco (`registrar_chamada`, só a service role), com uma
// trava por chave para duas chamadas simultâneas não passarem juntas.
//
// Falha do banco **libera**, pelo mesmo motivo do limite da matrícula pública:
// com o banco fora a função falharia adiante de qualquer jeito, e travar aqui
// só trocaria a mensagem honesta por uma falsa de "muitas tentativas".

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Uma regra: no máximo `limite` chamadas por `chave` em `janelaSeg` segundos. */
export type RegraFreio = { chave: string; limite: number; janelaSeg: number };

export const MENSAGEM_FREIO = "Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.";

/**
 * Registra a chamada em todas as regras e devolve se ela coube. Para na
 * primeira que não couber, e a chamada recusada não conta nas seguintes.
 */
export async function dentroDoFreio(admin: ClienteRpc, regras: RegraFreio[]): Promise<boolean> {
  for (const r of regras) {
    try {
      const { data, error } = await admin.rpc("registrar_chamada", {
        _chave: r.chave,
        _limite: r.limite,
        _janela_seg: r.janelaSeg,
      });
      if (error) {
        console.error("freio: falha ao registrar", (error as { code?: string }).code ?? "");
        continue;
      }
      if (data === false) return false;
    } catch {
      console.error("freio: falha ao registrar");
    }
  }
  return true;
}

/**
 * As regras das funções que chamam o Asaas pela conta da ArkeFit, contadas por
 * chamada à função (uma matrícula é uma chamada aqui e umas 5 no Asaas):
 *
 * - por pessoa, 30 a cada 10 minutos: uma recepção cheia não chega nisso;
 * - por academia, 120 por hora (umas 600 chamadas no Asaas): uma academia
 *   sozinha, no pior caso, gasta 7.200 das 25.000 da cota de 12 horas;
 * - no total, 400 por hora (umas 24.000 em 12 horas), para muitas academias
 *   ao mesmo tempo não esgotarem a cota de todas.
 */
export function regrasAsaas(userId: string, organizationId: string | null): RegraFreio[] {
  return [
    { chave: `asaas:user:${userId}`, limite: 30, janelaSeg: 10 * 60 },
    ...(organizationId ? [{ chave: `asaas:org:${organizationId}`, limite: 120, janelaSeg: 60 * 60 }] : []),
    { chave: "asaas:total", limite: 400, janelaSeg: 60 * 60 },
  ];
}
