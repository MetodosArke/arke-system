import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { modeloContratoMatricula } from "@/lib/parq";
import { AlertTriangle } from "lucide-react";
import { formatarDataBR } from "@/lib/dataBrasilia";

/**
 * Contrato de matrícula da academia. Nunca é editado no lugar: publicar cria
 * uma versão nova e aposenta a anterior — a assinatura de cada aluno aponta
 * para o texto exato que ele assinou. Alunos que assinaram a versão antiga
 * são convidados a assinar a nova no app.
 */
export function ContratoMatriculaPainel() {
  const { organization, organizationRole, hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [titulo, setTitulo] = useState("Contrato de matrícula");
  const [conteudo, setConteudo] = useState("");
  const podeEditar = organizationRole === "gestor" || hasRole("superadmin");

  const { data } = useQuery({
    queryKey: ["contrato-matricula", organization?.id],
    queryFn: async () => {
      const { data: versoes, error } = await supabase
        .from("contratos_matricula")
        .select("id, versao, titulo, conteudo, ativo, criado_em")
        .eq("organization_id", organization!.id)
        .order("versao", { ascending: false });
      if (error) throw error;
      const ativo = versoes.find((v) => v.ativo) ?? null;
      let assinaturas = 0;
      if (ativo) {
        const { count } = await supabase
          .from("aluno_assinaturas_contrato")
          .select("id", { count: "exact", head: true })
          .eq("contrato_id", ativo.id);
        assinaturas = count ?? 0;
      }
      return { versoes, ativo, assinaturas };
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (data?.ativo) {
      setTitulo(data.ativo.titulo);
      setConteudo(data.ativo.conteudo);
    }
  }, [data?.ativo]);

  const publicar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("publicar_contrato_matricula", {
        _organization_id: organization!.id,
        _titulo: titulo,
        _conteudo: conteudo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Contrato publicado", description: "Os alunos são convidados a assinar no app." });
      void queryClient.invalidateQueries({ queryKey: ["contrato-matricula", organization?.id] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível publicar", description: e.message, variant: "destructive" }),
  });

  const mudou = !data?.ativo || data.ativo.conteudo !== conteudo || data.ativo.titulo !== titulo;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contrato de matrícula</CardTitle>
        <CardDescription>
          O aluno assina no app, com o nome digitado, data, hora e o texto exato registrados (assinatura eletrônica simples, Lei
          14.063/2020). Cada alteração vira uma versão nova. Revise o texto com o advogado da academia.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.ativo ? (
          <p className="text-xs text-muted-foreground">
            Versão {data.ativo.versao} em vigor desde {formatarDataBR(data.ativo.criado_em)} · {data.assinaturas}{" "}
            assinatura(s)
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Nenhum contrato publicado ainda.</p>
        )}
        <div className="space-y-1">
          <Label htmlFor="contrato-titulo" className="text-xs">
            Título
          </Label>
          <Input id="contrato-titulo" value={titulo} disabled={!podeEditar} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="contrato-texto" className="text-xs">
            Texto (use # para títulos e - para listas)
          </Label>
          <Textarea id="contrato-texto" rows={14} value={conteudo} disabled={!podeEditar} onChange={(e) => setConteudo(e.target.value)} />
        </div>
        {podeEditar && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!mudou || conteudo.trim().length < 50 || publicar.isPending} onClick={() => publicar.mutate()}>
                {publicar.isPending ? "Publicando..." : data?.ativo ? "Publicar nova versão" : "Publicar contrato"}
              </Button>
              {!conteudo.trim() && (
                <Button variant="outline" onClick={() => setConteudo(modeloContratoMatricula(organization?.nome ?? "Academia"))}>
                  Começar pelo modelo ARKE
                </Button>
              )}
            </div>
            {/*
              Ressalva determinada pelo parecer juridico de 23/09/2026 (item
              3.7). Fornecer minuta contratual que um terceiro usa de verdade
              pode gerar tese de responsabilidade solidaria por clausula
              abusiva ou vicio na prestacao (CDC, arts. 14 e 25). O aviso fica
              ao lado do botao que oferece o modelo, e nao numa pagina de
              ajuda: quem precisa le-lo e quem esta prestes a usa-lo.
            */}
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                O modelo de contrato fornecido pela ARKE possui caráter <strong>meramente sugestivo e de
                ponto de partida</strong>. A academia é a única responsável por revisar, adequar e validar a
                minuta junto à sua própria assessoria jurídica local.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
