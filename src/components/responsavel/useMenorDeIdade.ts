import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { liberacaoConsentimento, situacaoIdade, type Liberacao, type PropositoResponsavel } from "@/lib/menorDeIdade";
import { VERSAO_DO_PROPOSITO } from "@/lib/textosConsentimento";

export type AceiteResponsavel = {
  id: string;
  proposito: string;
  versao_texto: string;
  responsavel_nome: string;
  responsavel_email: string;
  aceito_em: string;
};

export type PedidoResponsavel = {
  id: string;
  propositos: string[];
  responsavel_nome: string;
  responsavel_email: string;
  pedido_pela: string;
  criado_em: string;
  enviado_em: string | null;
  expira_em: string;
  respondido_em: string | null;
  cancelado_em: string | null;
};

/** A chave do cache: quem grava (data, pedido, revogação) invalida por ela. */
export const chaveMenorDeIdade = (alunoId: string | null | undefined) => ["menor-de-idade", alunoId] as const;

/**
 * A idade do aluno, os aceites vigentes do responsável e os últimos pedidos —
 * o que a tela precisa para decidir, antes de um consentimento sensível, se
 * segue, pede a data de nascimento ou pede o aceite do responsável
 * (`liberacaoConsentimento`). O aluno lê o próprio; a equipe, o dos alunos da
 * academia. Quem recusa de verdade é o banco.
 */
export function useMenorDeIdade(alunoId: string | null | undefined) {
  const consulta = useQuery({
    queryKey: ["menor-de-idade", alunoId],
    queryFn: async () => {
      const [aluno, aceites, pedidos] = await Promise.all([
        supabase.from("alunos").select("data_nascimento").eq("id", alunoId!).maybeSingle(),
        supabase
          .from("responsavel_aceites")
          .select("id, proposito, versao_texto, responsavel_nome, responsavel_email, aceito_em")
          .eq("aluno_id", alunoId!)
          .is("revogado_em", null),
        supabase
          .from("responsavel_pedidos")
          .select(
            "id, propositos, responsavel_nome, responsavel_email, pedido_pela, criado_em, enviado_em, expira_em, respondido_em, cancelado_em"
          )
          .eq("aluno_id", alunoId!)
          .order("criado_em", { ascending: false })
          .limit(5),
      ]);
      if (aluno.error) throw aluno.error;
      if (aceites.error) throw aceites.error;
      if (pedidos.error) throw pedidos.error;
      return {
        nascimento: aluno.data?.data_nascimento ?? null,
        aceites: (aceites.data ?? []) as AceiteResponsavel[],
        pedidos: (pedidos.data ?? []) as PedidoResponsavel[],
      };
    },
    enabled: !!alunoId,
  });

  const dados = consulta.data;
  const situacao = situacaoIdade(dados?.nascimento, hojeBrasilia());
  const aceiteVigente = (p: PropositoResponsavel) =>
    dados?.aceites.find((a) => a.proposito === p && a.versao_texto === VERSAO_DO_PROPOSITO[p]) ?? null;
  const liberacao = (p: PropositoResponsavel): Liberacao | "carregando" =>
    dados ? liberacaoConsentimento(situacao, !!aceiteVigente(p)) : "carregando";
  // O pedido que ainda vale: enviado, sem resposta, não substituído nem vencido.
  const pedidoAberto =
    dados?.pedidos.find(
      (p) => p.enviado_em && !p.respondido_em && !p.cancelado_em && new Date(p.expira_em).getTime() > Date.now()
    ) ?? null;

  return {
    carregando: consulta.isLoading,
    falhou: consulta.isError,
    nascimento: dados?.nascimento ?? null,
    situacao,
    aceiteVigente,
    liberacao,
    pedidoAberto,
    ultimoPedido: dados?.pedidos.find((p) => p.enviado_em) ?? null,
  };
}
