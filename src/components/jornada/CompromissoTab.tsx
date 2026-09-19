import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, Heart, Target, Sparkles, X } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type CompromissoSemanal = Tables<"compromisso_semanal">;
type CompromissoMeta = Tables<"compromisso_metas">;
type AlunoObjetivos = Tables<"aluno_objetivos">;
type AlunoValores = Tables<"aluno_valores">;

const MAX_METAS = 3;

function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function mensagemProgresso(pct: number) {
  if (pct >= 100) return "🎉 Semana completa! Você arrasou!";
  if (pct >= 50) return "💪 Mais da metade! Continue assim.";
  if (pct > 0) return "🚀 Bom começo, siga firme.";
  return "✨ Vamos começar a semana com o pé direito.";
}

interface MetaForm {
  texto: string;
  objetivo_vinculado: string;
  valor_vinculado: string;
}

const META_VAZIA: MetaForm = { texto: "", objetivo_vinculado: "", valor_vinculado: "" };

export default function CompromissoTab() {
  const { alunoId, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [metas, setMetas] = useState<MetaForm[]>([{ ...META_VAZIA }]);

  const weekKey = getWeekKey();

  const { data: objetivosAtual } = useQuery({
    queryKey: ["aluno-objetivos-compromisso", alunoId],
    queryFn: async () => {
      const { data } = await supabase.from("aluno_objetivos").select("*").eq("aluno_id", alunoId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data as AlunoObjetivos | null;
    },
    enabled: !!alunoId,
  });

  const { data: valoresAtual } = useQuery({
    queryKey: ["aluno-valores-compromisso", alunoId],
    queryFn: async () => {
      const { data } = await supabase.from("aluno_valores").select("*").eq("aluno_id", alunoId!).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data as AlunoValores | null;
    },
    enabled: !!alunoId,
  });

  const { data: compromisso, isLoading } = useQuery({
    queryKey: ["compromisso-semanal", alunoId, weekKey],
    queryFn: async () => {
      const { data, error } = await supabase.from("compromisso_semanal").select("*").eq("aluno_id", alunoId!).eq("semana", weekKey).maybeSingle();
      if (error) throw error;
      return data as CompromissoSemanal | null;
    },
    enabled: !!alunoId,
  });

  const { data: metasSalvas = [] } = useQuery({
    queryKey: ["compromisso-metas", compromisso?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("compromisso_metas").select("*").eq("compromisso_id", compromisso!.id).order("created_at");
      if (error) throw error;
      return data as CompromissoMeta[];
    },
    enabled: !!compromisso?.id,
  });

  const salvarCompromisso = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization) throw new Error("Cadastro de aluno não encontrado");
      const validas = metas.filter((m) => m.texto.trim());
      if (validas.length === 0) throw new Error("Adicione pelo menos uma meta");

      const { data: upserted, error } = await supabase
        .from("compromisso_semanal")
        .upsert({ organization_id: organization.id, aluno_id: alunoId, semana: weekKey }, { onConflict: "aluno_id,semana" })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("compromisso_metas").delete().eq("compromisso_id", upserted.id);

      const { error: insertError } = await supabase.from("compromisso_metas").insert(
        validas.map((m) => ({
          organization_id: organization.id,
          compromisso_id: upserted.id,
          texto: m.texto.trim(),
          objetivo_vinculado: m.objetivo_vinculado || null,
          valor_vinculado: m.valor_vinculado || null,
          concluida: false,
        }))
      );
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      toast({ title: "Compromisso da semana salvo!" });
      void queryClient.invalidateQueries({ queryKey: ["compromisso-semanal", alunoId, weekKey] });
      void queryClient.invalidateQueries({ queryKey: ["compromisso-metas"] });
      setIsCreating(false);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const toggleMeta = useMutation({
    mutationFn: async ({ id, concluida }: { id: string; concluida: boolean }) => {
      const { error } = await supabase.from("compromisso_metas").update({ concluida }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["compromisso-metas", compromisso?.id] }),
  });

  const iniciarCriacao = () => {
    setMetas([{ ...META_VAZIA }]);
    setIsCreating(true);
  };

  const atualizarMeta = (idx: number, campo: keyof MetaForm, valor: string) => {
    setMetas((prev) => prev.map((m, i) => (i === idx ? { ...m, [campo]: valor } : m)));
  };

  const removerMeta = (idx: number) => setMetas((prev) => prev.filter((_, i) => i !== idx));

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (isCreating) {
    return (
      <div className="space-y-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-3 text-xs text-muted-foreground flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
            Defina até {MAX_METAS} metas concretas pra essa semana. Vincular a um objetivo/valor te ajuda a lembrar do "porquê".
          </CardContent>
        </Card>

        {metas.map((meta, idx) => (
          <Card key={idx}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  placeholder={`Meta ${idx + 1}`}
                  value={meta.texto}
                  onChange={(e) => atualizarMeta(idx, "texto", e.target.value)}
                  className="flex-1"
                />
                {metas.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removerMeta(idx)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {meta.texto.trim() && (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={meta.objetivo_vinculado}
                    onChange={(e) => atualizarMeta(idx, "objetivo_vinculado", e.target.value)}
                  >
                    <option value="">Vincular a objetivo...</option>
                    {(objetivosAtual?.objetivos ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={meta.valor_vinculado}
                    onChange={(e) => atualizarMeta(idx, "valor_vinculado", e.target.value)}
                  >
                    <option value="">Vincular a valor...</option>
                    {(valoresAtual?.valores ?? []).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {metas.length < MAX_METAS && (
          <button
            className="w-full rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setMetas((prev) => [...prev, { ...META_VAZIA }])}
          >
            + Adicionar outra meta
          </button>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setIsCreating(false)}>
            Cancelar
          </Button>
          <Button disabled={!metas.some((m) => m.texto.trim()) || salvarCompromisso.isPending} onClick={() => salvarCompromisso.mutate()}>
            {salvarCompromisso.isPending ? "Salvando..." : "Salvar Compromisso"}
          </Button>
        </div>
      </div>
    );
  }

  if (!compromisso || metasSalvas.length === 0) {
    return (
      <Card>
        <CardContent className="p-4 flex flex-col items-center text-center gap-3 py-8">
          <Heart className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Você ainda não definiu suas metas desta semana.</p>
          <Button onClick={iniciarCriacao}>Criar Compromisso</Button>
        </CardContent>
      </Card>
    );
  }

  const concluidas = metasSalvas.filter((m) => m.concluida).length;
  const pct = Math.round((concluidas / metasSalvas.length) * 100);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Progresso da Semana</p>
            <span className="rounded-full bg-emerald-500/15 text-emerald-600 text-xs font-bold px-2.5 py-1">{pct}%</span>
          </div>
          <p className="text-xs text-muted-foreground">{mensagemProgresso(pct)}</p>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {metasSalvas.map((meta) => (
          <div
            key={meta.id}
            className={`rounded-lg border p-3 transition-colors ${meta.concluida ? "bg-emerald-500/10 border-emerald-500/30" : "border-border"}`}
          >
            <div className="flex items-start gap-2.5">
              <Checkbox
                checked={meta.concluida}
                onCheckedChange={(v) => toggleMeta.mutate({ id: meta.id, concluida: v === true })}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${meta.concluida ? "line-through text-muted-foreground" : ""}`}>{meta.texto}</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {meta.objetivo_vinculado && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Target className="h-3 w-3" /> {meta.objetivo_vinculado}
                    </span>
                  )}
                  {meta.valor_vinculado && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Heart className="h-3 w-3" /> {meta.valor_vinculado}
                    </span>
                  )}
                </div>
              </div>
              {meta.concluida && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => window.history.back()}>
          Voltar ao Dashboard
        </Button>
        <Button variant="outline" className="flex-1" onClick={iniciarCriacao}>
          Nova Semana
        </Button>
      </div>
    </div>
  );
}
