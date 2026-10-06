import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { erroDadosResponsavel, type PropositoResponsavel } from "@/lib/menorDeIdade";
import { emPerfilSimulado } from "@/lib/impersonation";
import { AvisoPerfilSimulado } from "@/components/AvisoPerfilSimulado";
import { chaveMenorDeIdade, type PedidoResponsavel as Pedido } from "@/components/responsavel/useMenorDeIdade";

type Envio = { nome: string; email: string };

/**
 * O pedido de aceite ao responsável legal: nome e e-mail dele, e a função
 * `responsavel-pedido` manda o link. Usado pelo próprio aluno no app (todos os
 * propósitos que existem para ele) e pela recepção na ficha (só a digital e o
 * rosto, para o termo impresso). Quem pede nunca vê o link: ele só existe no
 * e-mail do responsável.
 */
export function PedidoResponsavel({
  alunoId,
  propositos,
  pedidoAberto,
  emailDoAluno,
  pelaAcademia = false,
}: {
  alunoId: string;
  propositos: PropositoResponsavel[];
  pedidoAberto: Pedido | null;
  /** O e-mail de login do aluno, quando é ele quem pede: o do responsável tem de ser outro. */
  emailDoAluno?: string | null;
  pelaAcademia?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const simulado = emPerfilSimulado();
  const [form, setForm] = useState<Envio>({ nome: "", email: "" });

  const enviar = useMutation({
    mutationFn: async (dados: Envio) => {
      const erro = erroDadosResponsavel({ ...dados, emailDoAluno });
      if (erro) throw new Error(erro);
      const { error } = await supabase.functions.invoke("responsavel-pedido", {
        body: { aluno_id: alunoId, nome: dados.nome.trim(), email: dados.email.trim(), propositos },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível enviar o pedido."));
    },
    onSuccess: () => {
      toast({
        title: "Pedido enviado",
        description: "O responsável recebeu um e-mail com o link para ler e autorizar. O link vale 7 dias.",
      });
      setForm({ nome: "", email: "" });
      void queryClient.invalidateQueries({ queryKey: chaveMenorDeIdade(alunoId) });
    },
    onError: (e: Error) => toast({ title: "Pedido não enviado", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-2">
      {pedidoAberto && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Pedido enviado a {pedidoAberto.responsavel_nome} ({pedidoAberto.responsavel_email}) em{" "}
            {formatarDataBR(pedidoAberto.enviado_em)}, válido até {formatarDataBR(pedidoAberto.expira_em)}. Se o e-mail
            não chegou (confira o spam), envie de novo: o link anterior deixa de valer.
          </span>
        </p>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          enviar.mutate(form);
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`responsavel-nome-${alunoId}`} className="text-xs">
              Nome completo do responsável
            </Label>
            <Input
              id={`responsavel-nome-${alunoId}`}
              value={form.nome}
              autoComplete="off"
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`responsavel-email-${alunoId}`} className="text-xs">
              E-mail do responsável
            </Label>
            <Input
              id={`responsavel-email-${alunoId}`}
              type="email"
              value={form.email}
              autoComplete="off"
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          variant={pedidoAberto ? "outline" : "default"}
          disabled={!form.nome.trim() || !form.email.trim() || enviar.isPending || simulado || propositos.length === 0}
        >
          {enviar.isPending
            ? "Enviando..."
            : pedidoAberto
              ? "Enviar de novo"
              : pelaAcademia
                ? "Enviar o link ao responsável"
                : "Pedir a autorização"}
        </Button>
      </form>
      {simulado && <AvisoPerfilSimulado />}
    </div>
  );
}
