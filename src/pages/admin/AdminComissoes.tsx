import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Percent } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type Papel = Extract<Enums<"app_role">, "gestor" | "professor" | "nutricionista" | "recepcao">;
type TipoEvento = Enums<"comissao_tipo_evento">;

const PAPEL_LABEL: Record<Papel, string> = {
  gestor: "Gestor",
  professor: "Personal",
  nutricionista: "Nutricionista",
  recepcao: "Recepção",
};

const PAPEIS: Papel[] = ["gestor", "professor", "nutricionista", "recepcao"];

const TIPO_EVENTO_LABEL: Record<TipoEvento, string> = {
  matricula_academia: "Matrícula em plano da academia",
  adesao_metodo_arke: "Adesão ao Método ARKE",
};

const TIPOS_EVENTO: TipoEvento[] = ["matricula_academia", "adesao_metodo_arke"];

interface ConfigForm {
  percentual: string;
  valor_fixo: string;
  ativo: boolean;
  id: string | null;
}

const FORM_VAZIO: ConfigForm = { percentual: "", valor_fixo: "", ativo: true, id: null };

export default function AdminComissoes() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formularios, setFormularios] = useState<Record<string, ConfigForm>>({});

  const chave = (papel: Papel, tipo: TipoEvento) => `${papel}:${tipo}`;

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["staff-comissoes-config", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff_comissoes_config").select("*").eq("organization_id", organization!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: lancamentos = [] } = useQuery({
    queryKey: ["staff-comissoes-lancamentos", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_comissoes_lancamentos")
        .select("id, user_id, tipo_evento, valor_base, valor_comissao, status, competencia, created_at")
        .eq("organization_id", organization!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;

      const userIds = Array.from(new Set(data?.map((l) => l.user_id) ?? []));
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));

      return (data ?? []).map((l) => ({ ...l, nome: nomeByUserId.get(l.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const configByChave = new Map(configs.map((c) => [chave(c.papel as Papel, c.tipo_evento), c]));

  const getForm = (papel: Papel, tipo: TipoEvento): ConfigForm => {
    const k = chave(papel, tipo);
    if (formularios[k]) return formularios[k];
    const existente = configByChave.get(k);
    return existente
      ? {
          id: existente.id,
          percentual: existente.percentual != null ? String(existente.percentual) : "",
          valor_fixo: existente.valor_fixo != null ? String(existente.valor_fixo) : "",
          ativo: existente.ativo,
        }
      : { ...FORM_VAZIO };
  };

  const setForm = (papel: Papel, tipo: TipoEvento, patch: Partial<ConfigForm>) => {
    const k = chave(papel, tipo);
    setFormularios((f) => ({ ...f, [k]: { ...getForm(papel, tipo), ...patch } }));
  };

  const salvar = useMutation({
    mutationFn: async ({ papel, tipo }: { papel: Papel; tipo: TipoEvento }) => {
      if (!organization) return;
      const form = getForm(papel, tipo);
      const percentual = form.percentual.trim() ? Number(form.percentual.replace(",", ".")) : null;
      const valorFixo = form.valor_fixo.trim() ? Number(form.valor_fixo.replace(",", ".")) : null;
      const { error } = await supabase.from("staff_comissoes_config").upsert(
        {
          organization_id: organization.id,
          papel,
          tipo_evento: tipo,
          percentual,
          valor_fixo: valorFixo,
          ativo: form.ativo,
        },
        { onConflict: "organization_id,papel,tipo_evento" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Regra de comissão salva" });
      void queryClient.invalidateQueries({ queryKey: ["staff-comissoes-config", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const marcarPago = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("staff_comissoes_lancamentos").update({ status: "pago" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["staff-comissoes-lancamentos", organization?.id] }),
    onError: (error: Error) => toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <Percent className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Comissões</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Regra por papel — quando alguém desse papel registra uma matrícula ou uma adesão, o lançamento é gerado
        automaticamente. Sem regra configurada (ou com percentual/valor em branco), nenhuma comissão é gerada.
      </p>

      {TIPOS_EVENTO.map((tipo) => (
        <Card key={tipo}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{TIPO_EVENTO_LABEL[tipo]}</CardTitle>
            <CardDescription>Comissão = (valor do evento × percentual) + valor fixo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
            {!isLoading &&
              PAPEIS.map((papel) => {
                const form = getForm(papel, tipo);
                return (
                  <div key={papel} className="flex items-center gap-3 flex-wrap border-b border-border pb-3 last:border-0 last:pb-0">
                    <span className="text-sm font-medium w-28 shrink-0">{PAPEL_LABEL[papel]}</span>
                    <div className="flex items-center gap-1.5">
                      <Input
                        className="w-20 h-8"
                        placeholder="%"
                        inputMode="decimal"
                        value={form.percentual}
                        onChange={(e) => setForm(papel, tipo, { percentual: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <span className="text-xs text-muted-foreground">+</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">R$</span>
                      <Input
                        className="w-24 h-8"
                        placeholder="0,00"
                        inputMode="decimal"
                        value={form.valor_fixo}
                        onChange={(e) => setForm(papel, tipo, { valor_fixo: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Switch checked={form.ativo} onCheckedChange={(v) => setForm(papel, tipo, { ativo: v })} />
                      <span className="text-xs text-muted-foreground">Ativa</span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => salvar.mutate({ papel, tipo })} disabled={salvar.isPending}>
                      Salvar
                    </Button>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Lançamentos recentes</CardTitle>
        </CardHeader>
        <CardContent>
          {lancamentos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma comissão gerada ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lancamentos.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.nome}</TableCell>
                    <TableCell className="text-xs">{TIPO_EVENTO_LABEL[l.tipo_evento as TipoEvento]}</TableCell>
                    <TableCell>R$ {Number(l.valor_comissao).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={l.status === "pago" ? "default" : "outline"}>
                        {l.status === "pago" ? "Pago" : "Pendente"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {l.status === "pendente" && (
                        <Button size="sm" variant="ghost" onClick={() => marcarPago.mutate(l.id)} disabled={marcarPago.isPending}>
                          Marcar pago
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
