import { useAuth } from "@/contexts/AuthContext";
import { podeArea, type AcessoDaPessoa, type AreaArkefit } from "@/lib/acessosArkefit";

/**
 * O acesso de quem está na Visão Master: Sócio e os níveis da equipe
 * contratada (src/lib/acessosArkefit.ts). As telas usam este gancho para
 * esconder o que a pessoa não abre e para não disparar a consulta de uma área
 * que o banco recusaria; os testes das telas o simulam.
 */
export function useAcessoArkefit(): { acesso: AcessoDaPessoa; pode: (area: AreaArkefit) => boolean } {
  const { acessoArkefit } = useAuth();
  return { acesso: acessoArkefit, pode: (area) => podeArea(acessoArkefit, area) };
}
