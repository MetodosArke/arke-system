import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LifeBuoy, Mail } from "lucide-react";

type Chamado = {
  id: string;
  organization_id: string;
  organizacao: string;
  tipo_organizacao: string;
  quem: string | null;
  email: string | null;
  papel: string | null;
  pergunta: string;
  resposta_assistente: string | null;
  artigos: string[];
  contexto: { situacao?: string | null } | null;
  prazo: string;
  created_at: string;
  responsavel: string | null;
  acao: string | null;
  desfecho: string | null;
  proxima_checagem: string | null;
  concluido_em: string | null;
};

type Numeros = {
  perguntas: number;
  resolveu: number;
  nao_resolveu: number;
  chamados: number;
  abertos: number;
  atrasados: number;
  academias: number;
};

const PAPEL: Record<string, string> = { gestor: "gestão", recepcao: "recepção", professor: "professor", nutricionista: "nutricionista" };
const CHAVE = ["superadmin-suporte"];
const dataHora = (v: string) => formatarDataBR(v, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Visão Master → Suporte: os chamados que o assistente da academia abre
 * quando não resolve, e quanto ele resolve sozinho. A resposta à academia vai
 * por e-mail; aqui fica o desfecho, que é o que encerra o chamado.
 */
export default function SuperAdminSuporte() {
  const [registrando, setRegistrando] = useState<Chamado | null>(null);
  const queryClient = useQueryClient();

  const numeros = useQuery({
    queryKey: [...CHAVE, "numeros"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_assistente_numeros", { _dias: 30 });
      if (error) throw error;
      return data as unknown as Numeros;
    },
  });
  const chamados = useQuery({
    queryKey: [...CHAVE, "chamados"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_chamados_suporte");
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  const n = numeros.data;
  const respondidas = n ? n.resolveu + n.nao_resolveu : 0;
  const lista = chamados.data ?? [];
  const agora = Date.now();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Suporte</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        As dúvidas que o assistente do painel não resolveu viram chamado aqui, com a pergunta, o que ele respondeu e os artigos que
        sugeriu. Responda pelo e-mail de quem perguntou e registre o desfecho: é ele que encerra o chamado.
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <Numero titulo="Perguntas (30 dias)" valor={n?.perguntas} nota={n ? `${n.academias} academia${n.academias === 1 ? "" : "s"}` : undefined} />
        <Numero
          titulo="Resolveu sozinho"
          valor={n && respondidas ? `${Math.round((n.resolveu / respondidas) * 100)}%` : "—"}
          nota={n ? `${n.resolveu} de ${respondidas} que responderam` : undefined}
        />
        <Numero titulo="Chamados (30 dias)" valor={n?.chamados} />
        <Numero titulo="Abertos" valor={n?.abertos} nota={n?.atrasados ? `${n.atrasados} fora do prazo` : "nenhum fora do prazo"} alerta={!!n?.atrasados} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        "Resolveu sozinho" conta só quem respondeu à pergunta "Isso resolveu?" no fim da resposta. A pergunta em si não é guardada; só vira
        texto aqui quando a pessoa abre o chamado.
      </p>

      {chamados.error && <p className="text-sm text-destructive">Não foi possível carregar: {(chamados.error as Error).message}</p>}
      {!chamados.isLoading && !chamados.error && lista.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum chamado ainda.</p>
      )}

      <ul className="space-y-3">
        {lista.map((c) => {
          const atrasado = !c.concluido_em && new Date(c.prazo).getTime() < agora;
          return (
            <li key={c.id}>
              <Card className={atrasado ? "border-destructive/50" : undefined}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.organizacao}</span>
                    {c.tipo_organizacao === "profissional_autonomo" && <Badge variant="secondary">Autônomo</Badge>}
                    <Badge variant={c.concluido_em ? "default" : atrasado ? "destructive" : "outline"}>
                      {c.concluido_em ? "Encerrado" : atrasado ? "Fora do prazo" : "Aberto"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {dataHora(c.created_at)}
                      {!c.concluido_em && ` · prazo ${dataHora(c.prazo)}`}
                    </span>
                    {!c.concluido_em && (
                      <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setRegistrando(c)}>
                        Registrar o desfecho
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {c.quem?.trim() || "Sem nome"} ({PAPEL[c.papel ?? ""] ?? c.papel ?? "equipe"})
                    {c.email && (
                      <>
                        {" · "}
                        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-primary underline underline-offset-2">
                          <Mail className="h-3 w-3" /> {c.email}
                        </a>
                      </>
                    )}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{c.pergunta}</p>
                  {c.resposta_assistente && (
                    <p className="rounded-md bg-muted p-2 text-xs">
                      <span className="font-medium">O assistente respondeu: </span>
                      {c.resposta_assistente}
                    </p>
                  )}
                  {c.artigos.length > 0 && <p className="text-xs text-muted-foreground">Artigos sugeridos: {c.artigos.join(", ")}</p>}
                  {c.contexto?.situacao && (
                    <p className="whitespace-pre-wrap rounded-md border p-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Situação no sistema quando abriu: </span>
                      {c.contexto.situacao}
                    </p>
                  )}
                  {c.concluido_em && (
                    <div className="space-y-0.5 border-t pt-2 text-xs">
                      {c.acao && (
                        <p>
                          <span className="font-medium">Ação:</span> {c.acao}
                        </p>
                      )}
                      <p>
                        <span className="font-medium">Desfecho:</span> {c.desfecho}
                      </p>
                      <p className="text-muted-foreground">
                        {c.responsavel?.trim() || "ArkeFit"} em {dataHora(c.concluido_em)}
                        {c.proxima_checagem && ` · próxima checagem em ${formatarDataBR(c.proxima_checagem)}`}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {registrando && (
        <RegistrarDesfecho
          chamado={registrando}
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

function Numero({ titulo, valor, nota, alerta }: { titulo: string; valor: number | string | undefined; nota?: string; alerta?: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 p-3">
        <p className="text-xs text-muted-foreground">{titulo}</p>
        <p className={alerta ? "text-xl font-bold text-destructive" : "text-xl font-bold"}>{valor ?? "—"}</p>
        {nota && <p className="text-[11px] text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  );
}

function RegistrarDesfecho({ chamado, aoFechar, aoSalvar }: { chamado: Chamado; aoFechar: () => void; aoSalvar: () => void }) {
  const { toast } = useToast();
  const [acao, setAcao] = useState("");
  const [desfecho, setDesfecho] = useState("");
  const [proxima, setProxima] = useState("");
  const salvar = useMutation({
    // O formulário vai no mutate(), montado no clique.
    mutationFn: async (f: { acao: string; desfecho: string; proxima: string }) => {
      const { error } = await supabase.rpc("concluir_chamado_suporte", {
        _id: chamado.id,
        _acao: f.acao,
        _desfecho: f.desfecho,
        _proxima_checagem: f.proxima || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Chamado encerrado" });
      aoSalvar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{chamado.organizacao}: registrar o desfecho</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="line-clamp-3 text-sm text-muted-foreground">{chamado.pergunta}</p>
          <div className="space-y-1.5">
            <Label htmlFor="suporte-acao">O que foi feito</Label>
            <Textarea id="suporte-acao" value={acao} onChange={(e) => setAcao(e.target.value)} placeholder="Ex.: respondi por e-mail com o passo a passo" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suporte-desfecho">Desfecho</Label>
            <Textarea id="suporte-desfecho" value={desfecho} onChange={(e) => setDesfecho(e.target.value)} placeholder="Ex.: o Gateway voltou a sincronizar" />
            <p className="text-xs text-muted-foreground">A academia vê este texto nos chamados dela.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suporte-proxima">Próxima checagem (opcional)</Label>
            <Input id="suporte-proxima" type="date" value={proxima} onChange={(e) => setProxima(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button disabled={desfecho.trim().length < 3 || salvar.isPending} onClick={() => salvar.mutate({ acao, desfecho, proxima })}>
            {salvar.isPending ? "Registrando..." : "Encerrar o chamado"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
