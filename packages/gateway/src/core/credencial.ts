import type { Credencial } from "../types";

/**
 * De onde veio a leitura, no vocabulário comum às marcas:
 *
 * - `teclado`: o que a pessoa digitou;
 * - `rfid` (ou `cartao`): o número gravado no cartão de proximidade;
 * - `biometria`: o número do usuário que o próprio equipamento reconheceu
 *   pela digital ou pelo rosto;
 * - `codigo_barras` e `qrcode`: o texto de um código impresso ou na tela.
 */
export type OrigemLeitura = "teclado" | "rfid" | "cartao" | "biometria" | "codigo_barras" | "qrcode";

const ORIGENS_DE_CODIGO: ReadonlySet<string> = new Set(["codigo_barras", "qrcode"]);

/**
 * A credencial que uma leitura vale, ou null quando ela não identifica
 * ninguém. É a regra de todas as marcas que mandam o valor lido em vez do
 * usuário já resolvido (Toletus e Topdata Inner).
 *
 * **Teclado: só o CPF** (onze dígitos). Os números do equipamento são
 * pequenos e sequenciais (1, 2, 3…) e a catraca não tem senha para
 * conferir: quem digitasse "12" entraria como o aluno 12.
 *
 * **Código de barras e QR: nada** (desde a 1.9). Pela mesma razão do
 * teclado: o texto do código virava o número do aluno no equipamento, e
 * qualquer um imprime um código com "12". Nenhum fluxo do ARKE dá ao aluno
 * um código para mostrar na catraca: o QR do ARKE é o do check-in na
 * recepção, lido pelo celular. A Control iD já negava o QR desde a 1.0.
 *
 * Cartão e biometria são o identificador do equipamento, que mora em
 * `alunos.identificador_catraca`: o número do cartão sai do chip, e o da
 * biometria, do reconhecimento feito dentro do equipamento.
 */
export function credencialDaLeitura(origem: OrigemLeitura | string, valor: string): Credencial | null {
  if (origem === "teclado") {
    const digitos = valor.replace(/\D/g, "");
    return digitos.length === 11 ? { tipo: "cpf", valor: digitos } : null;
  }
  if (ORIGENS_DE_CODIGO.has(origem)) return null;
  return { tipo: "identificador_catraca", valor };
}

/**
 * A frase do display para a leitura que não vira credencial. No teclado,
 * dizer o que fazer ajuda e não expõe nada. No código, a negativa é neutra.
 */
export function displayDaLeituraRecusada(origem: OrigemLeitura | string): string {
  return origem === "teclado" ? "Digite o CPF" : "Acesso negado";
}
