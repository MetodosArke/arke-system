import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Users } from "lucide-react";
import { ChatMentor } from "@/components/chat/ChatMentor";
import { FilaChamadosMentor } from "@/components/superadmin/FilaChamadosMentor";
import { OperacaoMentor } from "@/components/superadmin/OperacaoMentor";
import { useAcessoArkefit } from "@/hooks/useAcessoArkefit";
import { CarteiraMentor } from "@/components/superadmin/CarteiraMentor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ROTULO_PLANO, type PlanoAluno } from "@/lib/planoAluno";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";

/**
 * Fila de mentoria da ArkeFit — onde o mentor atende os alunos do Método.
 *
 * A ordem é a mesma da Caixa de Mensagens da academia e pelo mesmo motivo:
 * quem está esperando resposta vem primeiro e, entre esses, quem espera há
 * mais tempo vem na frente. Ordenar pela mensagem mais recente premiaria quem
 * acabou de escrever e deixaria o aluno de ontem no fim da lista.
 *
 * A conversa em si é o mesmo componente que o aluno vê, do outro lado.
 */

type ItemFila = {
  aluno_id: string;
  aluno_nome: string;
  organizacao_nome: string;
  plano: string;
  ultima_mensagem: string;
  ultima_em: string;
  ultimo_remetente: string;
  nao_lidas: number;
};

export default function SuperAdminMentoria() {
  const { user } = useAuth();
  const [aberto, setAberto] = useState<ItemFila | null>(null);

  // A fila responde por quem pergunta: a chave leva a pessoa.
  const {
    data: fila = [],
    isLoading,
    error: erroFila,
    refetch: recarregarFila,
    isFetching: recarregandoFila,
  } = useQuery({
    queryKey: ["fila-mentor", user?.id ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_superadmin_fila_mentor");
      if (error) throw error;
      return (data ?? []) as ItemFila[];
    },
    refetchInterval: 30_000,
  });

  const esperando = fila.filter((f) => Number(f.nao_lidas) > 0).length;
  // A operação dos mentores (a carga e o SLA de cada um) é do Sócio.
  const { pode } = useAcessoArkefit();
  const socio = pode("socio");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Mentoria ARKE</h1>
        </div>
        <span className="text-xs text-muted-foreground">
          {fila.length} conversa(s) · {esperando} esperando resposta
        </span>
      </div>

      {/* A carteira é a porta de entrada: o mentor é dono do acompanhamento
          do aluno do Método, e não só de chamados. Chamados e conversas
          continuam como filas de trabalho ao lado. */}
      <Tabs defaultValue="alunos">
        <TabsList>
          <TabsTrigger value="alunos">Alunos</TabsTrigger>
          <TabsTrigger value="chamados">Chamados</TabsTrigger>
          <TabsTrigger value="conversas">Conversas</TabsTrigger>
          {socio && <TabsTrigger value="operacao">Operação</TabsTrigger>}
        </TabsList>
        <TabsContent value="alunos" className="mt-3">
          <CarteiraMentor />
        </TabsContent>
        <TabsContent value="chamados" className="mt-3">
          <FilaChamadosMentor />
        </TabsContent>
        <TabsContent value="conversas" className="mt-3 space-y-3">
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div role="status" aria-label="Carregando" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : erroFila && fila.length === 0 ? (
        <Card>
          <ErroAoCarregar oQue="as conversas de mentoria" onTentarDeNovo={() => void recarregarFila()} tentando={recarregandoFila} />
        </Card>
      ) : fila.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Users className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="font-medium">Nenhuma conversa de mentoria ainda</p>
            <p className="text-sm text-muted-foreground">
              O canal aparece para o aluno assim que ele entra no Método ARKE. Enquanto ninguém escrever,
              esta fila fica vazia.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(0,22rem)_1fr]">
          <div className="space-y-2">
            {fila.map((item) => {
              const pendentes = Number(item.nao_lidas);
              const selecionado = aberto?.aluno_id === item.aluno_id;
              return (
                <button
                  key={item.aluno_id}
                  onClick={() => setAberto(item)}
                  aria-pressed={selecionado}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    selecionado ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{item.aluno_nome}</span>
                    {pendentes > 0 && <Badge variant="destructive">{pendentes}</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {item.organizacao_nome} · {ROTULO_PLANO[item.plano as PlanoAluno] ?? item.plano}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.ultimo_remetente === "mentor" ? "Você: " : ""}
                    {item.ultima_mensagem}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {format(new Date(item.ultima_em), "dd/MM HH:mm", { locale: ptBR })}
                  </p>
                </button>
              );
            })}
          </div>

          <Card className="min-h-[24rem]">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {aberto ? aberto.aluno_nome : "Escolha uma conversa"}
              </CardTitle>
              {aberto && <p className="text-xs text-muted-foreground">{aberto.organizacao_nome}</p>}
            </CardHeader>
            <CardContent>
              {aberto ? (
                <ChatMentorDaFila item={aberto} />
              ) : (
                <p className="text-sm text-muted-foreground py-10 text-center">
                  Selecione um aluno na lista ao lado.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
        </TabsContent>
        {socio && (
          <TabsContent value="operacao" className="mt-3">
            <OperacaoMentor />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

/**
 * O `organization_id` não vem da fila porque ela devolve o nome da academia,
 * não o id — e o componente precisa do id para gravar. Buscar aqui mantém a
 * RPC enxuta e não expõe id de organização numa lista que só precisa exibir
 * nome.
 */
function ChatMentorDaFila({ item }: { item: ItemFila }) {
  const {
    data: orgId,
    error: erroOrg,
    refetch: recarregarOrg,
    isFetching: recarregandoOrg,
  } = useQuery({
    queryKey: ["mentor-org-do-aluno", item.aluno_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens_mentor")
        .select("organization_id")
        .eq("aluno_id", item.aluno_id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.organization_id ?? null;
    },
  });

  if (erroOrg && !orgId) {
    return <ErroAoCarregar oQue="a conversa" onTentarDeNovo={() => void recarregarOrg()} tentando={recarregandoOrg} />;
  }
  if (!orgId) {
    return <p className="text-sm text-muted-foreground py-10 text-center">Carregando conversa...</p>;
  }
  return <ChatMentor organizationId={orgId} alunoId={item.aluno_id} viewerType="mentor" />;
}
