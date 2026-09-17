import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Copy, Trash2, Clock, MapPin, Pencil, AlertTriangle } from "lucide-react";
import { TreinoExercicios } from "./TreinoExercicios";
import { AdicionarTreinoAvulsoDialog } from "./AdicionarTreinoAvulsoDialog";
import { EditarTreinoDialog } from "./EditarTreinoDialog";
import { EditarTreinoAvulsoDialog } from "./EditarTreinoAvulsoDialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface TreinoGrupo {
  grupo_id: string;
  titulo: string;
  aluno_nome: string;
  aluno_id: string;
  descricao: string | null;
  academia_id?: string | null;
  validade_inicio: string | null;
  validade_fim: string | null;
  treinos: {
    id: string;
    tipo: string;
    status: string;
    duracao_esperada_min?: number | null;
    distancia_esperada_km?: number | null;
    titulo?: string;
  }[];
}

interface TreinoCardProps {
  grupo: TreinoGrupo;
  onDuplicate: (grupoId: string) => void;
  onDelete: (grupoId: string) => void;
  isExpired?: boolean;
  alunos?: { user_id: string; full_name: string }[];
}

export function TreinoCard({ grupo, onDuplicate, onDelete, isExpired, alunos = [] }: TreinoCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAvulso, setEditAvulso] = useState<any>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const divisoes = grupo.treinos.filter((t) => t.tipo !== "avulso");
  const avulsos = grupo.treinos.filter((t) => t.tipo === "avulso");
  const [activeTab, setActiveTab] = useState(divisoes[0]?.tipo || "A");

  const activeTreino = divisoes.find((t) => t.tipo === activeTab);

  const handleDeleteAvulso = async (id: string) => {
    await supabase.from("treino_exercicios").delete().eq("treino_id", id);
    await supabase.from("treinos").delete().eq("id", id);
    queryClient.invalidateQueries({ queryKey: ["admin-treinos"] });
    toast({ title: "Treino avulso removido!" });
  };

  return (
    <>
      <Card className={`border-0 shadow-md overflow-hidden ${isExpired ? "border-l-4 border-l-destructive bg-destructive/5" : ""}`}>
        <CardHeader
          className="cursor-pointer hover:bg-muted/30 transition-colors py-3 sm:py-4 px-3 sm:px-6"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-start sm:items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm sm:text-base truncate">{grupo.titulo}</p>
                {isExpired && (
                  <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0 flex items-center gap-0.5">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    Vencido
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {grupo.aluno_nome}
                {grupo.validade_inicio && ` · ${grupo.validade_inicio}`}
                {grupo.validade_fim && ` — ${grupo.validade_fim}`}
              </p>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0 flex-wrap justify-end">
              <div className="hidden sm:flex gap-1">
                {divisoes.map((t) => (
                  <Badge key={t.id} variant="secondary" className="text-xs">
                    {t.tipo}
                  </Badge>
                ))}
                {avulsos.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    +{avulsos.length} avulso{avulsos.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <div className="flex sm:hidden gap-0.5">
                {divisoes.slice(0, 3).map((t) => (
                  <Badge key={t.id} variant="secondary" className="text-[10px] px-1.5 py-0">
                    {t.tipo}
                  </Badge>
                ))}
                {(divisoes.length > 3 || avulsos.length > 0) && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    +{Math.max(0, divisoes.length - 3) + avulsos.length}
                  </Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditOpen(true);
                }}
              >
                <Pencil className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(grupo.grupo_id);
                }}
              >
                <Copy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(grupo.grupo_id);
                }}
              >
                <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </Button>
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
        {expanded && (
          <CardContent className="border-t pt-4 px-3 sm:px-6">
            <Tabs defaultValue="divisoes" className="w-full">
              <TabsList className="mb-4 w-full sm:w-auto">
                <TabsTrigger value="divisoes" className="flex-1 sm:flex-none text-xs sm:text-sm">
                  Divisões de Treino
                </TabsTrigger>
                <TabsTrigger value="avulsos" className="flex-1 sm:flex-none text-xs sm:text-sm">
                  Treinos Avulsos
                  {avulsos.length > 0 && (
                    <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
                      {avulsos.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="divisoes">
                {divisoes.length > 0 ? (
                  <>
                    <div className="mb-4">
                      <div className="flex gap-1.5 sm:gap-2 flex-wrap">
                        {divisoes.map((t) => (
                          <Button
                            key={t.id}
                            variant={activeTab === t.tipo ? "default" : "outline"}
                            size="sm"
                            className="text-xs sm:text-sm h-7 sm:h-8 px-2.5 sm:px-3"
                            onClick={() => setActiveTab(t.tipo)}
                          >
                            Treino {t.tipo}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {activeTreino && (
                      <TreinoExercicios
                        treinoId={activeTreino.id}
                        treinoTipo={activeTab}
                      />
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Nenhuma divisão de treino cadastrada
                  </p>
                )}
              </TabsContent>

              <TabsContent value="avulsos">
                <div className="space-y-3">
                  <AdicionarTreinoAvulsoDialog
                    grupoId={grupo.grupo_id}
                    alunoId={grupo.aluno_id}
                    tituloRotina={grupo.titulo}
                  />
                  {avulsos.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Nenhum treino avulso cadastrado
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {avulsos.map((t: any) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between rounded-lg border bg-card p-3 gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">{t.titulo || grupo.titulo}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                              {t.duracao_esperada_min && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {t.duracao_esperada_min} min
                                </span>
                              )}
                              {t.distancia_esperada_km && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {t.distancia_esperada_km} km
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setEditAvulso(t)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteAvulso(t.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        )}
      </Card>

      <EditarTreinoDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        grupo={grupo}
        alunos={alunos}
      />

      {editAvulso && (
        <EditarTreinoAvulsoDialog
          open={!!editAvulso}
          onOpenChange={(v) => { if (!v) setEditAvulso(null); }}
          avulso={editAvulso}
          descricaoRotina={grupo.descricao}
        />
      )}
    </>
  );
}
