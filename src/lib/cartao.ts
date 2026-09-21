/**
 * Validação de cartão de crédito no cliente.
 *
 * Existe para dar resposta rápida a quem está digitando, e **não** é a
 * validação que vale: a edge function `asaas-cartao-assinatura` repete tudo
 * isto em Deno, e o Asaas decide no fim. Aqui só se evita mandar para a rede um
 * número com dígito trocado.
 *
 * Nada neste arquivo guarda, registra ou devolve o número completo. A única
 * coisa derivada que sai daqui é o final de 4 dígitos, que é o que se mostra
 * ("cartão final 4242") e o que o banco guarda.
 */

import { validarCpf } from "./cpf";

export type Bandeira = "visa" | "mastercard" | "amex" | "elo" | "hipercard" | "diners" | "discover" | "outra";

export const NOME_BANDEIRA: Record<Bandeira, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  elo: "Elo",
  hipercard: "Hipercard",
  diners: "Diners",
  discover: "Discover",
  outra: "Cartão",
};

export function somenteDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

/** Dígito verificador de Luhn — pega dígito trocado e a maioria das inversões. */
export function luhnValido(numero: string): boolean {
  const d = somenteDigitos(numero);
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 === 0;
}

// Prefixos de Elo e Hipercard vêm antes de Visa/Master porque alguns deles
// começam com 4 ou 5 e seriam classificados errado.
const PREFIXOS_ELO = [
  "401178", "401179", "431274", "438935", "451416", "457393", "457631", "457632", "504175",
  "506699", "5067", "509", "627780", "636297", "636368", "650", "6516", "6550",
];

/** Bandeira pelo início do número. Serve para o ícone; quem confirma é o Asaas. */
export function detectarBandeira(numero: string): Bandeira {
  const d = somenteDigitos(numero);
  if (!d) return "outra";
  if (PREFIXOS_ELO.some((p) => d.startsWith(p))) return "elo";
  if (d.startsWith("606282") || d.startsWith("3841")) return "hipercard";
  if (/^3[47]/.test(d)) return "amex";
  if (/^3(0[0-5]|[68])/.test(d)) return "diners";
  if (/^4/.test(d)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "mastercard";
  if (/^6(011|5)/.test(d)) return "discover";
  return "outra";
}

/** Agrupa de 4 em 4 (Amex: 4-6-5) para a digitação. */
export function mascararNumero(numero: string): string {
  const d = somenteDigitos(numero).slice(0, 19);
  if (detectarBandeira(d) === "amex") {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(" ");
  }
  return d.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export function finalDoCartao(numero: string): string {
  return somenteDigitos(numero).slice(-4);
}

/** Validade no formato do Asaas (mês com 2 dígitos, ano com 4), ou nulo se inválida. */
export function normalizarValidade(mes: string, ano: string, hoje = new Date()): { mes: string; ano: string } | null {
  const m = Number(somenteDigitos(mes));
  let a = Number(somenteDigitos(ano));
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (a < 100) a += 2000;
  if (a < 2000 || a > 2100) return null;
  // Vale até o último dia do mês impresso no cartão.
  const fimDoMes = new Date(a, m, 0, 23, 59, 59);
  if (fimDoMes < hoje) return null;
  return { mes: String(m).padStart(2, "0"), ano: String(a) };
}

export function cvvValido(cvv: string, bandeira: Bandeira): boolean {
  const d = somenteDigitos(cvv);
  return bandeira === "amex" ? d.length === 4 : d.length === 3 || d.length === 4;
}

export interface DadosCartao {
  titular: string;
  numero: string;
  mes: string;
  ano: string;
  cvv: string;
}

export interface DadosTitular {
  nome: string;
  email: string;
  cpf: string;
  cep: string;
  numeroEndereco: string;
  telefone: string;
}

/** Primeiro problema encontrado, em linguagem de quem está digitando; ou nulo. */
export function erroNoCartao(c: DadosCartao, t: DadosTitular, hoje = new Date()): string | null {
  if (c.titular.trim().length < 3) return "Informe o nome como está impresso no cartão.";
  if (!luhnValido(c.numero)) return "Número do cartão inválido. Confira os dígitos.";
  if (!normalizarValidade(c.mes, c.ano, hoje)) return "Validade inválida ou vencida.";
  if (!cvvValido(c.cvv, detectarBandeira(c.numero))) return "Código de segurança inválido.";
  if (t.nome.trim().length < 3) return "Informe o nome do titular.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email.trim())) return "E-mail do titular inválido.";
  if (!validarCpf(t.cpf)) return "CPF do titular inválido.";
  if (somenteDigitos(t.cep).length !== 8) return "CEP inválido.";
  if (!t.numeroEndereco.trim()) return "Informe o número do endereço.";
  const tel = somenteDigitos(t.telefone);
  if (tel.length < 10 || tel.length > 11) return "Telefone com DDD inválido.";
  return null;
}
