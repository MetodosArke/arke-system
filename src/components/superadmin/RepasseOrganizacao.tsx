import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dividirCobranca, resolverRepasse, type RepasseConfig, type TaxaProcessamento } from "@/lib/repasse";
import { reais } from "@/lib/numeros";
import { useTaxaProcessamento } from "@/hooks/useTaxaProcessamento";
import { useAtacadoReferencia, type NivelAtacado } from "@/hooks/useAtacadoReferencia";

/** Os níveis pagos do Método. Free não tem cobrança, então não tem repasse. */
const ROTULO_NIVEL: Record<string, string> = { integrado: "Integrado", elite: "Elite" };

type LinhaNivel = { nivel_atacado: string; repasse_tipo: string | null; repasse_valor: number | null };
const SEM_LINHAS: LinhaNivel[] = [];

/**
 * Quanto a ArkeFit retém de cada aluno no Método, negociado academia a academia.
 *
 * Antes era um custo por nível igual para todo mundo (Integrado R$ 45, Elite
 * R$ 85), o que não permitia contrato a contrato — e o modelo comercial novo
 * negocia cada academia pelo porte e pelo ticket médio dela.
 *
 * Só a ArkeFit configura: `trg_proteger_colunas_organizacao` recusa a
 * alteração vinda do gestor, que de outro modo se daria retenção zero pela
 * política de UPDATE da própria organização.
 *
 * **O valor é o líquido desejado.** A taxa do gateway é somada por cima, na
 * parte da academia, porque ela recebe valor fixo no split e o que o Asaas
 * desconta sai do que sobra.
 */
export function RepasseOrganizacao({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<RepasseConfig["tipo"]>("fixo");
  const [valor, setValor] = useState("");
  // Varejo de referência só para a prévia — não é gravado em lugar nenhum.
  const [simulado, setSimulado] = useState("119");

  const { data: config } = useQuery({
    queryKey: ["repasse-config", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("repasse_tipo, repasse_valor")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: taxa } = useTaxaProcessamento();
  const { data: referencia } = useAtacadoReferencia();
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    if (!config) return;
    setTipo((config.repasse_tipo as RepasseConfig["tipo"]) ?? "fixo");
    setValor(config.repasse_valor === null || config.repasse_valor === undefined ? "" : String(config.repasse_valor));
  }, [config]);

  const numero = Number(valor.replace(",", "."));
  const valido = valor.trim() !== "" && Number.isFinite(numero) && numero >= 0 && (tipo !== "percentual" || numero <= 100);

  const previa = dividirCobranca(
    Number(simulado.replace(",", ".")) || 0,
    { tipo, valor: valido ? numero : null },
    taxa ?? { percentual: 0, fixa: 0 }
  );

  const salvar = useMutation({
    mutationFn: async () => {
      await exigirGravacao(supabase
        .from("organizations")
        .update({ repasse_tipo: tipo, repasse_valor: numero })
        .eq("id", organizationId).select("id"));
    },
    onSuccess: () => {
      toast({
        title: "Repasse atualizado",
        description: "Vale para assinaturas novas. As existentes seguem com o repasse travado na criação.",
      });
      void queryClient.invalidateQueries({ queryKey: ["repasse-config", organizationId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const naoNegociado = config?.repasse_valor === null || config?.repasse_valor === undefined;

  // A tabela vira o negociado desta academia num clique (padrão no Integrado,
  // exceção no nível com valor diferente), pelo banco e auditada. Sobre um
  // repasse já negociado, pede um segundo clique: ele é substituído.
  const aplicarReferencia = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("aplicar_repasse_referencia", { _organization_id: organizationId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setConfirmando(false);
      toast({ title: "Tabela de referência aplicada", description: "Vale para assinaturas novas desta academia." });
      void queryClient.invalidateQueries({ queryKey: ["repasse-config", organizationId] });
      void queryClient.invalidateQueries({ queryKey: ["repasse-niveis", organizationId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível aplicar", description: e.message, variant: "destructive" }),
  });

  const resumoReferencia = referencia?.map((n) => `${ROTULO_NIVEL[n.id] ?? n.id} ${reais(n.referencia)}`).join(" · ");

  return (
    <div className="space-y-3">
      {naoNegociado && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-warning">
          Sem repasse negociado: a cobrança do Método nesta academia é recusada até configurar aqui.
        </p>
      )}

      {referencia && referencia.length > 0 && (
        <div className="space-y-1 rounded-md border p-2">
          <p className="text-xs text-muted-foreground">
            Tabela de referência: {resumoReferencia} por aluno, mais a taxa. Definida em Configurações.
          </p>
          {confirmando && !naoNegociado && (
            <p className="text-xs text-warning">
              Substitui o repasse e as exceções desta academia. Confirme para aplicar.
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={aplicarReferencia.isPending}
            onClick={() => (naoNegociado || confirmando ? aplicarReferencia.mutate() : setConfirmando(true))}
          >
            {aplicarReferencia.isPending ? "Aplicando..." : confirmando ? "Confirmar" : "Aplicar a tabela de referência"}
          </Button>
        </div>
      )}

      <div className="flex gap-2">
        <div className="w-36 space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as RepasseConfig["tipo"])}>
            <SelectTrigger aria-label="Tipo de repasse">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixo">Valor fixo</SelectItem>
              <SelectItem value="percentual">Percentual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor="repasse-valor" className="text-xs">
            {tipo === "percentual" ? "Percentual retido (%)" : "Valor retido por aluno (R$)"}
          </Label>
          <Input
            id="repasse-valor"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={tipo === "percentual" ? "30" : "49,00"}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="repasse-simulado" className="text-xs">
          Prévia com um varejo de (R$)
        </Label>
        <Input
          id="repasse-simulado"
          inputMode="decimal"
          value={simulado}
          onChange={(e) => setSimulado(e.target.value)}
          className="w-32"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {previa.semRepasseNegociado
          ? "Informe o valor para ver a divisão."
          : !previa.cobreORepasse
            ? `Este varejo não cobre o repasse de ${reais(previa.repasseArke!)} — a cobrança seria recusada.`
            : `ArkeFit fica com ${reais(previa.repasseArke!)} (negociado ${reais((
                previa.repasseArke! - previa.taxaEstimada
              ))} + taxa ${reais(previa.taxaEstimada)}) · academia recebe ${reais(previa.liquidoAcademia!)}`}
      </p>

      <Button size="sm" disabled={!valido || salvar.isPending} onClick={() => salvar.mutate()}>
        Salvar repasse
      </Button>

      <ExcecoesPorNivel
        organizationId={organizationId}
        niveis={referencia}
        padrao={{ tipo, valor: valido ? numero : null }}
        taxa={taxa ?? { percentual: 0, fixa: 0 }}
      />
    </div>
  );
}

/**
 * Exceção por nível, dentro da academia.
 *
 * Integrado e Elite custam coisas diferentes de servir — Elite entrega
 * acolhimento expandido, encontros periódicos e fila prioritária, que no
 * Mentor Centralizado é tempo de gente. Deixar os dois no mesmo repasse seria
 * um retrocesso: antes da negociação por academia eles já diferiam.
 *
 * Em branco = vale o negociado acima, para não obrigar a configurar duas vezes
 * quem fechou um valor só.
 */
function ExcecoesPorNivel({
  organizationId,
  niveis,
  padrao,
  taxa,
}: {
  organizationId: string;
  niveis: NivelAtacado[] | undefined;
  padrao: RepasseConfig;
  taxa: TaxaProcessamento;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rascunho, setRascunho] = useState<Record<string, { tipo: RepasseConfig["tipo"]; valor: string }>>({});

  // Sem valor padrão literal: um [] novo a cada renderização refaria o efeito
  // abaixo em laço enquanto a consulta carrega.
  const { data: linhas = SEM_LINHAS } = useQuery({
    queryKey: ["repasse-niveis", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_planos_precificacao")
        .select("nivel_atacado, repasse_tipo, repasse_valor")
        .eq("organization_id", organizationId);
      if (error) throw error;
      return data as LinhaNivel[];
    },
  });

  useEffect(() => {
    if (!niveis) return;
    const inicial: Record<string, { tipo: RepasseConfig["tipo"]; valor: string }> = {};
    for (const n of niveis) {
      const l = linhas.find((x) => x.nivel_atacado === n.id);
      inicial[n.id] = {
        tipo: (l?.repasse_tipo as RepasseConfig["tipo"]) ?? "fixo",
        valor: l?.repasse_valor === null || l?.repasse_valor === undefined ? "" : String(l.repasse_valor),
      };
    }
    setRascunho(inicial);
  }, [linhas, niveis]);

  const salvar = useMutation({
    mutationFn: async (nivel: string) => {
      const r = rascunho[nivel];
      const vazio = !r || r.valor.trim() === "";
      const n = Number((r?.valor ?? "").replace(",", "."));
      if (!vazio && (!Number.isFinite(n) || n < 0 || (r.tipo === "percentual" && n > 100))) {
        throw new Error("Valor inválido para este tipo de repasse.");
      }
      await exigirGravacao(supabase
        .from("organization_planos_precificacao")
        .update({ repasse_tipo: vazio ? null : r.tipo, repasse_valor: vazio ? null : n })
        .eq("organization_id", organizationId)
        .eq("nivel_atacado", nivel as never).select("id"));
    },
    onSuccess: () => {
      toast({ title: "Exceção atualizada", description: "Vale para assinaturas novas desse nível." });
      void queryClient.invalidateQueries({ queryKey: ["repasse-niveis", organizationId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-xs font-medium">Exceção por nível</p>
      <p className="text-xs text-muted-foreground -mt-1">Em branco, vale o repasse acima.</p>
      {niveis?.map((n) => {
        const r = rascunho[n.id] ?? { tipo: "fixo" as const, valor: "" };
        const num = Number(r.valor.replace(",", "."));
        const temValor = r.valor.trim() !== "" && Number.isFinite(num);
        const efetivo = resolverRepasse(padrao, temValor ? { tipo: r.tipo, valor: num } : null);
        const previa = dividirCobranca(n.varejoSugerido, efetivo, taxa);
        const rotulo = ROTULO_NIVEL[n.id] ?? n.id;
        return (
          <div key={n.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-20 text-xs">{rotulo}</span>
              <Select
                value={r.tipo}
                onValueChange={(v) => setRascunho((s) => ({ ...s, [n.id]: { ...r, tipo: v as RepasseConfig["tipo"] } }))}
              >
                <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Tipo de repasse do ${rotulo}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixo">Fixo</SelectItem>
                  <SelectItem value="percentual">%</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-8 w-24 text-xs"
                inputMode="decimal"
                aria-label={`Valor do repasse do ${rotulo}`}
                placeholder="padrão"
                value={r.valor}
                onChange={(e) => setRascunho((s) => ({ ...s, [n.id]: { ...r, valor: e.target.value } }))}
              />
              <Button size="sm" variant="outline" disabled={salvar.isPending} onClick={() => salvar.mutate(n.id)}>
                Salvar
              </Button>
            </div>
            <p className="pl-[5.5rem] text-[11px] text-muted-foreground">
              {previa.semRepasseNegociado
                ? "Sem repasse: a cobrança deste nível seria recusada."
                : `A ${reais(n.varejoSugerido)}: ArkeFit ${reais(previa.repasseArke!)} · academia ${reais(previa.liquidoAcademia!)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
