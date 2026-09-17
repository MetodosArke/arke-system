import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Copy } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Props {
  templateId: string;
  divisao: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentOrder: number;
}

export function AdicionarExercicioTemplateDialog({
  templateId,
  divisao,
  open,
  onOpenChange,
  currentOrder,
}: Props) {
  const [grupo, setGrupo] = useState("");
  const [equipamento, setEquipamento] = useState("");
  const [exercicioNome, setExercicioNome] = useState("");
  const [exercicioId, setExercicioId] = useState<string | null>(null);
  const [tipoVideo, setTipoVideo] = useState<"link" | "upload">("link");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [imagemUrl, setImagemUrl] = useState("");
  const [numSeries, setNumSeries] = useState(4);
  const [mesmaConfig, setMesmaConfig] = useState(true);
  const [seriesData, setSeriesData] = useState<{ reps: string; descanso: string }[]>([]);
  const [observacoes, setObservacoes] = useState("");
  const [ordem, setOrdem] = useState(currentOrder);
  const [loading, setLoading] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: gruposMusculares = [] } = useQuery({
    queryKey: ["grupos_musculares"],
    queryFn: async () => {
      const { data } = await supabase.from("grupos_musculares").select("nome").order("ordem");
      return (data || []).map((g) => g.nome);
    },
  });

  const { data: equipamentos = [] } = useQuery({
    queryKey: ["equipamentos"],
    queryFn: async () => {
      const { data } = await supabase.from("equipamentos").select("nome").order("ordem");
      return (data || []).map((e) => e.nome);
    },
  });

  const { data: exerciciosDisponiveis = [] } = useQuery({
    queryKey: ["exercicios-filtrados", grupo, equipamento],
    queryFn: async () => {
      let query = supabase.from("exercicios").select("id, nome, grupo_muscular, equipamento").order("nome");
      if (grupo) query = query.contains("grupo_muscular", [grupo]);
      if (equipamento) query = query.eq("equipamento", equipamento);
      const { data } = await query;
      return data || [];
    },
  });

  useEffect(() => {
    setSeriesData((prev) =>
      Array.from({ length: numSeries }, (_, i) => prev[i] || { reps: "12", descanso: "60" })
    );
  }, [numSeries]);

  useEffect(() => { setOrdem(currentOrder); }, [currentOrder]);

  useEffect(() => {
    if (open) {
      setGrupo(""); setEquipamento(""); setExercicioNome(""); setExercicioId(null);
      setTipoVideo("link"); setVideoUrl(""); setVideoFile(null); setImagemUrl("");
      setNumSeries(4); setMesmaConfig(true);
      setSeriesData(Array.from({ length: 4 }, () => ({ reps: "12", descanso: "60" })));
      setObservacoes(""); setOrdem(currentOrder);
    }
  }, [open, currentOrder]);

  const handleExercicioSelect = (nome: string) => {
    setExercicioNome(nome);
    const found = exerciciosDisponiveis.find((e) => e.nome === nome);
    if (found) {
      setExercicioId(found.id);
      if (!grupo && found.grupo_muscular && Array.isArray(found.grupo_muscular) && found.grupo_muscular.length > 0) {
        setGrupo(found.grupo_muscular[0]);
      }
      if (!equipamento && found.equipamento) setEquipamento(found.equipamento || "");
    } else {
      setExercicioId(null);
    }
  };

  const updateSerie = (idx: number, field: "reps" | "descanso", value: string) => {
    setSeriesData((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exercicioNome) return;
    setLoading(true);

    let finalExercicioId = exercicioId;

    if (!finalExercicioId) {
      let finalVideoUrl = videoUrl;
      if (tipoVideo === "upload" && videoFile) {
        const ext = videoFile.name.split(".").pop();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from("exercicio-videos").upload(path, videoFile);
        if (uploadErr) { toast({ title: "Erro no upload", description: uploadErr.message, variant: "destructive" }); setLoading(false); return; }
        const { data: urlData } = supabase.storage.from("exercicio-videos").getPublicUrl(path);
        finalVideoUrl = urlData.publicUrl;
      }
      const { data: newEx, error: exError } = await supabase.from("exercicios").insert({
        nome: exercicioNome, grupo_muscular: grupo ? [grupo] : ["Geral"],
        equipamento: equipamento || null, video_url: finalVideoUrl || null, imagem_url: imagemUrl || null,
      } as any).select().single();
      if (exError) { toast({ title: "Erro", description: exError.message, variant: "destructive" }); setLoading(false); return; }
      finalExercicioId = newEx.id;
    }

    let repeticoes: string;
    let descansoSeg: number;
    if (mesmaConfig) {
      repeticoes = seriesData[0]?.reps || "12";
      descansoSeg = parseInt(seriesData[0]?.descanso || "60") || 60;
    } else {
      repeticoes = seriesData.map((s) => s.reps).join(",");
      descansoSeg = parseInt(seriesData[0]?.descanso || "60") || 60;
    }

    const insertData: any = {
      template_id: templateId, divisao, exercicio_id: finalExercicioId,
      ordem, series: numSeries, repeticoes, descanso_seg: descansoSeg,
      observacoes: observacoes || null,
    };
    if (!mesmaConfig) insertData.descanso_por_serie = seriesData.map((s) => s.descanso).join(",");

    const { error } = await (supabase.from("treino_template_exercicios") as any).insert(insertData);
    setLoading(false);

    if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); return; }

    toast({ title: "Exercício adicionado ao template!" });
    queryClient.invalidateQueries({ queryKey: ["template-exercicios", templateId, divisao] });
    queryClient.invalidateQueries({ queryKey: ["exercicios-filtrados"] });
    onOpenChange(false);
  };

  const exercicioOptions = exerciciosDisponiveis.map((e) => e.nome);
  const isNewExercise = !exercicioId && exercicioNome.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">Adicionar Exercício ao Template</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <Label>Grupo Muscular</Label>
              <SearchableSelect value={grupo} onValueChange={(v) => { setGrupo(v); setExercicioNome(""); setExercicioId(null); }} options={gruposMusculares} placeholder="Todos os grupos"
                onAddNew={async (name) => { await supabase.from("grupos_musculares").insert({ nome: name, ordem: gruposMusculares.length + 1 }); queryClient.invalidateQueries({ queryKey: ["grupos_musculares"] }); }} addNewLabel="Adicionar" />
            </div>
            <div>
              <Label>Equipamento</Label>
              <SearchableSelect value={equipamento} onValueChange={setEquipamento} options={equipamentos} placeholder="Todos"
                onAddNew={async (name) => { await supabase.from("equipamentos").insert({ nome: name, ordem: equipamentos.length + 1 }); queryClient.invalidateQueries({ queryKey: ["equipamentos"] }); }} addNewLabel="Adicionar" />
            </div>
          </div>

          <div>
            <Label>Exercício</Label>
            <p className="text-xs text-muted-foreground mb-1">
              {grupo || equipamento ? "Filtrado. " : ""}Digite para buscar ou criar novo
            </p>
            <SearchableSelect value={exercicioNome} onValueChange={handleExercicioSelect} options={exercicioOptions} placeholder="Nome do exercício..."
              onAddNew={async (name) => { setExercicioNome(name); setExercicioId(null); }} addNewLabel="Criar" />
          </div>

          {isNewExercise && (
            <>
              <div>
                <Label>Tipo de Vídeo</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" size="sm" variant={tipoVideo === "link" ? "default" : "outline"} onClick={() => setTipoVideo("link")}>Link YouTube</Button>
                  <Button type="button" size="sm" variant={tipoVideo === "upload" ? "default" : "outline"} onClick={() => setTipoVideo("upload")}>Upload</Button>
                </div>
              </div>
              {tipoVideo === "link" ? (
                <div><Label>Link do Vídeo</Label><Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtube.com/..." /></div>
              ) : (
                <div><Label>Upload de Vídeo</Label><Input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} /></div>
              )}
              <div><Label>Imagem (Opcional)</Label><Input value={imagemUrl} onChange={(e) => setImagemUrl(e.target.value)} placeholder="https://..." /></div>
            </>
          )}

          <div><Label>Séries</Label><Input type="number" min={1} max={10} value={numSeries} onChange={(e) => setNumSeries(parseInt(e.target.value) || 1)} /></div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={mesmaConfig} onCheckedChange={(v) => setMesmaConfig(!!v)} />
              <span className="text-sm">Mesma config para todas as séries</span>
            </label>
            {!mesmaConfig && (
              <Button type="button" variant="outline" size="sm" onClick={() => { const f = seriesData[0]; setSeriesData(seriesData.map(() => ({ ...f }))); }}>
                <Copy className="mr-1 h-3.5 w-3.5" />Aplicar 1ª para todas
              </Button>
            )}
          </div>

          {mesmaConfig ? (
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Repetições</Label><Input value={seriesData[0]?.reps || "12"} onChange={(e) => { const v = e.target.value; setSeriesData((p) => p.map((s) => ({ ...s, reps: v }))); }} /></div>
              <div><Label>Descanso (s)</Label><Input value={seriesData[0]?.descanso || "60"} onChange={(e) => { const v = e.target.value; setSeriesData((p) => p.map((s) => ({ ...s, descanso: v }))); }} /></div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Detalhes por Série</Label>
              {seriesData.map((s, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr_1fr] gap-2 items-center">
                  <span className="text-sm text-muted-foreground">Série {i + 1}</span>
                  <Input value={s.reps} onChange={(e) => updateSerie(i, "reps", e.target.value)} placeholder="Reps" />
                  <Input value={s.descanso} onChange={(e) => updateSerie(i, "descanso", e.target.value)} placeholder="Descanso" />
                </div>
              ))}
            </div>
          )}

          <div><Label>Observações</Label><Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Técnica, dicas..." /></div>
          <div><Label>Ordem</Label><Input type="number" min={1} value={ordem} onChange={(e) => setOrdem(parseInt(e.target.value) || 1)} /></div>

          <Button type="submit" className="w-full" disabled={!exercicioNome || loading}>
            {loading ? "Salvando..." : "Adicionar Exercício"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
