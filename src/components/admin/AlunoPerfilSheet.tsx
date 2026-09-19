import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Dumbbell, UtensilsCrossed, Phone, Cake, Ruler, ClipboardList, AlertTriangle, Printer } from "lucide-react";
import { ImprimirTreinoDialog, type ExercicioSnapshotImpressao } from "@/components/admin/ImprimirTreinoDialog";

const NIVEL_LABEL: Record<string, string> = {
  essencial: "Essencial",
  integrado: "Integrado",
  elite: "Elite",
};

const FASE_LABEL: Record<string, string> = {
  mapa: "M.A.P.A.®",
  base: "B.A.S.E.®",
  rota: "R.O.T.A.®",
  apex: "A.P.E.X.®",
  legado: "L.E.G.A.D.O.®",
};

const ASSINATURA_LABEL: Record<string, string> = {
  ativa: "Ativa",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
};

const CHECKIN_LABEL: Record<string, string> = {
  funcionando_bem: "Funcionando bem",
  preciso_ajuste: "Preciso de ajuste",
  com_dificuldade: "Com dificuldade",
  quero_falar_com_alguem: "Quero falar com alguém",
};

const TAREFA_TIPO_LABEL: Record<string, string> = {
  ativacao: "Ativação",
  barreira: "Barreira de treino",
  dor: "Relato de dor",
  anamnese: "Anamnese pendente",
  ajuste: "Ajuste de prescrição",
  outro: "Outro",
};

function formatarData(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("pt-BR") : "—";
}

function calcularIdade(dataNascimento: string | null) {
  if (!dataNascimento) return null;
  const nasc = new Date(dataNascimento);
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const aindaNaoFezAniversario =
    hoje.getMonth() < nasc.getMonth() || (hoje.getMonth() === nasc.getMonth() && hoje.getDate() < nasc.getDate());
  if (aindaNaoFezAniversario) idade--;
  return idade;
}

function Bloco({ titulo, icon: Icon, children }: { titulo: string; icon: typeof Ruler; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {titulo}
      </div>
      {children}
    </div>
  );
}

// Painel lateral com o perfil completo do aluno — aberto clicando no nome
// dele em qualquer lista (gestor, professor ou nutricionista). Reúne dados
// que hoje ficam espalhados em telas e dialogs separados, num só lugar de
// consulta rápida, com atalho direto para prescrever treino/dieta.
export function AlunoPerfilSheet({
  alunoId,
  onOpenChange,
}: {
  alunoId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { organization } = useAuth();
  const [impressaoAberta, setImpressaoAberta] = useState(false);

  const { data: perfil, isLoading } = useQuery({
    queryKey: ["aluno-perfil", alunoId],
    queryFn: async () => {
      const { data: aluno, error: alunoError } = await supabase
        .from("alunos")
        .select(
          "id, user_id, organization_id, nivel_atacado, fase_jornada, objetivo, data_inicio, data_nascimento, peso_kg, altura_cm, observacoes, anonimizado_em"
        )
        .eq("id", alunoId!)
        .single();
      if (alunoError) throw alunoError;

      const [
        { data: profile },
        { data: assinatura },
        { data: anamnese },
        { data: avaliacoes },
        { data: treinoAtivo },
        { data: dietaAtiva },
        { data: tarefasAbertas },
        { data: checkins },
      ] = await Promise.all([
        supabase.from("profiles").select("full_name, phone").eq("user_id", aluno.user_id).maybeSingle(),
        supabase
          .from("aluno_assinaturas")
          .select("status, valor_cobrado, fatura_pendente_url")
          .eq("aluno_id", aluno.id)
          .maybeSingle(),
        supabase
          .from("anamnese_acolhimento")
          .select("objetivo_principal, qualidade_sono, nivel_estresse, frequencia_semanal_desejada, dores_lesoes, concluida_em")
          .eq("aluno_id", aluno.id)
          .maybeSingle(),
        supabase
          .from("avaliacoes_fisicas")
          .select("data_avaliacao, peso_kg, altura_cm, percentual_gordura, imc")
          .eq("aluno_id", aluno.id)
          .order("data_avaliacao", { ascending: false })
          .limit(1),
        supabase
          .from("treinos")
          .select("titulo, validade_inicio, validade_fim, snapshot_conteudo")
          .eq("aluno_id", aluno.id)
          .eq("status", "ativo")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("dietas")
          .select("titulo")
          .eq("aluno_id", aluno.id)
          .eq("status", "ativo")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("tarefas")
          .select("id, tipo, motivo, prioridade, sla_prazo")
          .eq("aluno_id", aluno.id)
          .in("status", ["aberta", "em_andamento"])
          .order("sla_prazo", { ascending: true }),
        supabase
          .from("checkins")
          .select("status, comentario, created_at")
          .eq("aluno_id", aluno.id)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      return {
        aluno,
        profile,
        assinatura,
        anamnese,
        avaliacao: avaliacoes?.[0] ?? null,
        treinoAtivo,
        dietaAtiva,
        tarefasAbertas: tarefasAbertas ?? [],
        checkins: checkins ?? [],
      };
    },
    enabled: !!alunoId,
  });

  const idade = perfil?.aluno.data_nascimento ? calcularIdade(perfil.aluno.data_nascimento) : null;
  const exerciciosTreinoAtivo =
    (perfil?.treinoAtivo?.snapshot_conteudo as unknown as ExercicioSnapshotImpressao[] | null) ?? [];

  const irPrescrever = (destino: "treinos" | "dietas") => {
    if (!alunoId) return;
    onOpenChange(false);
    navigate(`/admin/${destino}`, { state: { alunoId } });
  };

  return (
    <Sheet open={!!alunoId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando perfil...</p>}
        {perfil && (
          <>
            <SheetHeader className="text-left space-y-2">
              <SheetTitle className="flex items-center gap-2 flex-wrap">
                {perfil.profile?.full_name ?? "Aluno"}
                {perfil.aluno.anonimizado_em && (
                  <Badge variant="secondary" className="text-[10px]">Anonimizado</Badge>
                )}
              </SheetTitle>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{NIVEL_LABEL[perfil.aluno.nivel_atacado] ?? perfil.aluno.nivel_atacado}</Badge>
                <Badge variant="outline">{FASE_LABEL[perfil.aluno.fase_jornada] ?? perfil.aluno.fase_jornada}</Badge>
                {perfil.assinatura?.status && (
                  <Badge variant={perfil.assinatura.status === "ativa" ? "default" : "outline"}>
                    {ASSINATURA_LABEL[perfil.assinatura.status] ?? perfil.assinatura.status}
                  </Badge>
                )}
              </div>
            </SheetHeader>

            <div className="flex gap-2 mt-4">
              <Button size="sm" className="flex-1" onClick={() => irPrescrever("treinos")}>
                <Dumbbell className="h-4 w-4 mr-1.5" />
                Prescrever Treino
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => irPrescrever("dietas")}>
                <UtensilsCrossed className="h-4 w-4 mr-1.5" />
                Prescrever Dieta
              </Button>
            </div>

            <Separator className="my-4" />

            <div className="space-y-4">
              <Bloco titulo="Dados" icon={Phone}>
                <p className="text-sm">{perfil.profile?.phone ?? "Telefone não informado"}</p>
                <p className="text-xs text-muted-foreground">
                  {idade != null ? `${idade} anos · ` : ""}Aluno desde {formatarData(perfil.aluno.data_inicio)}
                </p>
                {perfil.aluno.objetivo && (
                  <p className="text-xs text-muted-foreground">Objetivo: {perfil.aluno.objetivo}</p>
                )}
              </Bloco>

              {perfil.avaliacao && (
                <Bloco titulo="Última Avaliação Física" icon={Ruler}>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                    {perfil.avaliacao.peso_kg != null && <span>Peso: {perfil.avaliacao.peso_kg} kg</span>}
                    {perfil.avaliacao.altura_cm != null && <span>Altura: {perfil.avaliacao.altura_cm} cm</span>}
                    {perfil.avaliacao.percentual_gordura != null && (
                      <span>Gordura: {perfil.avaliacao.percentual_gordura}%</span>
                    )}
                    {perfil.avaliacao.imc != null && <span>IMC: {perfil.avaliacao.imc}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Registrada em {formatarData(perfil.avaliacao.data_avaliacao)}
                  </p>
                </Bloco>
              )}

              {perfil.anamnese && (
                <Bloco titulo="Anamnese de Acolhimento" icon={Cake}>
                  {perfil.anamnese.objetivo_principal && <p className="text-sm">{perfil.anamnese.objetivo_principal}</p>}
                  <p className="text-xs text-muted-foreground">
                    Sono: {perfil.anamnese.qualidade_sono ?? "—"} · Estresse: {perfil.anamnese.nivel_estresse ?? "—"} ·{" "}
                    {perfil.anamnese.frequencia_semanal_desejada
                      ? `${perfil.anamnese.frequencia_semanal_desejada}x/semana desejado`
                      : "Frequência não informada"}
                  </p>
                  {perfil.anamnese.dores_lesoes && (
                    <p className="text-xs text-destructive">Dores/lesões: {perfil.anamnese.dores_lesoes}</p>
                  )}
                </Bloco>
              )}

              <Bloco titulo="Treino Ativo" icon={Dumbbell}>
                {perfil.treinoAtivo ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{perfil.treinoAtivo.titulo}</p>
                        {perfil.treinoAtivo.validade_fim && (
                          <p className="text-xs text-muted-foreground">
                            Válido até {formatarData(perfil.treinoAtivo.validade_fim)}
                          </p>
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setImpressaoAberta(true)}>
                        <Printer className="h-3.5 w-3.5 mr-1.5" />
                        Imprimir
                      </Button>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {exerciciosTreinoAtivo.map((ex) => (
                        <li key={ex.ordem} className="text-sm">
                          <span className="font-medium">
                            {ex.ordem}. {ex.nome_exercicio}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            — {ex.series}x{ex.repeticoes} · descanso {ex.descanso_seg}s
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum treino ativo</p>
                )}
              </Bloco>

              <Bloco titulo="Dieta Ativa" icon={UtensilsCrossed}>
                <p className="text-sm">
                  {perfil.dietaAtiva ? perfil.dietaAtiva.titulo : <span className="text-muted-foreground">nenhuma ativa</span>}
                </p>
              </Bloco>

              {perfil.tarefasAbertas.length > 0 && (
                <Bloco titulo="Pendências na Fila de Atendimento" icon={AlertTriangle}>
                  <ul className="space-y-1">
                    {perfil.tarefasAbertas.map((t) => (
                      <li key={t.id} className="text-sm">
                        <Badge variant="outline" className="mr-1.5 text-[10px]">
                          {TAREFA_TIPO_LABEL[t.tipo] ?? t.tipo}
                        </Badge>
                        {t.motivo}
                      </li>
                    ))}
                  </ul>
                </Bloco>
              )}

              {perfil.checkins.length > 0 && (
                <Bloco titulo="Check-ins Recentes" icon={ClipboardList}>
                  <ul className="space-y-1.5">
                    {perfil.checkins.map((c, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{CHECKIN_LABEL[c.status] ?? c.status}</span>
                        <span className="text-xs text-muted-foreground"> · {formatarData(c.created_at)}</span>
                        {c.comentario && <p className="text-xs text-muted-foreground">{c.comentario}</p>}
                      </li>
                    ))}
                  </ul>
                </Bloco>
              )}
            </div>

            <ImprimirTreinoDialog
              open={impressaoAberta}
              onOpenChange={setImpressaoAberta}
              organizacaoNome={organization?.nome ?? "Academia"}
              alunoNome={perfil.profile?.full_name ?? "Aluno"}
              treino={
                perfil.treinoAtivo
                  ? {
                      titulo: perfil.treinoAtivo.titulo,
                      validade_inicio: perfil.treinoAtivo.validade_inicio,
                      validade_fim: perfil.treinoAtivo.validade_fim,
                      exercicios: exerciciosTreinoAtivo,
                    }
                  : null
              }
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
