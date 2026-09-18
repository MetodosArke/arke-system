import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/integrations/supabase/types";

type Avaliacao = Tables<"avaliacoes_fisicas">;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alunoId: string | null;
  alunoNome?: string;
}

type Campo =
  | "peso_kg"
  | "altura_cm"
  | "percentual_gordura"
  | "dc_triceps"
  | "dc_subescapular"
  | "dc_suprailiaca"
  | "dc_abdominal"
  | "dc_coxa"
  | "dc_peitoral"
  | "dc_axilar_media"
  | "perim_braco"
  | "perim_antebraco"
  | "perim_cintura"
  | "perim_abdomen"
  | "perim_quadril"
  | "perim_coxa"
  | "perim_panturrilha";

const CAMPOS_ANTROPOMETRIA: { campo: Campo; label: string }[] = [
  { campo: "peso_kg", label: "Peso (kg)" },
  { campo: "altura_cm", label: "Altura (cm)" },
  { campo: "percentual_gordura", label: "% de gordura" },
];

const CAMPOS_DOBRAS: { campo: Campo; label: string }[] = [
  { campo: "dc_triceps", label: "Tríceps" },
  { campo: "dc_subescapular", label: "Subescapular" },
  { campo: "dc_suprailiaca", label: "Suprailíaca" },
  { campo: "dc_abdominal", label: "Abdominal" },
  { campo: "dc_coxa", label: "Coxa" },
  { campo: "dc_peitoral", label: "Peitoral" },
  { campo: "dc_axilar_media", label: "Axilar média" },
];

const CAMPOS_PERIMETRIA: { campo: Campo; label: string }[] = [
  { campo: "perim_braco", label: "Braço" },
  { campo: "perim_antebraco", label: "Antebraço" },
  { campo: "perim_cintura", label: "Cintura" },
  { campo: "perim_abdomen", label: "Abdômen" },
  { campo: "perim_quadril", label: "Quadril" },
  { campo: "perim_coxa", label: "Coxa" },
  { campo: "perim_panturrilha", label: "Panturrilha" },
];

const FORM_INICIAL: Record<Campo, string> = {
  peso_kg: "",
  altura_cm: "",
  percentual_gordura: "",
  dc_triceps: "",
  dc_subescapular: "",
  dc_suprailiaca: "",
  dc_abdominal: "",
  dc_coxa: "",
  dc_peitoral: "",
  dc_axilar_media: "",
  perim_braco: "",
  perim_antebraco: "",
  perim_cintura: "",
  perim_abdomen: "",
  perim_quadril: "",
  perim_coxa: "",
  perim_panturrilha: "",
};

function CampoNumerico({
  campo,
  label,
  valor,
  onChange,
}: {
  campo: Campo;
  label: string;
  valor: string;
  onChange: (campo: Campo, valor: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`avf-${campo}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`avf-${campo}`}
        type="number"
        inputMode="decimal"
        step="0.1"
        min={0}
        value={valor}
        onChange={(e) => onChange(campo, e.target.value)}
      />
    </div>
  );
}

export function AvaliacaoFisicaDialog({ open, onOpenChange, alunoId, alunoNome }: Props) {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<Campo, string>>(FORM_INICIAL);
  const [doresRelatadas, setDoresRelatadas] = useState("");
  const [historicoClinico, setHistoricoClinico] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ["avaliacoes-fisicas", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avaliacoes_fisicas")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("data_avaliacao", { ascending: false });
      if (error) throw error;
      return data as Avaliacao[];
    },
    enabled: open && !!alunoId,
  });

  const atualizarCampo = (campo: Campo, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  const limpar = () => {
    setForm(FORM_INICIAL);
    setDoresRelatadas("");
    setHistoricoClinico("");
    setObservacoes("");
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization) throw new Error("Aluno ou organização inválidos.");
      const numerico = (v: string) => (v.trim() ? Number(v) : null);
      const valores = Object.values(form).map(numerico);
      if (valores.some((v) => v != null && v < 0)) {
        throw new Error("Nenhum valor pode ser negativo.");
      }
      if (form.percentual_gordura.trim() && Number(form.percentual_gordura) > 100) {
        throw new Error("% de gordura não pode passar de 100.");
      }
      const { error } = await supabase.from("avaliacoes_fisicas").insert({
        organization_id: organization.id,
        aluno_id: alunoId,
        avaliado_por: user?.id,
        peso_kg: numerico(form.peso_kg),
        altura_cm: numerico(form.altura_cm),
        percentual_gordura: numerico(form.percentual_gordura),
        dc_triceps: numerico(form.dc_triceps),
        dc_subescapular: numerico(form.dc_subescapular),
        dc_suprailiaca: numerico(form.dc_suprailiaca),
        dc_abdominal: numerico(form.dc_abdominal),
        dc_coxa: numerico(form.dc_coxa),
        dc_peitoral: numerico(form.dc_peitoral),
        dc_axilar_media: numerico(form.dc_axilar_media),
        perim_braco: numerico(form.perim_braco),
        perim_antebraco: numerico(form.perim_antebraco),
        perim_cintura: numerico(form.perim_cintura),
        perim_abdomen: numerico(form.perim_abdomen),
        perim_quadril: numerico(form.perim_quadril),
        perim_coxa: numerico(form.perim_coxa),
        perim_panturrilha: numerico(form.perim_panturrilha),
        dores_relatadas: doresRelatadas.trim() || null,
        historico_clinico: historicoClinico.trim() || null,
        observacoes: observacoes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Avaliação física registrada!" });
      void queryClient.invalidateQueries({ queryKey: ["avaliacoes-fisicas", alunoId] });
      limpar();
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao registrar avaliação", description: error.message, variant: "destructive" }),
  });

  const fechar = (novoEstado: boolean) => {
    if (!novoEstado) limpar();
    onOpenChange(novoEstado);
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Avaliação Física — {alunoNome ?? "Aluno"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="nova">
          <TabsList>
            <TabsTrigger value="nova">Nova avaliação</TabsTrigger>
            <TabsTrigger value="historico">Histórico ({historico.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="nova" className="space-y-4 pt-2">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Antropometria</p>
              <div className="grid grid-cols-3 gap-2">
                {CAMPOS_ANTROPOMETRIA.map((c) => (
                  <CampoNumerico key={c.campo} {...c} valor={form[c.campo]} onChange={atualizarCampo} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Dobras cutâneas (mm)</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {CAMPOS_DOBRAS.map((c) => (
                  <CampoNumerico key={c.campo} {...c} valor={form[c.campo]} onChange={atualizarCampo} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Perimetria (cm)</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {CAMPOS_PERIMETRIA.map((c) => (
                  <CampoNumerico key={c.campo} {...c} valor={form[c.campo]} onChange={atualizarCampo} />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="avf-dores" className="text-xs">
                Dores relatadas
              </Label>
              <Textarea id="avf-dores" value={doresRelatadas} onChange={(e) => setDoresRelatadas(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avf-historico" className="text-xs">
                Histórico clínico
              </Label>
              <Textarea
                id="avf-historico"
                value={historicoClinico}
                onChange={(e) => setHistoricoClinico(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avf-obs" className="text-xs">
                Observações
              </Label>
              <Textarea id="avf-obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
            </div>
            <Button disabled={salvar.isPending} onClick={() => salvar.mutate()} className="w-full">
              {salvar.isPending ? "Salvando..." : "Registrar avaliação"}
            </Button>
          </TabsContent>

          <TabsContent value="historico" className="space-y-3 pt-2">
            {isLoading && <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>}
            {!isLoading && historico.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma avaliação registrada ainda.</p>
            )}
            {historico.map((av) => (
              <div key={av.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {new Date(av.data_avaliacao).toLocaleDateString("pt-BR")}
                  </span>
                  {av.imc != null && <span className="text-xs text-muted-foreground">IMC {av.imc}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  {av.peso_kg != null && <span>Peso: {av.peso_kg}kg</span>}
                  {av.altura_cm != null && <span>Altura: {av.altura_cm}cm</span>}
                  {av.percentual_gordura != null && <span>Gordura: {av.percentual_gordura}%</span>}
                </div>
                {av.dores_relatadas && <p className="text-xs">Dores: {av.dores_relatadas}</p>}
                {av.observacoes && <p className="text-xs text-muted-foreground">{av.observacoes}</p>}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
