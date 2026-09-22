import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROTULO_PLANO: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
  custom: "Custom",
  autonomo: "Profissional autônomo",
};
const ORDEM = ["starter", "growth", "enterprise", "custom", "autonomo"];

const paraNumero = (v: string) => (v.trim() ? Number(v.replace(/\./g, "").replace(",", ".")) : null);

/** Preço de tabela dos planos B2B. Custom e autônomo ficam sem preço: o valor é negociado por academia. */
export function PrecosPlanosB2b() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [valores, setValores] = useState<Record<string, { valor: string; limite: string }>>({});

  const { data: precos = [] } = useQuery({
    queryKey: ["planos-b2b-precos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("planos_b2b_precos").select("plano, valor_mensal, limite_alunos");
      if (error) throw error;
      return [...data].sort((a, b) => ORDEM.indexOf(a.plano) - ORDEM.indexOf(b.plano));
    },
  });

  useEffect(() => {
    setValores(
      Object.fromEntries(
        precos.map((p) => [
          p.plano,
          { valor: p.valor_mensal ? String(p.valor_mensal).replace(".", ",") : "", limite: p.limite_alunos ? String(p.limite_alunos) : "" },
        ])
      )
    );
  }, [precos]);

  const salvar = useMutation({
    mutationFn: async () => {
      for (const p of precos) {
        const v = valores[p.plano];
        const valor = paraNumero(v?.valor ?? "");
        const limite = v?.limite.trim() ? Number(v.limite) : null;
        if ((valor !== null && !(valor > 0)) || (limite !== null && !(limite > 0))) throw new Error(`Valor inválido em ${ROTULO_PLANO[p.plano]}.`);
        const { error } = await supabase
          .from("planos_b2b_precos")
          .update({ valor_mensal: valor, limite_alunos: limite, updated_at: new Date().toISOString() })
          .eq("plano", p.plano);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Preços salvos", description: "Valem para assinaturas novas; as já criadas mantêm o valor no Asaas." });
      void queryClient.invalidateQueries({ queryKey: ["planos-b2b-precos"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Planos B2B — preço de tabela</CardTitle>
        <CardDescription>
          Mensalidade da assinatura recorrente de cada academia, criada quando ela conclui o onboarding. Custom e autônomo não têm
          preço de tabela: o valor é definido na ficha da organização.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {precos.map((p) => (
          <div key={p.plano} className="grid grid-cols-[1fr_7rem_6rem] items-center gap-2">
            <span className="text-sm">{ROTULO_PLANO[p.plano] ?? p.plano}</span>
            <Input
              aria-label={`Mensalidade ${ROTULO_PLANO[p.plano]}`}
              className="h-8"
              inputMode="decimal"
              placeholder="R$"
              value={valores[p.plano]?.valor ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [p.plano]: { ...v[p.plano], valor: e.target.value } }))}
            />
            <Input
              aria-label={`Limite de alunos ${ROTULO_PLANO[p.plano]}`}
              className="h-8"
              inputMode="numeric"
              placeholder="alunos"
              value={valores[p.plano]?.limite ?? ""}
              onChange={(e) => setValores((v) => ({ ...v, [p.plano]: { ...v[p.plano], limite: e.target.value } }))}
            />
          </div>
        ))}
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando..." : "Salvar preços"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Canal do botão "falar com o suporte" do onboarding. Sem valor, o botão não aparece. */
export function CanaisSuporte() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");

  const { data } = useQuery({
    queryKey: ["canais-suporte"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plataforma_textos").select("chave, valor").in("chave", ["suporte_whatsapp", "suporte_email"]);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((l) => [l.chave, l.valor?.trim() || null])) as Record<string, string | null>;
    },
  });

  useEffect(() => {
    setWhatsapp(data?.suporte_whatsapp ?? "");
    setEmail(data?.suporte_email ?? "");
  }, [data]);

  const salvar = useMutation({
    mutationFn: async () => {
      const numero = whatsapp.replace(/\D/g, "");
      if (numero && (numero.length < 12 || numero.length > 13)) throw new Error("WhatsApp com DDI e DDD, ex.: 5511999999999.");
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("E-mail inválido.");
      for (const [chave, valor] of [
        ["suporte_whatsapp", numero || null],
        ["suporte_email", email.trim() || null],
      ] as const) {
        const { error } = await supabase.from("plataforma_textos").update({ valor, updated_at: new Date().toISOString() }).eq("chave", chave);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Canal de suporte salvo" });
      void queryClient.invalidateQueries({ queryKey: ["canais-suporte"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Canal de suporte</CardTitle>
        <CardDescription>Aparece como "falar com o suporte" em cada etapa do onboarding das academias.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="suporte-whatsapp" className="text-xs">
              WhatsApp (com DDI)
            </Label>
            <Input id="suporte-whatsapp" inputMode="tel" placeholder="5511999999999" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="suporte-email" className="text-xs">
              E-mail
            </Label>
            <Input id="suporte-email" type="email" placeholder="suporte@arkefit.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando..." : "Salvar canal"}
        </Button>
      </CardContent>
    </Card>
  );
}
