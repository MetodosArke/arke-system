import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Rocket, Building2, Wallet, Link2, Copy, CheckCircle2 } from "lucide-react";
import type { Enums } from "@/integrations/supabase/types";

type TipoNegocio = Extract<Enums<"organization_tipo">, "academia" | "studio">;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

const TOTAL_PASSOS = 3;

export default function AdminOnboarding() {
  const { organization, refreshOrganization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [passo, setPasso] = useState(1);

  const { data: org } = useQuery({
    queryKey: ["organizacao-onboarding", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("nome, slug, asaas_wallet_id, tipo")
        .eq("id", organization!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const [nome, setNome] = useState("");
  const [slug, setSlug] = useState("");
  const [walletId, setWalletId] = useState("");
  const [tipoNegocio, setTipoNegocio] = useState<TipoNegocio>("academia");

  useEffect(() => {
    if (org) {
      setNome(org.nome ?? "");
      setSlug(org.slug ?? "");
      setWalletId(org.asaas_wallet_id ?? "");
      if (org.tipo === "academia" || org.tipo === "studio") setTipoNegocio(org.tipo);
    }
  }, [org]);

  const salvarPerfil = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Nenhuma organização vinculada.");
      const slugNormalizado = slugify(slug);
      if (!SLUG_RE.test(slugNormalizado)) {
        throw new Error("Slug inválido. Use apenas letras minúsculas, números e hífens.");
      }
      const podeEscolherTipo = org?.tipo === "academia" || org?.tipo === "studio";
      const { error } = await supabase
        .from("organizations")
        .update(podeEscolherTipo ? { nome, slug: slugNormalizado, tipo: tipoNegocio } : { nome, slug: slugNormalizado })
        .eq("id", organization.id);
      if (error) {
        if (error.message.includes("duplicate") || error.code === "23505") {
          throw new Error("Esse slug já está em uso por outra academia. Escolha outro.");
        }
        throw error;
      }
      setSlug(slugNormalizado);
    },
    onSuccess: () => {
      toast({ title: "Perfil salvo!" });
      void queryClient.invalidateQueries({ queryKey: ["organizacao-onboarding", organization?.id] });
      void refreshOrganization();
      setPasso(2);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  // Chegar ao passo 3 (via wallet salva ou "Configurar depois") já é o
  // suficiente para considerar o onboarding concluído — encerra o banner
  // que aparece nas Homes até aqui.
  const concluirOnboarding = useMutation({
    mutationFn: async () => {
      if (!organization) return;
      const { error } = await supabase
        .from("organizations")
        .update({ onboarding_completed: true })
        .eq("id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => void refreshOrganization(),
  });

  const salvarWallet = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Nenhuma organização vinculada.");
      const { error } = await supabase
        .from("organizations")
        .update({ asaas_wallet_id: walletId || null, onboarding_completed: true })
        .eq("id", organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Split de pagamento configurado!" });
      void queryClient.invalidateQueries({ queryKey: ["organizacao-onboarding", organization?.id] });
      void refreshOrganization();
      setPasso(3);
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }),
  });

  const linkMatricula = slug ? `${window.location.origin}/#/p/${slug}` : "";

  const copiarLink = async () => {
    try {
      await navigator.clipboard.writeText(linkMatricula);
      toast({ title: "Link copiado!" });
    } catch {
      toast({ title: "Não foi possível copiar", description: "Copie manualmente o link abaixo.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2">
        <Rocket className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Onboarding da Academia</h1>
      </div>
      <Progress value={(passo / TOTAL_PASSOS) * 100} />

      {passo === 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> 1. Perfil da academia
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              O slug define o link público de matrícula dos seus alunos.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="onboarding-nome">Nome da academia</Label>
              <Input id="onboarding-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            {(org?.tipo === "academia" || org?.tipo === "studio") && (
              <div className="space-y-1.5">
                <Label htmlFor="onboarding-tipo">Tipo de negócio</Label>
                <Select value={tipoNegocio} onValueChange={(v) => setTipoNegocio(v as TipoNegocio)}>
                  <SelectTrigger id="onboarding-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="academia">Academia (livre acesso)</SelectItem>
                    <SelectItem value="studio">Studio (turmas fechadas com horário e capacidade)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Studios ganham a Grade Semanal de turmas em Agenda e a catraca passa a exigir
                  agendamento ativo, não só assinatura em dia.
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="onboarding-slug">Slug (link amigável)</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">arkefit.com.br/#/p/</span>
                <Input
                  id="onboarding-slug"
                  value={slug}
                  onChange={(e) => setSlug(slugify(e.target.value))}
                  placeholder="minha-academia"
                />
              </div>
            </div>
            <Button disabled={!nome.trim() || !slug.trim() || salvarPerfil.isPending || !organization} onClick={() => salvarPerfil.mutate()}>
              {salvarPerfil.isPending ? "Salvando..." : "Salvar e continuar"}
            </Button>
          </CardContent>
        </Card>
      )}

      {passo === 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4" /> 2. Split de pagamento (Asaas)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Informe a Wallet ID da academia no Asaas para receber automaticamente a parte líquida de
              cada cobrança dos alunos.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="onboarding-wallet">Wallet ID do Asaas</Label>
              <Input
                id="onboarding-wallet"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
                placeholder="ex.: 22e49670-27e4-4579-a4f4-0dfd42b2e-000"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPasso(1)}>Voltar</Button>
              <Button disabled={salvarWallet.isPending || !organization} onClick={() => salvarWallet.mutate()}>
                {salvarWallet.isPending ? "Salvando..." : "Salvar e continuar"}
              </Button>
              {!walletId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    concluirOnboarding.mutate();
                    setPasso(3);
                  }}
                >
                  Configurar depois
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {passo === 3 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> 3. Tudo pronto!
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Compartilhe o link abaixo com seus alunos para que eles escolham um plano e se matriculem
              sozinhos, direto pelo celular.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-mono truncate flex-1">{linkMatricula || "Configure o slug primeiro"}</span>
              <Button size="sm" variant="outline" disabled={!linkMatricula} onClick={() => void copiarLink()}>
                <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Você pode revisitar essas configurações a qualquer momento em Organização.
            </p>
            <Button variant="outline" onClick={() => setPasso(1)}>Revisar novamente</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
