import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plug, DoorOpen, Info, KeyRound } from "lucide-react";

type Parceiro = "wellhub" | "totalpass";
type CampoSegredo = "api_key" | "client_secret" | "webhook_secret";
type MetaSegredos = Partial<Record<CampoSegredo, { final?: string; atualizado_em?: string }>>;

interface CredencialForm {
  identificador: string;
  ativo: boolean;
  /** O que foi digitado agora. Vazio = manter o que está no cofre. */
  novos: Partial<Record<CampoSegredo, string>>;
  /** Pedido de apagar do cofre. */
  remover: Partial<Record<CampoSegredo, boolean>>;
}

const FORM_VAZIO: CredencialForm = { identificador: "", ativo: false, novos: {}, remover: {} };

const CAMPOS: Record<Parceiro, { campo: CampoSegredo; rotulo: string; dica: string }[]> = {
  wellhub: [
    { campo: "api_key", rotulo: "API Key / Partner Token", dica: "Chave secreta de autenticação da academia" },
    { campo: "webhook_secret", rotulo: "Webhook Secret (opcional)", dica: "Para avisos de check-in cancelado/estornado" },
  ],
  totalpass: [
    { campo: "api_key", rotulo: "Client ID", dica: "Identificador da academia na TotalPass" },
    { campo: "client_secret", rotulo: "Client Secret", dica: "Chave para assinar as requisições" },
  ],
};

const IDENTIFICADOR: Record<Parceiro, { rotulo: string; dica: string }> = {
  wellhub: { rotulo: "Gym ID / Location ID", dica: "Identificador desta unidade no Wellhub" },
  totalpass: { rotulo: "Gym Unit ID / Código da Academia", dica: "Número do contrato da unidade" },
};

/**
 * Credenciais dos agregadores (Wellhub/TotalPass).
 *
 * Os segredos vão para o cofre do banco (Vault) e NÃO voltam para a tela: o
 * gestor vê que existem e os 4 últimos caracteres, para conferir qual chave
 * está configurada, e pode trocar ou apagar — nunca ler. Até a versão 1.0 eles
 * ficavam em colunas de texto, legíveis por quem abria esta tela e por
 * qualquer cópia do banco.
 *
 * A checagem automática contra a API do parceiro ainda não existe (depende da
 * documentação e das credenciais reais); por ora o check-in é confirmado pela
 * recepção em Catracas, e este cadastro deixa a estrutura pronta.
 */
export default function AdminIntegracoes() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [forms, setForms] = useState<Record<Parceiro, CredencialForm>>({ wellhub: FORM_VAZIO, totalpass: FORM_VAZIO });

  // Sem `= []` aqui: um array novo a cada renderização disparava o efeito
  // abaixo em laço enquanto a consulta carregava, e o laço apagava o que o
  // gestor tinha acabado de digitar.
  const { data: credenciais } = useQuery({
    queryKey: ["integracoes-credenciais", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_credenciais_parceiro")
        .select("id, parceiro, identificador, ativo, segredos")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (!credenciais) return;
    const doParceiro = (p: Parceiro): CredencialForm => {
      const c = credenciais.find((x) => x.parceiro === p);
      return c ? { identificador: c.identificador ?? "", ativo: c.ativo, novos: {}, remover: {} } : FORM_VAZIO;
    };
    setForms({ wellhub: doParceiro("wellhub"), totalpass: doParceiro("totalpass") });
  }, [credenciais]);

  const salvar = useMutation({
    mutationFn: async (parceiro: Parceiro) => {
      const form = forms[parceiro];
      const segredos: Record<string, string> = {};
      for (const { campo } of CAMPOS[parceiro]) {
        const novo = form.novos[campo]?.trim();
        if (novo) segredos[campo] = novo;
        else if (form.remover[campo]) segredos[campo] = "";
      }
      const { error } = await supabase.rpc("salvar_credencial_parceiro", {
        _organization_id: organization!.id,
        _parceiro: parceiro,
        _identificador: form.identificador.trim(),
        _ativo: form.ativo,
        _segredos: segredos,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast({ title: "Credenciais salvas", description: "Os segredos ficam no cofre e não aparecem de novo nesta tela." });
      void queryClient.invalidateQueries({ queryKey: ["integracoes-credenciais", organization?.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-parceiros-ativos", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao salvar credenciais", description: error.message, variant: "destructive" }),
  });

  const alterar = (p: Parceiro, mudanca: Partial<CredencialForm>) =>
    setForms((atual) => ({ ...atual, [p]: { ...atual[p], ...mudanca } }));

  const cartao = (parceiro: Parceiro, titulo: string, origem: string) => {
    const form = forms[parceiro];
    const meta = (credenciais?.find((c) => c.parceiro === parceiro)?.segredos ?? {}) as MetaSegredos;
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{titulo}</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor={`ativo-${parceiro}`} className="text-xs text-muted-foreground">
                Ativo
              </Label>
              <Switch id={`ativo-${parceiro}`} checked={form.ativo} onCheckedChange={(v) => alterar(parceiro, { ativo: v })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{origem}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`id-${parceiro}`}>{IDENTIFICADOR[parceiro].rotulo}</Label>
            <Input
              id={`id-${parceiro}`}
              value={form.identificador}
              onChange={(e) => alterar(parceiro, { identificador: e.target.value })}
              placeholder={IDENTIFICADOR[parceiro].dica}
            />
          </div>
          {CAMPOS[parceiro].map(({ campo, rotulo, dica }) => {
            const guardado = meta[campo];
            const vaiRemover = !!form.remover[campo];
            return (
              <div key={campo} className="space-y-1.5">
                <Label htmlFor={`${campo}-${parceiro}`} className="flex items-center gap-1.5">
                  {rotulo}
                  {guardado && !vaiRemover && (
                    <span className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
                      <KeyRound className="h-3 w-3" /> no cofre{guardado.final ? ` (final ${guardado.final})` : ""}
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`${campo}-${parceiro}`}
                    type="password"
                    autoComplete="off"
                    value={form.novos[campo] ?? ""}
                    onChange={(e) => alterar(parceiro, { novos: { ...form.novos, [campo]: e.target.value } })}
                    placeholder={guardado ? "Deixe em branco para manter a atual" : dica}
                    disabled={vaiRemover}
                  />
                  {guardado && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => alterar(parceiro, { remover: { ...form.remover, [campo]: !vaiRemover } })}
                    >
                      {vaiRemover ? "Manter" : "Apagar"}
                    </Button>
                  )}
                </div>
                {vaiRemover && <p className="text-[11px] text-destructive">Será apagada do cofre ao salvar.</p>}
              </div>
            );
          })}
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate(parceiro)}>
            {salvar.isPending ? "Salvando..." : `Salvar ${titulo}`}
          </Button>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Integrações</h1>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          A validação automática do check-in contra a API do Wellhub/TotalPass ainda não está disponível (depende da
          documentação e das credenciais reais dos parceiros). Por enquanto, o cadastro abaixo deixa a estrutura pronta,
          e a liberação da catraca continua confirmada pela recepção em <strong>Catracas</strong>, onde fica também a
          conferência mensal dos check-ins.
        </p>
      </div>

      {cartao("wellhub", "Wellhub (Gympass)", "Gerados no Portal do Parceiro Wellhub, após o cadastro da academia como parceira.")}
      {cartao("totalpass", "TotalPass", "Gerados no Portal do Parceiro TotalPass, aba Integração / Desenvolvedores.")}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DoorOpen className="h-4 w-4" /> Equipamento da catraca
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {/*
            Esta tela tinha um "mapeamento de hardware" (fabricante, IP, porta)
            gravado na nuvem que nada lia: o Gateway Local sempre usou o
            config.json da própria máquina. E é lá que deve ficar — a senha de
            administrador do equipamento não tem por que subir para a nuvem.
          */}
          <p>
            O fabricante, o endereço e a senha do equipamento ficam no <strong>Gateway Local</strong>, no computador da
            recepção (arquivo <code>config.json</code>), e não aqui — a senha de administrador da catraca não sai da
            academia.
          </p>
          <p>
            Para a nuvem, cada catraca é só o dispositivo cadastrado em <strong>Catracas</strong>, com o token que o
            Gateway usa para se identificar. É lá também que aparece se o Gateway está no ar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
