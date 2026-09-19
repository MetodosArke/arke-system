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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Trophy, Plus } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { calcularPontosTotais, calcularStatusMetas, type MetaDirecao, type StatusMeta } from "@/lib/evolucaoPontos";

type Avaliacao = Tables<"avaliacoes_fisicas">;
type MetricaCustomizada = Tables<"metricas_customizadas">;

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
  | "musculo_percentual"
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
  { campo: "musculo_percentual", label: "% de músculo" },
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
  musculo_percentual: "",
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

const STATUS_LABEL: Record<StatusMeta, string> = {
  superada: "Superada! 🎉",
  atingida: "Atingida ✓",
  pendente: "Em andamento",
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

function MetaField({
  label,
  direcao,
  valor,
  onDirecaoChange,
  onValorChange,
  anteriorTexto,
}: {
  label: string;
  direcao: MetaDirecao | "";
  valor: string;
  onDirecaoChange: (v: MetaDirecao) => void;
  onValorChange: (v: string) => void;
  anteriorTexto?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1.5">
        <Select value={direcao} onValueChange={(v) => onDirecaoChange(v as MetaDirecao)}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manter">Manter</SelectItem>
            <SelectItem value="aumentar">Aumentar</SelectItem>
            <SelectItem value="diminuir">Diminuir</SelectItem>
          </SelectContent>
        </Select>
        <Input type="number" step="0.1" placeholder="Alvo" value={valor} onChange={(e) => onValorChange(e.target.value)} className="h-9" />
      </div>
      {anteriorTexto && <p className="text-[10px] text-muted-foreground">Meta anterior: {anteriorTexto}</p>}
    </div>
  );
}

export function AvaliacaoFisicaDialog({ open, onOpenChange, alunoId, alunoNome }: Props) {
  const { organization, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<Campo, string>>(FORM_INICIAL);
  const [proximaAvaliacao, setProximaAvaliacao] = useState("");
  const [metaPesoDirecao, setMetaPesoDirecao] = useState<MetaDirecao | "">("");
  const [metaPesoValor, setMetaPesoValor] = useState("");
  const [metaGorduraDirecao, setMetaGorduraDirecao] = useState<MetaDirecao | "">("");
  const [metaGorduraValor, setMetaGorduraValor] = useState("");
  const [metaMusculoDirecao, setMetaMusculoDirecao] = useState<MetaDirecao | "">("");
  const [metaMusculoValor, setMetaMusculoValor] = useState("");
  const [doresRelatadas, setDoresRelatadas] = useState("");
  const [historicoClinico, setHistoricoClinico] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [novaMetricaNome, setNovaMetricaNome] = useState("");
  const [valoresMetricas, setValoresMetricas] = useState<Record<string, string>>({});

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

  const { data: metricas = [] } = useQuery({
    queryKey: ["metricas-customizadas", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("metricas_customizadas")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("created_at");
      if (error) throw error;
      return data as MetricaCustomizada[];
    },
    enabled: open && !!alunoId,
  });

  const ultimaAvaliacao = historico[0] ?? null;

  const atualizarCampo = (campo: Campo, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  const limpar = () => {
    setForm(FORM_INICIAL);
    setProximaAvaliacao("");
    setMetaPesoDirecao("");
    setMetaPesoValor("");
    setMetaGorduraDirecao("");
    setMetaGorduraValor("");
    setMetaMusculoDirecao("");
    setMetaMusculoValor("");
    setDoresRelatadas("");
    setHistoricoClinico("");
    setObservacoes("");
    setValoresMetricas({});
  };

  const criarMetrica = useMutation({
    mutationFn: async () => {
      if (!alunoId || !organization || !novaMetricaNome.trim()) return;
      const { error } = await supabase
        .from("metricas_customizadas")
        .insert({ organization_id: organization.id, aluno_id: alunoId, nome: novaMetricaNome.trim(), criado_por: user?.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovaMetricaNome("");
      void queryClient.invalidateQueries({ queryKey: ["metricas-customizadas", alunoId] });
    },
    onError: (error: Error) => toast({ title: "Erro ao criar métrica", description: error.message, variant: "destructive" }),
  });

  const excluirMetrica = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("metricas_customizadas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["metricas-customizadas", alunoId] }),
  });

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

      const atual = {
        peso_kg: numerico(form.peso_kg),
        percentual_gordura: numerico(form.percentual_gordura),
        musculo_percentual: numerico(form.musculo_percentual),
        meta_peso_kg: null,
        meta_peso_direcao: null,
        meta_gordura_valor: null,
        meta_gordura_direcao: null,
        meta_musculo_valor: null,
        meta_musculo_direcao: null,
      };
      const pontos = calcularPontosTotais(ultimaAvaliacao, atual);

      const { data: inserida, error } = await supabase
        .from("avaliacoes_fisicas")
        .insert({
          organization_id: organization.id,
          aluno_id: alunoId,
          avaliado_por: user?.id,
          peso_kg: numerico(form.peso_kg),
          altura_cm: numerico(form.altura_cm),
          percentual_gordura: numerico(form.percentual_gordura),
          musculo_percentual: numerico(form.musculo_percentual),
          data_proxima_avaliacao: proximaAvaliacao || null,
          meta_peso_kg: metaPesoValor.trim() ? Number(metaPesoValor) : null,
          meta_peso_direcao: metaPesoDirecao || null,
          meta_gordura_valor: metaGorduraValor.trim() ? Number(metaGorduraValor) : null,
          meta_gordura_direcao: metaGorduraDirecao || null,
          meta_musculo_valor: metaMusculoValor.trim() ? Number(metaMusculoValor) : null,
          meta_musculo_direcao: metaMusculoDirecao || null,
          pontos,
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
        })
        .select("id")
        .single();
      if (error) throw error;

      const linhasMetricas = Object.entries(valoresMetricas)
        .filter(([, v]) => v.trim())
        .map(([metricaId, v]) => ({
          organization_id: organization.id,
          metrica_id: metricaId,
          avaliacao_id: inserida.id,
          valor: Number(v),
        }));
      if (linhasMetricas.length > 0) {
        const { error: metricaError } = await supabase.from("metrica_valores").insert(linhasMetricas);
        if (metricaError) throw metricaError;
      }
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

  const metaAnteriorTexto = (direcao: string | null, valor: number | null) =>
    direcao && valor != null ? `${direcao} até ${valor}` : undefined;

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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CAMPOS_ANTROPOMETRIA.map((c) => (
                  <CampoNumerico key={c.campo} {...c} valor={form[c.campo]} onChange={atualizarCampo} />
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="avf-proxima" className="text-xs">
                Próxima avaliação
              </Label>
              <Input id="avf-proxima" type="date" value={proximaAvaliacao} onChange={(e) => setProximaAvaliacao(e.target.value)} className="max-w-[200px]" />
            </div>

            <Separator />

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">Novas metas (pra próxima avaliação)</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <MetaField
                  label="Peso (kg)"
                  direcao={metaPesoDirecao}
                  valor={metaPesoValor}
                  onDirecaoChange={setMetaPesoDirecao}
                  onValorChange={setMetaPesoValor}
                  anteriorTexto={metaAnteriorTexto(ultimaAvaliacao?.meta_peso_direcao ?? null, ultimaAvaliacao?.meta_peso_kg ?? null)}
                />
                <MetaField
                  label="% Gordura"
                  direcao={metaGorduraDirecao}
                  valor={metaGorduraValor}
                  onDirecaoChange={setMetaGorduraDirecao}
                  onValorChange={setMetaGorduraValor}
                  anteriorTexto={metaAnteriorTexto(ultimaAvaliacao?.meta_gordura_direcao ?? null, ultimaAvaliacao?.meta_gordura_valor ?? null)}
                />
                <MetaField
                  label="% Músculo"
                  direcao={metaMusculoDirecao}
                  valor={metaMusculoValor}
                  onDirecaoChange={setMetaMusculoDirecao}
                  onValorChange={setMetaMusculoValor}
                  anteriorTexto={metaAnteriorTexto(ultimaAvaliacao?.meta_musculo_direcao ?? null, ultimaAvaliacao?.meta_musculo_valor ?? null)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">Meta atingida = +20 pontos · Meta superada = +30 pontos</p>
            </div>

            <Separator />

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

            <Separator />

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Métricas Personalizadas</p>
              {metricas.length > 0 && (
                <div className="space-y-2">
                  {metricas.map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Badge variant="secondary" className="gap-1 pr-1 shrink-0">
                        {m.nome}
                        <button onClick={() => excluirMetrica.mutate(m.id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        step="0.5"
                        placeholder="0-10"
                        className="h-8 w-24"
                        value={valoresMetricas[m.id] ?? ""}
                        onChange={(e) => setValoresMetricas((v) => ({ ...v, [m.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Nova métrica (ex.: disposição, postura...)"
                  className="h-8"
                  value={novaMetricaNome}
                  onChange={(e) => setNovaMetricaNome(e.target.value)}
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={!novaMetricaNome.trim() || criarMetrica.isPending} onClick={() => criarMetrica.mutate()}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Criar
                </Button>
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
            {historico.map((av, idx) => {
              const anterior = historico[idx + 1] ?? null;
              const statusMetas = calcularStatusMetas(anterior, av);
              return (
                <div key={av.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{new Date(av.data_avaliacao).toLocaleDateString("pt-BR")}</span>
                    <div className="flex items-center gap-2">
                      {av.pontos > 0 && (
                        <Badge variant="secondary" className="gap-1">
                          <Trophy className="h-3 w-3" /> {av.pontos} pts
                        </Badge>
                      )}
                      {av.imc != null && <span className="text-xs text-muted-foreground">IMC {av.imc}</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                    {av.peso_kg != null && <span>Peso: {av.peso_kg}kg</span>}
                    {av.percentual_gordura != null && <span>Gordura: {av.percentual_gordura}%</span>}
                    {av.musculo_percentual != null && <span>Músculo: {av.musculo_percentual}%</span>}
                    {av.altura_cm != null && <span>Altura: {av.altura_cm}cm</span>}
                  </div>
                  {(statusMetas.peso || statusMetas.gordura || statusMetas.musculo) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {statusMetas.peso && <Badge variant="outline" className="text-[10px]">Peso: {STATUS_LABEL[statusMetas.peso]}</Badge>}
                      {statusMetas.gordura && <Badge variant="outline" className="text-[10px]">Gordura: {STATUS_LABEL[statusMetas.gordura]}</Badge>}
                      {statusMetas.musculo && <Badge variant="outline" className="text-[10px]">Músculo: {STATUS_LABEL[statusMetas.musculo]}</Badge>}
                    </div>
                  )}
                  {av.data_proxima_avaliacao && (
                    <p className="text-xs text-primary">Próxima avaliação: {new Date(av.data_proxima_avaliacao).toLocaleDateString("pt-BR")}</p>
                  )}
                  {av.dores_relatadas && <p className="text-xs">Dores: {av.dores_relatadas}</p>}
                  {av.observacoes && <p className="text-xs text-muted-foreground">{av.observacoes}</p>}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
