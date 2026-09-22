import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERGUNTAS_PARQ, ROTULO_ATESTADO, situacaoAtestado } from "@/lib/parq";

/**
 * Documentos da matrícula na ficha do aluno: contrato assinado (versão e data),
 * PAR-Q (quais perguntas tiveram "sim") e atestado — a equipe abre o arquivo e
 * registra até quando vale. A validade só a equipe grava (o banco recusa do
 * aluno), e o alerta de vencimento sai dela.
 */
export function DocumentosMatriculaAluno({ alunoId, organizationId }: { alunoId: string; organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [validade, setValidade] = useState("");

  const { data } = useQuery({
    queryKey: ["documentos-matricula-ficha", alunoId],
    queryFn: async () => {
      const [{ data: contrato }, { data: assinaturas }, { data: parq }] = await Promise.all([
        supabase.from("contratos_matricula").select("id, versao").eq("organization_id", organizationId).eq("ativo", true).maybeSingle(),
        supabase
          .from("aluno_assinaturas_contrato")
          .select("contrato_id, assinado_em, nome_digitado, contratos_matricula(versao)")
          .eq("aluno_id", alunoId)
          .order("assinado_em", { ascending: false }),
        supabase
          .from("aluno_parq")
          .select("respostas, algum_sim, respondido_em, atestado_caminho, atestado_validade")
          .eq("aluno_id", alunoId)
          .maybeSingle(),
      ]);
      return { contrato, assinaturas: assinaturas ?? [], parq };
    },
  });

  const salvarValidade = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("aluno_parq").update({ atestado_validade: validade || null }).eq("aluno_id", alunoId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Validade do atestado registrada" });
      void queryClient.invalidateQueries({ queryKey: ["documentos-matricula-ficha", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const abrirAtestado = async () => {
    if (!data?.parq?.atestado_caminho) return;
    const { data: url, error } = await supabase.storage.from("atestados").createSignedUrl(data.parq.atestado_caminho, 120);
    if (error || !url) {
      toast({ title: "Não foi possível abrir o atestado", variant: "destructive" });
      return;
    }
    window.open(url.signedUrl, "_blank", "noopener");
  };

  if (!data) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  const assinaturaVigente = data.assinaturas.find((a) => a.contrato_id === data.contrato?.id);
  const ultima = data.assinaturas[0];
  const respostas = (data.parq?.respostas as boolean[] | null) ?? [];
  const sims = respostas.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  const atestado = situacaoAtestado(data.parq ?? null);

  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-muted-foreground">Contrato: </span>
        {!data.contrato
          ? "a academia ainda não publicou"
          : assinaturaVigente
            ? `assinado em ${new Date(assinaturaVigente.assinado_em).toLocaleDateString("pt-BR")} (versão ${data.contrato.versao})`
            : ultima
              ? `assinou a versão ${(ultima.contratos_matricula as { versao: number } | null)?.versao ?? "anterior"}; falta a vigente`
              : "não assinado"}
      </p>
      <div>
        <span className="text-muted-foreground">PAR-Q: </span>
        {!data.parq ? (
          "não respondido"
        ) : sims.length === 0 ? (
          "sem nenhum sim"
        ) : (
          <>
            {sims.length} resposta(s) "sim"
            <ul className="list-disc pl-5 text-xs text-muted-foreground mt-1">
              {sims.map((i) => (
                <li key={i}>{PERGUNTAS_PARQ[i]}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      {atestado !== "nao_precisa" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant={atestado === "valido" ? "default" : atestado === "vence_logo" ? "outline" : "destructive"}>{ROTULO_ATESTADO[atestado]}</Badge>
            {data.parq?.atestado_validade && (
              <span className="text-xs text-muted-foreground">até {new Date(`${data.parq.atestado_validade}T12:00:00`).toLocaleDateString("pt-BR")}</span>
            )}
            {data.parq?.atestado_caminho && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void abrirAtestado()}>
                Ver atestado
              </Button>
            )}
          </div>
          {data.parq?.atestado_caminho && (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="Validade do atestado" className="h-8 w-40" value={validade} onChange={(e) => setValidade(e.target.value)} />
              <Button size="sm" variant="outline" disabled={!validade || salvarValidade.isPending} onClick={() => salvarValidade.mutate()}>
                Registrar validade
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
