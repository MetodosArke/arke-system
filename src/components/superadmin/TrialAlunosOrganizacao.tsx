import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { TrialMetodoArke } from "@/components/admin/TrialMetodoArke";

const LIMITE = 20;

// Onde o Super Admin atribui o trial do Método. Trial é ferramenta de teste
// (homologação da jornada sem passar pelo Asaas), não oferta comercial — por
// isso mora aqui, e não na ficha do aluno que a academia usa. A lista vem de
// get_superadmin_alunos_trial: só nome e situação no Método.
export function TrialAlunosOrganizacao({ organizationId }: { organizationId: string }) {
  const [busca, setBusca] = useState("");
  const queryClient = useQueryClient();
  const chave = ["superadmin-alunos-trial", organizationId];

  const { data: alunos = [], isLoading, error } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_alunos_trial", { _organization_id: organizationId });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando alunos…</p>;
  if (error) return <p className="text-sm text-destructive">Não foi possível carregar os alunos.</p>;
  if (alunos.length === 0) return <p className="text-sm text-muted-foreground">Nenhum aluno cadastrado.</p>;

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtrados = termo ? alunos.filter((a) => a.nome.toLocaleLowerCase("pt-BR").includes(termo)) : alunos;
  const visiveis = filtrados.slice(0, LIMITE);
  const emTrial = alunos.filter((a) => a.assinatura_status === "trial").length;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Só para testes: libera a jornada do Método sem cobrança. {emTrial} aluno(s) em trial agora.
      </p>
      <Input
        placeholder="Buscar aluno pelo nome"
        aria-label="Buscar aluno pelo nome"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
      <ul className="space-y-3">
        {visiveis.map((a) => {
          // Assinatura paga não entra em trial por aqui: iniciar sobrescreveria
          // a linha dela e desligaria a cobrança do aluno.
          const pagante = a.assinatura_status === "ativa" || a.assinatura_status === "atrasada";
          return (
            <li key={a.aluno_id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <p className="text-sm font-medium mb-1.5">{a.nome}</p>
              {pagante ? (
                <p className="text-xs text-muted-foreground">Assinatura paga do Método — trial não se aplica.</p>
              ) : (
                <TrialMetodoArke
                  alunoId={a.aluno_id}
                  emTrial={a.assinatura_status === "trial"}
                  trialFim={a.trial_fim}
                  nivelAtual={a.nivel_atacado}
                  onAlterado={() => void queryClient.invalidateQueries({ queryKey: chave })}
                />
              )}
            </li>
          );
        })}
      </ul>
      {filtrados.length > LIMITE && (
        <p className="text-xs text-muted-foreground">
          Mostrando {LIMITE} de {filtrados.length}. Refine a busca pelo nome.
        </p>
      )}
    </div>
  );
}
