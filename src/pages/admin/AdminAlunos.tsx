import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { useAuth } from "@/contexts/AuthContext";
import { erroCpf } from "@/lib/cpf";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Users,
  CalendarOff,
  UserPlus,
  FileSpreadsheet,
  Printer,
  MessageCircle,
  UserX,
  Ruler,
  Trash2,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Enums } from "@/integrations/supabase/types";
import { ReciboComprovanteDialog, type ReciboData } from "@/components/admin/ReciboComprovanteDialog";
import { AvaliacaoFisicaDialog } from "@/components/admin/AvaliacaoFisicaDialog";
import { AlunoPerfilSheet } from "@/components/admin/AlunoPerfilSheet";
import { ImprimirTreinoDialog, type ExercicioSnapshotImpressao, type TreinoImpressao } from "@/components/admin/ImprimirTreinoDialog";
import { abrirWhatsAppAtivacao } from "@/lib/whatsappAtivacao";
import { ConvitePrimeiroAcesso } from "@/components/admin/ConvitePrimeiroAcesso";
import { SituacaoAluno } from "@/components/admin/SituacaoAluno";
import { planoDoAluno, ROTULO_PLANO, vendaMetodoArkeLiberada, type SituacaoAcademia } from "@/lib/planoAluno";

type Nivel = Enums<"nivel_atacado">;

const NIVEL_LABEL: Record<string, string> = {
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

const DIAS_SEMANA = [
  { valor: 1, label: "Seg" },
  { valor: 2, label: "Ter" },
  { valor: 3, label: "Qua" },
  { valor: 4, label: "Qui" },
  { valor: 5, label: "Sex" },
  { valor: 6, label: "Sáb" },
  { valor: 7, label: "Dom" },
];

interface AlunoRow {
  id: string;
  user_id: string;
  nivel_atacado: string | null;
  fase_jornada: string;
  metodo_arke_status: string;
  situacao_academia: SituacaoAcademia;
  objetivo: string | null;
  data_inicio: string | null;
  dias_descanso: number[];
  anonimizado_em: string | null;
  full_name: string;
  telefone: string | null;
  assinatura_status: string | null;
  assinatura_valor: number | null;
  assinatura_fatura_url: string | null;
  assinatura_atualizada_em: string | null;
}

const EMPTY_ALUNOS: AlunoRow[] = [];

export default function AdminAlunos() {
  const { organization, hasRole, organizationRole, user } = useAuth();
  const podeGerenciarEquipe = hasRole("admin_arke") || organizationRole === "gestor";
  // Adesão e cobrança do Método pela academia só depois do lançamento do Método.
  const vendaMetodo = vendaMetodoArkeLiberada();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [alunoEditando, setAlunoEditando] = useState<AlunoRow | null>(null);
  const [diasSelecionados, setDiasSelecionados] = useState<number[]>([]);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [reciboAberto, setReciboAberto] = useState(false);
  const [reciboSelecionado, setReciboSelecionado] = useState<ReciboData | null>(null);
  const [alunoAnonimizar, setAlunoAnonimizar] = useState<AlunoRow | null>(null);
  const [alunoAdesao, setAlunoAdesao] = useState<AlunoRow | null>(null);
  const [nivelAdesao, setNivelAdesao] = useState<Nivel | "">("");
  const [valorAdesao, setValorAdesao] = useState("");
  const [alunoExcluir, setAlunoExcluir] = useState<AlunoRow | null>(null);
  const [enviandoWhatsApp, setEnviandoWhatsApp] = useState<string | null>(null);
  const [alunoAvaliacao, setAlunoAvaliacao] = useState<AlunoRow | null>(null);
  const [alunoPerfilId, setAlunoPerfilId] = useState<string | null>(null);
  const [impressaoTreino, setImpressaoTreino] = useState<{ alunoNome: string; treino: TreinoImpressao } | null>(null);
  const [carregandoImpressao, setCarregandoImpressao] = useState<string | null>(null);

  const { data: alunos = EMPTY_ALUNOS, isLoading } = useQuery({
    queryKey: ["admin-alunos", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select(
          "id, user_id, nivel_atacado, objetivo, data_inicio, fase_jornada, metodo_arke_status, situacao_academia, dias_descanso, anonimizado_em"
        )
        .eq("organization_id", organization!.id)
        .order("data_inicio", { ascending: false });
      if (error) throw error;

      const userIds = alunosData.map((a) => a.user_id);
      const alunoIds = alunosData.map((a) => a.id);

      const [{ data: profiles }, { data: assinaturas }] = await Promise.all([
        userIds.length
          ? supabase.from("profiles").select("user_id, full_name, phone").in("user_id", userIds)
          : Promise.resolve({ data: [] as { user_id: string; full_name: string; phone: string | null }[] }),
        alunoIds.length
          ? supabase
              .from("aluno_assinaturas")
              .select("aluno_id, status, valor_cobrado, fatura_pendente_url, updated_at")
              .in("aluno_id", alunoIds)
          : Promise.resolve({
              data: [] as {
                aluno_id: string;
                status: string;
                valor_cobrado: number;
                fatura_pendente_url: string | null;
                updated_at: string;
              }[],
            }),
      ]);

      const profileByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
      const assinaturaByAlunoId = new Map((assinaturas ?? []).map((a) => [a.aluno_id, a]));
      return alunosData.map((a) => {
        const profile = profileByUserId.get(a.user_id);
        const assinatura = assinaturaByAlunoId.get(a.id);
        return {
          ...a,
          full_name: profile?.full_name ?? "—",
          telefone: profile?.phone ?? null,
          assinatura_status: assinatura?.status ?? null,
          assinatura_valor: assinatura?.valor_cobrado ?? null,
          assinatura_fatura_url: assinatura?.fatura_pendente_url ?? null,
          assinatura_atualizada_em: assinatura?.updated_at ?? null,
        };
      });
    },
    enabled: !!organization?.id,
  });

  const { data: precificacaoAtacado = [] } = useQuery({
    queryKey: ["org-precificacao-atacado", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_planos_precificacao")
        .select("nivel_atacado, valor_varejo")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const marcarAdesaoMetodoArke = useMutation({
    mutationFn: async ({ aluno, nivel, valorCobrado }: { aluno: AlunoRow; nivel: Nivel; valorCobrado: number }) => {
      const { error } = await supabase
        .from("alunos")
        .update({
          metodo_arke_status: "ativo",
          metodo_arke_ativado_em: new Date().toISOString(),
          metodo_arke_ativado_por: user?.id,
          nivel_atacado: nivel,
        })
        .eq("id", aluno.id);
      if (error) throw error;

      // A adesão em si já vale — se a cobrança falhar (ex.: wallet do Asaas
      // ainda não configurada), não desfaz o que já foi salvo, só avisa o
      // staff pra tentar de novo depois (o botão "Marcar adesão" some assim
      // que metodo_arke_status vira 'ativo', então a cobrança fica pendente
      // de retentativa manual via essa mesma tela, na coluna Assinatura).
      const { data, error: billingError } = await supabase.functions.invoke("asaas-create-subscription", {
        body: { aluno_id: aluno.id, valor_cobrado: valorCobrado },
      });
      if (billingError || data?.error) {
        return {
          billingOk: false,
          billingMessage: data?.error ?? (await mensagemDeErroEdge(billingError, "Falha ao criar a assinatura.")),
        };
      }
      return { billingOk: true };
    },
    onSuccess: (resultado) => {
      if (resultado.billingOk) {
        toast({ title: "Adesão registrada", description: "Assinatura criada no Asaas com split automático." });
      } else {
        toast({
          title: "Adesão registrada, mas a cobrança falhou",
          description: resultado.billingMessage ?? "Configure a wallet do Asaas em Organização e tente novamente.",
          variant: "destructive",
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] });
      setAlunoAdesao(null);
      setValorAdesao("");
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao registrar adesão", description: error.message, variant: "destructive" }),
  });

  // Retentativa manual de cobrança — para quando "Marcar adesão" salvou o
  // status mas a criação da assinatura no Asaas falhou (ex.: wallet ainda
  // não configurada na hora). Usa o valor de varejo já configurado pra esse
  // nível, sem precisar reabrir o dialog inteiro de adesão.
  const cobrarNovamente = useMutation({
    mutationFn: async ({ aluno }: { aluno: AlunoRow }) => {
      const valor = precificacaoAtacado.find((p) => p.nivel_atacado === aluno.nivel_atacado)?.valor_varejo;
      if (!valor) throw new Error("Configure o valor de varejo desse nível em Planos da Academia antes de cobrar.");
      const { data, error } = await supabase.functions.invoke("asaas-create-subscription", {
        body: { aluno_id: aluno.id, valor_cobrado: valor },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Falha ao criar cobrança."));
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast({ title: "Assinatura criada!", description: "Cobrança do Método ARKE ativada com split automático." });
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao cobrar", description: error.message, variant: "destructive" }),
  });

  const salvarDiasDescanso = useMutation({
    mutationFn: async () => {
      if (!alunoEditando) return;
      const { error } = await supabase
        .from("alunos")
        .update({ dias_descanso: diasSelecionados })
        .eq("id", alunoEditando.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Dias de descanso atualizados" });
      setAlunoEditando(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const abrirEdicao = (aluno: AlunoRow) => {
    setAlunoEditando(aluno);
    setDiasSelecionados(aluno.dias_descanso ?? []);
  };

  const toggleDia = (dia: number) => {
    setDiasSelecionados((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  };

  const abrirRecibo = (aluno: AlunoRow) => {
    if (!aluno.assinatura_status || aluno.assinatura_valor == null) return;
    setReciboSelecionado({
      organizacaoNome: organization?.nome ?? "Academia",
      alunoNome: aluno.full_name,
      planoNome: aluno.nivel_atacado ? NIVEL_LABEL[aluno.nivel_atacado] ?? aluno.nivel_atacado : "—",
      valor: aluno.assinatura_valor,
      formaPagamento: "Asaas",
      data: aluno.assinatura_atualizada_em ?? new Date().toISOString(),
      statusPagamento: ASSINATURA_LABEL[aluno.assinatura_status] ?? aluno.assinatura_status,
      invoiceUrl: aluno.assinatura_fatura_url,
    });
    setReciboAberto(true);
  };

  const enviarWhatsApp = async (aluno: AlunoRow) => {
    setEnviandoWhatsApp(aluno.id);
    const resultado = await abrirWhatsAppAtivacao({
      userId: aluno.user_id,
      telefone: aluno.telefone,
      alunoNome: aluno.full_name,
      organizacaoNome: organization?.nome ?? "sua academia",
    });
    setEnviandoWhatsApp(null);
    if (!resultado.ok) {
      toast({ title: "Não foi possível gerar o link", description: resultado.erro, variant: "destructive" });
    }
  };

  // Impressão rápida direto na listagem, sem abrir o perfil completo —
  // pensado pra recepção/professor com o aluno na frente no balcão. Mesmo
  // recibo térmico 80mm já usado no AlunoPerfilSheet.
  const abrirImpressaoTreino = async (aluno: AlunoRow) => {
    setCarregandoImpressao(aluno.id);
    const { data: treino, error } = await supabase
      .from("treinos")
      .select("titulo, validade_inicio, validade_fim, snapshot_conteudo")
      .eq("aluno_id", aluno.id)
      .eq("status", "ativo")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setCarregandoImpressao(null);
    if (error) {
      toast({ title: "Erro ao carregar o treino", description: error.message, variant: "destructive" });
      return;
    }
    if (!treino) {
      toast({ title: "Nenhum treino ativo", description: `${aluno.full_name} ainda não tem um treino publicado.` });
      return;
    }
    setImpressaoTreino({
      alunoNome: aluno.full_name,
      treino: {
        titulo: treino.titulo,
        validade_inicio: treino.validade_inicio,
        validade_fim: treino.validade_fim,
        exercicios: (treino.snapshot_conteudo as unknown as ExercicioSnapshotImpressao[] | null) ?? [],
      },
    });
  };

  const anonimizarAluno = useMutation({
    mutationFn: async () => {
      if (!alunoAnonimizar) return;
      const { error } = await supabase.functions.invoke("anonimizar-aluno", {
        body: { aluno_id: alunoAnonimizar.id },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível anonimizar o aluno."));
    },
    onSuccess: () => {
      toast({ title: "Aluno anonimizado", description: "Os dados pessoais foram removidos conforme a LGPD." });
      setAlunoAnonimizar(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao anonimizar", description: error.message, variant: "destructive" }),
  });

  const excluirAluno = useMutation({
    mutationFn: async () => {
      if (!alunoExcluir) return;
      const { error } = await supabase.functions.invoke("excluir-aluno", {
        body: { aluno_id: alunoExcluir.id },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível excluir o aluno."));
    },
    onSuccess: () => {
      toast({ title: "Aluno excluído", description: "A conta e todos os dados vinculados foram apagados." });
      setAlunoExcluir(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Alunos & Prescrições</h1>
        </div>
        {podeGerenciarEquipe && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/admin/alunos/importar")}>
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              Importar em massa
            </Button>
            <Button size="sm" onClick={() => setCadastroAberto(true)} disabled={!organization}>
              <UserPlus className="h-4 w-4 mr-1.5" />
              Cadastrar Aluno
            </Button>
          </div>
        )}
      </div>

      {podeGerenciarEquipe && <ConvitePrimeiroAcesso />}

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
          {!isLoading && alunos.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Nenhum aluno cadastrado ainda.</p>
          )}
          {alunos.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Assinatura</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Descanso</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alunos.map((aluno) => (
                  <TableRow key={aluno.id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="hover:underline underline-offset-2 text-left"
                        onClick={() => setAlunoPerfilId(aluno.id)}
                      >
                        {aluno.full_name}
                      </button>
                      {aluno.anonimizado_em && (
                        <Badge variant="secondary" className="ml-2 text-[10px]">Anonimizado</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {planoDoAluno(aluno) === "free" ? (
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline">{ROTULO_PLANO.free}</Badge>
                          {vendaMetodo && !aluno.anonimizado_em && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setAlunoAdesao(aluno);
                                setNivelAdesao(aluno.nivel_atacado === "integrado" || aluno.nivel_atacado === "elite" ? aluno.nivel_atacado : "");
                              }}
                            >
                              <Sparkles className="h-3 w-3 mr-1" /> Método
                            </Button>
                          )}
                        </div>
                      ) : (
                        <Badge className="gap-1">
                          <Sparkles className="h-3 w-3" /> {ROTULO_PLANO[planoDoAluno(aluno)]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <SituacaoAluno alunoId={aluno.id} situacao={aluno.situacao_academia} desabilitado={!!aluno.anonimizado_em} />
                    </TableCell>
                    <TableCell>
                      {aluno.assinatura_status ? (
                        <Badge variant={aluno.assinatura_status === "ativa" ? "default" : "outline"}>
                          {ASSINATURA_LABEL[aluno.assinatura_status] ?? aluno.assinatura_status}
                        </Badge>
                      ) : aluno.metodo_arke_status === "ativo" && vendaMetodo ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={cobrarNovamente.isPending && cobrarNovamente.variables?.aluno.id === aluno.id}
                          onClick={() => cobrarNovamente.mutate({ aluno })}
                        >
                          {cobrarNovamente.isPending && cobrarNovamente.variables?.aluno.id === aluno.id
                            ? "Criando..."
                            : "Tentar cobrar"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Fases da jornada são do Método; no Free não há fase. */}
                      {planoDoAluno(aluno) === "free" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Badge variant="outline">{FASE_LABEL[aluno.fase_jornada] ?? aluno.fase_jornada}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {aluno.data_inicio ? new Date(aluno.data_inicio).toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => abrirEdicao(aluno)} disabled={!!aluno.anonimizado_em}>
                        <CalendarOff className="h-3.5 w-3.5 mr-1" />
                        {aluno.dias_descanso?.length ?? 0} dia(s)
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Imprimir Recibo / Comprovante"
                          disabled={!aluno.assinatura_status || !!aluno.anonimizado_em}
                          onClick={() => abrirRecibo(aluno)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Imprimir Treino (balcão)"
                          disabled={!!aluno.anonimizado_em || carregandoImpressao === aluno.id}
                          onClick={() => void abrirImpressaoTreino(aluno)}
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Enviar Ativação via WhatsApp"
                          disabled={!!aluno.anonimizado_em || enviandoWhatsApp === aluno.id}
                          onClick={() => void enviarWhatsApp(aluno)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Avaliação Física"
                          disabled={!!aluno.anonimizado_em}
                          onClick={() => setAlunoAvaliacao(aluno)}
                        >
                          <Ruler className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Desativar / Anonimizar Aluno"
                          disabled={!!aluno.anonimizado_em}
                          onClick={() => setAlunoAnonimizar(aluno)}
                        >
                          <UserX className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Excluir Aluno (teste/homologação)"
                          onClick={() => setAlunoExcluir(aluno)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ReciboComprovanteDialog open={reciboAberto} onOpenChange={setReciboAberto} recibo={reciboSelecionado} />

      <AvaliacaoFisicaDialog
        open={!!alunoAvaliacao}
        onOpenChange={(open) => !open && setAlunoAvaliacao(null)}
        alunoId={alunoAvaliacao?.id ?? null}
        alunoNome={alunoAvaliacao?.full_name}
      />

      <Dialog open={!!alunoAdesao} onOpenChange={(open) => !open && setAlunoAdesao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar adesão ao Método ARKE — {alunoAdesao?.full_name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Qual nível do Método ARKE esse aluno está contratando? O plano Free continua valendo; o Método soma o
            acolhimento M.A.P.A.®, as fases da jornada e o chat com a nutricionista.
          </p>
          <div className="space-y-1.5">
            <Label>Nível</Label>
            <Select
              value={nivelAdesao}
              onValueChange={(v) => {
                setNivelAdesao(v as Nivel);
                const sugestao = precificacaoAtacado.find((p) => p.nivel_atacado === v)?.valor_varejo;
                setValorAdesao(sugestao != null ? String(sugestao) : "");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o nível" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="integrado">Integrado</SelectItem>
                <SelectItem value="elite">Elite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Valor cobrado do aluno (mensal)</Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="Ex.: 119.00"
              value={valorAdesao}
              onChange={(e) => setValorAdesao(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Pré-preenchido com o valor de varejo configurado em Planos da Academia — ajuste se for negociar diferente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlunoAdesao(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!nivelAdesao || !valorAdesao || Number(valorAdesao) <= 0 || marcarAdesaoMetodoArke.isPending}
              onClick={() =>
                alunoAdesao &&
                marcarAdesaoMetodoArke.mutate({ aluno: alunoAdesao, nivel: nivelAdesao as Nivel, valorCobrado: Number(valorAdesao) })
              }
            >
              {marcarAdesaoMetodoArke.isPending ? "Registrando..." : "Confirmar adesão e criar cobrança"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!alunoAnonimizar} onOpenChange={(open) => !open && setAlunoAnonimizar(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desativar / Anonimizar Aluno — Protocolo LGPD</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Esta ação vai <strong>anonimizar permanentemente</strong> os dados pessoais de{" "}
              <strong>{alunoAnonimizar?.full_name}</strong>: nome, CPF, e-mail e telefone serão substituídos por
              placeholders, e o acesso do aluno à organização será desativado.
            </p>
            <p>
              O histórico financeiro (assinaturas, pagamentos e IDs do Asaas) é preservado, para fins de
              auditoria fiscal/contábil. <strong>Esta ação não pode ser desfeita.</strong>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlunoAnonimizar(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={anonimizarAluno.isPending}
              onClick={() => anonimizarAluno.mutate()}
            >
              {anonimizarAluno.isPending ? "Anonimizando..." : "Confirmar anonimização"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!alunoExcluir} onOpenChange={(open) => !open && setAlunoExcluir(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir Aluno — Teste/Homologação</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Esta ação vai <strong>apagar definitivamente</strong> a conta de{" "}
              <strong>{alunoExcluir?.full_name}</strong>: login, perfil, treinos, dietas, check-ins, avaliações,
              assinaturas e pagamentos — nada fica registrado.
            </p>
            <p>
              Diferente da anonimização (que preserva o histórico financeiro para auditoria), aqui não sobra
              rastro nenhum e o e-mail fica livre para um novo cadastro na hora. Use apenas para limpar contas de
              teste. <strong>Esta ação não pode ser desfeita.</strong>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlunoExcluir(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={excluirAluno.isPending} onClick={() => excluirAluno.mutate()}>
              {excluirAluno.isPending ? "Excluindo..." : "Confirmar exclusão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!alunoEditando} onOpenChange={(open) => !open && setAlunoEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dias de descanso — {alunoEditando?.full_name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Nesses dias, a automação de "treinos previstos sem registro" não considera falta.
          </p>
          <div className="grid grid-cols-4 gap-3 py-2">
            {DIAS_SEMANA.map((d) => (
              <label key={d.valor} className="flex items-center gap-2 text-sm">
                <Checkbox checked={diasSelecionados.includes(d.valor)} onCheckedChange={() => toggleDia(d.valor)} />
                {d.label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button disabled={salvarDiasDescanso.isPending} onClick={() => salvarDiasDescanso.mutate()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CadastrarAlunoDialog
        open={cadastroAberto}
        onOpenChange={setCadastroAberto}
        onSuccess={() => void queryClient.invalidateQueries({ queryKey: ["admin-alunos", organization?.id] })}
      />

      <AlunoPerfilSheet alunoId={alunoPerfilId} onOpenChange={(open) => !open && setAlunoPerfilId(null)} />

      <ImprimirTreinoDialog
        open={!!impressaoTreino}
        onOpenChange={(open) => !open && setImpressaoTreino(null)}
        organizacaoNome={organization?.nome ?? "Academia"}
        alunoNome={impressaoTreino?.alunoNome ?? ""}
        treino={impressaoTreino?.treino ?? null}
      />
    </div>
  );
}

interface CadastroForm {
  full_name: string;
  email: string;
  telefone: string;
  cpf: string;
  nivel_atacado: Nivel | "";
}

const CADASTRO_INICIAL: CadastroForm = { full_name: "", email: "", telefone: "", cpf: "", nivel_atacado: "" };

interface AlunoRecemCriado {
  user_id: string;
  full_name: string;
  telefone: string;
}

function CadastrarAlunoDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<CadastroForm>(CADASTRO_INICIAL);
  const [recemCriado, setRecemCriado] = useState<AlunoRecemCriado | null>(null);
  const [enviandoWhatsApp, setEnviandoWhatsApp] = useState(false);

  // CPF é opcional aqui, mas se preenchido tem que fechar o dígito
  // verificador: ele é a chave de leitura da catraca e a de deduplicação da
  // base. Avisar na tela evita a viagem até o servidor só para voltar erro.
  const problemaCpf = erroCpf(form.cpf);

  const cadastrar = useMutation({
    mutationFn: async () => {
      if (problemaCpf) throw new Error(problemaCpf);
      const { data, error } = await supabase.functions.invoke<{ user_id: string }>("convidar-membro", {
        body: {
          email: form.email,
          full_name: form.full_name,
          telefone: form.telefone,
          cpf: form.cpf,
          papel: "aluno",
          nivel_atacado: form.nivel_atacado || undefined,
        },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível cadastrar o aluno."));
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Aluno cadastrado", description: "Um e-mail de convite foi enviado para definir a senha." });
      if (data?.user_id) {
        setRecemCriado({ user_id: data.user_id, full_name: form.full_name, telefone: form.telefone });
      }
      setForm(CADASTRO_INICIAL);
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Não foi possível cadastrar o aluno", description: error.message, variant: "destructive" });
    },
  });

  const fecharTudo = () => {
    setRecemCriado(null);
    onOpenChange(false);
  };

  const enviarWhatsApp = async () => {
    if (!recemCriado) return;
    setEnviandoWhatsApp(true);
    const resultado = await abrirWhatsAppAtivacao({
      userId: recemCriado.user_id,
      telefone: recemCriado.telefone,
      alunoNome: recemCriado.full_name,
      organizacaoNome: organization?.nome ?? "sua academia",
    });
    setEnviandoWhatsApp(false);
    if (!resultado.ok) {
      toast({ title: "Não foi possível gerar o link", description: resultado.erro, variant: "destructive" });
    }
  };

  if (recemCriado) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && fecharTudo()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aluno cadastrado!</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {recemCriado.full_name} já recebeu o convite por e-mail. Se preferir, envie também a ativação pelo
            WhatsApp.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={fecharTudo}>
              Fechar
            </Button>
            <Button disabled={enviandoWhatsApp} onClick={() => void enviarWhatsApp()}>
              <MessageCircle className="h-4 w-4 mr-1.5" />
              {enviandoWhatsApp ? "Gerando link..." : "Enviar Ativação via WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cadastrar aluno</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            cadastrar.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="aluno-nome">Nome completo</Label>
            <Input
              id="aluno-nome"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aluno-email">E-mail</Label>
            <Input
              id="aluno-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="aluno-telefone">Telefone</Label>
              <Input
                id="aluno-telefone"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                placeholder="(11) 91234-5678"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="aluno-cpf">CPF</Label>
              <Input
                id="aluno-cpf"
                value={form.cpf}
                onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
                placeholder="000.000.000-00"
                aria-invalid={!!problemaCpf}
              />
              {problemaCpf && <p className="text-xs text-destructive">{problemaCpf}</p>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O aluno entra no plano Free: treinos, calendário, rotina, diário de água e dieta, e chat com os professores.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={cadastrar.isPending}>
              {cadastrar.isPending ? "Cadastrando..." : "Cadastrar e convidar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
