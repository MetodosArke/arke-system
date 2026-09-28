import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Configuracao = {
  ativo: boolean;
  ia: boolean;
  agenda: string | null;
  assinatura: string | null;
  responderPara: string | null;
};

/**
 * Letícia, a resposta automática ao contato do site: liga, desliga e guarda o
 * link da agenda do Jean. Quem decide quando cada e-mail sai é o banco
 * (`leads_para_agente_comercial`); aqui só a configuração, por
 * `definir_agente_comercial`, que confere o papel e fica na Auditoria.
 */
export function RespostaAutomatica() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: cfg, isLoading } = useQuery({
    queryKey: ["agente-comercial-config"],
    queryFn: async (): Promise<Configuracao> => {
      const [numeros, textos] = await Promise.all([
        supabase.from("plataforma_config").select("chave, valor").in("chave", ["agente_comercial_ativo", "agente_comercial_ia"]),
        supabase
          .from("plataforma_textos")
          .select("chave, valor")
          .in("chave", ["agenda_demonstracao_url", "agente_comercial_assinatura", "comercial_email"]),
      ]);
      if (numeros.error) throw numeros.error;
      if (textos.error) throw textos.error;
      const n = (c: string) => Number(numeros.data?.find((l) => l.chave === c)?.valor ?? 0) === 1;
      const t = (c: string) => textos.data?.find((l) => l.chave === c)?.valor?.trim() || null;
      return {
        ativo: n("agente_comercial_ativo"),
        ia: n("agente_comercial_ia"),
        agenda: t("agenda_demonstracao_url"),
        assinatura: t("agente_comercial_assinatura"),
        responderPara: t("comercial_email"),
      };
    },
  });

  const [agenda, setAgenda] = useState("");
  useEffect(() => {
    if (cfg) setAgenda(cfg.agenda ?? "");
  }, [cfg]);

  const salvar = useMutation({
    mutationFn: async (dados: { ativo: boolean; agenda: string }) => {
      const { error } = await supabase.rpc("definir_agente_comercial", { _ativo: dados.ativo, _agenda_url: dados.agenda });
      if (error) throw error;
    },
    onSuccess: (_d, dados) => {
      toast({
        title: dados.ativo ? "Resposta automática ligada" : "Configuração salva",
        description: dados.ativo ? "Contatos que chegarem a partir de agora recebem a resposta em minutos." : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["agente-comercial-config"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !cfg) return null;
  const agendaSalva = cfg.agenda ?? "";
  const agendaMudou = agenda.trim() !== agendaSalva;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="font-semibold">Resposta automática (Letícia)</p>
              <p className="text-sm text-muted-foreground">
                Responde cada contato por e-mail em minutos, com o convite para a demonstração com o Jean, e manda até dois lembretes, no 2º e no 5º dia,
                em dia útil das 9h às 19h. Para quando alguém muda a situação do contato aqui ou a pessoa pede para não receber mais. Nunca fala de preço nem de plano.
              </p>
            </div>
          </div>
          <Badge variant={cfg.ativo ? "default" : "outline"}>{cfg.ativo ? "Ligada" : "Desligada"}</Badge>
        </div>

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
            {agendaSalva ? "Ligar a resposta automática" : "Salve o link da agenda para poder ligar"}
          </Label>
          <Switch
            id="ligar-leticia"
            checked={cfg.ativo}
            disabled={salvar.isPending || (!cfg.ativo && !agendaSalva)}
            onCheckedChange={(ligar) => salvar.mutate({ ativo: ligar, agenda: agendaSalva })}
          />
        </div>

        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>As respostas das academias vão para {cfg.responderPara ?? "o e-mail de quem responde (nenhum configurado em Configurações)"}.</li>
          <li>Assinado por "{cfg.assinatura ?? "Equipe comercial ArkeFit"}".</li>
          <li>
            {cfg.ia
              ? "A inteligência artificial, em São Paulo, escreve uma ou duas frases sobre o que o contato contou; o resto do e-mail é texto fixo."
              : "O e-mail sai só com o texto fixo. As frases escritas por IA entram quando a Política que descreve isso for publicada."}
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
