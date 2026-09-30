import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CHAVE_CONFIG_LETICIA, useConfigLeticia } from "@/components/superadmin/comercial/useConfigLeticia";

/**
 * Letícia, a resposta automática: liga, desliga e guarda o link da agenda do
 * Jean. Fica recolhida no topo do Pipeline comercial, numa linha, e abre para
 * configurar. Quem decide quando cada e-mail sai é o banco
 * (`leads_para_agente_comercial`); aqui só a configuração, por
 * `definir_agente_comercial`, que confere o papel e fica na Auditoria.
 */
export function RespostaAutomatica() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: cfg, isLoading } = useConfigLeticia();

  const [agenda, setAgenda] = useState("");
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    setAgenda(cfg.agenda ?? "");
    // Sem o link da agenda, abre sozinho: é o que falta para ligar.
    if (!cfg.agenda) setAberto(true);
  }, [cfg]);

  const salvar = useMutation({
    mutationFn: async (dados: { ativo: boolean; agenda: string }) => {
      const { error } = await supabase.rpc("definir_agente_comercial", { _ativo: dados.ativo, _agenda_url: dados.agenda });
      if (error) throw error;
    },
    onSuccess: (_d, dados) => {
      toast({
        title: dados.ativo ? "Letícia ligada" : "Configuração salva",
        description: dados.ativo ? "Contatos do site que chegarem a partir de agora recebem a resposta em minutos." : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: CHAVE_CONFIG_LETICIA });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !cfg) return null;
  const agendaSalva = cfg.agenda ?? "";
  const agendaMudou = agenda.trim() !== agendaSalva;

  return (
    <Collapsible open={aberto} onOpenChange={setAberto} asChild>
      <Card>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/50"
            aria-label={aberto ? "Recolher configuração da Letícia" : "Abrir configuração da Letícia"}
          >
            <Bot className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Letícia, a resposta automática</p>
              <p className="truncate text-xs text-muted-foreground">
                {cfg.ativo
                  ? `Responde sozinha os contatos do site${cfg.outrasOrigens ? " e os outros canais quando acionada no cartão" : ""}.`
                  : agendaSalva
                    ? "Desligada. Os contatos esperam a equipe."
                    : "Desligada: falta o link da agenda do Jean."}
              </p>
            </div>
            <Badge variant={cfg.ativo ? "default" : "outline"}>{cfg.ativo ? "Ligada" : "Desligada"}</Badge>
            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 border-t p-4">
            <p className="text-sm text-muted-foreground">
              Responde por e-mail em minutos, com o convite para a demonstração com o Jean, e manda até dois lembretes, no 2º e no 5º dia, em dia útil das
              9h às 19h. Só fala com contatos em <strong>Novos</strong>: mover o cartão adiante é a equipe assumindo, e ela para. Para também quando a
              pessoa pede para não receber mais. Nunca fala de preço nem de plano.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="agenda-demonstracao">Link da agenda do Jean</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="agenda-demonstracao"
                  type="url"
                  value={agenda}
                  onChange={(e) => setAgenda(e.target.value)}
                  placeholder="https://calendly.com/… ou página de agendamento do Google Agenda"
                  className="min-w-0 flex-1"
                />
                {agendaMudou && (
                  <Button size="sm" disabled={salvar.isPending} onClick={() => salvar.mutate({ ativo: cfg.ativo, agenda: agenda.trim() })}>
                    Salvar link
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
              <Label htmlFor="ligar-leticia" className="text-sm font-normal">
                {agendaSalva ? "Ligar a Letícia" : "Salve o link da agenda para poder ligar"}
              </Label>
              <Switch
                id="ligar-leticia"
                checked={cfg.ativo}
                disabled={salvar.isPending || (!cfg.ativo && !agendaSalva)}
                onCheckedChange={(ligar) => salvar.mutate({ ativo: ligar, agenda: agendaSalva })}
              />
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <strong className="font-medium text-foreground">Site:</strong> responde sozinha, sem ninguém acionar.
              </li>
              <li>
                <strong className="font-medium text-foreground">WhatsApp, telefone, indicação e prospecção:</strong>{" "}
                {cfg.outrasOrigens
                  ? "só quando alguém da equipe clica em Acionar Letícia no cartão. A primeira mensagem sai em horário útil."
                  : "o botão Acionar Letícia fica disponível quando a Política de Privacidade descrever esses canais."}
              </li>
              <li>As respostas das academias vão para {cfg.responderPara ?? "o e-mail de quem responde (nenhum configurado em Configurações)"}.</li>
              <li>Assinado por "{cfg.assinatura ?? "Equipe comercial ArkeFit"}".</li>
              <li>
                {cfg.ia
                  ? "A inteligência artificial, em São Paulo, escreve uma ou duas frases sobre o que a academia contou (no site, no WhatsApp ou por telefone). Em indicação e prospecção, o e-mail é só texto fixo."
                  : "O e-mail sai só com o texto fixo. As frases escritas por IA entram quando a Política que descreve isso for publicada."}
              </li>
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
