import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Phone, ClipboardList, AlertTriangle, Dumbbell, UtensilsCrossed, Ruler, Pencil, Power, UserX, CheckCircle2 } from "lucide-react";
import { Bloco, formatarData } from "@/components/admin/perfilSheetHelpers";
import { AlunoPerfilSheet } from "@/components/admin/AlunoPerfilSheet";

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

type AtividadeTipo = "treino" | "dieta" | "avaliacao" | "tarefa";

interface AtividadeItem {
  id: string;
  tipo: AtividadeTipo;
  alunoId: string | null;
  data: string;
  descricao: string;
}

const ATIVIDADE_ICON: Record<AtividadeTipo, typeof Dumbbell> = {
  treino: Dumbbell,
  dieta: UtensilsCrossed,
  avaliacao: Ruler,
  tarefa: CheckCircle2,
};

const ATIVIDADE_LABEL: Record<AtividadeTipo, string> = {
  treino: "Treino publicado",
  dieta: "Dieta publicada",
  avaliacao: "Avaliação física registrada",
  tarefa: "Pendência resolvida",
};

// Painel lateral com o perfil completo de um membro da equipe — aberto
// clicando no nome dele em "Equipe". Reúne dados de contato com um
// registro auditável do que cada um fez e para quem (treinos/dietas
// publicados, avaliações registradas, pendências resolvidas — cada linha
// leva ao perfil do aluno correspondente), e reaproveita as mesmas ações
// de editar/inativar/remover que já existiam na lista, para não duplicar
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
  const [alunoAbertoId, setAlunoAbertoId] = useState<string | null>(null);

  const { data: perfil, isLoading } = useQuery({
    queryKey: ["funcionario-perfil", membro?.user_id, organization?.id],
    queryFn: async () => {
      const userId = membro!.user_id;
      const organizationId = organization!.id;
      const ha30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { data: profile },
        { data: tarefasAbertas },
        { data: treinosRecentes },
        { data: dietasRecentes },
        { data: avaliacoesRecentes },
        { data: tarefasResolvidas },
      ] = await Promise.all([
        supabase.from("profiles").select("phone, cpf").eq("user_id", userId).maybeSingle(),
        supabase
          .from("tarefas")
          .select("id, aluno_id, tipo, motivo, prioridade, sla_prazo")
          .eq("organization_id", organizationId)
          .eq("responsavel_id", userId)
          .in("status", ["aberta", "em_andamento"])
          .order("sla_prazo", { ascending: true }),
        supabase
          .from("treinos")
          .select("id, aluno_id, titulo, status, created_at")
          .eq("organization_id", organizationId)
          .eq("publicado_por", userId)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("dietas")
          .select("id, aluno_id, titulo, status, created_at")
          .eq("organization_id", organizationId)
          .eq("publicado_por", userId)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase
          .from("avaliacoes_fisicas")
          .select("id, aluno_id, data_avaliacao")
          .eq("organization_id", organizationId)
          .eq("avaliado_por", userId)
          .order("data_avaliacao", { ascending: false })
          .limit(8),
        supabase
          .from("tarefas")
          .select("id, aluno_id, tipo, motivo, desfecho_acao, updated_at")
          .eq("organization_id", organizationId)
          .eq("responsavel_id", userId)
          .eq("status", "concluida")
          .gte("updated_at", ha30dias)
          .order("updated_at", { ascending: false })
          .limit(8),
      ]);

      const alunoIds = Array.from(
        new Set(
          [
            ...(tarefasAbertas ?? []).map((t) => t.aluno_id),
            ...(treinosRecentes ?? []).map((t) => t.aluno_id),
            ...(dietasRecentes ?? []).map((d) => d.aluno_id),
            ...(avaliacoesRecentes ?? []).map((a) => a.aluno_id),
            ...(tarefasResolvidas ?? []).map((t) => t.aluno_id),
          ].filter((id): id is string => !!id)
        )
      );

      const { data: alunosData } = alunoIds.length
        ? await supabase.from("alunos").select("id, user_id").in("id", alunoIds)
        : { data: [] as { id: string; user_id: string }[] };
      const userIds = (alunosData ?? []).map((a) => a.user_id);
      const { data: profilesData } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profilesData ?? []).map((p) => [p.user_id, p.full_name]));
      const nomeByAlunoId = new Map(
        (alunosData ?? []).map((a) => [a.id, nomeByUserId.get(a.user_id) ?? "Aluno"])
      );

      const atividade: AtividadeItem[] = [
        ...(treinosRecentes ?? []).map((t) => ({
          id: `treino-${t.id}`,
          tipo: "treino" as const,
          alunoId: t.aluno_id,
          data: t.created_at,
          descricao: t.titulo,
        })),
        ...(dietasRecentes ?? []).map((d) => ({
          id: `dieta-${d.id}`,
          tipo: "dieta" as const,
          alunoId: d.aluno_id,
          data: d.created_at,
          descricao: d.titulo,
        })),
        ...(avaliacoesRecentes ?? []).map((a) => ({
          id: `avaliacao-${a.id}`,
          tipo: "avaliacao" as const,
          alunoId: a.aluno_id,
          data: a.data_avaliacao,
          descricao: "Avaliação física",
        })),
        ...(tarefasResolvidas ?? []).map((t) => ({
          id: `tarefa-${t.id}`,
          tipo: "tarefa" as const,
          alunoId: t.aluno_id,
          data: t.updated_at,
          descricao: t.desfecho_acao || TAREFA_TIPO_LABEL[t.tipo] || t.motivo,
        })),
      ].sort((a, b) => (a.data < b.data ? 1 : -1));

      return {
        profile,
        tarefasAbertas: tarefasAbertas ?? [],
        atividade: atividade.slice(0, 15),
        nomeByAlunoId,
      };
    },
    enabled: !!membro && !!organization?.id,
  });

  const nomeAluno = (alunoId: string | null) =>
    alunoId ? perfil?.nomeByAlunoId.get(alunoId) ?? "Aluno" : null;

  return (
    <>
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

              {perfil.tarefasAbertas.length > 0 && (
                <Bloco titulo="Pendências Atribuídas na Fila" icon={AlertTriangle}>
                  <ul className="space-y-1">
                    {perfil.tarefasAbertas.map((t) => (
                      <li key={t.id} className="text-sm">
                        <Badge variant="outline" className="mr-1.5 text-[10px]">
                          {TAREFA_TIPO_LABEL[t.tipo] ?? t.tipo}
                        </Badge>
                        {t.motivo}
                        {t.aluno_id && (
                          <>
                            {" — "}
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setAlunoAbertoId(t.aluno_id)}
                            >
                              {nomeAluno(t.aluno_id)}
                            </button>
                          </>
                        )}
                        <span className="text-xs text-muted-foreground"> · SLA {formatarData(t.sla_prazo)}</span>
                      </li>
                    ))}
                  </ul>
                </Bloco>
              )}

              <Bloco titulo="Atividade Recente" icon={ClipboardList}>
                {perfil.atividade.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem atividade recente registrada.</p>
                ) : (
                  <ul className="space-y-2">
                    {perfil.atividade.map((item) => {
                      const Icon = ATIVIDADE_ICON[item.tipo];
                      const nome = nomeAluno(item.alunoId);
                      return (
                        <li key={item.id} className="text-sm">
                          <div className="flex items-start gap-2">
                            <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <p>
                                <span className="font-medium">{ATIVIDADE_LABEL[item.tipo]}</span>
                                {item.descricao && <span className="text-muted-foreground"> — {item.descricao}</span>}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {nome ? (
                                  <>
                                    Para{" "}
                                    <button
                                      type="button"
                                      className="text-primary hover:underline"
                                      onClick={() => item.alunoId && setAlunoAbertoId(item.alunoId)}
                                    >
                                      {nome}
                                    </button>
                                  </>
                                ) : (
                                  "Sem aluno vinculado"
                                )}{" "}
                                · {formatarData(item.data)}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Bloco>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>

    <AlunoPerfilSheet alunoId={alunoAbertoId} onOpenChange={(open) => !open && setAlunoAbertoId(null)} />
    </>
  );
}
