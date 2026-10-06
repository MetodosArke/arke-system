import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { reais } from "@/lib/numeros";
import { SITUACAO_GATEWAY, solicitarComando, tempoDesde, type SituacaoGateway } from "@/lib/gateway";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlunoPerfilSheet } from "@/components/admin/AlunoPerfilSheet";
import { AvaliarAtendimento } from "@/components/ajuda/AvaliarAtendimento";
import { PrestadorPagamentos } from "@/components/pagamento/PrestadorPagamentos";
import { CircleHelp, MessageSquareText, RefreshCw, Send, Sparkles } from "lucide-react";

type CatracaCartao = {
  id: string;
  nome: string;
  status: string;
  situacao: SituacaoGateway;
  ultima_sincronizacao: string | null;
  fila_offline: number;
  capacidades: string[];
};
type AlunoCartao = {
  id: string;
  user_id: string;
  nome: string;
  situacao: "em_dia" | "pausado" | "inadimplente";
  situacao_motivo: string | null;
  entra_no_app: boolean;
  primeiro_acesso_em: string | null;
  tem_numero_catraca: boolean;
  no_metodo: boolean;
  cobranca: { descricao: string; valor: number; vencimento: string; status: string; invoice_url: string | null } | null;
};
type Resposta = {
  pergunta_id: string | null;
  resposta: string | null;
  artigos: { slug: string; titulo: string; secao: string | null; trecho: string }[];
  contexto: {
    papel: string;
    pode_comandar_catraca: boolean;
    pode_ver_cobranca: boolean;
    catracas?: CatracaCartao[];
    alunos?: AlunoCartao[];
    implantacao?: { liberado: boolean; proxima: { etapa: string; detalhe: string } | null } | null;
  };
};

const SITUACAO_ALUNO: Record<AlunoCartao["situacao"], string> = { em_dia: "Em dia", pausado: "Pausado", inadimplente: "Inadimplente" };
const PAPEIS_EQUIPE = ["gestor", "recepcao", "professor", "nutricionista"];

/**
 * O assistente da academia, no alto da Central de Ajuda do painel. Acha a
 * resposta nos artigos, mostra a situação na hora do que a pergunta trata,
 * com o botão da ação, e abre chamado para a ArkeFit quando não resolve. Os
 * botões chamam as mesmas rotas das telas, com a permissão de quem clica.
 */
export function AssistenteAcademia({ base }: { base: string }) {
  const { user, organization, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pergunta, setPergunta] = useState("");
  const [aluno, setAluno] = useState("");
  const [resultado, setResultado] = useState<{ pergunta: string; aluno: string; dados: Resposta } | null>(null);
  const [retorno, setRetorno] = useState<"resolveu" | "chamar" | "chamado" | null>(null);
  const [alunoAberto, setAlunoAberto] = useState<string | null>(null);

  const orgId = organization?.id ?? null;
  const daEquipe = !!orgId && !!organizationRole && PAPEIS_EQUIPE.includes(organizationRole);

  const chamados = useQuery({
    queryKey: ["assistente-chamados", orgId],
    enabled: daEquipe,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chamados_suporte")
        .select("id, pergunta, created_at, concluido_em, desfecho, prazo, user_id, responsavel_id")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Os chamados encerrados por uma pessoa da ArkeFit que quem está aqui abriu
  // e ainda não avaliou: é nesses que aparece "Como foi o atendimento?".
  const paraAvaliar = (chamados.data ?? []).filter((c) => c.concluido_em && c.responsavel_id && c.user_id === user?.id);
  const avaliados = useQuery({
    queryKey: ["assistente-chamados-avaliados", orgId, paraAvaliar.map((c) => c.id).join(",")],
    enabled: paraAvaliar.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avaliacoes_atendimento")
        .select("chamado_id")
        .in("chamado_id", paraAvaliar.map((c) => c.id));
      if (error) throw error;
      return new Set((data ?? []).map((a) => a.chamado_id));
    },
  });

  const perguntar = useMutation({
    mutationFn: async (dados: { pergunta: string; aluno: string }) => {
      const { data, error } = await supabase.functions.invoke<Resposta>("assistente-academia", {
        body: { acao: "perguntar", organization_id: orgId, pergunta: dados.pergunta, aluno: dados.aluno || undefined },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "O assistente não respondeu agora."));
      if (!data) throw new Error("O assistente não respondeu agora.");
      return { pergunta: dados.pergunta, aluno: dados.aluno, dados: data };
    },
    onSuccess: (r) => {
      setResultado(r);
      setRetorno(null);
    },
    onError: (e: Error) => toast({ title: "Não foi possível perguntar", description: e.message, variant: "destructive" }),
  });

  const registrar = useMutation({
    mutationFn: async (dados: { perguntaId: string; resolveu: boolean }) => {
      const { error } = await supabase.rpc("registrar_resultado_assistente", { _pergunta_id: dados.perguntaId, _resolveu: dados.resolveu });
      if (error) throw new Error(error.message);
    },
  });

  const abrirChamado = useMutation({
    mutationFn: async (dados: { pergunta: string; aluno: string; resposta: string | null; artigos: string[] }) => {
      const { data, error } = await supabase.functions.invoke<{ chamado_id: string; aviso: string | null }>("assistente-academia", {
        body: {
          acao: "chamado",
          organization_id: orgId,
          pergunta: dados.pergunta,
          aluno: dados.aluno || undefined,
          resposta: dados.resposta,
          artigos: dados.artigos,
        },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível abrir o chamado."));
      return data;
    },
    onSuccess: (data) => {
      setRetorno("chamado");
      toast({
        title: "Chamado aberto",
        description: data?.aviso ?? "A ArkeFit responde no seu e-mail em até 1 dia útil, e o andamento fica aqui embaixo.",
      });
      void queryClient.invalidateQueries({ queryKey: ["assistente-chamados", orgId] });
    },
    onError: (e: Error) => toast({ title: "Chamado não aberto", description: e.message, variant: "destructive" }),
  });

  const sincronizar = useMutation({
    mutationFn: async (catracaId: string) => solicitarComando(catracaId, "sincronizar_completo"),
    onSuccess: () => toast({ title: "Pedido enviado ao Gateway", description: "O cadastro chega ao computador da recepção em alguns segundos." }),
    onError: (e: Error) => toast({ title: "Não foi possível sincronizar", description: e.message, variant: "destructive" }),
  });

  const copiarLink = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke<{ action_link?: string }>("gerar-link-ativacao", { body: { user_id: userId } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível gerar o link."));
      if (!data?.action_link) throw new Error("O link não veio. Tente de novo.");
      await navigator.clipboard.writeText(data.action_link);
    },
    onSuccess: () => toast({ title: "Link copiado", description: "Vale por 48 horas. Mande ao aluno pelo canal que preferir." }),
    onError: (e: Error) => toast({ title: "Não foi possível copiar", description: e.message, variant: "destructive" }),
  });

  if (!daEquipe) return null;

  const dados = resultado?.dados;
  const ctx = dados?.contexto;
  const temCartao = !!(ctx?.catracas?.length || ctx?.alunos || ctx?.implantacao);

  const responder = (resolveu: boolean) => {
    if (dados?.pergunta_id) registrar.mutate({ perguntaId: dados.pergunta_id, resolveu });
    setRetorno(resolveu ? "resolveu" : "chamar");
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Pergunte ao assistente</h2>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pergunta.trim().length >= 3) perguntar.mutate({ pergunta: pergunta.trim(), aluno: aluno.trim() });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="assistente-pergunta">Sua dúvida</Label>
            <Textarea
              id="assistente-pergunta"
              rows={3}
              maxLength={1000}
              value={pergunta}
              onChange={(e) => setPergunta(e.target.value)}
              placeholder="Ex.: a catraca não liberou o aluno hoje cedo; o aluno não recebeu o e-mail para criar a senha."
              aria-describedby="assistente-pergunta-dica"
            />
            {/* A dúvida vai a um modelo de IA que pode rodar fora do Brasil
                (Política, seções 5 e 6): o nome do aluno vai no campo de
                baixo, que fica na plataforma. */}
            <p id="assistente-pergunta-dica" className="text-xs text-muted-foreground">
              Não escreva aqui o nome, o CPF nem dado de saúde do aluno. Para falar de um aluno, use o campo abaixo.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assistente-aluno">É sobre um aluno? (opcional)</Label>
            <Input
              id="assistente-aluno"
              value={aluno}
              maxLength={80}
              onChange={(e) => setAluno(e.target.value)}
              placeholder="Nome do aluno, para mostrar a situação dele"
            />
          </div>
          <Button type="submit" size="sm" disabled={pergunta.trim().length < 3 || perguntar.isPending}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {perguntar.isPending ? "Procurando..." : "Perguntar"}
          </Button>
        </form>

        {dados && (
          <div className="space-y-4 border-t pt-4" aria-live="polite">
            {dados.resposta ? (
              <div className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" /> Resposta escrita por IA a partir da Central de Ajuda. Confira antes de agir.
                </p>
                <p className="text-sm">{dados.resposta}</p>
              </div>
            ) : (
              dados.artigos.length === 0 &&
              !temCartao && <p className="text-sm text-muted-foreground">Não achei isso na Central de Ajuda. Dá para chamar a ArkeFit logo abaixo.</p>
            )}

            {ctx?.catracas && ctx.catracas.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Catracas agora</p>
                {ctx.catracas.map((c) => {
                  const info = SITUACAO_GATEWAY[c.situacao] ?? SITUACAO_GATEWAY.offline;
                  const noAr = c.situacao === "online" || c.situacao === "contingencia";
                  return (
                    <div key={c.id} className="space-y-1 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.nome}</span>
                        <Badge variant={info.tom === "ok" ? "default" : info.tom === "problema" ? "destructive" : "outline"}>{info.rotulo}</Badge>
                        <span className="text-xs text-muted-foreground">última sincronização {tempoDesde(c.ultima_sincronizacao)}</span>
                      </div>
                      {c.situacao !== "online" && <p className="text-xs text-muted-foreground">{info.descricao}</p>}
                      {c.fila_offline > 0 && <p className="text-xs text-muted-foreground">{c.fila_offline} acessos guardados para subir.</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {ctx.pode_comandar_catraca && noAr && c.capacidades.includes("sincronizar_completo") && (
                          <Button size="sm" variant="outline" disabled={sincronizar.isPending} onClick={() => sincronizar.mutate(c.id)}>
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sincronizar agora
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" asChild>
                          <Link to="/admin/catracas">Abrir Catracas</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {ctx?.alunos && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aluno</p>
                {ctx.alunos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum aluno com esse nome nesta academia.</p>}
                {ctx.alunos.length > 1 && <p className="text-xs text-muted-foreground">Mais de um aluno com esse nome: confira qual é.</p>}
                {ctx.alunos.map((a) => (
                  <div key={a.id} className="space-y-1 rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.nome}</span>
                      <Badge variant={a.situacao === "em_dia" ? "default" : "destructive"}>{SITUACAO_ALUNO[a.situacao] ?? a.situacao}</Badge>
                      {a.no_metodo && <Badge variant="outline">Método ARKE</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {a.entra_no_app ? "Entra no app e passa na catraca." : "Não entra no app nem passa na catraca pela situação dele."}{" "}
                      {a.primeiro_acesso_em ? `Entrou no app pela primeira vez em ${formatarDataBR(a.primeiro_acesso_em)}.` : "Nunca entrou no app."}{" "}
                      {a.tem_numero_catraca ? "" : "Não tem número na catraca."}
                    </p>
                    {a.cobranca && (
                      <>
                        <p className="text-xs">
                          {a.cobranca.descricao} de {reais(Number(a.cobranca.valor))}, vencimento {formatarDataBR(a.cobranca.vencimento)},{" "}
                          <span className={a.cobranca.status === "atrasado" ? "text-destructive" : ""}>{a.cobranca.status === "atrasado" ? "atrasada" : "em aberto"}</span>.
                        </p>
                        <PrestadorPagamentos atendimento={false} />
                      </>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => setAlunoAberto(a.id)}>
                        Abrir a ficha
                      </Button>
                      {a.cobranca?.invoice_url && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={a.cobranca.invoice_url} target="_blank" rel="noreferrer">
                            Abrir a fatura
                          </a>
                        </Button>
                      )}
                      {!a.primeiro_acesso_em && (
                        <Button size="sm" variant="outline" disabled={copiarLink.isPending} onClick={() => copiarLink.mutate(a.user_id)}>
                          Copiar link de ativação
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {ctx?.implantacao && (
              <div className="space-y-1 rounded-md border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Configuração</p>
                <p className="text-sm">
                  {ctx.implantacao.liberado
                    ? "A configuração está concluída e o app está liberado aos alunos."
                    : `Falta: ${ctx.implantacao.proxima?.detalhe ?? "concluir a configuração"}.`}
                </p>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/admin/onboarding">Abrir a implantação</Link>
                </Button>
              </div>
            )}

            {dados.artigos.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Na Central de Ajuda</p>
                <ul className="space-y-2">
                  {dados.artigos.map((a, i) => (
                    <li key={`${a.slug}-${i}`}>
                      <Link to={`${base}/${a.slug}`} className="block rounded-md border px-3 py-2 hover:bg-muted">
                        <p className="text-sm font-medium">
                          {a.titulo}
                          {a.secao ? <span className="text-muted-foreground"> — {a.secao}</span> : null}
                        </p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">{a.trecho}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {retorno === null && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="text-sm">Isso resolveu?</span>
                <Button size="sm" variant="outline" onClick={() => responder(true)}>
                  Sim
                </Button>
                <Button size="sm" variant="outline" onClick={() => responder(false)}>
                  Não, chamar a ArkeFit
                </Button>
              </div>
            )}
            {retorno === "resolveu" && <p className="border-t pt-3 text-sm text-muted-foreground">Que bom. Obrigado por avisar.</p>}
            {retorno === "chamar" && (
              <div className="space-y-2 rounded-md border border-primary/40 p-3">
                <p className="text-sm">
                  A sua pergunta vai para a ArkeFit, que responde no seu e-mail em até 1 dia útil. Junto vão o que o assistente respondeu e os artigos sugeridos.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={abrirChamado.isPending}
                    onClick={() =>
                      abrirChamado.mutate({ pergunta: resultado!.pergunta, aluno: resultado!.aluno, resposta: dados.resposta, artigos: dados.artigos.map((a) => a.slug) })
                    }
                  >
                    {abrirChamado.isPending ? "Abrindo..." : "Abrir chamado"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRetorno(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
            {retorno === "chamado" && <p className="border-t pt-3 text-sm text-muted-foreground">Chamado aberto. O andamento aparece logo abaixo.</p>}
          </div>
        )}

        {(chamados.data?.length ?? 0) > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <CircleHelp className="h-3.5 w-3.5" /> Chamados da academia
            </p>
            <ul className="space-y-1.5">
              {chamados.data!.map((c) => (
                <li key={c.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={c.concluido_em ? "default" : "outline"}>{c.concluido_em ? "Respondido" : "Aberto"}</Badge>
                    <span className="line-clamp-1">{c.pergunta}</span>
                    <span className="text-xs text-muted-foreground">{formatarDataBR(c.created_at)}</span>
                  </div>
                  {c.desfecho && <p className="pl-1 text-xs text-muted-foreground">{c.desfecho}</p>}
                  {avaliados.data && paraAvaliar.some((p) => p.id === c.id) && !avaliados.data.has(c.id) && (
                    <AvaliarAtendimento
                      chamadoId={c.id}
                      aoAvaliar={() => {
                        toast({ title: "Obrigado pela avaliação" });
                        void avaliados.refetch();
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <AlunoPerfilSheet alunoId={alunoAberto} onOpenChange={(open) => !open && setAlunoAberto(null)} />
    </Card>
  );
}
