import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Target, Heart, CheckCircle2, CalendarDays } from "lucide-react";
import ObjetivosTab from "@/components/jornada/ObjetivosTab";
import ValoresTab from "@/components/jornada/ValoresTab";
import CompromissoTab from "@/components/jornada/CompromissoTab";
import RotinaSemanal from "@/components/aluno/RotinaSemanal";
import { MetodoArke } from "@/components/aluno/MetodoArke";
import { useAuth } from "@/contexts/AuthContext";
import { SeloMetodoArke } from "@/components/marca/MarcaAcademia";

/**
 * Minha Jornada — quatro abas.
 *
 * Reorganização de 23/09/2026. A aba que se chamava *Compromisso* passou a se
 * chamar **Meta Pessoal**: ela sempre foi sobre as metas da semana que o aluno
 * escreve para si, e o nome antigo disputava significado com o compromisso de
 * rotina — o que o aluno de fato assume ao dizer em que dias vai treinar.
 *
 * Esse compromisso de rotina veio do calendário de treinos para cá, como aba
 * **Compromisso**. O lugar dele é a jornada: dizer "segunda eu treino, terça eu
 * descanso" é intenção, não execução. O calendário ficou com o que é execução —
 * o card de meta semanal e os treinos registrados.
 */
export default function AlunoJornada() {
  const { planoAluno, organization } = useAuth();

  // A Jornada é do Método ARKE (decisão comercial de 28/09/2026). Quem chega
  // aqui no Free, por um link antigo, vê o convite, sem tela trancada.
  if (planoAluno === "free") {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold">Minha Jornada</h1>
        {organization?.id && <MetodoArke organizationId={organization.id} recurso="A Minha Jornada" />}
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div>
        {/* O app leva a marca da academia; a Jornada é do Método, e o selo diz isso. */}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">Minha Jornada</h1>
          <SeloMetodoArke />
        </div>
        <p className="text-xs text-muted-foreground">Seus objetivos, valores, metas e compromisso de rotina</p>
      </div>

      <Tabs defaultValue="objetivos">
        <TabsList className="grid grid-cols-4">
          <TabsTrigger value="objetivos" className="gap-1.5">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">Objetivos</span>
          </TabsTrigger>
          <TabsTrigger value="valores" className="gap-1.5">
            <Heart className="h-4 w-4" />
            <span className="hidden sm:inline">Valores-guia</span>
            <span className="sm:hidden">Valores</span>
          </TabsTrigger>
          <TabsTrigger value="meta-pessoal" className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:inline">Meta Pessoal</span>
            <span className="sm:hidden">Meta</span>
          </TabsTrigger>
          <TabsTrigger value="compromisso" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            <span className="hidden sm:inline">Compromisso</span>
            <span className="sm:hidden">Rotina</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="objetivos" className="pt-3">
          <ObjetivosTab />
        </TabsContent>
        <TabsContent value="valores" className="pt-3">
          <ValoresTab />
        </TabsContent>
        <TabsContent value="meta-pessoal" className="pt-3">
          <CompromissoTab />
        </TabsContent>
        <TabsContent value="compromisso" className="pt-3">
          <RotinaSemanal />
        </TabsContent>
      </Tabs>
    </div>
  );
}
