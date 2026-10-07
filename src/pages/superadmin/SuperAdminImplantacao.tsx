import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, PhoneCall, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { ROTULO_MENSAGEM, diasUteisParada, tituloEtapa, type Implantacao } from "@/lib/implantacao";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Linha = {
  organization_id: string;
  nome: string;
  tipo: string;
  status: string;
  iniciada_em: string;
  etapa_atual: string | null;
  etapa_atual_desde: string | null;
  concluida_em: string | null;
  etapas_feitas: number;
  etapas_total: number;
  asaas_conta_status: string | null;
  evasao_meses: number;
  ultima_mensagem: { tipo: string; etapa: string | null; enviado_em: string } | null;
  chamado: { id: string; etapa: string; motivo: string; aberto_em: string; prazo: string } | null;
};

const CHAVE = ["superadmin-implantacoes"];
const CHAVE_ATIVO = ["agente-implantacao-ativo"];

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="text-2xl font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

/**
 * Visão Master → Implantação: as academias do primeiro acesso à primeira
 * entrada. O Bruno, agente de implantação, manda o próximo passo de hora em
 * hora e, com 1 dia útil parado na mesma etapa, abre o chamado para a ArkeFit
 * ligar. O chamado só se encerra com o desfecho registrado.
 */
export default function SuperAdminImplantacao() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [aberta, setAberta] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState<Linha | null>(null);

  const { data: linhas = [], isLoading, error } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_implantacoes");
      if (error) throw error;
      return (data ?? []) as unknown as Linha[];
    },
  });

  const { data: ativo = false } = useQuery({
    queryKey: CHAVE_ATIVO,
    queryFn: async () => {
      const { data, error } = await supabase.from("plataforma_config").select("valor").eq("chave", "agente_implantacao_ativo").maybeSingle();
      if (error) throw error;
      return Number(data?.valor ?? 0) === 1;
    },
  });

  const ligar = useMutation({
    mutationFn: async (valor: boolean) => {
      const { error } = await supabase.rpc("definir_agente_implantacao", { _ativo: valor });
      if (error) throw error;
      return valor;
    },
    onSuccess: (valor) => {
      toast({ title: valor ? "Agente de implantação ligado" : "Agente de implantação desligado" });
      void queryClient.invalidateQueries({ queryKey: CHAVE_ATIVO });
    },
    onError: (e: Error) => toast({ title: "Não foi possível mudar", description: e.message, variant: "destructive" }),
  });

  const emAndamento = linhas.filter((l) => !l.concluida_em);
  const comChamado = linhas.filter((l) => l.chamado);
  const concluidas = linhas.filter((l) => l.concluida_em);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Implantação</h1>
      </div>

      <Card>
        <CardContent className="py-4 flex items-start gap-4">
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-medium">Bruno, o agente de implantação</p>
            <p className="text-xs text-muted-foreground">
              De hora em hora, manda à gestão de cada academia o próximo passo, com o link da tela e do artigo; confere a aprovação da
              conta no Asaas uma vez por dia; pede a evasão dos 6 meses anteriores; e manda o kit de lançamento depois da primeira
              entrada. E-mails só em dia útil, das 9h às 19h, no máximo dois por dia por academia. Com 1 dia útil parada na mesma
              etapa, abre um chamado aqui para a ArkeFit ligar.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Label htmlFor="agente-implantacao" className="text-xs">
              {ativo ? "Ligado" : "Desligado"}
            </Label>
            <Switch id="agente-implantacao" checked={ativo} disabled={ligar.isPending} onCheckedChange={(v) => ligar.mutate(v)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Numero rotulo="Em implantação" valor={emAndamento.length} />
        <Numero rotulo="Esperando ligação" valor={comChamado.length} />
        <Numero rotulo="Concluídas em 30 dias" valor={concluidas.length} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {error && <p className="text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>}
      {!isLoading && !linhas.length && (
        <p className="text-sm text-muted-foreground">Nenhuma academia em implantação agora.</p>
      )}

      <ul className="space-y-2">
        {linhas.map((l) => {
          const parada = diasUteisParada(l.etapa_atual_desde);
          const expandida = aberta === l.organization_id;
          return (
            <li key={l.organization_id}>
              <Card className={cn(l.chamado && "border-amber-500/50")}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{l.nome}</span>
                    {l.tipo === "profissional_autonomo" && <Badge variant="outline">Autônomo</Badge>}
                    {l.concluida_em ? (
                      <Badge variant="secondary">Concluída em {formatarDataBR(l.concluida_em)}</Badge>
                    ) : (
                      <Badge variant="outline">
                        {tituloEtapa(l.etapa_atual)}
                        {parada > 0 && ` · parada há ${parada} dia${parada > 1 ? "s" : ""} úti${parada > 1 ? "s" : "l"}`}
                      </Badge>
                    )}
                    {l.chamado && (
                      <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setRegistrando(l)}>
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" /> Registrar a ligação
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={l.etapas_total ? (l.etapas_feitas / l.etapas_total) * 100 : 0} className="h-1.5 flex-1" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {l.etapas_feitas} de {l.etapas_total}
                    </span>
                  </div>
                  {l.chamado && <p className="text-xs text-warning">{l.chamado.motivo}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Desde {formatarDataBR(l.iniciada_em)}</span>
                    <span>Evasão anterior: {l.evasao_meses} de 6 meses</span>
                    {l.asaas_conta_status && <span>Asaas: {l.asaas_conta_status}</span>}
                    {l.ultima_mensagem && (
                      <span>
                        Último e-mail: {ROTULO_MENSAGEM[l.ultima_mensagem.tipo] ?? l.ultima_mensagem.tipo} em{" "}
                        {formatarDataBR(l.ultima_mensagem.enviado_em)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-primary"
                    aria-expanded={expandida}
                    onClick={() => setAberta(expandida ? null : l.organization_id)}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expandida && "rotate-180")} /> Etapas e e-mails
                  </button>
                  {expandida && <Detalhe organizationId={l.organization_id} />}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {registrando?.chamado && (
        <RegistrarLigacao
          linha={registrando}
          aoFechar={() => setRegistrando(null)}
          aoSalvar={() => {
            setRegistrando(null);
            void queryClient.invalidateQueries({ queryKey: CHAVE });
          }}
        />
      )}
    </div>
  );
}

function Detalhe({ organizationId }: { organizationId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["superadmin-implantacao", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_implantacao_organizacao", { _organization_id: organizationId });
      if (error) throw error;
      return data as unknown as Implantacao;
    },
  });
  if (isLoading) return <p className="text-xs text-muted-foreground">Carregando...</p>;
  if (error || !data) return <p className="text-xs text-destructive">Não foi possível carregar.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 text-xs">
      <ul className="space-y-1">
        {data.etapas.map((e) => (
          <li key={e.etapa} className={cn(!e.principal && "text-muted-foreground")}>
            <span className={e.concluida ? "text-success" : ""}>{e.concluida ? "✓" : "○"}</span> {tituloEtapa(e.etapa)}
            {e.detalhe && <span className="text-muted-foreground"> — {e.detalhe}</span>}
          </li>
        ))}
      </ul>
      <ul className="space-y-1">
        {data.mensagens.length === 0 && <li className="text-muted-foreground">Nenhum e-mail enviado ainda.</li>}
        {data.mensagens.map((m, i) => (
          <li key={i}>
            <span className="text-muted-foreground tabular-nums">{formatarDataBR(m.enviado_em)}</span>{" "}
            {ROTULO_MENSAGEM[m.tipo] ?? m.tipo}
            <span className="text-muted-foreground"> — {m.motivo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegistrarLigacao({ linha, aoFechar, aoSalvar }: { linha: Linha; aoFechar: () => void; aoSalvar: () => void }) {
  const { toast } = useToast();
  const [acao, setAcao] = useState("");
  const [desfecho, setDesfecho] = useState("");
  const [proxima, setProxima] = useState("");
  const salvar = useMutation({
    // O formulário vai no mutate(), montado no clique.
    mutationFn: async (f: { acao: string; desfecho: string; proxima: string }) => {
      const { error } = await supabase.rpc("concluir_chamado_implantacao", {
        _chamado_id: linha.chamado!.id,
        _acao: f.acao,
        _desfecho: f.desfecho,
        _proxima_checagem: f.proxima ? new Date(`${f.proxima}T09:00:00-03:00`).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Ligação registrada" });
      aoSalvar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{linha.nome}: registrar a ligação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{linha.chamado!.motivo}</p>
          <div className="space-y-1.5">
            <Label htmlFor="acao-chamado">O que foi feito</Label>
            <Textarea id="acao-chamado" value={acao} onChange={(e) => setAcao(e.target.value)} placeholder="Ex.: liguei para o gestor e abrimos a conta juntos" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desfecho-chamado">Desfecho</Label>
            <Textarea id="desfecho-chamado" value={desfecho} onChange={(e) => setDesfecho(e.target.value)} placeholder="Ex.: conta aberta; falta só a aprovação do Asaas" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proxima-chamado">Próxima checagem (opcional)</Label>
            <Input id="proxima-chamado" type="date" value={proxima} onChange={(e) => setProxima(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Com data, se a academia continuar parada na mesma etapa depois dela, o agente abre outro chamado. Sem data, o assunto
              desta etapa fica encerrado.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            disabled={acao.trim().length < 3 || desfecho.trim().length < 3 || salvar.isPending}
            onClick={() => salvar.mutate({ acao, desfecho, proxima })}
          >
            {salvar.isPending ? "Registrando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
