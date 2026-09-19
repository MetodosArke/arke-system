import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Phone, ClipboardList, AlertTriangle, Dumbbell, UtensilsCrossed, Ruler, Pencil, Power, UserX } from "lucide-react";
import { Bloco, formatarData } from "@/components/admin/perfilSheetHelpers";

const PAPEL_LABEL: Record<string, string> = {
  gestor: "Gestor",
  professor: "Personal",
  nutricionista: "Nutricionista",
  recepcao: "Recepção",
};

const TAREFA_TIPO_LABEL: Record<string, string> = {
  ativacao: "Ativação",
  barreira: "Barreira de treino",
  dor: "Relato de dor",
  anamnese: "Anamnese pendente",
  ajuste: "Ajuste de prescrição",
  outro: "Outro",
};

export interface MembroEquipe {
  user_id: string;
  role: string;
  status: string;
  full_name: string;
}

// Painel lateral com o perfil completo de um membro da equipe — aberto
// clicando no nome dele em "Equipe". Reúne dados de contato com um retrato
// rápido da atividade (pendências atribuídas, prescrições publicadas,
// avaliações registradas), e reaproveita as mesmas ações de
// editar/inativar/remover que já existiam na lista, para não duplicar
// aquela lógica aqui dentro.
export function FuncionarioPerfilSheet({
  membro,
  onOpenChange,
  onEditar,
  onInativar,
  onRemover,
}: {
  membro: MembroEquipe | null;
  onOpenChange: (open: boolean) => void;
  onEditar: (membro: MembroEquipe) => void;
  onInativar: (membro: MembroEquipe) => void;
  onRemover: (membro: MembroEquipe) => void;
}) {
  const { organization, user } = useAuth();
  const ehVoceMesmo = membro?.user_id === user?.id;

  const { data: perfil, isLoading } = useQuery({
    queryKey: ["funcionario-perfil", membro?.user_id, organization?.id],
    queryFn: async () => {
      const userId = membro!.user_id;
      const organizationId = organization!.id;
      const ha30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [
        { data: profile },
        { data: tarefasAbertas },
        { count: treinosAtivos },
        { count: dietasAtivas },
        { count: avaliacoesRecentes },
      ] = await Promise.all([
        supabase.from("profiles").select("phone, cpf").eq("user_id", userId).maybeSingle(),
        supabase
          .from("tarefas")
          .select("id, tipo, motivo, prioridade, sla_prazo")
          .eq("organization_id", organizationId)
          .eq("responsavel_id", userId)
          .in("status", ["aberta", "em_andamento"])
          .order("sla_prazo", { ascending: true }),
        supabase
          .from("treinos")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("publicado_por", userId)
          .eq("status", "ativo"),
        supabase
          .from("dietas")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("publicado_por", userId)
          .eq("status", "ativo"),
        supabase
          .from("avaliacoes_fisicas")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("avaliado_por", userId)
          .gte("data_avaliacao", ha30dias),
      ]);

      return {
        profile,
        tarefasAbertas: tarefasAbertas ?? [],
        treinosAtivos: treinosAtivos ?? 0,
        dietasAtivas: dietasAtivas ?? 0,
        avaliacoesRecentes: avaliacoesRecentes ?? 0,
      };
    },
    enabled: !!membro && !!organization?.id,
  });

  return (
    <Sheet open={!!membro} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando perfil...</p>}
        {membro && perfil && (
          <>
            <SheetHeader className="text-left space-y-2">
              <SheetTitle>{membro.full_name}</SheetTitle>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{PAPEL_LABEL[membro.role] ?? membro.role}</Badge>
                <Badge variant={membro.status === "active" ? "default" : "outline"}>
                  {membro.status === "active" ? "Ativo" : "Inativo"}
                </Badge>
              </div>
            </SheetHeader>

            <div className="flex gap-2 mt-4">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => onEditar(membro)}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Editar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={ehVoceMesmo}
                title={ehVoceMesmo ? "Você não pode inativar seu próprio acesso" : undefined}
                onClick={() => onInativar(membro)}
              >
                <Power className="h-3.5 w-3.5 mr-1.5" />
                {membro.status === "active" ? "Inativar" : "Ativar"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-destructive"
                disabled={ehVoceMesmo}
                title={ehVoceMesmo ? "Você não pode remover seu próprio acesso" : undefined}
                onClick={() => onRemover(membro)}
              >
                <UserX className="h-3.5 w-3.5 mr-1.5" />
                Remover
              </Button>
            </div>

            <Separator className="my-4" />

            <div className="space-y-4">
              <Bloco titulo="Dados" icon={Phone}>
                <p className="text-sm">{perfil.profile?.phone ?? "Telefone não informado"}</p>
                {perfil.profile?.cpf && <p className="text-xs text-muted-foreground">CPF: {perfil.profile.cpf}</p>}
              </Bloco>

              {(perfil.treinosAtivos > 0 || perfil.dietasAtivas > 0) && (
                <Bloco titulo="Prescrições Ativas Publicadas" icon={Dumbbell}>
                  {perfil.treinosAtivos > 0 && (
                    <p className="text-sm flex items-center gap-1.5">
                      <Dumbbell className="h-3.5 w-3.5 text-muted-foreground" />
                      {perfil.treinosAtivos} treino(s) ativo(s)
                    </p>
                  )}
                  {perfil.dietasAtivas > 0 && (
                    <p className="text-sm flex items-center gap-1.5">
                      <UtensilsCrossed className="h-3.5 w-3.5 text-muted-foreground" />
                      {perfil.dietasAtivas} dieta(s) ativa(s)
                    </p>
                  )}
                </Bloco>
              )}

              {perfil.avaliacoesRecentes > 0 && (
                <Bloco titulo="Avaliações Físicas (últimos 30 dias)" icon={Ruler}>
                  <p className="text-sm">{perfil.avaliacoesRecentes} avaliação(ões) registrada(s)</p>
                </Bloco>
              )}

              {perfil.tarefasAbertas.length > 0 && (
                <Bloco titulo="Pendências Atribuídas na Fila" icon={AlertTriangle}>
                  <ul className="space-y-1">
                    {perfil.tarefasAbertas.map((t) => (
                      <li key={t.id} className="text-sm">
                        <Badge variant="outline" className="mr-1.5 text-[10px]">
                          {TAREFA_TIPO_LABEL[t.tipo] ?? t.tipo}
                        </Badge>
                        {t.motivo}
                        <span className="text-xs text-muted-foreground"> · SLA {formatarData(t.sla_prazo)}</span>
                      </li>
                    ))}
                  </ul>
                </Bloco>
              )}

              {perfil.tarefasAbertas.length === 0 &&
                perfil.treinosAtivos === 0 &&
                perfil.dietasAtivas === 0 &&
                perfil.avaliacoesRecentes === 0 && (
                  <Bloco titulo="Atividade" icon={ClipboardList}>
                    <p className="text-sm text-muted-foreground">Sem atividade recente registrada.</p>
                  </Bloco>
                )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
