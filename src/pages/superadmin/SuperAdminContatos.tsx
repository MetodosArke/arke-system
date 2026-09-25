import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Mail, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS: [string, string][] = [
  ["novo", "Novo"],
  ["em_contato", "Em contato"],
  ["demonstracao", "Demonstração marcada"],
  ["proposta", "Proposta enviada"],
  ["fechado", "Fechado"],
  ["descartado", "Descartado"],
];
const FAIXA: Record<string, string> = {
  ate_150: "até 150 alunos",
  "151_500": "151 a 500 alunos",
  "501_1000": "501 a 1.000 alunos",
  mais_1000: "mais de 1.000 alunos",
};

type Lead = {
  id: string;
  created_at: string;
  nome: string;
  academia: string;
  cidade: string | null;
  uf: string | null;
  telefone: string;
  email: string;
  alunos_faixa: string | null;
  sistema_atual: string | null;
  mensagem: string | null;
  origem: string | null;
  status: string;
  observacao: string | null;
  email_enviado_em: string | null;
};

function LinhaContato({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [observacao, setObservacao] = useState(lead.observacao ?? "");
  const salvar = useMutation({
    mutationFn: async (mudanca: { status?: string; observacao?: string | null }) => {
      const { error } = await supabase.from("leads_site").update(mudanca).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["leads-site"] }),
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });
  const whatsapp = lead.telefone.replace(/\D/g, "");
  const local = [lead.cidade, lead.uf].filter(Boolean).join(" / ");

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">{lead.academia}</p>
            <p className="text-sm text-muted-foreground">
              {lead.nome}
              {local && ` · ${local}`}
              {lead.alunos_faixa && ` · ${FAIXA[lead.alunos_faixa] ?? lead.alunos_faixa}`}
              {lead.sistema_atual && ` · usa ${lead.sistema_atual}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatarDataBR(lead.created_at)}
              {lead.origem && ` · veio de ${lead.origem}`}
              {!lead.email_enviado_em && " · aviso por e-mail não saiu"}
            </p>
          </div>
          <Select value={lead.status} onValueChange={(status) => salvar.mutate({ status })} disabled={salvar.isPending}>
            <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Situação do contato">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS.map(([v, r]) => (
                <SelectItem key={v} value={v} className="text-xs">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {lead.mensagem && <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">{lead.mensagem}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`https://wa.me/${whatsapp.startsWith("55") ? whatsapp : `55${whatsapp}`}`} target="_blank" rel="noreferrer">
              <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> WhatsApp
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={`mailto:${lead.email}?subject=${encodeURIComponent("ARKE — sua demonstração")}`}>
              <Mail className="mr-1.5 h-3.5 w-3.5" /> {lead.email}
            </a>
          </Button>
        </div>
        <div className="space-y-2">
          <Textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Anotações do comercial (quem falou, o que ficou combinado)"
            rows={2}
            maxLength={2000}
            aria-label="Anotações do contato"
          />
          {observacao !== (lead.observacao ?? "") && (
            <Button size="sm" disabled={salvar.isPending} onClick={() => salvar.mutate({ observacao: observacao.trim() || null })}>
              Salvar anotação
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Visão Master → Contatos do site: o que chegou pelo formulário da página de
 * vendas. O mesmo contato vai por e-mail para o comercial; aqui fica o
 * andamento de cada um.
 */
export default function SuperAdminContatos() {
  const [filtro, setFiltro] = useState("abertos");
  const { data: leads = [], isLoading, error } = useQuery({
    queryKey: ["leads-site"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads_site").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as Lead[];
    },
  });
  const visiveis = leads.filter((l) =>
    filtro === "todos" ? true : filtro === "abertos" ? !["fechado", "descartado"].includes(l.status) : l.status === filtro,
  );
  const novos = leads.filter((l) => l.status === "novo").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Inbox className="h-5 w-5 text-primary" /> Contatos do site
          </h1>
          <p className="text-sm text-muted-foreground">
            Academias que pediram demonstração na página de vendas.{novos > 0 && ` ${novos} ainda sem resposta.`}
          </p>
        </div>
        <Select value={filtro} onValueChange={setFiltro}>
          <SelectTrigger className="w-[200px]" aria-label="Filtrar contatos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertos">Em aberto</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
            {STATUS.map(([v, r]) => (
              <SelectItem key={v} value={v}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Não foi possível carregar os contatos.</p>}
      {!isLoading && !error && visiveis.length === 0 && (
        <p className="text-sm text-muted-foreground">{filtro === "todos" ? "Nenhum contato ainda." : "Nenhum contato neste filtro."}</p>
      )}
      <div className="space-y-3">
        {visiveis.map((l) => (
          <LinhaContato key={l.id} lead={l} />
        ))}
      </div>
      {leads.length >= 500 && (
        <Badge variant="outline" className="text-[11px]">
          Mostrando os 500 mais recentes
        </Badge>
      )}
    </div>
  );
}
