import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, Trash2 } from "lucide-react";

const PUBLICO: Record<string, string> = { alunos: "Alunos", equipe: "Equipe", todos: "Todos" };

/**
 * Comunicados em massa: um aviso para todos os alunos (ou para a equipe) —
 * feriado, horário especial, evento. Aparece no app e vai por notificação no
 * celular de quem ativou. Gestor e recepção publicam.
 */
export default function AdminComunicados() {
  const { organization, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [publico, setPublico] = useState("alunos");
  const [expira, setExpira] = useState("");
  const podePublicar = organizationRole === "gestor" || organizationRole === "recepcao";

  const { data: comunicados = [] } = useQuery({
    queryKey: ["comunicados-admin", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comunicados")
        .select("id, titulo, mensagem, publico, criado_em, expira_em, comunicados_lidos(count)")
        .eq("organization_id", organization!.id)
        .order("criado_em", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const publicar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ enviados?: number }>("enviar-comunicado", {
        body: { organization_id: organization!.id, titulo, mensagem, publico, expira_em: expira || null },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível publicar."));
      return data;
    },
    onSuccess: (r) => {
      toast({ title: "Comunicado publicado", description: r?.enviados ? `Notificação enviada a ${r.enviados} aparelho(s).` : "Aparece no app de quem abrir." });
      setTitulo("");
      setMensagem("");
      setExpira("");
      void queryClient.invalidateQueries({ queryKey: ["comunicados-admin", organization?.id] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível publicar", description: e.message, variant: "destructive" }),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("comunicados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["comunicados-admin", organization?.id] }),
    onError: (e: Error) => toast({ title: "Não foi possível excluir", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Comunicados</h1>
      </div>

      {podePublicar && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Novo comunicado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="com-titulo" className="text-xs">Título</Label>
              <Input id="com-titulo" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Horário especial no feriado" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="com-mensagem" className="text-xs">Mensagem</Label>
              <Textarea id="com-mensagem" rows={4} maxLength={2000} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Para</Label>
                <Select value={publico} onValueChange={setPublico}>
                  <SelectTrigger aria-label="Público do comunicado">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PUBLICO).map(([v, r]) => (
                      <SelectItem key={v} value={v}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="com-expira" className="text-xs">Mostrar até (opcional)</Label>
                <Input id="com-expira" type="date" value={expira} onChange={(e) => setExpira(e.target.value)} />
              </div>
            </div>
            <Button disabled={publicar.isPending || titulo.trim().length < 3 || mensagem.trim().length < 3} onClick={() => publicar.mutate()}>
              {publicar.isPending ? "Publicando..." : "Publicar e notificar"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {comunicados.length === 0 && <p className="text-sm text-muted-foreground">Nenhum comunicado ainda.</p>}
        {comunicados.map((c) => (
          <Card key={c.id}>
            <CardContent className="py-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.titulo}</p>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{PUBLICO[c.publico] ?? c.publico}</Badge>
                  {podePublicar && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Excluir comunicado" onClick={() => excluir.mutate(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-line">{c.mensagem}</p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(c.criado_em).toLocaleDateString("pt-BR")} · lido por {(c.comunicados_lidos as unknown as { count: number }[])?.[0]?.count ?? 0}
                {c.expira_em ? ` · até ${new Date(`${c.expira_em}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
