import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Dumbbell, UtensilsCrossed } from "lucide-react";
import { FaseJornada } from "@/components/admin/FaseJornada";
import { ChatMentor } from "@/components/chat/ChatMentor";
import { ResumoSentinela } from "@/components/sentinela/SentinelaAnamnese";
import { PrescricaoTreino } from "@/components/prescricao/PrescricaoTreino";
import { PrescricaoDieta } from "@/components/prescricao/PrescricaoDieta";
import { ROTULO_PLANO, type PlanoAluno } from "@/lib/planoAluno";
import { ROTULO_FASE } from "@/lib/carteiraMentor";
import { AGUA_MIN, AGUA_MAX } from "@/components/admin/MetasAluno";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { decimal } from "@/lib/numeros";
import type { Enums } from "@/integrations/supabase/types";
import { useAcessoArkefit } from "@/hooks/useAcessoArkefit";

type ExercicioSnapshot = { ordem: number; divisao?: string; nome_exercicio: string; series: number; repeticoes: string; descanso_seg: number };
type RefeicaoSnapshot = { ordem: number; nome_refeicao: string; horario_sugerido: string | null; itens: string | null };

type Ficha = {
  aluno: {
    id: string;
    nome: string;
    telefone: string | null;
    organization_id: string;
    organizacao_nome: string;
    plano: string;
    fase: Enums<"fase_jornada">;
    fase_desde: string | null;
    metodo_desde: string | null;
    data_nascimento: string | null;
    situacao_academia: string;
    objetivo: string | null;
    meta_semanal_dias: number;
    meta_agua_ml: number;
    mentor_id: string | null;
    mentor_nome: string | null;
    progressao_bloqueada_em: string | null;
    progressao_bloqueada_motivo: string | null;
    dias_inativo: number | null;
    constancia: number | null;
  };
  anamnese: Record<string, string | number | null> | null;
  treino: {
    titulo: string;
    validade_fim: string | null;
    snapshot: ExercicioSnapshot[];
    dono: string;
    prescritor_registro: string | null;
    publicado_em: string;
    publicado_por: string;
  } | null;
  dieta: {
    titulo: string;
    snapshot: RefeicaoSnapshot[];
    observacoes_gerais: string | null;
    dono: string;
    prescritor_registro: string | null;
    publicado_em: string;
    publicado_por: string;
  } | null;
  checkins: { status: string; comentario: string | null; data: string }[];
  treinos_registrados: { data: string; divisao: string | null; concluido: boolean; sensacao: string | null; esforco_percebido: number | null }[];
  adesao_dieta: { data: string; adesao_percentual: number | null; agua_ml: number | null }[];
  avaliacoes: { data_avaliacao: string; peso_kg: number | null; percentual_gordura: number | null; musculo_percentual: number | null; perim_cintura: number | null }[];
  chamados: { id: string; tipo: string; motivo: string; prioridade: string; dono: string; sla_prazo: string; atrasado: boolean }[];
};

const CHECKIN_LABEL: Record<string, string> = {
  funcionando_bem: "Funcionando bem",
  preciso_ajuste: "Preciso de ajuste",
  com_dificuldade: "Com dificuldade",
  quero_falar_com_alguem: "Quero falar com alguém",
};

const SITUACAO_LABEL: Record<string, string> = { em_dia: "Em dia", inadimplente: "Inadimplente", pausado: "Pausado" };

const CAMPOS_ANAMNESE: { chave: string; rotulo: string }[] = [
  { chave: "objetivo_principal", rotulo: "Objetivo principal" },
  { chave: "dores_lesoes", rotulo: "Dores e lesões" },
  { chave: "medicamentos", rotulo: "Medicamentos" },
  { chave: "experiencias_exercicio", rotulo: "Experiência com exercício" },
  { chave: "rotina_diaria", rotulo: "Rotina diária" },
  { chave: "tempo_disponivel", rotulo: "Tempo disponível" },
  { chave: "frequencia_semanal_desejada", rotulo: "Frequência desejada (dias por semana)" },
  { chave: "estilo_treino", rotulo: "Estilo de treino" },
  { chave: "qualidade_sono", rotulo: "Qualidade do sono" },
  { chave: "nivel_estresse", rotulo: "Nível de estresse" },
  { chave: "alimentacao_rotina", rotulo: "Alimentação no dia a dia" },
  { chave: "alimentos_gosta", rotulo: "Alimentos de que gosta" },
  { chave: "alimentos_nao_gosta", rotulo: "Alimentos de que não gosta" },
  { chave: "expectativas", rotulo: "Expectativas" },
];

/**
 * A ficha do aluno do Método, do lado da ArkeFit.
 *
 * É onde o mentor faz o acompanhamento inteiro sem sair do console: lê o
 * acolhimento, prescreve treino e dieta pela biblioteca do Método, define as
 * metas, conduz a fase, conversa e pede à academia o que só acontece no
 * presencial. Cadastro, matrícula e catraca continuam na ficha da academia.
 */
export default function SuperAdminFichaAluno() {
  const { alunoId } = useParams<{ alunoId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: ficha, isLoading, error } = useQuery({
    queryKey: ["ficha-mentor", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_ficha_mentor", { _aluno_id: alunoId! });
      if (error) throw error;
      return data as unknown as Ficha;
    },
    enabled: !!alunoId,
  });

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ["ficha-mentor", alunoId] });
    void queryClient.invalidateQueries({ queryKey: ["carteira-mentor"] });
  };

  if (isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando ficha...</p>;
  if (error || !ficha) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/superadmin/mentoria")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar à carteira
        </Button>
        <p className="text-sm text-destructive">
          Não foi possível abrir a ficha: {(error as Error | null)?.message ?? "aluno não encontrado"}
        </p>
      </div>
    );
  }

  const { aluno } = ficha;
  const escopo = {
    tipo: "metodo" as const,
    aluno: { id: aluno.id, nome: aluno.nome, organizationId: aluno.organization_id },
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/superadmin/mentoria")}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Voltar à carteira
      </Button>

      <div className="space-y-1.5">
        <h1 className="text-xl font-bold">{aluno.nome}</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{ROTULO_PLANO[aluno.plano as PlanoAluno] ?? aluno.plano}</Badge>
          <Badge variant="outline">{ROTULO_FASE[aluno.fase] ?? aluno.fase}</Badge>
          <Badge variant={aluno.situacao_academia === "em_dia" ? "outline" : "destructive"}>
            {SITUACAO_LABEL[aluno.situacao_academia] ?? aluno.situacao_academia}
          </Badge>
          {aluno.progressao_bloqueada_em && <Badge variant="destructive">Progressão suspensa por dor</Badge>}
          <span className="text-xs text-muted-foreground">{aluno.organizacao_nome}</span>
        </div>
        <MentorResponsavel alunoId={aluno.id} mentorId={aluno.mentor_id} mentorNome={aluno.mentor_nome} aoMudar={recarregar} />
      </div>

      <Tabs defaultValue="geral">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="anamnese">Acolhimento</TabsTrigger>
          <TabsTrigger value="treino">Treino</TabsTrigger>
          <TabsTrigger value="dieta">Dieta</TabsTrigger>
          <TabsTrigger value="evolucao">Evolução</TabsTrigger>
          <TabsTrigger value="conversa">Conversa</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sinais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                {aluno.dias_inativo == null
                  ? "Ainda não deu nenhum sinal (app, presença, treino ou check-in)."
                  : `${aluno.dias_inativo} dia(s) sem sinal.`}
              </p>
              <p>Constância nas últimas 4 semanas: {aluno.constancia == null ? "—" : `${decimal(Number(aluno.constancia), 0)}%`}</p>
              {aluno.metodo_desde && <p className="text-xs text-muted-foreground">No Método desde {formatarDataBR(aluno.metodo_desde)}</p>}
              {aluno.telefone && <p className="text-xs text-muted-foreground">Telefone: {aluno.telefone}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Metas e objetivo</CardTitle>
            </CardHeader>
            <CardContent>
              <MetasDoMetodo key={aluno.id} aluno={aluno} aoSalvar={recarregar} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Fase da jornada</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FaseJornada alunoId={aluno.id} faseAtual={aluno.fase} aoMover={recarregar} />
              {aluno.progressao_bloqueada_em && <LiberarProgressao alunoId={aluno.id} aoLiberar={recarregar} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pedir à academia</CardTitle>
            </CardHeader>
            <CardContent>
              <PedidoAcademia alunoId={aluno.id} aoEnviar={recarregar} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Chamados abertos</CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.chamados.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum chamado aberto para este aluno.</p>
              ) : (
                <ul className="space-y-1.5">
                  {ficha.chamados.map((c) => (
                    <li key={c.id} className="text-sm flex flex-wrap items-center gap-1.5">
                      <Badge variant={c.atrasado ? "destructive" : "outline"} className="text-[10px]">
                        {c.atrasado ? "atrasado" : `até ${formatarDataBR(c.sla_prazo)}`}
                      </Badge>
                      {c.dono === "academia" && <Badge variant="secondary" className="text-[10px]">com a academia</Badge>}
                      {c.motivo}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Os chamados da ArkeFit se encerram na aba Chamados da Mentoria, com o desfecho.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="anamnese" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Acolhimento M.A.P.A.®</CardTitle>
            </CardHeader>
            <CardContent>
              {!ficha.anamnese || !ficha.anamnese.concluida_em ? (
                <p className="text-sm text-muted-foreground">
                  O aluno ainda não concluiu o acolhimento no app. Ele aparece aqui assim que ele terminar.
                </p>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2">
                  {CAMPOS_ANAMNESE.filter((c) => ficha.anamnese?.[c.chave] != null && ficha.anamnese?.[c.chave] !== "").map((c) => (
                    <div key={c.chave}>
                      <dt className="text-xs font-medium text-muted-foreground">{c.rotulo}</dt>
                      <dd className={`text-sm whitespace-pre-wrap ${c.chave === "dores_lesoes" ? "text-destructive" : ""}`}>
                        {String(ficha.anamnese?.[c.chave])}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resumo da anamnese (Sentinela)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResumoSentinela alunoId={aluno.id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="treino" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Dumbbell className="h-4 w-4" /> Treino ativo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.treino ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{ficha.treino.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    Publicado em {formatarDataBR(ficha.treino.publicado_em)} por {ficha.treino.publicado_por}
                    {ficha.treino.prescritor_registro && ` · CREF ${ficha.treino.prescritor_registro}`}
                    {ficha.treino.dono === "academia" && " · prescrito pela academia antes do Método"}
                    {ficha.treino.validade_fim && ` · válido até ${formatarDataBR(ficha.treino.validade_fim)}`}
                  </p>
                  <ul className="space-y-1">
                    {(ficha.treino.snapshot ?? []).map((ex, i) => (
                      <li key={i} className="text-sm">
                        <span className="text-muted-foreground">{ex.divisao ?? "A"} ·</span> {ex.nome_exercicio}
                        <span className="text-xs text-muted-foreground">
                          {" "}— {ex.series}x{ex.repeticoes} · descanso {ex.descanso_seg}s
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum treino ativo. Publique o primeiro abaixo.</p>
              )}
            </CardContent>
          </Card>
          <PrescricaoTreino escopo={escopo} alunoInicial={aluno.id} rodape="embutido" aoPublicar={recarregar} />
        </TabsContent>

        <TabsContent value="dieta" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4" /> Dieta ativa
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.dieta ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{ficha.dieta.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    Publicada em {formatarDataBR(ficha.dieta.publicado_em)} por {ficha.dieta.publicado_por}
                    {ficha.dieta.prescritor_registro && ` · CRN ${ficha.dieta.prescritor_registro}`}
                    {ficha.dieta.dono === "academia" && " · prescrita pela academia antes do Método"}
                  </p>
                  <ul className="space-y-1.5">
                    {(ficha.dieta.snapshot ?? []).map((r, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{r.nome_refeicao}</span>
                        {r.horario_sugerido && <span className="text-xs text-muted-foreground"> · {r.horario_sugerido.slice(0, 5)}</span>}
                        {r.itens && <p className="text-xs text-muted-foreground whitespace-pre-line">{r.itens}</p>}
                      </li>
                    ))}
                  </ul>
                  {ficha.dieta.observacoes_gerais && (
                    <p className="text-xs text-muted-foreground whitespace-pre-line">{ficha.dieta.observacoes_gerais}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma dieta ativa. Publique a primeira abaixo.</p>
              )}
            </CardContent>
          </Card>
          <PrescricaoDieta escopo={escopo} alunoInicial={aluno.id} rodape="embutido" aoPublicar={recarregar} />
        </TabsContent>

        <TabsContent value="evolucao" className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Check-ins</CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.checkins.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum check-in ainda.</p>
              ) : (
                <ul className="space-y-1.5">
                  {ficha.checkins.map((c, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium">{CHECKIN_LABEL[c.status] ?? c.status}</span>
                      <span className="text-xs text-muted-foreground"> · {formatarDataBR(c.data)}</span>
                      {c.comentario && <p className="text-xs text-muted-foreground">{c.comentario}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Treinos registrados (4 semanas)</CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.treinos_registrados.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum treino registrado nas últimas 4 semanas.</p>
              ) : (
                <ul className="space-y-1">
                  {ficha.treinos_registrados.map((r, i) => (
                    <li key={i} className="text-sm">
                      {formatarDataBR(r.data)} · Treino {r.divisao ?? "A"}
                      {r.sensacao && <span className="text-xs text-muted-foreground"> · {r.sensacao}</span>}
                      {r.esforco_percebido != null && <span className="text-xs text-muted-foreground"> · esforço {r.esforco_percebido}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Adesão à dieta (2 semanas)</CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.adesao_dieta.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum registro de adesão nas últimas 2 semanas.</p>
              ) : (
                <ul className="space-y-1">
                  {ficha.adesao_dieta.map((d, i) => (
                    <li key={i} className="text-sm">
                      {formatarDataBR(d.data)} · {d.adesao_percentual ?? "—"}%
                      {d.agua_ml != null && <span className="text-xs text-muted-foreground"> · água {d.agua_ml} ml</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Avaliações físicas</CardTitle>
            </CardHeader>
            <CardContent>
              {ficha.avaliacoes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma avaliação registrada. Peça à academia em Visão geral → Pedir à academia.
                </p>
              ) : (
                <ul className="space-y-1">
                  {ficha.avaliacoes.map((a, i) => (
                    <li key={i} className="text-sm">
                      {formatarDataBR(a.data_avaliacao)}
                      {a.peso_kg != null && ` · ${decimal(Number(a.peso_kg), 1)} kg`}
                      {a.percentual_gordura != null && ` · gordura ${decimal(Number(a.percentual_gordura), 1)}%`}
                      {a.musculo_percentual != null && ` · músculo ${decimal(Number(a.musculo_percentual), 1)}%`}
                      {a.perim_cintura != null && ` · cintura ${decimal(Number(a.perim_cintura), 1)} cm`}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversa" className="mt-3">
          <Card className="min-h-[24rem]">
            <CardContent className="pt-4">
              <ChatMentor organizationId={aluno.organization_id} alunoId={aluno.id} viewerType="mentor" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// `estado` desde 20261421010000: quem ainda não criou a senha ou não tem as
// duas etapas não entra na Visão Master, e por isso não recebe aluno.
type MembroEquipe = { user_id: string; nome: string; ativo: boolean; cadastrado: boolean; mentor: boolean; estado?: string | null };

function MentorResponsavel({
  alunoId,
  mentorId,
  mentorNome,
  aoMudar,
}: {
  alunoId: string;
  mentorId: string | null;
  mentorNome: string | null;
  aoMudar: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  // Definir o mentor do aluno é do Sócio (20261423010000); o Mentor vê quem é.
  const { pode } = useAcessoArkefit();
  const socio = pode("socio");

  const { data: equipe = [] } = useQuery({
    queryKey: ["superadmin-equipe-arkefit"],
    enabled: socio,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_equipe_arkefit");
      if (error) throw error;
      return (data ?? []) as MembroEquipe[];
    },
  });

  const atribuir = useMutation({
    mutationFn: async (novo: string) => {
      const { error } = await supabase.rpc("atribuir_mentor_aluno", { _aluno_id: alunoId, _mentor_id: novo });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Mentor definido" });
      aoMudar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível definir o mentor", description: e.message, variant: "destructive" }),
  });

  // Recebe aluno quem atende como mentor na equipe, ativo e com as duas
  // etapas: o banco confere o mesmo em `equipe_arkefit` (ativo e mentor).
  const disponiveis = equipe.filter((m) => m.cadastrado && m.ativo && m.mentor && (m.estado ?? "ativo") === "ativo");
  const euAtendo = !!user && disponiveis.some((m) => m.user_id === user.id);

  if (!socio) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Mentor:</span>
        <span className="font-medium">{mentorNome ?? "sem mentor"}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Mentor:</span>
      <span className="font-medium">{mentorNome ?? "sem mentor"}</span>
      {user && euAtendo && mentorId !== user.id && (
        <Button size="sm" variant="outline" disabled={atribuir.isPending} onClick={() => atribuir.mutate(user.id)}>
          Assumir
        </Button>
      )}
      {disponiveis.filter((m) => m.user_id !== mentorId).length > 0 && (
        <Select value="" onValueChange={(v) => atribuir.mutate(v)}>
          <SelectTrigger className="h-8 w-[180px]" aria-label="Passar para outro mentor">
            <SelectValue placeholder="Passar para..." />
          </SelectTrigger>
          <SelectContent>
            {disponiveis
              .filter((m) => m.user_id !== mentorId)
              .map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function MetasDoMetodo({ aluno, aoSalvar }: { aluno: Ficha["aluno"]; aoSalvar: () => void }) {
  const { toast } = useToast();
  const [objetivo, setObjetivo] = useState(aluno.objetivo ?? "");
  const [dias, setDias] = useState(String(aluno.meta_semanal_dias));
  const [agua, setAgua] = useState(String(aluno.meta_agua_ml));

  const salvar = useMutation({
    mutationFn: async (dados: { objetivo: string; dias: number; agua: number }) => {
      const { error } = await supabase.rpc("definir_metas_aluno_metodo", {
        _aluno_id: aluno.id,
        _objetivo: dados.objetivo,
        _meta_semanal_dias: dados.dias,
        _meta_agua_ml: dados.agua,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Metas atualizadas", description: "O aluno já vê as novas metas no app." });
      aoSalvar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const mudou =
    objetivo !== (aluno.objetivo ?? "") || dias !== String(aluno.meta_semanal_dias) || agua !== String(aluno.meta_agua_ml);

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label htmlFor="mentor-objetivo" className="text-xs">Objetivo</Label>
        <Input id="mentor-objetivo" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: ganhar condicionamento" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="mentor-dias" className="text-xs">Treinos por semana (dias)</Label>
          <Input id="mentor-dias" type="number" inputMode="numeric" min={1} max={7} value={dias} onChange={(e) => setDias(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mentor-agua" className="text-xs">Água por dia (ml)</Label>
          <Input id="mentor-agua" type="number" inputMode="numeric" min={AGUA_MIN} max={AGUA_MAX} step={100} value={agua} onChange={(e) => setAgua(e.target.value)} />
        </div>
      </div>
      {mudou && (
        <Button
          size="sm"
          disabled={salvar.isPending}
          onClick={() => salvar.mutate({ objetivo: objetivo.trim(), dias: Number(dias), agua: Number(agua) })}
        >
          {salvar.isPending ? "Salvando..." : "Salvar metas"}
        </Button>
      )}
    </div>
  );
}

function LiberarProgressao({ alunoId, aoLiberar }: { alunoId: string; aoLiberar: () => void }) {
  const { toast } = useToast();
  const [justificativa, setJustificativa] = useState("");
  const liberar = useMutation({
    mutationFn: async (texto: string) => {
      const { error } = await supabase.rpc("liberar_progressao_aluno", { _aluno_id: alunoId, _observacao: texto });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Progressão liberada" });
      setJustificativa("");
      aoLiberar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível liberar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2 rounded-md border border-destructive/40 p-2">
      <p className="text-xs">
        O aluno relatou dor e a progressão está suspensa. Libere depois de avaliar o caso, dizendo o porquê.
      </p>
      <Input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Por que está liberando?" aria-label="Justificativa" />
      <Button size="sm" variant="outline" disabled={!justificativa.trim() || liberar.isPending} onClick={() => liberar.mutate(justificativa.trim())}>
        Liberar progressão
      </Button>
    </div>
  );
}

function PedidoAcademia({ alunoId, aoEnviar }: { alunoId: string; aoEnviar: () => void }) {
  const { toast } = useToast();
  const [texto, setTexto] = useState("");
  const enviar = useMutation({
    mutationFn: async (instrucao: string) => {
      const { error } = await supabase.rpc("criar_instrucao_presencial", { _aluno_id: alunoId, _instrucao: instrucao });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Pedido enviado", description: "Chegou na fila da academia, com prazo." });
      setTexto("");
      aoEnviar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        O que só acontece no presencial: avaliação física, correção de um exercício, uma conversa ao vivo. Vai para a fila da academia.
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setTexto("Fazer a avaliação física do aluno (peso, dobras e perímetros) e registrar no ArkeFit.")}
      >
        Pedir avaliação física
      </Button>
      <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que a academia precisa fazer?" aria-label="Pedido à academia" />
      <Button size="sm" disabled={!texto.trim() || enviar.isPending} onClick={() => enviar.mutate(texto.trim())}>
        Enviar à academia
      </Button>
    </div>
  );
}
