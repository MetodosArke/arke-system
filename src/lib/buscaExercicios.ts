/**
 * Busca da prescrição com filtros rápidos, como no app original: grupo
 * muscular + equipamento + texto. Sem acento e sem caixa: "supino" acha
 * "Supino máquina", e "biceps" acha "Bíceps".
 */
export type ExercicioBusca = {
  id: string;
  nome: string;
  grupo_muscular: string;
  grupos_musculares?: string[] | null;
  equipamento?: string | null;
  organization_id?: string | null;
  ativo?: boolean | null;
};

export const normalizar = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export const gruposDe = (e: ExercicioBusca) => (e.grupos_musculares?.length ? e.grupos_musculares : [e.grupo_muscular]);

export function filtrarExercicios<T extends ExercicioBusca>(
  lista: T[],
  { texto = "", grupo = null, equipamento = null }: { texto?: string; grupo?: string | null; equipamento?: string | null }
): T[] {
  const termo = normalizar(texto);
  return lista
    .filter((e) => e.ativo !== false)
    .filter((e) => !grupo || gruposDe(e).includes(grupo))
    .filter((e) => !equipamento || e.equipamento === equipamento)
    .filter((e) => !termo || normalizar(e.nome).includes(termo) || gruposDe(e).some((g) => normalizar(g).includes(termo)))
    // Os da própria academia primeiro: são os que ela criou por não achar no padrão.
    .sort((a, b) => Number(!!b.organization_id) - Number(!!a.organization_id) || a.nome.localeCompare(b.nome, "pt-BR"));
}
