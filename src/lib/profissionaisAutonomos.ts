import { tituloEtapa } from "@/lib/implantacao";

// Regras da tela de profissionais autônomos da Visão Master. A linha vem de
// get_superadmin_profissionais_autonomos().

export type EspecialidadeAutonomo = "professor" | "nutricionista";

export type ParceiroAutonomo = { user_id: string; nome: string | null; email: string | null; papel: string };

export type ProfissionalAutonomo = {
  organization_id: string;
  nome: string;
  slug: string;
  especialidade: EspecialidadeAutonomo | null;
  status: "trial" | "ativo" | "inadimplente" | "suspenso" | "cancelado";
  gestor_user_id: string | null;
  gestor_nome: string | null;
  email: string | null;
  telefone: string | null;
  ultimo_acesso: string | null;
  alunos_total: number;
  parceiros: ParceiroAutonomo[];
  created_at: string;
  sem_gestor: boolean;
  onboarding_completed: boolean;
  etapa_implantacao: string | null;
  pode_excluir: boolean;
  /** A conta já existia e ainda não entrou pelo link do e-mail: a gestão fica pendente (20261362010000). */
  gestor_pendente?: boolean;
};

export const ESPECIALIDADE_ROTULO: Record<EspecialidadeAutonomo, string> = {
  professor: "Personal Trainer",
  nutricionista: "Nutricionista",
};

export type SituacaoAcesso = "sem_responsavel" | "convite_pendente" | "ativo";

/**
 * Quem nunca entrou está com o convite pendente, mesmo com o perfil "ativo":
 * o perfil nasce assim no próprio convite. É o último acesso que diz. A conta
 * que já existia (com último acesso de outro vínculo) fica pendente até entrar
 * pelo link do e-mail: até lá o painel não é dela.
 */
export function situacaoAcesso(p: Pick<ProfissionalAutonomo, "sem_gestor" | "ultimo_acesso" | "gestor_pendente">): SituacaoAcesso {
  if (p.sem_gestor) return "sem_responsavel";
  if (p.gestor_pendente) return "convite_pendente";
  return p.ultimo_acesso ? "ativo" : "convite_pendente";
}

export const ROTULO_ACESSO: Record<SituacaoAcesso, string> = {
  sem_responsavel: "Sem responsável",
  convite_pendente: "Convite pendente",
  ativo: "Entra no painel",
};

/**
 * Trocar o responsável só enquanto ele nunca entrou: aí é e-mail errado no
 * convite. Quem já usa o painel tem o negócio ali dentro, e a correção é o
 * e-mail de login dele, não outra pessoa no lugar.
 */
export function podeTrocarResponsavel(p: Pick<ProfissionalAutonomo, "sem_gestor" | "ultimo_acesso" | "gestor_pendente">): boolean {
  return situacaoAcesso(p) !== "ativo";
}

export function rotuloImplantacao(p: Pick<ProfissionalAutonomo, "onboarding_completed" | "etapa_implantacao">): string {
  if (p.onboarding_completed) return "Liberado";
  return p.etapa_implantacao ? tituloEtapa(p.etapa_implantacao) : "Não começou";
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Busca pelo painel, pelo responsável ou pelo e-mail, sem acento nem maiúscula. */
export function filtrarProfissionais<T extends Pick<ProfissionalAutonomo, "nome" | "gestor_nome" | "email">>(
  lista: T[],
  busca: string
): T[] {
  const termo = semAcento(busca.trim());
  if (!termo) return lista;
  return lista.filter((p) => [p.nome, p.gestor_nome ?? "", p.email ?? ""].some((c) => semAcento(c).includes(termo)));
}

/** O que a ficha precisa para salvar: o telefone vai como foi digitado, e o banco confere. */
export function telefoneValido(telefone: string): boolean {
  const digitos = telefone.replace(/\D/g, "");
  return digitos.length === 0 || (digitos.length >= 10 && digitos.length <= 13);
}
