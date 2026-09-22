import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { ROTULO_SITUACAO_ASAAS } from "@/lib/onboardingAcademia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, MailCheck, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Caminho = "criar" | "existente";

/**
 * Conta Asaas da academia (decisão D6): o ARKE abre a subconta pela API, ou a
 * academia que já tem conta informa a carteira. Na conta aberta pelo ARKE,
 * documentos e conta bancária para saque ficam com o próprio Asaas — o e-mail
 * de ativação chega para a academia, que conclui tudo na tela dele. O ARKE não
 * guarda documento nem dado bancário.
 */
export function EtapaRecebimentos({ onSalvo }: { onSalvo: () => void }) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [caminho, setCaminho] = useState<Caminho>("criar");
  const [faturamento, setFaturamento] = useState("");
  const [walletId, setWalletId] = useState("");

  const { data: conta } = useQuery({
    queryKey: ["onboarding-recebimentos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("asaas_wallet_id, asaas_conta_origem, asaas_conta_status, asaas_conta_status_em, email_contato, faturamento_mensal")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: ["onboarding-recebimentos", organization?.id] });
    onSalvo();
  };

  const chamar = async (corpo: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; email?: string; adotada?: boolean; situacao?: { general: string } }>(
      "asaas-conta-academia",
      { body: { organization_id: organization!.id, ...corpo } }
    );
    if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível falar com o Asaas agora."));
    return data;
  };

  const criar = useMutation({
    mutationFn: async () => {
      const valor = Number(faturamento.replace(/\./g, "").replace(",", "."));
      if (!conta?.faturamento_mensal && (!Number.isFinite(valor) || valor <= 0)) {
        throw new Error("Informe o faturamento mensal aproximado — o Asaas pede para abrir a conta.");
      }
      if (valor > 0) {
        const { error } = await supabase.from("organizations").update({ faturamento_mensal: valor }).eq("id", organization!.id);
        if (error) throw error;
      }
      return chamar({ acao: "criar" });
    },
    onSuccess: (r) => {
      toast({
        title: r?.adotada ? "Conta recuperada" : "Conta aberta no Asaas",
        description: r?.adotada
          ? "Achamos a conta de uma tentativa anterior e a vinculamos."
          : `O Asaas enviou um e-mail para ${r?.email ?? "a academia"} para definir a senha e enviar os documentos.`,
      });
      atualizar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível abrir a conta", description: e.message, variant: "destructive" }),
  });

  const informar = useMutation({
    mutationFn: () => chamar({ acao: "existente", wallet_id: walletId }),
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

  if (conta?.asaas_wallet_id) {
    const criada = conta.asaas_conta_origem === "criada";
    const status = conta.asaas_conta_status ?? "PENDING";
    return (
      <div className="space-y-3">
        <p className="text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          {criada ? "Conta Asaas aberta pelo ARKE." : "Conta Asaas da academia vinculada."}
        </p>
        {criada && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Aprovação no Asaas:</span>
              <Badge variant={status === "APPROVED" ? "default" : status === "REJECTED" ? "destructive" : "outline"}>
                {ROTULO_SITUACAO_ASAAS[status] ?? status}
              </Badge>
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={situacao.isPending} onClick={() => situacao.mutate()}>
                <RefreshCw className={cn("h-3.5 w-3.5", situacao.isPending && "animate-spin")} />
              </Button>
            </div>
            {status !== "APPROVED" && (
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
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Conta Asaas">
        {(
          [
            ["criar", "Abrir minha conta pelo ARKE", "Recomendado. Em 1 minuto, sem sair daqui."],
            ["existente", "Já tenho conta no Asaas", "Informe a carteira da sua conta."],
          ] as const
        ).map(([valor, titulo, texto]) => (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={caminho === valor}
            onClick={() => setCaminho(valor)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              caminho === valor ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
            )}
          >
            <p className="text-sm font-medium">{titulo}</p>
            <p className="text-xs text-muted-foreground">{texto}</p>
          </button>
        ))}
      </div>

      {caminho === "criar" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Usamos os dados da etapa anterior. O Asaas envia um e-mail para a academia definir a senha, mandar os documentos e
            cadastrar a conta bancária — tudo na tela dele.
          </p>
          {!conta?.faturamento_mensal && (
            <div className="space-y-1 max-w-xs">
              <Label htmlFor="onb-faturamento" className="text-xs">
                Faturamento mensal aproximado (R$)
              </Label>
              <Input id="onb-faturamento" inputMode="decimal" placeholder="30.000,00" value={faturamento} onChange={(e) => setFaturamento(e.target.value)} />
            </div>
          )}
          <Button onClick={() => criar.mutate()} disabled={criar.isPending}>
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
            <p className="text-[11px] text-muted-foreground">No Asaas: Minha Conta → Integrações → Wallet ID.</p>
          </div>
          <Button onClick={() => informar.mutate()} disabled={informar.isPending || !walletId}>
            {informar.isPending ? "Conferindo..." : "Vincular carteira"}
          </Button>
        </div>
      )}
    </div>
  );
}
