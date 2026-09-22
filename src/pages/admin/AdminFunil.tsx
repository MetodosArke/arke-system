import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Filter, MessageCircle, Plus, Trash2, X } from "lucide-react";

const ETAPAS = [
  { id: "novo", titulo: "Novo" },
  { id: "contato", titulo: "Em contato" },
  { id: "experimental", titulo: "Aula experimental" },
  { id: "negociacao", titulo: "Negociação" },
  { id: "matriculado", titulo: "Matriculado" },
  { id: "perdido", titulo: "Perdido" },
] as const;
type Etapa = (typeof ETAPAS)[number]["id"];

type Lead = {
  id: string;
  nome: string;
  telefone: string | null;
  origem: string | null;
  etapa: Etapa;
  aula_experimental_em: string | null;
  observacao: string | null;
  motivo_perda: string | null;
  updated_at: string;
};

const VAZIO = { nome: "", telefone: "", origem: "", observacao: "" };

/**
 * Funil de vendas em Kanban simples: interessados antes de virarem alunos. O
 * cartão anda por botões (sem arrastar, que no celular da recepção atrapalha
 * mais do que ajuda). "Matriculado" é o fim feliz — o cadastro do aluno segue
 * pelo caminho de sempre; "Perdido" pede o motivo, que é o que ensina.
 */
export default function AdminFunil() {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState(VAZIO);
  const [perdendo, setPerdendo] = useState<Lead | null>(null);
  const [motivo, setMotivo] = useState("");
  const chave = ["leads", organization?.id];

  const { data: leads = [] } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, nome, telefone, origem, etapa, aula_experimental_em, observacao, motivo_perda, updated_at")
        .eq("organization_id", organization!.id)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as Lead[];
    },
    enabled: !!organization?.id,
  });

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chave });

  const criar = useMutation({
    mutationFn: async () => {
      if (form.nome.trim().length < 2) throw new Error("Informe o nome.");
      const { error } = await supabase.from("leads").insert({
        organization_id: organization!.id,
        nome: form.nome.trim(),
        telefone: form.telefone.replace(/\D/g, "") || null,
        origem: form.origem.trim() || null,
        observacao: form.observacao.trim() || null,
        criado_por: user?.id,
        responsavel_id: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovo(false);
      setForm(VAZIO);
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const mover = useMutation({
    mutationFn: async ({ lead, etapa, motivoPerda }: { lead: Lead; etapa: Etapa; motivoPerda?: string }) => {
      const { error } = await supabase
        .from("leads")
        .update({ etapa, motivo_perda: etapa === "perdido" ? motivoPerda ?? null : null })
        .eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      if (v.etapa === "matriculado") toast({ title: "Matriculado!", description: "Cadastre o aluno em Alunos & Prescrições." });
      setPerdendo(null);
      setMotivo("");
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível mover", description: e.message, variant: "destructive" }),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: recarregar,
    onError: (e: Error) => toast({ title: "Não foi possível excluir", description: e.message, variant: "destructive" }),
  });

  const andar = (lead: Lead, passo: 1 | -1) => {
    const i = ETAPAS.findIndex((e) => e.id === lead.etapa);
    const destino = ETAPAS[i + passo]?.id;
    if (!destino) return;
    if (destino === "perdido") {
      setPerdendo(lead);
      return;
    }
    mover.mutate({ lead, etapa: destino });
  };

  const abertos = leads.filter((l) => l.etapa !== "matriculado" && l.etapa !== "perdido").length;
  const matriculados = leads.filter((l) => l.etapa === "matriculado").length;
  const conversao = matriculados + leads.filter((l) => l.etapa === "perdido").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Funil de vendas</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {abertos} em aberto · {conversao ? Math.round((matriculados / conversao) * 100) : 0}% de conversão
          </span>
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Novo interessado
          </Button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {ETAPAS.map((etapa, i) => {
          const daEtapa = leads.filter((l) => l.etapa === etapa.id);
          return (
            <section key={etapa.id} className="min-w-[15rem] w-60 shrink-0 snap-start space-y-2" aria-label={etapa.titulo}>
              <h2 className="text-sm font-semibold flex items-center justify-between px-1">
                {etapa.titulo} <span className="text-xs text-muted-foreground font-normal">{daEtapa.length}</span>
              </h2>
              {daEtapa.map((l) => (
                <Card key={l.id}>
                  <CardContent className="p-3 space-y-1.5">
                    <p className="text-sm font-medium">{l.nome}</p>
                    {l.origem && <p className="text-[11px] text-muted-foreground">Origem: {l.origem}</p>}
                    {l.observacao && <p className="text-xs text-muted-foreground line-clamp-2">{l.observacao}</p>}
                    {l.motivo_perda && <p className="text-xs text-destructive">Motivo: {l.motivo_perda}</p>}
                    <div className="flex items-center gap-1 pt-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Voltar etapa" disabled={i === 0} onClick={() => andar(l, -1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Avançar etapa" disabled={i === ETAPAS.length - 1} onClick={() => andar(l, 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      {l.etapa !== "perdido" && l.etapa !== "matriculado" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Marcar como perdido" onClick={() => setPerdendo(l)}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      {l.telefone && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Chamar no WhatsApp" asChild>
                          <a href={`https://wa.me/55${l.telefone}`} target="_blank" rel="noreferrer">
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto" aria-label="Excluir" onClick={() => excluir.mutate(l.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          );
        })}
      </div>

      <Dialog open={novo} onOpenChange={setNovo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo interessado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="lead-nome" className="text-xs">Nome</Label>
              <Input id="lead-nome" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="lead-tel" className="text-xs">Celular (WhatsApp)</Label>
                <Input id="lead-tel" inputMode="tel" value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lead-origem" className="text-xs">Origem</Label>
                <Input id="lead-origem" placeholder="Instagram, indicação..." value={form.origem} onChange={(e) => setForm((f) => ({ ...f, origem: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="lead-obs" className="text-xs">Observação</Label>
              <Textarea id="lead-obs" rows={3} value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={criar.isPending} onClick={() => criar.mutate()}>
              {criar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!perdendo} onOpenChange={(v) => !v && setPerdendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Por que não fechou?</DialogTitle>
          </DialogHeader>
          <Input aria-label="Motivo da perda" placeholder="Preço, horário, distância, foi para outra academia..." value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <DialogFooter>
            <Button disabled={!motivo.trim() || mover.isPending} onClick={() => perdendo && mover.mutate({ lead: perdendo, etapa: "perdido", motivoPerda: motivo.trim() })}>
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
