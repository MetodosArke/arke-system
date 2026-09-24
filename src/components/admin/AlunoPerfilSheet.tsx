import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { useAuth } from "@/contexts/AuthContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dumbbell, UtensilsCrossed, Phone, Cake, Ruler, ClipboardList, AlertTriangle, Printer, MessageCircle, Wallet, FlaskConical, Route, Fingerprint, Target, History, FileSignature, Sparkles, ShieldCheck } from "lucide-react";
import { ImprimirTreinoDialog, type ExercicioSnapshotImpressao } from "@/components/admin/ImprimirTreinoDialog";
import { Bloco, formatarData } from "@/components/admin/perfilSheetHelpers";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { TrialMetodoArke } from "@/components/admin/TrialMetodoArke";
import { FaseJornada } from "@/components/admin/FaseJornada";
import { MetasAluno } from "@/components/admin/MetasAluno";
import { HistoricoAluno } from "@/components/admin/HistoricoAluno";
import { AcessoCatraca } from "@/components/admin/AcessoCatraca";
import { CartaoAssinatura } from "@/components/pagamento/CartaoAssinatura";
import { CicloAssinatura } from "@/components/pagamento/CicloAssinatura";
import { ResumoSentinela } from "@/components/sentinela/SentinelaAnamnese";
import { useToast } from "@/hooks/use-toast";
import { SituacaoAluno } from "@/components/admin/SituacaoAluno";
import { DocumentosMatriculaAluno } from "@/components/admin/DocumentosMatriculaAluno";
import { PresencasAluno } from "@/components/admin/PresencasAluno";
import { planoDoAluno, ROTULO_PLANO, temNutricaoNoPlano } from "@/lib/planoAluno";
import { useNutricionistaDaAcademia } from "@/hooks/useNutricionistaDaAcademia";

const PERIODICIDADE_LABEL: Record<string, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
};

const MENSALIDADE_STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  confirmado: "Pago",
  atrasado: "Atrasado",
  estornado: "Estornado",
  cancelado: "Cancelado",
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
  trial: "Trial",
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
  cobranca: "Cobrança",
  acolhimento_elite: "Acolhimento Elite",
  engajamento_baixo: "Engajamento baixo",
  atestado: "Atestado médico",
};

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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [impressaoAberta, setImpressaoAberta] = useState(false);
  const [chatAberto, setChatAberto] = useState<"treino" | "nutri" | null>(null);
  const [matriculaAberta, setMatriculaAberta] = useState(false);
  const [planoEscolhido, setPlanoEscolhido] = useState("");
  const [valorOverride, setValorOverride] = useState("");

  const { data: perfil, isLoading } = useQuery({
    queryKey: ["aluno-perfil", alunoId],
    queryFn: async () => {
      const { data: aluno, error: alunoError } = await supabase
        .from("alunos")
        .select(
          "id, user_id, organization_id, nivel_atacado, fase_jornada, metodo_arke_status, situacao_academia, situacao_academia_motivo, situacao_academia_retorno, objetivo, data_inicio, data_nascimento, peso_kg, altura_cm, observacoes, anonimizado_em, identificador_catraca, meta_agua_ml, meta_semanal_dias"
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
        supabase.from("profiles").select("full_name, phone, cpf").eq("user_id", aluno.user_id).maybeSingle(),
        supabase
          .from("aluno_assinaturas")
          .select(
            "status, valor_cobrado, fatura_pendente_url, trial_fim, asaas_subscription_id, forma_pagamento, cartao_final, cartao_bandeira, cartao_recusado_em"
          )
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

      const matricula = (
        await supabase
          .from("aluno_matriculas_academia")
          .select("id, valor_cobrado, dia_vencimento, status, planos_academia(nome, periodicidade)")
          .eq("aluno_id", aluno.id)
          .eq("status", "ativa")
          .maybeSingle()
      ).data;

      const mensalidades = matricula
        ? (
            await supabase
              .from("mensalidades")
              .select("id, competencia, valor, vencimento, status")
              .eq("matricula_id", matricula.id)
              .order("competencia", { ascending: false })
              .limit(3)
          ).data
        : [];

      // A relação vem como objeto (belongs-to), mas normaliza pra array
      // aqui também por segurança — depende de como o PostgREST infere o
      // relacionamento, e não vale a pena travar a tela por isso.
      const planoInfo = matricula
        ? Array.isArray(matricula.planos_academia)
          ? matricula.planos_academia[0]
          : matricula.planos_academia
        : null;

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
        matricula,
        planoInfo,
        mensalidades: mensalidades ?? [],
      };
    },
    enabled: !!alunoId,
  });

  const { data: planosAcademia = [] } = useQuery({
    queryKey: ["planos-academia-ativos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planos_academia")
        .select("id, nome, periodicidade, valor")
        .eq("organization_id", organization!.id)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id && matriculaAberta,
  });

  const matricular = useMutation({
    mutationFn: async () => {
      if (!alunoId || !planoEscolhido) throw new Error("Selecione um plano.");
      const body: Record<string, unknown> = { aluno_id: alunoId, plano_id: planoEscolhido };
      if (valorOverride.trim()) {
        const valor = Number(valorOverride.trim().replace(",", "."));
        if (Number.isFinite(valor) && valor > 0) body.valor_cobrado = valor;
      }
      const { error } = await supabase.functions.invoke("academia-criar-matricula", { body });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível criar a matrícula."));
    },
    onSuccess: () => {
      toast({ title: "Matrícula criada", description: "A cobrança recorrente já foi configurada no Asaas." });
      setMatriculaAberta(false);
      setPlanoEscolhido("");
      setValorOverride("");
      void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
    },
    onError: (error: Error) => toast({ title: "Erro ao matricular", description: error.message, variant: "destructive" }),
  });

  const plano = perfil ? planoDoAluno(perfil.aluno) : "free";
  const academiaTemNutri = useNutricionistaDaAcademia(perfil?.aluno.organization_id);
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
                <Badge variant={plano === "free" ? "outline" : "secondary"}>{ROTULO_PLANO[plano]}</Badge>
                {plano !== "free" && (
                  <Badge variant="outline">{FASE_LABEL[perfil.aluno.fase_jornada] ?? perfil.aluno.fase_jornada}</Badge>
                )}
                <SituacaoAluno
                  alunoId={perfil.aluno.id}
                  situacao={perfil.aluno.situacao_academia}
                  motivo={perfil.aluno.situacao_academia_motivo}
                  retorno={perfil.aluno.situacao_academia_retorno}
                  desabilitado={!!perfil.aluno.anonimizado_em}
                />
                {perfil.assinatura?.status && (
                  <Badge variant={perfil.assinatura.status === "ativa" ? "default" : "outline"}>
                    {ASSINATURA_LABEL[perfil.assinatura.status] ?? perfil.assinatura.status}
                  </Badge>
                )}
              </div>
              {perfil.aluno.situacao_academia !== "em_dia" &&
                (perfil.aluno.situacao_academia_motivo || perfil.aluno.situacao_academia_retorno) && (
                  <p className="text-xs text-muted-foreground">
                    {perfil.aluno.situacao_academia_motivo}
                    {perfil.aluno.situacao_academia_motivo && perfil.aluno.situacao_academia_retorno && " · "}
                    {perfil.aluno.situacao_academia_retorno &&
                      `volta prevista ${new Date(`${perfil.aluno.situacao_academia_retorno}T12:00:00`).toLocaleDateString("pt-BR")}`}
                  </p>
                )}
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

            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setChatAberto("treino")}
              >
                <MessageCircle className="h-4 w-4 mr-1.5" />
                Chat Treino
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={!temNutricaoNoPlano(plano) && !academiaTemNutri}
                title={temNutricaoNoPlano(plano) || academiaTemNutri ? undefined : "Sem nutricionista na equipe: o chat com a nutricionista é do Método ARKE"}
                onClick={() => setChatAberto("nutri")}
              >
                <MessageCircle className="h-4 w-4 mr-1.5" />
                Chat Nutrição
              </Button>
            </div>

            <Separator className="my-4" />

            <div className="space-y-4">
              <Bloco titulo="Dados" icon={Phone}>
                <p className="text-sm">{perfil.profile?.phone ?? "Telefone não informado"}</p>
                <p className="text-xs text-muted-foreground">
                  {idade != null ? `${idade} anos · ` : ""}Aluno desde {formatarData(perfil.aluno.data_inicio)}
                </p>
                <PresencasAluno alunoId={perfil.aluno.id} />
                {perfil.aluno.objetivo && (
                  <p className="text-xs text-muted-foreground">Objetivo: {perfil.aluno.objetivo}</p>
                )}
              </Bloco>

              <Bloco titulo="Metas do Aluno" icon={Target}>
                <MetasAluno
                  key={perfil.aluno.id}
                  alunoId={perfil.aluno.id}
                  metaAguaMl={perfil.aluno.meta_agua_ml}
                  metaSemanalDias={perfil.aluno.meta_semanal_dias}
                />
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

              {/* Fases da jornada são do Método ARKE; no Free não há fase a mover. */}
              {plano !== "free" && (
                <Bloco titulo="Fase da Jornada" icon={Route}>
                  <FaseJornada alunoId={perfil.aluno.id} faseAtual={perfil.aluno.fase_jornada} />
                </Bloco>
              )}

              <Bloco titulo="Método ARKE" icon={FlaskConical}>
                {/* Trial é atribuído só pelo Super Admin (Visão Master); aqui a academia só vê. */}
                <TrialMetodoArke
                  alunoId={perfil.aluno.id}
                  emTrial={perfil.assinatura?.status === "trial"}
                  trialFim={perfil.assinatura?.trial_fim ?? null}
                  nivelAtual={perfil.aluno.nivel_atacado}
                  somenteLeitura
                />
                <div className={perfil.assinatura?.status === "trial" ? "mt-3 border-t pt-3" : undefined}>
                  <CartaoAssinatura
                    alunoId={perfil.aluno.id}
                    assinatura={perfil.assinatura ?? null}
                    titularPadrao={{
                      nome: perfil.profile?.full_name ?? "",
                      cpf: perfil.profile?.cpf ?? "",
                      telefone: perfil.profile?.phone ?? "",
                    }}
                    onSalvo={() => void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] })}
                    onSucesso={(m) => toast({ title: "Cartão cadastrado", description: m })}
                  />
                </div>
              </Bloco>

              <Bloco titulo="Resumo da anamnese (Sentinela)" icon={Sparkles}>
                <ResumoSentinela alunoId={perfil.aluno.id} />
              </Bloco>

              <Bloco titulo="Documentos da Matrícula" icon={FileSignature}>
                <DocumentosMatriculaAluno alunoId={perfil.aluno.id} organizationId={perfil.aluno.organization_id} />
              </Bloco>

              <Bloco titulo="Acesso por Catraca" icon={Fingerprint}>
                <AcessoCatraca
                  alunoId={perfil.aluno.id}
                  organizationId={perfil.aluno.organization_id}
                  identificadorAtual={perfil.aluno.identificador_catraca}
                  alunoNome={perfil.profile?.full_name ?? "Aluno"}
                  alunoCpf={perfil.profile?.cpf ?? null}
                  situacaoAcademia={perfil.aluno.situacao_academia}
                />
              </Bloco>

              <Bloco titulo="Plano da Academia" icon={Wallet}>
                {perfil.matricula && perfil.planoInfo ? (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{perfil.planoInfo.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {PERIODICIDADE_LABEL[perfil.planoInfo.periodicidade] ?? perfil.planoInfo.periodicidade} · R${" "}
                          {Number(perfil.matricula.valor_cobrado).toFixed(2)} · vence dia {perfil.matricula.dia_vencimento}
                        </p>
                      </div>
                    </div>
                    {perfil.mensalidades.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {perfil.mensalidades.map((m) => (
                          <li key={m.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">{formatarData(m.competencia)}</span>
                            <Badge
                              variant={m.status === "confirmado" ? "default" : m.status === "atrasado" ? "destructive" : "outline"}
                              className="text-[10px]"
                            >
                              {MENSALIDADE_STATUS_LABEL[m.status] ?? m.status}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-2">Aluno sem plano da academia.</p>
                    <Button size="sm" variant="outline" onClick={() => setMatriculaAberta(true)}>
                      <Wallet className="h-3.5 w-3.5 mr-1.5" />
                      Matricular
                    </Button>
                  </>
                )}
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

              <Bloco titulo="Histórico e Observações" icon={History}>
                <HistoricoAluno alunoId={perfil.aluno.id} organizationId={perfil.aluno.organization_id} />
              </Bloco>

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

            <Dialog open={!!chatAberto} onOpenChange={(open) => !open && setChatAberto(null)}>
              <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
                <DialogHeader>
                  <DialogTitle>
                    {chatAberto === "treino" ? "Chat Treino" : "Chat Nutrição"} — {perfil.profile?.full_name ?? "Aluno"}
                  </DialogTitle>
                </DialogHeader>
                {chatAberto && organization && (
                  <ChatPanel
                    organizationId={organization.id}
                    alunoId={perfil.aluno.id}
                    viewerType="staff"
                    type={chatAberto}
                    className="flex-1"
                  />
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={matriculaAberta} onOpenChange={setMatriculaAberta}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Matricular no plano da academia</DialogTitle>
                  <DialogDescription>
                    Cria a assinatura recorrente no Asaas — a cobrança acontece automaticamente todo período.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Plano</Label>
                    <Select value={planoEscolhido} onValueChange={setPlanoEscolhido}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um plano" />
                      </SelectTrigger>
                      <SelectContent>
                        {planosAcademia.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome} — R$ {Number(p.valor).toFixed(2)} ({PERIODICIDADE_LABEL[p.periodicidade] ?? p.periodicidade})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {planosAcademia.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Nenhum plano cadastrado ainda — crie um em Configurações &gt; Planos da Academia.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Valor (opcional)</Label>
                    <Input
                      placeholder="usa o valor do plano"
                      inputMode="decimal"
                      value={valorOverride}
                      onChange={(e) => setValorOverride(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A matrícula vale a partir de hoje: a primeira mensalidade vence hoje e as seguintes no dia{" "}
                    {new Date().getDate()} de cada mês.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setMatriculaAberta(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={() => matricular.mutate()} disabled={matricular.isPending || !planoEscolhido}>
                    {matricular.isPending ? "Matriculando..." : "Confirmar matrícula"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
