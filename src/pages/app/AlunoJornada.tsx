import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Target, Heart, CheckCircle2 } from "lucide-react";
import ObjetivosTab from "@/components/jornada/ObjetivosTab";
import ValoresTab from "@/components/jornada/ValoresTab";
import CompromissoTab from "@/components/jornada/CompromissoTab";

export default function AlunoJornada() {
  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">Minha Jornada</h1>
        <p className="text-xs text-muted-foreground">Seus objetivos, valores e compromissos</p>
      </div>

      <Tabs defaultValue="objetivos">
        <TabsList className="grid grid-cols-3">
          <TabsTrigger value="objetivos" className="gap-1.5">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">Objetivos</span>
          </TabsTrigger>
          <TabsTrigger value="valores" className="gap-1.5">
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Valores-guia</span>
            <span className="sm:hidden">Valores</span>
          </TabsTrigger>
          <TabsTrigger value="compromisso" className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:inline">Compromisso</span>
            <span className="sm:hidden">Compro.</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objetivos" className="pt-3">
          <ObjetivosTab />
        </TabsContent>
        <TabsContent value="valores" className="pt-3">
          <ValoresTab />
        </TabsContent>
        <TabsContent value="compromisso" className="pt-3">
          <CompromissoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
