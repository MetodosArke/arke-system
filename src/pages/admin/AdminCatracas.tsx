import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { DoorOpen, Plus, Copy, Power, PowerOff, ScrollText } from "lucide-react";

export default function AdminCatracas() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [novoNome, setNovoNome] = useState("");
  const [novaLocalizacao, setNovaLocalizacao] = useState("");
  const [dialogAberto, setDialogAberto] = useState(false);

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
        .select("id, resultado, cpf_consultado, created_at, organizacao_catracas(nome)")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

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

  const RESULTADO_LABEL: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
    liberado: { label: "Liberado", variant: "default" },
    negado_inadimplente: { label: "Inadimplente", variant: "destructive" },
    negado_nao_encontrado: { label: "Não encontrado", variant: "secondary" },
    negado_catraca_inativa: { label: "Dispositivo inativo", variant: "secondary" },
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Catracas</h1>
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
            <ScrollText className="h-4 w-4" /> Últimos acessos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {logs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Nenhum acesso registrado ainda.</p>
          )}
          {logs.map((log) => {
            const info = RESULTADO_LABEL[log.resultado] ?? { label: log.resultado, variant: "secondary" as const };
            return (
              <div key={log.id} className="flex items-center justify-between gap-2 text-sm border-b border-border last:border-0 py-1.5">
                <div className="min-w-0">
                  <p className="truncate">{log.organizacao_catracas?.nome ?? "Dispositivo removido"}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>
                <Badge variant={info.variant}>{info.label}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
