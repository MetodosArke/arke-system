import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAtacadoReferencia, type NivelAtacado } from "@/hooks/useAtacadoReferencia";
import { useTaxaProcessamento } from "@/hooks/useTaxaProcessamento";
import { conferirAtacado, dividirCobranca } from "@/lib/repasse";
import { decimal, lerReais, reais } from "@/lib/numeros";

const ROTULO_PLANO: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
  redes: "Redes (até 3 unidades)",
  custom: "Custom",
  autonomo: "Profissional autônomo",
};
const ORDEM = ["growth", "enterprise", "redes", "custom", "autonomo", "starter"];

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
          Mensalidade da assinatura recorrente de cada academia, criada quando ela conclui o onboarding. Limite vazio é plano sem teto
          de alunos. A academia recebe o limite do plano quando entra nele; mudar o limite aqui vale para quem entrar depois. Custom e autônomo não têm preço de tabela: o valor é definido
          na ficha da organização.
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
              placeholder="sem teto"
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

const ROTULO_NIVEL: Record<string, string> = { integrado: "Integrado", elite: "Elite" };

/**
 * Tabela de atacado de referência do Método ARKE: por nível, quanto a ArkeFit
 * fica de cada aluno e o preço sugerido ao aluno.
 *
 * É o ponto de partida da negociação, e não o repasse que vale na cobrança:
 * esse é o de cada academia (Repasse do Método, na ficha da organização), onde
 * um botão aplica esta tabela. Academia sem repasse negociado continua sem
 * cobrar o Método — cair aqui por omissão cobraria o aluno com uma divisão que
 * ninguém combinou.
 */
export function AtacadoMetodo() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: niveis } = useAtacadoReferencia();
  const { data: taxa } = useTaxaProcessamento();
  const [valores, setValores] = useState<Record<string, { referencia: string; varejo: string }>>({});

  useEffect(() => {
    if (!niveis) return;
    setValores(
      Object.fromEntries(niveis.map((n) => [n.id, { referencia: decimal(n.referencia, 2), varejo: decimal(n.varejoSugerido, 2) }]))
    );
  }, [niveis]);

  const taxaAtual = taxa ?? { percentual: 0, fixa: 0 };

  const salvar = useMutation({
    mutationFn: async (linhas: { id: NivelAtacado["id"]; referencia: number; varejo: number }[]) => {
      for (const l of linhas) {
        const problema = conferirAtacado(l.referencia, l.varejo, taxaAtual);
        if (problema) throw new Error(`${ROTULO_NIVEL[l.id] ?? l.id}: ${problema}`);
      }
      for (const l of linhas) {
        const { error } = await supabase
          .from("planos_atacado")
          .update({ custo_mensal: l.referencia, valor_sugerido_varejo: l.varejo })
          .eq("id", l.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({
        title: "Tabela de atacado salva",
        description: "Vale para as próximas negociações e para academias novas. O repasse já negociado não muda.",
      });
      void queryClient.invalidateQueries({ queryKey: ["atacado-referencia"] });
      void queryClient.invalidateQueries({ queryKey: ["planos-atacado"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Método ARKE — atacado de referência</CardTitle>
        <CardDescription>
          Quanto a ArkeFit fica de cada aluno do Método, por nível, e o preço sugerido ao aluno. É o ponto de partida da
          negociação: o repasse que vale é o de cada academia, em Repasse do Método na ficha da organização, onde um botão
          aplica esta tabela. Mudar aqui não altera o que já foi negociado nem assinatura já criada. O varejo sugerido
          preenche a precificação das academias criadas daqui em diante.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!niveis && <p className="text-sm text-muted-foreground">Carregando...</p>}
        {niveis && (
          <div className="grid grid-cols-[1fr_7rem_7rem] items-end gap-2 text-xs text-muted-foreground">
            <span>Nível</span>
            <span>Repasse por aluno (R$)</span>
            <span>Varejo sugerido (R$)</span>
          </div>
        )}
        {niveis?.map((n) => {
          const v = valores[n.id] ?? { referencia: "", varejo: "" };
          const referencia = lerReais(v.referencia);
          const varejo = lerReais(v.varejo);
          const problema = conferirAtacado(referencia, varejo, taxaAtual);
          const divisao = dividirCobranca(varejo, { tipo: "fixo", valor: referencia }, taxaAtual);
          const rotulo = ROTULO_NIVEL[n.id] ?? n.id;
          return (
            <div key={n.id} className="space-y-1">
              <div className="grid grid-cols-[1fr_7rem_7rem] items-center gap-2">
                <span className="text-sm">{rotulo}</span>
                <Input
                  aria-label={`Repasse de referência do ${rotulo}`}
                  className="h-8"
                  inputMode="decimal"
                  value={v.referencia}
                  onChange={(e) => setValores((s) => ({ ...s, [n.id]: { ...v, referencia: e.target.value } }))}
                />
                <Input
                  aria-label={`Varejo sugerido do ${rotulo}`}
                  className="h-8"
                  inputMode="decimal"
                  value={v.varejo}
                  onChange={(e) => setValores((s) => ({ ...s, [n.id]: { ...v, varejo: e.target.value } }))}
                />
              </div>
              <p className={`text-[11px] ${problema ? "text-destructive" : "text-muted-foreground"}`}>
                {problema ??
                  `A ${reais(varejo)}: ArkeFit fica com ${reais(divisao.repasseArke)} (${reais(referencia)} + taxa ${reais(
                    divisao.taxaEstimada
                  )}) · academia recebe ${reais(divisao.liquidoAcademia)}`}
              </p>
            </div>
          );
        })}
        {niveis && (
          <Button
            size="sm"
            disabled={salvar.isPending}
            onClick={() =>
              salvar.mutate(
                niveis.map((n) => ({
                  id: n.id,
                  referencia: lerReais(valores[n.id]?.referencia ?? ""),
                  varejo: lerReais(valores[n.id]?.varejo ?? ""),
                }))
              )
            }
          >
            {salvar.isPending ? "Salvando..." : "Salvar tabela"}
          </Button>
        )}
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

/** Para onde vão os contatos da página de vendas. Vazio: para os Super Admins. */
export function EmailComercial() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const { data } = useQuery({
    queryKey: ["email-comercial"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plataforma_textos").select("valor").eq("chave", "comercial_email").maybeSingle();
      if (error) throw error;
      return data?.valor?.trim() ?? "";
    },
  });

  useEffect(() => {
    setEmail(data ?? "");
  }, [data]);

  const salvar = useMutation({
    mutationFn: async (valor: string) => {
      if (valor && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)) throw new Error("E-mail inválido.");
      const { error } = await supabase
        .from("plataforma_textos")
        .upsert({ chave: "comercial_email", valor: valor || null, updated_at: new Date().toISOString() }, { onConflict: "chave" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "E-mail do comercial salvo" });
      void queryClient.invalidateQueries({ queryKey: ["email-comercial"] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Contatos da página de vendas</CardTitle>
        <CardDescription>
          Cada pedido de demonstração vai para este e-mail e fica no Pipeline comercial. Vazio, o aviso vai para os Super Admins.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="email-comercial" className="text-xs">
            E-mail do comercial
          </Label>
          <Input id="email-comercial" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <Button size="sm" onClick={() => salvar.mutate(email.trim())} disabled={salvar.isPending}>
          {salvar.isPending ? "Salvando..." : "Salvar"}
        </Button>
      </CardContent>
    </Card>
  );
}
