/**
 * Escolha da organização corrente quando a pessoa tem vínculo ativo em mais
 * de uma.
 *
 * O caso é legítimo e já existe na base: gestor de uma academia que treina em
 * outra, professor que atende em duas unidades. Antes a consulta usava
 * `.maybeSingle()`, que falha com mais de uma linha — e o app ficava sem
 * organização nenhuma para essa pessoa, em vez de escolher uma.
 *
 * Quem tem mais de um vínculo troca de unidade pelo seletor do cabeçalho
 * (multiunidade, Rodada 6): a escolha fica guardada no aparelho e passa a
 * valer aqui, enquanto a pessoa ainda tiver vínculo ativo naquela
 * organização. Sem preferência válida, vale a hierarquia abaixo.
 */

// Papéis de equipe vêm antes de `aluno`: quem trabalha numa academia e treina
// em outra entra no contexto de trabalho, onde tem responsabilidade sobre
// outras pessoas.
const PRIORIDADE: Record<string, number> = {
  gestor: 0,
  professor: 1,
  nutricionista: 2,
  aluno: 3,
};

export function escolherVinculo<T extends { role: string; created_at: string; organization_id?: string }>(
  vinculos: T[],
  organizacaoPreferida?: string | null
): T | null {
  if (vinculos.length === 0) return null;
  const preferido = organizacaoPreferida ? vinculos.find((v) => v.organization_id === organizacaoPreferida) : undefined;
  if (preferido) return preferido;
  return [...vinculos].sort((a, b) => {
    const pa = PRIORIDADE[a.role] ?? 99;
    const pb = PRIORIDADE[b.role] ?? 99;
    if (pa !== pb) return pa - pb;
    // Empate resolvido pelo vínculo mais antigo: qualquer critério serve,
    // desde que seja estável — o que não pode é a organização mudar entre
    // dois logins da mesma pessoa.
    return a.created_at.localeCompare(b.created_at);
  })[0];
}

const chavePreferencia = (userId: string) => `arke:organizacao:${userId}`;

/** Unidade escolhida no seletor, guardada no aparelho. Falha de armazenamento vira "sem preferência". */
export function lerOrganizacaoPreferida(userId: string): string | null {
  try {
    return localStorage.getItem(chavePreferencia(userId));
  } catch {
    return null;
  }
}

export function gravarOrganizacaoPreferida(userId: string, organizationId: string) {
  try {
    localStorage.setItem(chavePreferencia(userId), organizationId);
  } catch {
    // Sem armazenamento (aba privada): a troca vale só até recarregar.
  }
}
