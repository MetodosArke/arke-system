import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Send, Trash2, X, Rss } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

export default function AdminFeed() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const [showComments, setShowComments] = useState<Record<string, boolean>>({});
  const [newPost, setNewPost] = useState("");
  const [posting, setPosting] = useState(false);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["feed-posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["feed-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name, avatar_url");
      if (error) throw error;
      return data;
    },
  });

  const { data: likes = [] } = useQuery({
    queryKey: ["feed-likes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_likes").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: comments = [] } = useQuery({
    queryKey: ["feed-comments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("feed_comments")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const profileMap = Object.fromEntries(profiles.map((p) => [p.user_id, p]));

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const createPost = async () => {
    if (!user || !newPost.trim()) return;
    setPosting(true);
    try {
      const { error } = await supabase.from("feed_posts").insert({
        user_id: user.id,
        content: newPost.trim(),
      });
      if (error) throw error;
      setNewPost("");
      queryClient.invalidateQueries({ queryKey: ["feed-posts"] });
      toast.success("Publicação criada!");
    } catch {
      toast.error("Erro ao publicar");
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = useMutation({
    mutationFn: async (postId: string) => {
      if (!user) return;
      const existing = likes.find((l) => l.post_id === postId && l.user_id === user.id);
      if (existing) {
        await supabase.from("feed_likes").delete().eq("id", existing.id);
      } else {
        await supabase.from("feed_likes").insert({ post_id: postId, user_id: user.id });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["feed-likes"] }),
  });

  const addComment = useMutation({
    mutationFn: async (postId: string) => {
      if (!user) return;
      const text = commentText[postId]?.trim();
      if (!text) return;
      const { error } = await supabase.from("feed_comments").insert({
        post_id: postId,
        user_id: user.id,
        content: text,
      });
      if (error) throw error;
    },
    onSuccess: (_, postId) => {
      setCommentText((prev) => ({ ...prev, [postId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["feed-comments"] });
    },
    onError: () => toast.error("Erro ao comentar"),
  });

  const deletePost = useMutation({
    mutationFn: async (postId: string) => {
      const { error } = await supabase.from("feed_posts").delete().eq("id", postId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed-posts"] });
      toast.success("Publicação removida");
    },
  });

  const deleteComment = useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from("feed_comments").delete().eq("id", commentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["feed-comments"] });
      toast.success("Comentário removido");
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Rss className="h-6 w-6 text-primary" />
        <h1
          className="text-2xl font-bold text-primary"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          Feed da Comunidade
        </h1>
      </div>

      {/* Admin can also post */}
      <Card className="border-primary/20">
        <CardContent className="p-4 space-y-3">
          <Textarea
            value={newPost}
            onChange={(e) => setNewPost(e.target.value)}
            placeholder="Publique uma mensagem para a comunidade..."
            className="min-h-[60px] resize-none text-sm"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={createPost} disabled={posting || !newPost.trim()}>
              <Send className="h-4 w-4 mr-1" /> Publicar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="max-w-2xl space-y-4">
        {isLoading ? (
          <p className="text-center text-muted-foreground text-sm">Carregando...</p>
        ) : posts.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Nenhuma publicação no feed ainda.
            </CardContent>
          </Card>
        ) : (
          posts.map((post) => {
            const author = profileMap[post.user_id];
            const postLikes = likes.filter((l) => l.post_id === post.id);
            const userLiked = postLikes.some((l) => l.user_id === user?.id);
            const postComments = comments.filter((c) => c.post_id === post.id);

            return (
              <Card key={post.id} className="overflow-hidden">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={author?.avatar_url || ""} />
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {getInitials(author?.full_name || "U")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-semibold">{author?.full_name || "Usuário"}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(post.created_at), "dd MMM 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deletePost.mutate(post.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {post.content && <p className="text-sm whitespace-pre-wrap">{post.content}</p>}
                  {post.image_url && (
                    <img src={post.image_url} alt="" className="w-full rounded-lg max-h-80 object-cover" />
                  )}

                  <div className="flex items-center gap-4 pt-1 border-t border-border">
                    <button
                      onClick={() => toggleLike.mutate(post.id)}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Heart className={cn("h-4 w-4", userLiked && "fill-primary text-primary")} />
                      <span>{postLikes.length}</span>
                    </button>
                    <button
                      onClick={() => setShowComments((prev) => ({ ...prev, [post.id]: !prev[post.id] }))}
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
                    >
                      <MessageCircle className="h-4 w-4" />
                      <span>{postComments.length}</span>
                    </button>
                  </div>

                  {showComments[post.id] && (
                    <div className="space-y-2 pt-2">
                      {postComments.map((c) => {
                        const cAuthor = profileMap[c.user_id];
                        return (
                          <div key={c.id} className="flex gap-2 items-start group">
                            <Avatar className="h-6 w-6 mt-0.5">
                              <AvatarFallback className="text-[10px] bg-muted">
                                {getInitials(cAuthor?.full_name || "U")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 bg-muted rounded-lg px-3 py-1.5">
                              <p className="text-xs font-semibold">{cAuthor?.full_name || "Usuário"}</p>
                              <p className="text-xs">{c.content}</p>
                            </div>
                            <button
                              onClick={() => deleteComment.mutate(c.id)}
                              className="text-destructive hover:text-destructive/80 transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                      <div className="flex gap-2">
                        <input
                          value={commentText[post.id] || ""}
                          onChange={(e) => setCommentText((prev) => ({ ...prev, [post.id]: e.target.value }))}
                          placeholder="Escreva um comentário..."
                          className="flex-1 text-xs bg-muted rounded-lg px-3 py-2 outline-none focus:ring-1 ring-primary"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              addComment.mutate(post.id);
                            }
                          }}
                        />
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => addComment.mutate(post.id)}>
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
