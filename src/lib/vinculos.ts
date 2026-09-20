/**
 * Escolha da organização corrente quando a pessoa tem vínculo ativo em mais
 * de uma.
 *
 * O caso é legítimo e já existe na base: gestor de uma academia que treina em
 * outra, professor que atende em duas unidades. Antes a consulta usava
 * `.maybeSingle()`, que falha com mais de uma linha — e o app ficava sem
 * organização nenhuma para essa pessoa, em vez de escolher uma.
 *
 * Isto é o remendo correto, não a solução completa: quem tem dois vínculos
 * continua vendo só um contexto por vez. O que resolve de fato é um seletor
 * de organização na interface, que é feature e não conserto.
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

export function escolherVinculo<T extends { role: string; created_at: string }>(
  vinculos: T[]
): T | null {
  if (vinculos.length === 0) return null;
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
