import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { ROTULO_SITUACAO_ASAAS } from "@/lib/onboardingAcademia";
import { caminhosDaConta, grupoPendente, ROTULO_DOCUMENTO, subcontaDisponivelNaTela, type CaminhoConta, type GrupoDeDocumentos } from "@/lib/contaAsaas";
import { TERMOS_ASAAS_URL } from "@/lib/prestadorPagamentos";
import { useSubcontasBaasLigadas } from "@/hooks/useContaDasCobrancas";
import { PrestadorPagamentos } from "@/components/pagamento/PrestadorPagamentos";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, ExternalLink, FileUp, MailCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Conta Asaas da academia (decisão D6), na etapa Recebimentos.
 *
 * O caminho de sempre é a conta própria: a academia abre no site do Asaas e
 * informa a carteira. A conta aberta pela ArkeFit é BaaS (resposta do Asaas
 * de 06/10/2026) e só aparece com o interruptor `asaas_subcontas_baas` ligado
 * — ou na organização em trial, que fala com o sandbox (`caminhosDaConta`).
 * Antes de abrir, a tela diz que a conta é aberta e mantida pelo Asaas, em
 * nome da academia, e pede o aceite dos Termos de Uso do Asaas ao titular.
 * Depois, no formato BaaS, os documentos se mandam pelo link que o Asaas dá
 * a cada grupo, sem ir ao painel dele. O ARKE não guarda documento nem dado
 * bancário.
 */
export function EtapaRecebimentos({ onSalvo }: { onSalvo: () => void }) {
  const { organization, organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [caminho, setCaminho] = useState<CaminhoConta>("existente");
  const [faturamento, setFaturamento] = useState("");
  const [walletId, setWalletId] = useState("");
  const [aceite, setAceite] = useState(false);
  const [erroAbertura, setErroAbertura] = useState<string | null>(null);

  const {
    data: conta,
    isLoading: carregandoConta,
    error: erroConta,
    refetch: recarregarConta,
    isFetching: recarregandoConta,
  } = useQuery({
    queryKey: ["onboarding-recebimentos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("status, asaas_wallet_id, asaas_conta_origem, asaas_conta_status, asaas_conta_status_em, email_contato, faturamento_mensal")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });
  const { data: subcontasLigadas = false } = useSubcontasBaasLigadas(!!organization?.id);
  const caminhos = caminhosDaConta(subcontasLigadas, conta?.status);
  const baas = subcontaDisponivelNaTela(subcontasLigadas, conta?.status);
  const caminhoAtual: CaminhoConta = caminhos.includes(caminho) ? caminho : "existente";
  const ehGestor = organizationRole === "gestor";

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["onboarding-recebimentos", organization?.id] });
    onSalvo();
  };

  const chamar = async (corpo: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      email?: string;
      adotada?: boolean;
      situacao?: { general: string };
      grupos?: GrupoDeDocumentos[];
      motivo_recusa?: string | null;
    }>("asaas-conta-academia", { body: { organization_id: organization!.id, ...corpo } });
    if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível falar com o Asaas agora."));
    return data;
  };

  const criar = useMutation({
    mutationFn: async (dados: { faturamento: string; aceite: boolean }) => {
      const valor = Number(dados.faturamento.replace(/\./g, "").replace(",", "."));
      if (!conta?.faturamento_mensal && (!Number.isFinite(valor) || valor <= 0)) {
        throw new Error("Informe o faturamento mensal aproximado — o Asaas pede para abrir a conta.");
      }
      if (!dados.aceite) throw new Error("Para abrir a conta, aceite os Termos de Uso do Asaas.");
      if (valor > 0) {
        await exigirGravacao(supabase.from("organizations").update({ faturamento_mensal: valor }).eq("id", organization!.id).select("id"));
      }
      return chamar({ acao: "criar", aceite_termos: true, termos_url: TERMOS_ASAAS_URL });
    },
    onMutate: () => setErroAbertura(null),
    onSuccess: (r) => {
      toast({
        title: r?.adotada ? "Conta recuperada" : "Conta aberta no Asaas",
        description: r?.adotada
          ? "Achamos a conta de uma tentativa anterior e a vinculamos."
          : `O Asaas enviou um e-mail para ${r?.email ?? "a academia"} para definir a senha. Os documentos que ele pedir aparecem aqui.`,
      });
      atualizar();
    },
    // A recusa fica na tela, e não só num aviso que some: o sandbox, por
    // exemplo, pode recusar a subconta, e a conta própria continua ao lado.
    onError: (e: Error) => setErroAbertura(e.message),
  });

  const informar = useMutation({
    mutationFn: (carteira: string) => chamar({ acao: "existente", wallet_id: carteira }),
    onSuccess: () => {
      toast({ title: "Carteira vinculada", description: "As mensalidades dos alunos passam a cair nessa conta." });
      atualizar();
    },
    onError: (e: Error) => toast({ title: "Carteira não aceita", description: e.message, variant: "destructive" }),
  });

  const situacao = useMutation({
    mutationFn: () => chamar({ acao: "situacao" }),
    onSuccess: () => atualizar(),
    onError: (e: Error) => toast({ title: "Não foi possível consultar", description: e.message, variant: "destructive" }),
  });

  // Sem a situação da conta, a etapa não oferece abrir outra: com a leitura
  // falhando, ela parecia "sem conta" e convidava a abrir uma segunda.
  if (erroConta && !conta) {
    return <ErroAoCarregar oQue="a situação da conta Asaas" onTentarDeNovo={() => void recarregarConta()} tentando={recarregandoConta} className="p-3" />;
  }
  if (carregandoConta) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (conta?.asaas_wallet_id) {
    const criada = conta.asaas_conta_origem === "criada";
    const status = conta.asaas_conta_status ?? "PENDING";
    return (
      <div className="space-y-3">
        <p className="text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          {criada ? "Conta Asaas aberta pela ArkeFit, em nome da academia." : "Conta Asaas da academia vinculada."}
        </p>
        {criada && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Aprovação no Asaas:</span>
              <Badge variant={status === "APPROVED" ? "default" : status === "REJECTED" ? "destructive" : "outline"}>
                {ROTULO_SITUACAO_ASAAS[status] ?? status}
              </Badge>
              <Button aria-label="Atualizar a situação da conta" size="sm" variant="ghost" className="h-7 px-2" disabled={situacao.isPending} onClick={() => situacao.mutate()}>
                <RefreshCw className={cn("h-3.5 w-3.5", situacao.isPending && "animate-spin")} />
              </Button>
            </div>
            {status !== "APPROVED" &&
              (baas ? (
                <DocumentosDaConta chamar={chamar} organizationId={organization!.id} />
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs space-y-1.5">
                  <p className="font-medium flex items-center gap-1.5">
                    <MailCheck className="h-3.5 w-3.5" /> Próximo passo, no e-mail do Asaas ({conta.email_contato})
                  </p>
                  <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                    <li>Defina a senha da conta.</li>
                    <li>Envie os documentos pedidos (é o Asaas quem confere — o ARKE não guarda cópia).</li>
                    <li>Cadastre a conta bancária para saque.</li>
                  </ol>
                  <p className="text-muted-foreground">
                    As cobranças já podem começar; o saque para o banco libera quando o Asaas aprovar a conta.
                  </p>
                </div>
              ))}
          </>
        )}
        <PrestadorPagamentos />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {caminhos.length > 1 && (
        <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Conta Asaas">
          {(
            [
              ["existente", "Conta da academia no Asaas", "Recomendado. Abra grátis no site do Asaas, ou use a que já tem, e informe a carteira."],
              ["criar", "Abrir pela ArkeFit", "A conta é aberta e mantida pelo Asaas, em nome da academia."],
            ] as const
          )
            .filter(([valor]) => caminhos.includes(valor))
            .map(([valor, titulo, texto]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={caminhoAtual === valor}
                onClick={() => setCaminho(valor)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  caminhoAtual === valor ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                )}
              >
                <p className="text-sm font-medium">{titulo}</p>
                <p className="text-xs text-muted-foreground">{texto}</p>
              </button>
            ))}
        </div>
      )}

      {caminhoAtual === "criar" ? (
        <div className="space-y-3">
          <div className="rounded-md border p-3 text-xs space-y-1.5">
            <p className="font-medium">Quem abre e mantém a conta</p>
            <p className="text-muted-foreground">
              A conta de pagamento é aberta e mantida pelo Asaas, em nome da academia, e é dela. O Asaas confere os documentos e
              guarda os dados bancários; a ArkeFit é a plataforma de tecnologia que integra a conta ao ARKE e não guarda documento
              nem dado bancário. Usamos os dados da etapa anterior. Depois de aberta, os documentos que o Asaas pedir aparecem aqui,
              com o link do Asaas para enviar.
            </p>
          </div>
          {!conta?.faturamento_mensal && (
            <div className="space-y-1 max-w-xs">
              <Label htmlFor="onb-faturamento" className="text-xs">
                Faturamento mensal aproximado (R$)
              </Label>
              <Input id="onb-faturamento" inputMode="decimal" placeholder="30.000,00" value={faturamento} onChange={(e) => setFaturamento(e.target.value)} />
            </div>
          )}
          {ehGestor ? (
            <div className="flex items-start gap-2">
              <Checkbox id="onb-termos-asaas" checked={aceite} onCheckedChange={(v) => setAceite(v === true)} className="mt-0.5" />
              <Label htmlFor="onb-termos-asaas" className="text-xs font-normal leading-snug">
                Li e aceito os{" "}
                <a href={TERMOS_ASAAS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                  Termos de Uso do Asaas
                </a>
                , como responsável pela academia, titular da conta.
              </Label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Quem abre a conta e aceita os Termos do Asaas é a gestão da academia.</p>
          )}
          {erroAbertura && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
              <p className="font-medium text-destructive">O Asaas não abriu a conta.</p>
              <p className="text-muted-foreground">{erroAbertura}</p>
              <p className="text-muted-foreground">
                A conta própria da academia continua disponível:{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => setCaminho("existente")}>
                  informar a carteira
                </button>
                .
              </p>
            </div>
          )}
          <Button onClick={() => criar.mutate({ faturamento, aceite })} disabled={criar.isPending || !ehGestor || !aceite}>
            {criar.isPending ? "Abrindo a conta..." : "Abrir conta no Asaas"}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="onb-wallet" className="text-xs">
              Wallet ID da sua conta Asaas
            </Label>
            <Input
              id="onb-wallet"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={walletId}
              onChange={(e) => setWalletId(e.target.value.trim())}
            />
            <p className="text-[11px] text-muted-foreground">
              No Asaas: Minha Conta → Integrações → Wallet ID. Ainda não tem conta? Abra grátis em{" "}
              <a href="https://www.asaas.com" target="_blank" rel="noopener noreferrer" className="underline">
                asaas.com
              </a>
              , com o CNPJ da academia. A conta é da academia, no Asaas, e é para ela que vai o que os alunos pagam.
            </p>
          </div>
          <Button onClick={() => informar.mutate(walletId)} disabled={informar.isPending || !walletId}>
            {informar.isPending ? "Conferindo..." : "Vincular carteira"}
          </Button>
        </div>
      )}

      <PrestadorPagamentos />
    </div>
  );
}

/**
 * Os documentos que o Asaas pede, no formato BaaS: cada grupo com a situação
 * e o link do Asaas para enviar (abre em outra aba). O Asaas pede alguns
 * segundos depois da abertura antes de consultar; até lá a lista pode vir
 * vazia ou mudar, e o botão de atualizar resolve.
 */
function DocumentosDaConta({
  chamar,
  organizationId,
}: {
  chamar: (corpo: Record<string, unknown>) => Promise<{ grupos?: GrupoDeDocumentos[]; motivo_recusa?: string | null } | null | undefined>;
  organizationId: string;
}) {
  const documentos = useQuery({
    queryKey: ["asaas-documentos-conta", organizationId],
    queryFn: async () => {
      const r = await chamar({ acao: "documentos" });
      return { grupos: r?.grupos ?? [], motivoRecusa: r?.motivo_recusa ?? null };
    },
    retry: false,
  });
  const grupos = documentos.data?.grupos ?? [];
  const pendentes = grupos.filter(grupoPendente);

  return (
    <div className="rounded-md border border-dashed p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium flex items-center gap-1.5">
          <FileUp className="h-3.5 w-3.5" /> Documentos que o Asaas pede
        </p>
        <Button
          aria-label="Atualizar os documentos"
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          disabled={documentos.isFetching}
          onClick={() => void documentos.refetch()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", documentos.isFetching && "animate-spin")} />
        </Button>
      </div>
      {documentos.error ? (
        <p role="alert" className="text-destructive">
          {(documentos.error as Error).message}
        </p>
      ) : documentos.isLoading ? (
        <p className="text-muted-foreground">Consultando o Asaas…</p>
      ) : grupos.length === 0 ? (
        <p className="text-muted-foreground">
          O Asaas ainda não listou os documentos. Ele leva alguns segundos depois da abertura: atualize em instantes.
        </p>
      ) : (
        <>
          {documentos.data?.motivoRecusa && <p className="text-destructive">Motivo informado pelo Asaas: {documentos.data.motivoRecusa}</p>}
          <ul className="space-y-1.5">
            {grupos.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{g.titulo}</p>
                  {(g.responsavel || g.descricao) && (
                    <p className="text-muted-foreground">{[g.responsavel, g.descricao].filter(Boolean).join(" · ")}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={g.status === "APPROVED" ? "default" : g.status === "REJECTED" ? "destructive" : "outline"} className="text-[10px]">
                    {ROTULO_DOCUMENTO[g.status] ?? g.status}
                  </Badge>
                  {grupoPendente(g) && g.link && (
                    <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                      <a href={g.link} target="_blank" rel="noopener noreferrer">
                        Enviar no Asaas <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    </Button>
                  )}
                  {grupoPendente(g) && !g.link && <span className="text-muted-foreground">Fale com a ArkeFit</span>}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            {pendentes.length === 0
              ? "Nada a enviar agora. O Asaas analisa em até 48 horas; as cobranças já podem começar, e o saque libera com a aprovação."
              : "O envio é na página do Asaas, que confere os documentos. O ARKE não guarda cópia."}
          </p>
        </>
      )}
    </div>
  );
}
