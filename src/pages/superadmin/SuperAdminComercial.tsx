import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Kanban, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { todasAsLinhas } from "@/lib/paginar";
import { cn } from "@/lib/utils";
import { ETAPAS_ABERTAS, ORIGENS, combinaBusca, numerosDoPipeline, type DadosLead } from "@/lib/crmComercial";
import { RespostaAutomatica } from "@/components/superadmin/RespostaAutomatica";
import { QuadroPipeline } from "@/components/superadmin/comercial/QuadroPipeline";
import { FormularioLead, type ModoFormulario } from "@/components/superadmin/comercial/FormularioLead";
import { DialogoPerda } from "@/components/superadmin/comercial/DialogoPerda";
import { useConfigLeticia } from "@/components/superadmin/comercial/useConfigLeticia";
import { COLUNAS_LEAD, type LeadComercial } from "@/components/superadmin/comercial/tipos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CHAVE = ["leads-comerciais"];
// Ganhos e perdidos antigos saem do quadro, que é para trabalhar o que está em
// andamento; os números de conversão olham os mesmos 90 dias.
const DIAS_FECHADOS = 90;

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string | number; detalhe?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
      {detalhe && <p className="text-[11px] text-muted-foreground">{detalhe}</p>}
    </div>
  );
}

/**
 * Visão Master → Pipeline comercial: o CRM da ArkeFit. O mesmo quadro recebe
 * os pedidos de demonstração do site (sozinhos) e os contatos que a equipe
 * anota (WhatsApp, telefone, indicação, prospecção). Cada contato anda pelas
 * etapas arrastando o cartão ou pelo menu "Mover". A Letícia responde sozinha
 * o site e, nos outros canais, quando alguém a aciona no cartão.
 */
export default function SuperAdminComercial() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: cfgLeticia } = useConfigLeticia();
  const cfg = { ativo: cfgLeticia?.ativo ?? false, outrasOrigens: cfgLeticia?.outrasOrigens ?? false };

  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState("todas");
  const [formulario, setFormulario] = useState<ModoFormulario>(null);
  const [perdendo, setPerdendo] = useState<LeadComercial | null>(null);

  const { data: leads = [], isLoading, error } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const desde = new Date(Date.now() - DIAS_FECHADOS * 86_400_000).toISOString();
      return todasAsLinhas<LeadComercial>((de, ate) =>
        supabase
          .from("leads_comerciais")
          .select(COLUNAS_LEAD)
          .or(`status.in.(${ETAPAS_ABERTAS.join(",")}),status_desde.gte.${desde}`)
          .order("created_at", { ascending: false })
          .order("id")
          .range(de, ate) as unknown as PromiseLike<{ data: LeadComercial[] | null; error: { message: string } | null }>,
      );
    },
  });

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: CHAVE });
  const falhou = (titulo: string) => (e: Error) => toast({ title: titulo, description: e.message, variant: "destructive" });

  const salvar = useMutation({
    mutationFn: async ({ dados, etapa }: { dados: DadosLead; etapa: string }) => {
      if (formulario?.modo === "editar") {
        const lead = formulario.lead;
        // No contato do site, o canal e o que a academia escreveu não se mexem.
        const { origem: _o, mensagem: _m, ...resto } = dados;
        const mudanca = lead.origem === "site" ? resto : dados;
        const { error } = await supabase.from("leads_comerciais").update(mudanca).eq("id", lead.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("leads_comerciais").insert({ ...dados, status: etapa });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: formulario?.modo === "editar" ? "Contato salvo" : "Lead adicionado" });
      setFormulario(null);
      recarregar();
    },
    onError: falhou("Não foi possível salvar"),
  });

  // Mover é otimista: o cartão fica onde foi solto, e volta se o banco recusar.
  const mover = useMutation({
    mutationFn: async ({ lead, etapa, motivo }: { lead: LeadComercial; etapa: string; motivo?: string }) => {
      const { error } = await supabase
        .from("leads_comerciais")
        .update({ status: etapa, motivo_perda: etapa === "perdido" ? motivo ?? null : null })
        .eq("id", lead.id);
      if (error) throw error;
    },
    onMutate: async ({ lead, etapa, motivo }) => {
      await queryClient.cancelQueries({ queryKey: CHAVE });
      const antes = queryClient.getQueryData<LeadComercial[]>(CHAVE);
      queryClient.setQueryData<LeadComercial[]>(CHAVE, (atual) =>
        (atual ?? []).map((l) =>
          l.id === lead.id
            ? { ...l, status: etapa, status_desde: new Date().toISOString(), motivo_perda: etapa === "perdido" ? motivo ?? null : null }
            : l,
        ),
      );
      return { antes };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.antes) queryClient.setQueryData(CHAVE, ctx.antes);
      falhou("Não foi possível mover")(e);
    },
    onSuccess: (_d, { etapa }) => {
      if (etapa === "ganho") toast({ title: "Ganho!", description: "Crie a organização em Visão Geral → Nova organização." });
      setPerdendo(null);
    },
    onSettled: recarregar,
  });

  const excluir = useMutation({
    mutationFn: async (lead: LeadComercial) => {
      const { error } = await supabase.from("leads_comerciais").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Contato excluído" });
      setFormulario(null);
      recarregar();
    },
    onError: falhou("Não foi possível excluir"),
  });

  const acionar = useMutation({
    mutationFn: async (lead: LeadComercial) => {
      const { error } = await supabase.rpc("acionar_agente_comercial", { _lead_id: lead.id });
      // A recusa do banco já diz o que falta (sem e-mail, Letícia desligada…).
      if (error) throw new Error(error.message);
    },
    onSuccess: (_d, lead) => {
      toast({ title: "Letícia acionada", description: `O primeiro e-mail para ${lead.academia} sai no próximo horário útil.` });
      recarregar();
    },
    onError: falhou("Não foi possível acionar a Letícia"),
  });

  const onMover = (lead: LeadComercial, etapa: string) => {
    if (etapa === "perdido") setPerdendo(lead);
    else mover.mutate({ lead, etapa });
  };

  const visiveis = useMemo(
    () => leads.filter((l) => (origem === "todas" || l.origem === origem) && combinaBusca(l, busca)),
    [leads, origem, busca],
  );
  const n = numerosDoPipeline(leads);
  const filtrando = origem !== "todas" || busca.trim() !== "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Kanban className="h-5 w-5 text-primary" aria-hidden /> Pipeline comercial
          </h1>
          <p className="text-sm text-muted-foreground">Academias do primeiro contato ao fechamento, de todos os canais.</p>
        </div>
        <Button onClick={() => setFormulario({ modo: "novo" })}>
          <Plus className="mr-1.5 h-4 w-4" /> Adicionar lead
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero rotulo="Em aberto" valor={n.abertos} />
        <Numero rotulo="Novos" valor={n.novos} detalhe="esperando o primeiro contato" />
        <Numero rotulo="Demos agendadas" valor={n.demos} />
        <Numero
          rotulo="Ganhos em 30 dias"
          valor={n.ganhos30}
          detalhe={n.conversao90 === null ? "nenhum fechamento em 90 dias" : `${n.conversao90}% de conversão em 90 dias`}
        />
      </div>

      <RespostaAutomatica />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar academia, nome, cidade…"
            aria-label="Buscar no pipeline"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por canal">
          {[{ id: "todas", rotulo: "Todos", cor: "" }, ...ORIGENS].map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={origem === o.id}
              onClick={() => setOrigem(o.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
                origem === o.id ? "border-primary bg-primary/15 text-foreground" : "text-muted-foreground hover:border-primary/40",
              )}
            >
              {o.cor && <span className={cn("h-2 w-2 rounded-full", o.cor)} aria-hidden />}
              {o.rotulo}
            </button>
          ))}
        </div>
        {filtrando && (
          <span className="text-xs text-muted-foreground">
            {visiveis.length} de {leads.length}
          </span>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Não foi possível carregar o pipeline.</p>}
      {!isLoading && !error && (
        <QuadroPipeline
          leads={visiveis}
          cfg={cfg}
          acoes={{
            onEditar: (lead) => setFormulario({ modo: "editar", lead }),
            onMover,
            onAcionar: (lead) => acionar.mutate(lead),
            acionando: acionar.isPending ? (acionar.variables?.id ?? null) : null,
          }}
          vazioNovos={
            filtrando
              ? "Nada com este filtro."
              : "Os pedidos de demonstração do site aparecem aqui sozinhos. Quem chamou no WhatsApp ou ligou, use Adicionar lead."
          }
        />
      )}
      <p className="text-[11px] text-muted-foreground">Ganhos e perdidos aparecem por {DIAS_FECHADOS} dias depois do fechamento.</p>

      <FormularioLead
        estado={formulario}
        existentes={leads}
        salvando={salvar.isPending}
        excluindo={excluir.isPending}
        onFechar={() => setFormulario(null)}
        onSalvar={(dados, etapa) => salvar.mutate({ dados, etapa })}
        onExcluir={(lead) => excluir.mutate(lead)}
      />
      <DialogoPerda
        academia={perdendo?.academia ?? null}
        aberto={!!perdendo}
        salvando={mover.isPending}
        onCancelar={() => setPerdendo(null)}
        onConfirmar={(motivo) => perdendo && mover.mutate({ lead: perdendo, etapa: "perdido", motivo })}
      />
    </div>
  );
}
