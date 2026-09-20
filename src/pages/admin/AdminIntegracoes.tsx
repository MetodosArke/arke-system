import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plug, DoorOpen, Info } from "lucide-react";

type Parceiro = "wellhub" | "totalpass";
type Driver = "henry" | "control_id" | "topdata" | "intelbras" | "mock";

const DRIVER_LABEL: Record<Driver, string> = {
  henry: "Henry",
  control_id: "Control iD",
  topdata: "Topdata",
  intelbras: "Intelbras",
  mock: "Simulador (testes)",
};

interface CredencialForm {
  identificador: string;
  api_key: string;
  client_secret: string;
  webhook_secret: string;
  ativo: boolean;
}

const CREDENCIAL_VAZIA: CredencialForm = {
  identificador: "",
  api_key: "",
  client_secret: "",
  webhook_secret: "",
  ativo: false,
};

interface HardwareForm {
  driver: Driver | "";
  ip_address: string;
  porta: string;
  delay_liberacao_seg: string;
}

// Painel de credenciais dos agregadores (Wellhub/TotalPass) e mapeamento
// de hardware das catracas. A checagem automática contra a API do
// parceiro (passo 3 do fluxo: enviar código + Gym ID e receber 200 OK)
// ainda não está implementada — depende da documentação/credenciais reais
// dos parceiros, que a academia ainda está providenciando. Por ora, o
// check-in continua confirmado manualmente pela recepção em /admin/catracas
// (catraca-checkin-parceiro-externo), e este cadastro deixa a estrutura
// pronta para quando a validação automática entrar.
export default function AdminIntegracoes() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [wellhub, setWellhub] = useState<CredencialForm>(CREDENCIAL_VAZIA);
  const [totalpass, setTotalpass] = useState<CredencialForm>(CREDENCIAL_VAZIA);
  const [hardwareForms, setHardwareForms] = useState<Record<string, HardwareForm>>({});

  const { data: credenciais = [] } = useQuery({
    queryKey: ["integracoes-credenciais", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_credenciais_parceiro")
        .select("id, parceiro, identificador, api_key, client_secret, webhook_secret, ativo")
        .eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: catracas = [] } = useQuery({
    queryKey: ["integracoes-catracas", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizacao_catracas")
        .select("id, nome, localizacao, driver, ip_address, porta, delay_liberacao_seg")
        .eq("organization_id", organization!.id)
        .order("nome");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    const w = credenciais.find((c) => c.parceiro === "wellhub");
    const t = credenciais.find((c) => c.parceiro === "totalpass");
    setWellhub(
      w
        ? {
            identificador: w.identificador ?? "",
            api_key: w.api_key ?? "",
            client_secret: w.client_secret ?? "",
            webhook_secret: w.webhook_secret ?? "",
            ativo: w.ativo,
          }
        : CREDENCIAL_VAZIA
    );
    setTotalpass(
      t
        ? {
            identificador: t.identificador ?? "",
            api_key: t.api_key ?? "",
            client_secret: t.client_secret ?? "",
            webhook_secret: t.webhook_secret ?? "",
            ativo: t.ativo,
          }
        : CREDENCIAL_VAZIA
    );
  }, [credenciais]);

  useEffect(() => {
    setHardwareForms((atual) => {
      const proximo = { ...atual };
      for (const c of catracas) {
        if (!proximo[c.id]) {
          proximo[c.id] = {
            driver: (c.driver as Driver) ?? "",
            ip_address: c.ip_address ?? "",
            porta: c.porta != null ? String(c.porta) : "",
            delay_liberacao_seg: String(c.delay_liberacao_seg),
          };
        }
      }
      return proximo;
    });
  }, [catracas]);

  const salvarCredencial = useMutation({
    mutationFn: async ({ parceiro, form }: { parceiro: Parceiro; form: CredencialForm }) => {
      const { error } = await supabase.from("organizacao_credenciais_parceiro").upsert(
        {
          organization_id: organization!.id,
          parceiro,
          identificador: form.identificador.trim() || null,
          api_key: form.api_key.trim() || null,
          client_secret: form.client_secret.trim() || null,
          webhook_secret: form.webhook_secret.trim() || null,
          ativo: form.ativo,
        },
        { onConflict: "organization_id,parceiro" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Credenciais salvas!" });
      void queryClient.invalidateQueries({ queryKey: ["integracoes-credenciais", organization?.id] });
      void queryClient.invalidateQueries({ queryKey: ["admin-parceiros-ativos", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao salvar credenciais", description: error.message, variant: "destructive" }),
  });

  const salvarHardware = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: HardwareForm }) => {
      const { error } = await supabase
        .from("organizacao_catracas")
        .update({
          driver: form.driver || null,
          ip_address: form.ip_address.trim() || null,
          porta: form.porta.trim() ? Number(form.porta) : null,
          delay_liberacao_seg: form.delay_liberacao_seg.trim() ? Number(form.delay_liberacao_seg) : 4,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Mapeamento de hardware salvo!" });
      void queryClient.invalidateQueries({ queryKey: ["integracoes-catracas", organization?.id] });
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao salvar hardware", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-10">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Integrações</h1>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          A validação automática do check-in contra a API do Wellhub/TotalPass ainda não está
          disponível (depende da documentação e credenciais reais dos parceiros). Por enquanto, o
          cadastro abaixo deixa a estrutura pronta, e a liberação da catraca continua confirmada
          manualmente pela recepção em <strong>Catracas</strong>.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Wellhub (Gympass)</CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Ativo</Label>
              <Switch checked={wellhub.ativo} onCheckedChange={(v) => setWellhub((p) => ({ ...p, ativo: v }))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Gerados no Portal do Parceiro Wellhub, após o cadastro da academia como parceira.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>API Key / Partner Token</Label>
            <Input
              type="password"
              value={wellhub.api_key}
              onChange={(e) => setWellhub((p) => ({ ...p, api_key: e.target.value }))}
              placeholder="Chave secreta de autenticação da academia"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Gym ID / Location ID</Label>
            <Input
              value={wellhub.identificador}
              onChange={(e) => setWellhub((p) => ({ ...p, identificador: e.target.value }))}
              placeholder="Identificador desta unidade no Wellhub"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Webhook Secret (opcional)</Label>
            <Input
              type="password"
              value={wellhub.webhook_secret}
              onChange={(e) => setWellhub((p) => ({ ...p, webhook_secret: e.target.value }))}
              placeholder="Para avisos de check-in cancelado/estornado"
            />
          </div>
          <Button
            disabled={salvarCredencial.isPending}
            onClick={() => salvarCredencial.mutate({ parceiro: "wellhub", form: wellhub })}
          >
            {salvarCredencial.isPending ? "Salvando..." : "Salvar credenciais Wellhub"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">TotalPass</CardTitle>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Ativo</Label>
              <Switch checked={totalpass.ativo} onCheckedChange={(v) => setTotalpass((p) => ({ ...p, ativo: v }))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Gerados no Portal do Parceiro TotalPass, aba Integração / Desenvolvedores.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Client ID</Label>
            <Input
              value={totalpass.api_key}
              onChange={(e) => setTotalpass((p) => ({ ...p, api_key: e.target.value }))}
              placeholder="Identificador da academia na TotalPass"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Client Secret</Label>
            <Input
              type="password"
              value={totalpass.client_secret}
              onChange={(e) => setTotalpass((p) => ({ ...p, client_secret: e.target.value }))}
              placeholder="Chave para assinar as requisições"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Gym Unit ID / Código da Academia</Label>
            <Input
              value={totalpass.identificador}
              onChange={(e) => setTotalpass((p) => ({ ...p, identificador: e.target.value }))}
              placeholder="Número do contrato da unidade"
            />
          </div>
          <Button
            disabled={salvarCredencial.isPending}
            onClick={() => salvarCredencial.mutate({ parceiro: "totalpass", form: totalpass })}
          >
            {salvarCredencial.isPending ? "Salvando..." : "Salvar credenciais TotalPass"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DoorOpen className="h-4 w-4" /> Mapeamento das Catracas (Hardware)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Para qual dispositivo físico enviar o comando de abertura. Cadastre os dispositivos em{" "}
            <strong>Catracas</strong> primeiro — eles aparecem aqui para mapear o hardware.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {catracas.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              Nenhuma catraca cadastrada ainda.
            </p>
          ) : (
            catracas.map((c) => {
              const form = hardwareForms[c.id] ?? {
                driver: "",
                ip_address: "",
                porta: "",
                delay_liberacao_seg: "4",
              };
              return (
                <div key={c.id} className="rounded-lg border border-border p-3 space-y-2.5">
                  <p className="font-medium text-sm">
                    {c.nome}
                    {c.localizacao && <span className="text-muted-foreground"> — {c.localizacao}</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Fabricante / Driver</Label>
                      <Select
                        value={form.driver}
                        onValueChange={(v) =>
                          setHardwareForms((p) => ({ ...p, [c.id]: { ...form, driver: v as Driver } }))
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(DRIVER_LABEL) as Driver[]).map((d) => (
                            <SelectItem key={d} value={d}>
                              {DRIVER_LABEL[d]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">ID do Dispositivo / Ponto de Acesso</Label>
                      <Input value={c.nome} disabled className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">IP / Endereço da Catraca</Label>
                      <Input
                        className="h-9"
                        value={form.ip_address}
                        onChange={(e) =>
                          setHardwareForms((p) => ({ ...p, [c.id]: { ...form, ip_address: e.target.value } }))
                        }
                        placeholder="192.168.0.10"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Porta</Label>
                      <Input
                        className="h-9"
                        type="number"
                        value={form.porta}
                        onChange={(e) => setHardwareForms((p) => ({ ...p, [c.id]: { ...form, porta: e.target.value } }))}
                        placeholder="80"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs">Tempo de Liberação — Delay (segundos)</Label>
                      <Input
                        className="h-9"
                        type="number"
                        min={1}
                        max={30}
                        value={form.delay_liberacao_seg}
                        onChange={(e) =>
                          setHardwareForms((p) => ({ ...p, [c.id]: { ...form, delay_liberacao_seg: e.target.value } }))
                        }
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={salvarHardware.isPending}
                    onClick={() => salvarHardware.mutate({ id: c.id, form })}
                  >
                    Salvar mapeamento
                  </Button>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
