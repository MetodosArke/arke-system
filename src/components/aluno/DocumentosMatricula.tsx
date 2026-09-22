import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileSignature, HeartPulse, Upload } from "lucide-react";
import { MarkdownSimples } from "@/lib/markdownSimples";
import { PERGUNTAS_PARQ, situacaoAtestado } from "@/lib/parq";

/**
 * Documentos da matrícula que dependem do aluno: assinar o contrato da
 * academia, responder o PAR-Q e, se alguma resposta for "sim", enviar o
 * atestado. Some quando não há nada pendente. Não trava o app; o que trava é
 * só o registro de treino, e só com PAR-Q com "sim" sem atestado conferido
 * (trg_exigir_atestado_para_treinar, decisão de 22/09/2026).
 */
export function DocumentosMatricula() {
  const { alunoId, organization, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [abrir, setAbrir] = useState<"contrato" | "parq" | null>(null);
  const [nome, setNome] = useState("");
  const [concordo, setConcordo] = useState(false);
  const [respostas, setRespostas] = useState<(boolean | null)[]>(PERGUNTAS_PARQ.map(() => null));
  const [enviando, setEnviando] = useState(false);

  const { data } = useQuery({
    queryKey: ["documentos-matricula", alunoId],
    queryFn: async () => {
      const [{ data: contrato }, { data: parq }] = await Promise.all([
        supabase
          .from("contratos_matricula")
          .select("id, titulo, conteudo, versao")
          .eq("organization_id", organization!.id)
          .eq("ativo", true)
          .maybeSingle(),
        supabase.from("aluno_parq").select("id, algum_sim, atestado_validade, atestado_caminho").eq("aluno_id", alunoId!).maybeSingle(),
      ]);
      let assinado = false;
      if (contrato) {
        const { data: assinatura } = await supabase
          .from("aluno_assinaturas_contrato")
          .select("id")
          .eq("aluno_id", alunoId!)
          .eq("contrato_id", contrato.id)
          .maybeSingle();
        assinado = !!assinatura;
      }
      return { contrato, assinado, parq };
    },
    enabled: !!alunoId && !!organization?.id,
  });

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: ["documentos-matricula", alunoId] });

  const assinar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("assinar_contrato_matricula", {
        _aluno_id: alunoId!,
        _contrato_id: data!.contrato!.id,
        _nome: nome,
        _user_agent: navigator.userAgent,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Contrato assinado" });
      setAbrir(null);
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível assinar", description: e.message, variant: "destructive" }),
  });

  const responder = useMutation({
    mutationFn: async () => {
      if (respostas.some((r) => r === null)) throw new Error("Responda todas as perguntas.");
      const { error } = await supabase
        .from("aluno_parq")
        .upsert({ organization_id: organization!.id, aluno_id: alunoId!, respostas, respondido_em: new Date().toISOString() }, { onConflict: "aluno_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Questionário enviado" });
      setAbrir(null);
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível enviar", description: e.message, variant: "destructive" }),
  });

  const enviarAtestado = async (arquivo: File) => {
    if (arquivo.size > 5 * 1024 * 1024) {
      toast({ title: "Arquivo grande demais", description: "Até 5 MB (PDF ou foto).", variant: "destructive" });
      return;
    }
    setEnviando(true);
    const nomeArquivo = arquivo.name.normalize("NFD").replace(/[^\w.-]/g, "_");
    const caminho = `${organization!.id}/${alunoId}/${Date.now()}-${nomeArquivo}`;
    const { error } = await supabase.storage.from("atestados").upload(caminho, arquivo, { contentType: arquivo.type });
    if (!error) {
      const { error: erroParq } = await supabase.from("aluno_parq").update({ atestado_caminho: caminho }).eq("aluno_id", alunoId!);
      if (erroParq) toast({ title: "Arquivo enviado, mas não registrado", description: erroParq.message, variant: "destructive" });
      else toast({ title: "Atestado enviado", description: "A academia confere e registra a validade." });
    } else {
      toast({ title: "Não foi possível enviar", description: error.message, variant: "destructive" });
    }
    setEnviando(false);
    recarregar();
  };

  if (!data) return null;
  const faltaContrato = !!data.contrato && !data.assinado;
  const faltaParq = !data.parq;
  const atestado = situacaoAtestado(data.parq ?? null);
  const faltaAtestado = !faltaParq && (atestado === "falta" || atestado === "vencido") && !(atestado === "falta" && data.parq?.atestado_caminho);
  const aguardandoConferencia = atestado === "falta" && !!data.parq?.atestado_caminho;
  if (!faltaContrato && !faltaParq && !faltaAtestado && !aguardandoConferencia) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Documentos da matrícula</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {faltaContrato && (
          <Button variant="outline" className="w-full justify-start" onClick={() => { setNome(profile?.full_name ?? ""); setConcordo(false); setAbrir("contrato"); }}>
            <FileSignature className="h-4 w-4 mr-2" /> Assinar o contrato da {organization?.nome}
          </Button>
        )}
        {faltaParq && (
          <Button variant="outline" className="w-full justify-start" onClick={() => setAbrir("parq")}>
            <HeartPulse className="h-4 w-4 mr-2" /> Responder o questionário de saúde (1 min)
          </Button>
        )}
        {faltaAtestado && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {atestado === "vencido" ? "Seu atestado médico venceu." : "Pelo questionário, você precisa de um atestado médico liberando a atividade física."}{" "}
              O registro dos treinos volta quando a academia conferir o atestado.
            </p>
            <Label htmlFor="enviar-atestado" className="flex">
              <span className="inline-flex items-center rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                <Upload className="h-4 w-4 mr-2" /> {enviando ? "Enviando..." : "Enviar atestado (PDF ou foto)"}
              </span>
            </Label>
            <input
              id="enviar-atestado"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={enviando}
              onChange={(e) => e.target.files?.[0] && void enviarAtestado(e.target.files[0])}
            />
          </div>
        )}
        {aguardandoConferencia && (
          <p className="text-xs text-muted-foreground">Atestado enviado. Assim que a academia conferir, o registro dos treinos é liberado.</p>
        )}
      </CardContent>

      <Dialog open={abrir === "contrato"} onOpenChange={(v) => !v && setAbrir(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{data.contrato?.titulo}</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border p-3 max-h-[45vh] overflow-y-auto">
            <MarkdownSimples texto={data.contrato?.conteudo ?? ""} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nome-assinatura" className="text-xs">
              Digite seu nome completo para assinar
            </Label>
            <Input id="nome-assinatura" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={concordo} onCheckedChange={(v) => setConcordo(v === true)} className="mt-0.5" />
            <span>Li e concordo com o contrato. Esta é a minha assinatura eletrônica.</span>
          </label>
          <DialogFooter>
            <Button disabled={!concordo || nome.trim().length < 3 || assinar.isPending} onClick={() => assinar.mutate()}>
              {assinar.isPending ? "Assinando..." : "Assinar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={abrir === "parq"} onOpenChange={(v) => !v && setAbrir(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Questionário de prontidão para atividade física</DialogTitle>
          </DialogHeader>
          <ol className="space-y-3">
            {PERGUNTAS_PARQ.map((p, i) => (
              <li key={i} className="space-y-1.5">
                <p className="text-sm">
                  {i + 1}. {p}
                </p>
                <div className="flex gap-2" role="radiogroup" aria-label={`Pergunta ${i + 1}`}>
                  {([true, false] as const).map((v) => (
                    <Button
                      key={String(v)}
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={respostas[i] === v}
                      variant={respostas[i] === v ? "default" : "outline"}
                      onClick={() => setRespostas((r) => r.map((x, j) => (j === i ? v : x)))}
                    >
                      {v ? "Sim" : "Não"}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button disabled={responder.isPending || respostas.some((r) => r === null)} onClick={() => responder.mutate()}>
              {responder.isPending ? "Enviando..." : "Enviar respostas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
