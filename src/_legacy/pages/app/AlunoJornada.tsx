import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { Target, Heart, CheckCircle2 } from "lucide-react";
import ObjetivosTab from "@/components/jornada/ObjetivosTab";
import ValoresTab from "@/components/jornada/ValoresTab";
import CompromissoTab from "@/components/jornada/CompromissoTab";

export default function AlunoJornada() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 space-y-4"
    >
      <div>
        <h1 className="text-2xl font-bold text-primary">Minha Jornada</h1>
        <p className="text-sm text-muted-foreground">Seus objetivos, valores e compromissos</p>
      </div>

      <Tabs defaultValue="objetivos" className="w-full">
        <TabsList className="w-full grid grid-cols-3 h-auto p-1">
          <TabsTrigger value="objetivos" className="flex items-center gap-1.5 text-xs py-2.5 data-[state=active]:shadow-md">
            <Target className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Objetivos</span>
            <span className="sm:hidden">Objetivos</span>
          </TabsTrigger>
          <TabsTrigger value="valores" className="flex items-center gap-1.5 text-xs py-2.5 data-[state=active]:shadow-md">
            <Heart className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Valores-guia</span>
            <span className="sm:hidden">Valores</span>
          </TabsTrigger>
          <TabsTrigger value="compromisso" className="flex items-center gap-1.5 text-xs py-2.5 data-[state=active]:shadow-md">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Compromisso</span>
            <span className="sm:hidden">Compro.</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objetivos">
          <ObjetivosTab />
        </TabsContent>
        <TabsContent value="valores">
          <ValoresTab />
        </TabsContent>
        <TabsContent value="compromisso">
          <CompromissoTab />
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
