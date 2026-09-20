import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";
import { DesafiosPainel } from "@/components/admin/DesafiosPainel";
import { CompeticoesPainel } from "@/components/admin/CompeticoesPainel";
import { FeedSocial } from "@/components/feed/FeedSocial";

// Consolida os 3 recursos de gamificação/comunidade que antes eram itens
// separados no menu (Desafios, Competições, Feed) — mesmo assunto
// (engajamento do aluno), só reagrupado em abas.
export default function AdminEngajamento() {
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Engajamento</h1>
      </div>

      <Tabs defaultValue="desafios">
        <TabsList>
          <TabsTrigger value="desafios">Desafios</TabsTrigger>
          <TabsTrigger value="competicoes">Competições</TabsTrigger>
          <TabsTrigger value="feed">Feed</TabsTrigger>
        </TabsList>

        <TabsContent value="desafios" className="pt-3">
          <DesafiosPainel />
        </TabsContent>
        <TabsContent value="competicoes" className="pt-3">
          <CompeticoesPainel />
        </TabsContent>
        <TabsContent value="feed" className="pt-3">
          <FeedSocial podeModerarTudo />
        </TabsContent>
      </Tabs>
    </div>
  );
}
