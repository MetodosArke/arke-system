import { CAIXA_CONSENTIMENTO_SAUDE, TEXTO_CONSENTIMENTO_SAUDE, VERSAO_CONSENTIMENTO_SAUDE } from "@/lib/consentimentoSaude";
import { TEXTO_TERMO_BIOMETRIA, TITULO_TERMO_BIOMETRIA, VERSAO_CONSENTIMENTO_BIOMETRIA } from "@/lib/termoBiometria";
import { AVISO_PROCESSAMENTO_IA_TEXTO, PROPOSITOS_IA, VERSAO_CONSENTIMENTO_IA } from "@/lib/consentimentoIA";
import type { PropositoResponsavel } from "@/lib/menorDeIdade";

/**
 * O texto de cada consentimento sensível, como o aluno o lê no app, para a
 * página em que o responsável do aluno menor autoriza (decisão de 06/10/2026).
 *
 * Nenhum texto novo: cada propósito junta os textos que já existem e já são
 * versionados — `consentimentoSaude.ts`, `termoBiometria.ts` e
 * `consentimentoIA.ts`. O responsável lê exatamente o que o aluno lê.
 *
 * `textoCanonico()` é o que vira o SHA-256 gravado no aceite. A tabela que a
 * função `responsavel-aceite` usa (`_shared/textosResponsavel.ts`) é conferida
 * contra ele por `textosConsentimento.test.ts`: mudou um texto daqui, o teste
 * falha até a versão e o hash de lá acompanharem.
 */
export type TextoConsentimento = { titulo: string; paragrafos: string[]; versao: string };

const ia = (chave: "anamnese" | "chat"): TextoConsentimento => {
  const p = PROPOSITOS_IA.find((x) => x.chave === chave)!;
  return { titulo: p.titulo, paragrafos: [p.texto, AVISO_PROCESSAMENTO_IA_TEXTO], versao: VERSAO_CONSENTIMENTO_IA };
};

export const TEXTOS_CONSENTIMENTO: Record<PropositoResponsavel, TextoConsentimento> = {
  saude: {
    titulo: "LGPD — Dados de Saúde",
    paragrafos: [TEXTO_CONSENTIMENTO_SAUDE, CAIXA_CONSENTIMENTO_SAUDE],
    versao: VERSAO_CONSENTIMENTO_SAUDE,
  },
  biometria: {
    titulo: TITULO_TERMO_BIOMETRIA,
    paragrafos: TEXTO_TERMO_BIOMETRIA,
    versao: VERSAO_CONSENTIMENTO_BIOMETRIA,
  },
  ia_anamnese: ia("anamnese"),
  ia_chat: ia("chat"),
};

/** A versão vigente do texto de cada propósito — espelho de `public.versao_proposito_responsavel()`. */
export const VERSAO_DO_PROPOSITO: Record<PropositoResponsavel, string> = {
  saude: TEXTOS_CONSENTIMENTO.saude.versao,
  biometria: TEXTOS_CONSENTIMENTO.biometria.versao,
  ia_anamnese: TEXTOS_CONSENTIMENTO.ia_anamnese.versao,
  ia_chat: TEXTOS_CONSENTIMENTO.ia_chat.versao,
};

/** Título e parágrafos, um por linha: o texto de que sai o hash. */
export function textoCanonico(proposito: PropositoResponsavel): string {
  const t = TEXTOS_CONSENTIMENTO[proposito];
  return [t.titulo, ...t.paragrafos].join("\n");
}
