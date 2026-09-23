import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DoorOpen, Plus, Copy, Power, PowerOff, ScrollText, Radio, UserCheck, Settings } from "lucide-react";

type Parceiro = "wellhub" | "totalpass";
const PARCEIRO_LABEL: Record<Parceiro, string> = { wellhub: "Wellhub (Gympass)", totalpass: "TotalPass" };

export default function AdminCatracas() {
  const { organization, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [novoNome, setNovoNome] = useState("");
  const [novaLocalizacao, setNovaLocalizacao] = useState("");
  const [dialogAberto, setDialogAberto] = useState(false);
  const ehGestor = organizationRole === "gestor";

  const [checkinCatracaId, setCheckinCatracaId] = useState("");
  const [checkinParceiro, setCheckinParceiro] = useState<Parceiro | "">("");
  const [checkinNomeVisitante, setCheckinNomeVisitante] = useState("");

  const { data: catracas = [], isLoading } = useQuery({
    queryKey: ["admin-catracas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_catracas")
        .select("id, nome, localizacao, device_token, status, created_at")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["admin-catracas-logs", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("acessos_catraca_logs")
        .select(
          "id, resultado, giro, cpf_consultado, created_at, validado_offline, parceiro_externo, nome_visitante_externo, organizacao_catracas(nome)"
        )
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const [realtimeAtivo, setRealtimeAtivo] = useState(false);

  // Monitoramento em tempo real: status do dispositivo e novos acessos
  // chegam via Supabase Realtime em vez de depender só do polling do
  // react-query, então a tela reflete liberações/bloqueios assim que
  // acontecem na catraca física.
  useEffect(() => {
    if (!organization?.id) return;

    const channel = supabase
      .channel(`catracas-${organization.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "organizacao_catracas", filter: `organization_id=eq.${organization.id}` },
        () => void queryClient.invalidateQueries({ queryKey: ["admin-catracas", organization.id] })
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "acessos_catraca_logs", filter: `organization_id=eq.${organization.id}` },
        () => void queryClient.invalidateQueries({ queryKey: ["admin-catracas-logs", organization.id] })
      )
      .subscribe((status) => setRealtimeAtivo(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [organization?.id, queryClient]);

  const criarCatraca = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Nenhuma organização vinculada.");
      const { error } = await supabase.from("organizacao_catracas").insert({
        organization_id: organization.id,
        nome: novoNome.trim(),
        localizacao: novaLocalizacao.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Dispositivo cadastrado!" });
      void queryClient.invalidateQueries({ queryKey: ["admin-catracas", organization?.id] });
      setNovoNome("");
      setNovaLocalizacao("");
      setDialogAberto(false);
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao cadastrar", description: error.message, variant: "destructive" }),
  });

  const alternarStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "ativo" | "inativo" }) => {
      const { error } = await supabase.from("organizacao_catracas").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-catracas", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  const copiarToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast({ title: "Token copiado!" });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  };

  // Para saber quais parceiros oferecer no check-in, qualquer staff usa a
  // RPC listar_parceiros_externos_ativos (não expõe credenciais). O
  // cadastro das credenciais em si fica em /admin/configuracoes/integracoes
  // (restrito a gestor, mesma regra do RLS).
  const { data: parceirosAtivos = [] } = useQuery({
    queryKey: ["admin-parceiros-ativos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("listar_parceiros_externos_ativos", {
        _organization_id: organization!.id,
      });
      if (error) throw error;
      return (data ?? []).map((d) => d.parceiro as Parceiro);
    },
    enabled: !!organization?.id,
  });

  const checkinParceiroExterno = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{
        liberado: boolean;
        motivo: string;
        error?: string;
      }>("catraca-checkin-parceiro-externo", {
        body: {
          catraca_id: checkinCatracaId,
          parceiro: checkinParceiro,
          nome_visitante: checkinNomeVisitante.trim() || undefined,
        },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível registrar o check-in."));
      if (data?.error) throw new Error(data.error);
      if (!data?.liberado) throw new Error(data?.motivo ?? "Acesso não liberado.");
      return data;
    },
    onSuccess: () => {
      toast({ title: "Catraca liberada!" });
      setCheckinNomeVisitante("");
      void queryClient.invalidateQueries({ queryKey: ["admin-catracas-logs", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Não foi possível liberar", description: error.message, variant: "destructive" }),
  });

  const RESULTADO_LABEL: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
    liberado: { label: "Liberado", variant: "default" },
    liberado_parceiro_externo: { label: "Liberado (parceiro)", variant: "default" },
    negado_inadimplente: { label: "Inadimplente", variant: "destructive" },
    negado_pausado: { label: "Matrícula pausada", variant: "secondary" },
    negado_nao_encontrado: { label: "Não encontrado", variant: "secondary" },
    negado_catraca_inativa: { label: "Dispositivo inativo", variant: "secondary" },
    negado_sem_agendamento: { label: "Sem agendamento", variant: "secondary" },
    negado_falha_verificacao_agendamento: { label: "Falha ao verificar agendamento", variant: "destructive" },
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Catracas</h1>
          {realtimeAtivo && (
            <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-600/30">
              <Radio className="h-3 w-3 animate-pulse" /> Ao vivo
            </Badge>
          )}
        </div>
        <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> Novo dispositivo
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cadastrar catraca</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="catraca-nome">Nome do dispositivo</Label>
                <Input
                  id="catraca-nome"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Catraca — Recepção"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="catraca-local">Localização (opcional)</Label>
                <Input
                  id="catraca-local"
                  value={novaLocalizacao}
                  onChange={(e) => setNovaLocalizacao(e.target.value)}
                  placeholder="Entrada principal"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={!novoNome.trim() || criarCatraca.isPending}
                onClick={() => criarCatraca.mutate()}
              >
                {criarCatraca.isPending ? "Cadastrando..." : "Cadastrar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Dispositivos cadastrados</CardTitle>
          <p className="text-xs text-muted-foreground">
            Cada catraca usa seu próprio token de dispositivo para autenticar chamadas ao endpoint
            de validação de acesso — mantenha-o em local seguro no hardware.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {!isLoading && catracas.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhum dispositivo cadastrado ainda.
            </p>
          )}
          {catracas.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{c.nome}</p>
                  <Badge variant={c.status === "ativo" ? "default" : "secondary"}>
                    {c.status === "ativo" ? "Ativo" : "Inativo"}
                  </Badge>
                </div>
                {c.localizacao && <p className="text-xs text-muted-foreground">{c.localizacao}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[11px] font-mono text-muted-foreground truncate">
                    {c.device_token}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5"
                    onClick={() => void copiarToken(c.device_token)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                title={c.status === "ativo" ? "Desativar" : "Ativar"}
                onClick={() =>
                  alternarStatus.mutate({ id: c.id, status: c.status === "ativo" ? "inativo" : "ativo" })
                }
              >
                {c.status === "ativo" ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCheck className="h-4 w-4" /> Check-in de visitante (Wellhub / TotalPass)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Confira o código mostrado no app do visitante e confirme aqui para liberar a catraca. A
            validação automática com o parceiro ainda não está disponível — esta confirmação é manual.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {parceirosAtivos.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-2 space-y-2">
              <p>Nenhum parceiro habilitado ainda.</p>
              {ehGestor ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/configuracoes/integracoes">
                    <Settings className="h-3.5 w-3.5 mr-1.5" /> Cadastrar credenciais em Integrações
                  </Link>
                </Button>
              ) : (
                <p>Peça ao gestor para cadastrar um parceiro em Integrações.</p>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Catraca</Label>
                  <Select value={checkinCatracaId} onValueChange={setCheckinCatracaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {catracas
                        .filter((c) => c.status === "ativo")
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Parceiro</Label>
                  <Select value={checkinParceiro} onValueChange={(v) => setCheckinParceiro(v as Parceiro)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {parceirosAtivos.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PARCEIRO_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="checkin-visitante">Nome do visitante (opcional)</Label>
                <Input
                  id="checkin-visitante"
                  value={checkinNomeVisitante}
                  onChange={(e) => setCheckinNomeVisitante(e.target.value)}
                  placeholder="Nome mostrado no app do parceiro"
                />
              </div>
              <Button
                className="w-full"
                disabled={!checkinCatracaId || !checkinParceiro || checkinParceiroExterno.isPending}
                onClick={() => checkinParceiroExterno.mutate()}
              >
                {checkinParceiroExterno.isPending ? "Liberando..." : "Confirmar e liberar catraca"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Últimos acessos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {logs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum acesso registrado ainda.</p>
          )}
          {logs.map((log) => {
            // Liberado e desistiu é outra coisa: a catraca abriu e o aluno não
            // passou — e por isso não virou presença. Mostrar só "Liberado"
            // faria a recepção procurar uma presença que, com razão, não existe.
            const info =
              log.resultado === "liberado" && log.giro === "desistencia"
                ? { label: "Liberado, não passou", variant: "secondary" as const }
                : log.resultado === "liberado" && log.giro === "pendente"
                  ? { label: "Liberado, aguardando giro", variant: "secondary" as const }
                  : (RESULTADO_LABEL[log.resultado] ?? { label: log.resultado, variant: "secondary" as const });
            return (
              <div key={log.id} className="flex items-center justify-between gap-2 text-sm border-b border-border last:border-0 py-1.5">
                <div className="min-w-0">
                  <p className="truncate">
                    {log.organizacao_catracas?.nome ?? "Dispositivo removido"}
                    {log.parceiro_externo && (
                      <span className="text-muted-foreground">
                        {" — "}
                        {PARCEIRO_LABEL[log.parceiro_externo as Parceiro]}
                        {log.nome_visitante_externo ? ` (${log.nome_visitante_externo})` : ""}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {log.validado_offline && (
                    <Badge variant="outline" className="text-[10px]">Offline</Badge>
                  )}
                  <Badge variant={info.variant}>{info.label}</Badge>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
