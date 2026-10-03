import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { andamento, proximaDaImplantacao, type Implantacao } from "@/lib/implantacao";

export const chaveImplantacao = (organizationId: string | undefined) => ["implantacao-academia", organizationId];

/** A implantação da academia, do primeiro acesso à primeira entrada, lida do banco. */
export function useImplantacaoAcademia() {
  const { organization } = useAuth();
  const consulta = useQuery({
    queryKey: chaveImplantacao(organization?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_implantacao_organizacao", { _organization_id: organization!.id });
      if (error) throw error;
      return data as unknown as Implantacao;
    },
    enabled: !!organization?.id,
  });
  const etapas = consulta.data?.etapas ?? [];
  return {
    ...consulta,
    implantacao: consulta.data ?? null,
    etapas,
    ...andamento(etapas),
    proxima: proximaDaImplantacao(etapas),
  };
}
