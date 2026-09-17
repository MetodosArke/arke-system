import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dumbbell, Plus, Search, Trash2, Edit, Video, Upload, ExternalLink, Image as ImageIcon } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { stripAudioFromVideo } from "@/lib/stripAudio";


const isUploadedVideo = (url: string | null) => {
  if (!url) return false;
  return url.includes("exercicio-videos") && !url.includes("youtube") && !url.includes("youtu.be");
};

const getStoragePathFromUrl = (url: string, bucket: string) => {
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length);
};

const deleteVideoFromStorage = async (videoUrl: string) => {
  const path = getStoragePathFromUrl(videoUrl, "exercicio-videos");
  if (path) {
    await supabase.storage.from("exercicio-videos").remove([path]);
  }
};

const deleteImageFromStorage = async (imageUrl: string) => {
  const path = getStoragePathFromUrl(imageUrl, "exercicio-imagens");
  if (path) {
    await supabase.storage.from("exercicio-imagens").remove([path]);
  }
};


export default function AdminExercicios() {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nome, setNome] = useState("");
  const [grupos, setGrupos] = useState<string[]>([]);
  const [equipamento, setEquipamento] = useState("");
  const [descricao, setDescricao] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoType, setVideoType] = useState<"youtube" | "upload">("youtube");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [existingVideoUrl, setExistingVideoUrl] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: exercicios = [], isLoading } = useQuery({
    queryKey: ["exercicios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exercicios")
        .select("*")
        .order("grupo_muscular")
        .order("nome");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: gruposMusculares = [] } = useQuery({
    queryKey: ["grupos_musculares"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grupos_musculares")
        .select("nome")
        .order("ordem");
      if (error) throw error;
      return (data || []).map((g) => g.nome);
    },
  });

  const { data: equipamentos = [] } = useQuery({
    queryKey: ["equipamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("equipamentos")
        .select("nome")
        .order("ordem");
      if (error) throw error;
      return (data || []).map((e) => e.nome);
    },
  });

  const uploadFile = async (file: File, bucket: string) => {
    const ext = file.name.split(".").pop();
    const filePath = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(filePath, file);
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return data.publicUrl;
  };

  const upsert = useMutation({
    mutationFn: async () => {
      setUploading(true);
      let imagemUrl: string | null = null;
      let finalVideoUrl: string | null = existingVideoUrl || videoUrl || null;

      if (imageFile) {
        imagemUrl = await uploadFile(imageFile, "exercicio-imagens");
      }

      if (videoType === "upload" && videoFile) {
        let fileToUpload = videoFile;
        try {
          fileToUpload = await stripAudioFromVideo(videoFile);
        } catch (err) {
          console.warn("Falha ao remover áudio do vídeo, enviando original:", err);
        }
        finalVideoUrl = await uploadFile(fileToUpload, "exercicio-videos");
      }

      const payload: any = {
        nome,
        grupo_muscular: grupos.length > 0 ? grupos : ["Geral"],
        equipamento: equipamento || null,
        descricao: descricao || null,
        video_url: finalVideoUrl,
      };
      if (imagemUrl) payload.imagem_url = imagemUrl;

      if (editingId) {
        const { error } = await supabase
          .from("exercicios")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        if (imagemUrl) payload.imagem_url = imagemUrl;
        const { error } = await supabase.from("exercicios").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exercicios"] });
      toast({ title: editingId ? "Exercício atualizado!" : "Exercício criado!" });
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
    onSettled: () => setUploading(false),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      // Find the exercise to check for uploaded video
      const ex = exercicios.find((e: any) => e.id === id);
      if (ex?.video_url && isUploadedVideo(ex.video_url)) {
        await deleteVideoFromStorage(ex.video_url);
      }
      if (ex?.imagem_url) {
        await deleteImageFromStorage(ex.imagem_url);
      }
      const { error } = await supabase.from("exercicios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exercicios"] });
      toast({ title: "Exercício removido!" });
    },
  });

  const resetForm = () => {
    setNome("");
    setGrupos([]);
    setEquipamento("");
    setDescricao("");
    setVideoUrl("");
    setVideoType("youtube");
    setImageFile(null);
    setVideoFile(null);
    setEditingId(null);
    setExistingImageUrl(null);
    setExistingVideoUrl(null);
    setDialogOpen(false);
  };

  const startEdit = (ex: any) => {
    setNome(ex.nome);
    setGrupos(Array.isArray(ex.grupo_muscular) ? ex.grupo_muscular : [ex.grupo_muscular]);
    setEquipamento(ex.equipamento || "");
    setDescricao(ex.descricao || "");
    setExistingImageUrl(ex.imagem_url || null);
    const hasUploadedVideo = isUploadedVideo(ex.video_url);
    setExistingVideoUrl(hasUploadedVideo ? ex.video_url : null);
    setVideoUrl(hasUploadedVideo ? "" : (ex.video_url || ""));
    setVideoType(hasUploadedVideo ? "upload" : "youtube");
    setEditingId(ex.id);
    setDialogOpen(true);
  };

  const handleDeleteVideo = async () => {
    if (!editingId) return;
    const urlToDelete = existingVideoUrl;
    if (urlToDelete && isUploadedVideo(urlToDelete)) {
      await deleteVideoFromStorage(urlToDelete);
    }
    await supabase.from("exercicios").update({ video_url: null }).eq("id", editingId);
    setExistingVideoUrl(null);
    setVideoUrl("");
    setVideoFile(null);
    queryClient.invalidateQueries({ queryKey: ["exercicios"] });
    toast({ title: "Vídeo removido!" });
  };

  const handleDeleteImage = async () => {
    if (!editingId) return;
    if (existingImageUrl) {
      const path = getStoragePathFromUrl(existingImageUrl, "exercicio-imagens");
      if (path) {
        await supabase.storage.from("exercicio-imagens").remove([path]);
      }
    }
    await supabase.from("exercicios").update({ imagem_url: null }).eq("id", editingId);
    setExistingImageUrl(null);
    setImageFile(null);
    queryClient.invalidateQueries({ queryKey: ["exercicios"] });
    toast({ title: "Imagem removida!" });
  };

  const filtered = exercicios.filter(
    (e: any) =>
      e.nome.toLowerCase().includes(search.toLowerCase()) ||
      (Array.isArray(e.grupo_muscular) ? e.grupo_muscular : [e.grupo_muscular]).some((g: string) => g.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Exercícios</h2>
          <p className="text-xs sm:text-sm text-muted-foreground">Catálogo de exercícios da academia</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
          <DialogTrigger asChild>
            <Button className="gradient-primary text-primary-foreground w-full sm:w-auto text-sm">
              <Plus className="mr-1.5 h-4 w-4" />
              Novo Exercício
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Exercício" : "Novo Exercício"}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => { e.preventDefault(); upsert.mutate(); }}
              className="space-y-5"
            >
              {/* Nome */}
              <div>
                <Label>Nome do Exercício *</Label>
                <Input
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex: Supino Reto"
                  required
                />
              </div>

              {/* Imagem do Exercício */}
              <div>
                <Label>Imagem do Exercício</Label>
                {/* Existing image preview */}
                {existingImageUrl && !imageFile && (
                  <div className="mt-1 mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <img src={existingImageUrl} alt="Imagem atual" className="h-16 w-16 rounded-lg object-cover" />
                    <span className="text-sm text-muted-foreground flex-1 truncate">Imagem atual</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                      onClick={handleDeleteImage}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <div
                  className="mt-1 flex items-center gap-3 cursor-pointer rounded-lg border border-border bg-background px-4 py-3 hover:bg-muted/30 transition-colors"
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {imageFile ? imageFile.name : existingImageUrl ? "Trocar imagem" : "Escolher arquivo"}
                  </span>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>

              {/* Grupo Muscular + Equipamento */}
              <div className="space-y-4">
                <div>
                  <Label>Grupos Musculares</Label>
                  <SearchableMultiSelect
                    value={grupos}
                    onValueChange={setGrupos}
                    options={gruposMusculares}
                    placeholder="Selecione um ou mais"
                    addNewLabel="Adicionar"
                    onAddNew={async (name) => {
                      const maxOrdem = gruposMusculares.length + 1;
                      await supabase.from("grupos_musculares").insert({ nome: name, ordem: maxOrdem });
                      queryClient.invalidateQueries({ queryKey: ["grupos_musculares"] });
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Equipamento</Label>
                  <SearchableSelect
                    value={equipamento}
                    onValueChange={setEquipamento}
                    options={equipamentos}
                    placeholder="Selecione"
                    addNewLabel="Adicionar"
                    onAddNew={async (name) => {
                      const maxOrdem = equipamentos.length + 1;
                      await supabase.from("equipamentos").insert({ nome: name, ordem: maxOrdem });
                      queryClient.invalidateQueries({ queryKey: ["equipamentos"] });
                    }}
                  />
                </div>
              </div>
              </div>

              {/* Existing uploaded video preview */}
              {editingId && existingVideoUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <Video className="h-4 w-4 text-primary" />
                  <span className="text-sm text-muted-foreground flex-1 truncate">Vídeo anexado</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => window.open(existingVideoUrl, "_blank")}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Abrir
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                    onClick={handleDeleteVideo}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              {/* Video type toggle - always visible */}
              <div>
                <Label>Tipo de Vídeo</Label>
                <div className="mt-1 grid grid-cols-2 gap-0 rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      videoType === "youtube"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted/30"
                    }`}
                    onClick={() => setVideoType("youtube")}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Link YouTube
                  </button>
                  <button
                    type="button"
                    className={`flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      videoType === "upload"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted/30"
                    }`}
                    onClick={() => setVideoType("upload")}
                  >
                    <Upload className="h-4 w-4" />
                    Upload de Vídeo
                  </button>
                </div>
              </div>

              {/* YouTube link or Upload input - hide upload input when existing uploaded video */}
              {videoType === "youtube" ? (
                <div>
                  <Label>Link do Vídeo (YouTube)</Label>
                  <Input
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </div>
              ) : !existingVideoUrl ? (
                <div>
                  <Label>Upload de Vídeo</Label>
                  <div
                    className="mt-1 flex items-center gap-3 cursor-pointer rounded-lg border border-border bg-background px-4 py-3 hover:bg-muted/30 transition-colors"
                    onClick={() => videoInputRef.current?.click()}
                  >
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {videoFile ? videoFile.name : "Escolher vídeo"}
                    </span>
                    <input
                      ref={videoInputRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                    />
                  </div>
                </div>
              ) : null}


              {/* Descrição */}
              <div>
                <Label>Descrição / Observações</Label>
                <Textarea
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Técnica de execução, dicas, etc..."
                  rows={3}
                />
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancelar
                </Button>
                <Button type="submit" className="gradient-primary text-primary-foreground" disabled={!nome || grupos.length === 0 || uploading}>
                  {uploading ? "Enviando..." : editingId ? "Salvar Exercício" : "Adicionar Exercício"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar exercício..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <Card className="border-0 shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Dumbbell className="h-5 w-5 text-primary" />
            Catálogo ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/50" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Dumbbell className="h-10 w-10 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhum exercício cadastrado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((ex: any) => (
                <div
                  key={ex.id}
                  className="flex items-center justify-between rounded-lg bg-muted/30 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {ex.imagem_url ? (
                      <img src={ex.imagem_url} alt={ex.nome} className="h-9 w-9 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <Dumbbell className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold">{ex.nome}</p>
                      <div className="flex items-center gap-2">
                        {(Array.isArray(ex.grupo_muscular) ? ex.grupo_muscular : [ex.grupo_muscular]).map((g: string) => (
                          <Badge key={g} variant="outline" className="text-xs">{g}</Badge>
                        ))}
                        {ex.equipamento && <Badge variant="secondary" className="text-xs">{ex.equipamento}</Badge>}
                        {ex.video_url && <Video className="h-3 w-3 text-muted-foreground" />}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(ex)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => remove.mutate(ex.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
