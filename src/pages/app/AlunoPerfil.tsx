import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsentimentoSentinela } from "@/components/sentinela/SentinelaAnamnese";
import { ConsentimentoBiometria } from "@/components/catraca/ConsentimentoBiometria";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, Ruler, Droplets, Wallet, Sparkles, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Tables } from "@/integrations/supabase/types";
import { CartaoAssinatura } from "@/components/pagamento/CartaoAssinatura";
import { PagamentosAcademia } from "@/components/pagamento/PagamentosAcademia";

export default function AlunoPerfil() {
  const { user, profile, organization, alunoId, signOut, planoAluno } = useAuth();
  // No Método ARKE a meta de hidratação é do mentor, não do aluno (decisão
  // de 23/09/2026): lá ela faz parte de um acompanhamento prescrito. A RPC
  // recusa de qualquer forma; a tela existe para o aluno entender o porquê
  // em vez de tentar e levar um erro.
  const metaAguaEhDoMentor = planoAluno !== "free";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [metaAguaInput, setMetaAguaInput] = useState("2000");

  const { data: metaAguaMl } = useQuery({
    queryKey: ["aluno-meta-agua", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("alunos").select("meta_agua_ml").eq("id", alunoId!).single();
      if (error) throw error;
      return data.meta_agua_ml;
    },
    enabled: !!alunoId,
  });

  useEffect(() => {
    if (metaAguaMl != null) setMetaAguaInput(String(metaAguaMl));
  }, [metaAguaMl]);

  const salvarMetaAgua = useMutation({
    mutationFn: async () => {
      const valor = Number(metaAguaInput);
      if (!Number.isFinite(valor) || valor < 500 || valor > 8000) {
        throw new Error("Informe um valor entre 500ml e 8000ml.");
      }
      const { error } = await supabase.rpc("atualizar_meta_agua_aluno", { _meta_ml: valor });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Meta de água atualizada!" });
      void queryClient.invalidateQueries({ queryKey: ["aluno-meta-agua", alunoId] });
    },
    onError: (error: Error) => toast({ title: "Erro ao salvar meta", description: error.message, variant: "destructive" }),
  });

  // Forma de pagamento da assinatura do Método. O RLS de aluno_assinaturas
  // deixa o aluno ler só a própria linha.
  const { data: pagamento } = useQuery({
    queryKey: ["aluno-pagamento", alunoId],
    queryFn: async () => {
      const [{ data: assinatura }, { data: dadosPessoais }] = await Promise.all([
        supabase
          .from("aluno_assinaturas")
          .select("status, asaas_subscription_id, forma_pagamento, cartao_final, cartao_bandeira, cartao_recusado_em")
          .eq("aluno_id", alunoId!)
          .maybeSingle(),
        supabase.from("profiles").select("cpf, phone").eq("user_id", user!.id).maybeSingle(),
      ]);
      return { assinatura, dadosPessoais };
    },
    enabled: !!alunoId && !!user?.id,
  });

  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["minhas-avaliacoes-fisicas", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avaliacoes_fisicas")
        .select("*")
        .eq("aluno_id", alunoId!)
        .order("data_avaliacao", { ascending: false });
      if (error) throw error;
      return data as Tables<"avaliacoes_fisicas">[];
    },
    enabled: !!alunoId,
  });

  const initials = profile?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-md mx-auto space-y-4">
      <Card>
        <CardHeader className="items-center text-center">
          <Avatar className="h-20 w-20">
            <AvatarImage src={profile?.avatar_url || undefined} />
            <AvatarFallback className="text-xl">{initials || "AR"}</AvatarFallback>
          </Avatar>
          <CardTitle>{profile?.full_name || "Aluno"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between border-b border-border py-2">
              <span className="text-muted-foreground">Academia</span>
              <span className="font-medium">{organization?.nome ?? "—"}</span>
            </div>
          </div>
          <Button variant="destructive" className="w-full" onClick={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>

      {alunoId && organization?.id && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-primary" /> Privacidade
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ConsentimentoSentinela alunoId={alunoId} organizationId={organization.id} />
            <ConsentimentoBiometria alunoId={alunoId} organizationId={organization.id} />
          </CardContent>
        </Card>
      )}

      {alunoId && <PagamentosAcademia alunoId={alunoId} />}

      {pagamento?.assinatura && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-600" /> Pagamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CartaoAssinatura
              alunoId={alunoId!}
              assinatura={pagamento.assinatura}
              titularPadrao={{
                nome: profile?.full_name ?? "",
                email: user?.email ?? "",
                cpf: pagamento.dadosPessoais?.cpf ?? "",
                telefone: pagamento.dadosPessoais?.phone ?? "",
              }}
              onSalvo={() => void queryClient.invalidateQueries({ queryKey: ["aluno-pagamento", alunoId] })}
              onSucesso={(m) => toast({ title: "Cartão cadastrado", description: m })}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Droplets className="h-4 w-4 text-blue-500" /> Meta de Água Diária
          </CardTitle>
        </CardHeader>
        {metaAguaEhDoMentor ? (
          <CardContent className="space-y-1">
            <p className="text-sm font-medium">{metaAguaMl ?? 2000} ml por dia</p>
            <p className="text-xs text-muted-foreground">
              No Método ARKE quem define a sua meta de hidratação é o seu mentor. Fale com ele pelo
              chat se quiser ajustar.
            </p>
          </CardContent>
        ) : (
          <CardContent className="flex items-center gap-2">
            <Input
              type="number"
              min={500}
              max={8000}
              step={100}
              value={metaAguaInput}
              onChange={(e) => setMetaAguaInput(e.target.value)}
              className="flex-1"
              aria-label="Meta de água diária em mililitros"
            />
            <span className="text-sm text-muted-foreground">ml</span>
            <Button
              size="sm"
              disabled={salvarMetaAgua.isPending || metaAguaInput === String(metaAguaMl ?? "")}
              onClick={() => salvarMetaAgua.mutate()}
            >
              {salvarMetaAgua.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </CardContent>
        )}
      </Card>

      {avaliacoes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Ruler className="h-4 w-4" /> Histórico de Avaliações Físicas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {avaliacoes.map((av) => (
              <div key={av.id} className="rounded-lg border border-border p-3 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {new Date(av.data_avaliacao).toLocaleDateString("pt-BR")}
                  </span>
                  {av.imc != null && <span className="text-xs text-muted-foreground">IMC {av.imc}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  {av.peso_kg != null && <span>Peso: {av.peso_kg}kg</span>}
                  {av.altura_cm != null && <span>Altura: {av.altura_cm}cm</span>}
                  {av.percentual_gordura != null && <span>Gordura: {av.percentual_gordura}%</span>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
