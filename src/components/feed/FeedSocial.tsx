import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Trash2, Image as ImageIcon, X, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";

type FeedPost = Tables<"feed_posts">;
type FeedComment = Tables<"feed_comments">;

const PAGE_SIZE = 15;
const MAX_IMAGE_MB = 5;

interface Perfil {
  full_name: string;
  avatar_url: string | null;
}

function iniciais(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function FeedSocial({ podeModerarTudo }: { podeModerarTudo: boolean }) {
  const { user, organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [imagemArquivo, setImagemArquivo] = useState<File | null>(null);
  const [imagemPreview, setImagemPreview] = useState<string | null>(null);
  const [enviandoPost, setEnviandoPost] = useState(false);
  const [limite, setLimite] = useState(PAGE_SIZE);
  const [comentariosAbertos, setComentariosAbertos] = useState<Record<string, boolean>>({});
  const [novoComentario, setNovoComentario] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["feed-posts", organization?.id, limite],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limite);
      if (error) throw error;
      return data as FeedPost[];
    },
    enabled: !!organization?.id,
  });

  const { data: perfis = [] } = useQuery({
    queryKey: ["feed-perfis", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("obter_perfis_publicos_org");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });
  const perfilPorUserId = useMemo(() => new Map(perfis.map((p) => [p.user_id, p as Perfil])), [perfis]);

  const { data: likes = [] } = useQuery({
    queryKey: ["feed-likes", posts.map((p) => p.id).join(",")],
    queryFn: async () => {
      if (posts.length === 0) return [];
      const { data, error } = await supabase.from("feed_likes").select("post_id, user_id").in("post_id", posts.map((p) => p.id));
      if (error) throw error;
      return data;
    },
    enabled: posts.length > 0,
  });

  const { data: comentarios = [] } = useQuery({
    queryKey: ["feed-comments", posts.map((p) => p.id).join(",")],
    queryFn: async () => {
      if (posts.length === 0) return [];
      const { data, error } = await supabase
        .from("feed_comments")
        .select("*")
        .in("post_id", posts.map((p) => p.id))
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as FeedComment[];
    },
    enabled: posts.length > 0,
  });

  const likesPorPost = useMemo(() => {
    const map = new Map<string, { count: number; curtiPor: boolean }>();
    likes.forEach((l) => {
      const atual = map.get(l.post_id) ?? { count: 0, curtiPor: false };
      atual.count++;
      if (l.user_id === user?.id) atual.curtiPor = true;
      map.set(l.post_id, atual);
    });
    return map;
  }, [likes, user?.id]);

  const comentariosPorPost = useMemo(() => {
    const map = new Map<string, FeedComment[]>();
    comentarios.forEach((c) => map.set(c.post_id, [...(map.get(c.post_id) ?? []), c]));
    return map;
  }, [comentarios]);

  const invalidarFeed = () => {
    void queryClient.invalidateQueries({ queryKey: ["feed-posts", organization?.id] });
  };

  const escolherImagem = (file: File) => {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      toast({ title: "Imagem muito grande", description: `Máximo ${MAX_IMAGE_MB}MB.`, variant: "destructive" });
      return;
    }
    setImagemArquivo(file);
    setImagemPreview(URL.createObjectURL(file));
  };

  const removerImagem = () => {
    setImagemArquivo(null);
    setImagemPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const publicar = useMutation({
    mutationFn: async () => {
      if (!user || !organization) throw new Error("Sessão inválida");
      if (!texto.trim() && !imagemArquivo) throw new Error("Escreva algo ou adicione uma foto");
      setEnviandoPost(true);
      let imageUrl: string | null = null;
      if (imagemArquivo) {
        const ext = imagemArquivo.name.split(".").pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("feed-images").upload(path, imagemArquivo);
        if (uploadError) throw uploadError;
        imageUrl = supabase.storage.from("feed-images").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase.from("feed_posts").insert({
        organization_id: organization.id,
        user_id: user.id,
        content: texto.trim(),
        image_url: imageUrl,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto("");
      removerImagem();
      invalidarFeed();
    },
    onError: (error: Error) => toast({ title: "Não foi possível publicar", description: error.message, variant: "destructive" }),
    onSettled: () => setEnviandoPost(false),
  });

  const apagarPost = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from("feed_posts").delete().eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Post removido" });
      invalidarFeed();
    },
    onError: (error: Error) => toast({ title: "Erro ao remover", description: error.message, variant: "destructive" }),
  });

  const toggleLike = useMutation({
    mutationFn: async (postId: string) => {
      if (!user || !organization) throw new Error("Sessão inválida");
      const jaCurtiu = likesPorPost.get(postId)?.curtiPor;
      if (jaCurtiu) {
        const { error } = await supabase.from("feed_likes").delete().eq("post_id", postId).eq("user_id", user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("feed_likes").insert({ organization_id: organization.id, post_id: postId, user_id: user.id });
        if (error) throw error;
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["feed-likes"] }),
  });

  const enviarComentario = useMutation({
    mutationFn: async (postId: string) => {
      if (!user || !organization) throw new Error("Sessão inválida");
      const texto = (novoComentario[postId] ?? "").trim();
      if (!texto) return;
      const { error } = await supabase.from("feed_comments").insert({ organization_id: organization.id, post_id: postId, user_id: user.id, content: texto });
      if (error) throw error;
    },
    onSuccess: (_, postId) => {
      setNovoComentario((c) => ({ ...c, [postId]: "" }));
      void queryClient.invalidateQueries({ queryKey: ["feed-comments"] });
    },
    onError: (error: Error) => toast({ title: "Erro ao comentar", description: error.message, variant: "destructive" }),
  });

  const apagarComentario = useMutation({
    mutationFn: async (comentarioId: string) => {
      const { error } = await supabase.from("feed_comments").delete().eq("id", comentarioId);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["feed-comments"] }),
  });

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarImage src={perfilPorUserId.get(user?.id ?? "")?.avatar_url ?? undefined} />
              <AvatarFallback>{iniciais(perfilPorUserId.get(user?.id ?? "")?.full_name ?? "Você")}</AvatarFallback>
            </Avatar>
            <Textarea placeholder="O que você está pensando?" value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} className="flex-1" />
          </div>
          {imagemPreview && (
            <div className="relative inline-block">
              <img src={imagemPreview} alt="Prévia" className="max-h-48 rounded-lg" />
              <button
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                onClick={removerImagem}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) escolherImagem(file);
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
              <ImageIcon className="h-4 w-4 mr-1.5" /> Foto
            </Button>
            <Button size="sm" disabled={(!texto.trim() && !imagemArquivo) || enviandoPost} onClick={() => publicar.mutate()}>
              {enviandoPost ? <Loader2 className="h-4 w-4 animate-spin" /> : "Publicar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground text-center">Carregando...</p>}
      {!isLoading && posts.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">Ainda não tem nada por aqui. Seja o primeiro a postar!</CardContent>
        </Card>
      )}

      {posts.map((post) => {
        const perfil = perfilPorUserId.get(post.user_id);
        const likeInfo = likesPorPost.get(post.id) ?? { count: 0, curtiPor: false };
        const comentariosDoPost = comentariosPorPost.get(post.id) ?? [];
        const podeApagar = podeModerarTudo || post.user_id === user?.id;
        const comentarioAberto = !!comentariosAbertos[post.id];

        return (
          <Card key={post.id}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={perfil?.avatar_url ?? undefined} />
                    <AvatarFallback>{iniciais(perfil?.full_name ?? "?")}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold">{perfil?.full_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(post.created_at), "dd MMM 'às' HH:mm", { locale: ptBR })}</p>
                  </div>
                </div>
                {podeApagar && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => apagarPost.mutate(post.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {post.content && <p className="text-sm whitespace-pre-wrap">{post.content}</p>}
              {post.image_url && <img src={post.image_url} alt="" className="rounded-lg max-h-80 w-full object-cover" />}

              <div className="flex items-center gap-4 pt-1 border-t border-border">
                <button
                  className="flex items-center gap-1.5 text-sm py-2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => toggleLike.mutate(post.id)}
                >
                  <Heart className={cn("h-4 w-4", likeInfo.curtiPor && "fill-primary text-primary")} />
                  {likeInfo.count > 0 && likeInfo.count}
                </button>
                <button
                  className="flex items-center gap-1.5 text-sm py-2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setComentariosAbertos((c) => ({ ...c, [post.id]: !c[post.id] }))}
                >
                  <MessageCircle className="h-4 w-4" />
                  {comentariosDoPost.length > 0 && comentariosDoPost.length}
                </button>
              </div>

              {comentarioAberto && (
                <div className="space-y-2 pt-1">
                  {comentariosDoPost.map((c) => {
                    const perfilComentario = perfilPorUserId.get(c.user_id);
                    return (
                      <div key={c.id} className="flex items-start gap-2">
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarImage src={perfilComentario?.avatar_url ?? undefined} />
                          <AvatarFallback className="text-[10px]">{iniciais(perfilComentario?.full_name ?? "?")}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0 rounded-lg bg-muted/40 px-2.5 py-1.5">
                          <p className="text-xs font-semibold">{perfilComentario?.full_name ?? "—"}</p>
                          <p className="text-sm break-words">{c.content}</p>
                        </div>
                        {(podeModerarTudo || c.user_id === user?.id) && (
                          <button className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => apagarComentario.mutate(c.id)}>
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      enviarComentario.mutate(post.id);
                    }}
                  >
                    <Input
                      placeholder="Escreva um comentário..."
                      value={novoComentario[post.id] ?? ""}
                      onChange={(e) => setNovoComentario((c) => ({ ...c, [post.id]: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={!(novoComentario[post.id] ?? "").trim()}>
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {posts.length >= limite && (
        <Button variant="outline" className="w-full" onClick={() => setLimite((l) => l + PAGE_SIZE)}>
          Carregar mais
        </Button>
      )}
    </div>
  );
}
