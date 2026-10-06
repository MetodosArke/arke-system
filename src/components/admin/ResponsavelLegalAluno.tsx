import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { exigirGravacao } from "@/lib/gravacao";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatarDataBR, hojeBrasilia } from "@/lib/dataBrasilia";
import { erroDataNascimento, idadeEm, PROPOSITOS_RESPONSAVEL, ROTULO_PROPOSITO, type PropositoResponsavel } from "@/lib/menorDeIdade";
import { chaveMenorDeIdade, useMenorDeIdade } from "@/components/responsavel/useMenorDeIdade";

/**
 * A data de nascimento e o responsável legal do aluno, do lado da academia
 * (decisão de 06/10/2026).
 *
 * - A gestão e a recepção preenchem a data que falta (aluno importado sem ela,
 *   ou que não usa o app) e corrigem a errada — a troca de uma data que já
 *   existia vai para a auditoria, no banco.
 * - Para o menor, mostra o que o responsável autorizou e o pedido em aberto, e
 *   deixa a academia retirar o aceite quando o responsável pede: o
 *   consentimento que dependia dele cai junto, pelo caminho de sempre
 *   (`revogar_aceite_responsavel`).
 */
export function ResponsavelLegalAluno({ alunoId }: { alunoId: string }) {
  const { organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const menor = useMenorDeIdade(alunoId);
  const podeEditar = organizationRole === "gestor" || organizationRole === "recepcao";
  const [editando, setEditando] = useState(false);
  const [data, setData] = useState("");
  const [confirmar, setConfirmar] = useState<PropositoResponsavel | null>(null);

  const atualizar = () => {
    void queryClient.invalidateQueries({ queryKey: chaveMenorDeIdade(alunoId) });
    void queryClient.invalidateQueries({ queryKey: ["aluno-perfil", alunoId] });
  };

  const salvarData = useMutation({
    mutationFn: async (valor: string) => {
      const erro = erroDataNascimento(valor, hojeBrasilia());
      if (erro) throw new Error(erro);
      await exigirGravacao(supabase.from("alunos").update({ data_nascimento: valor }).eq("id", alunoId).select("id"));
    },
    onSuccess: () => {
      toast({ title: "Data de nascimento salva" });
      setEditando(false);
      setData("");
      atualizar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const retirar = useMutation({
    mutationFn: async (proposito: PropositoResponsavel) => {
      const { error } = await supabase.rpc("revogar_aceite_responsavel", { _aluno_id: alunoId, _proposito: proposito });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast({
        title: "Aceite do responsável retirado",
        description: "A autorização que dependia dele também foi retirada.",
      });
      setConfirmar(null);
      atualizar();
      void queryClient.invalidateQueries({ queryKey: ["consentimento-biometrico", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível retirar", description: e.message, variant: "destructive" }),
  });

  if (menor.carregando || menor.falhou) return null;
  const idade = menor.nascimento ? idadeEm(menor.nascimento, hojeBrasilia()) : null;
  const aceites = PROPOSITOS_RESPONSAVEL.map((p) => ({ p, aceite: menor.aceiteVigente(p) })).filter((x) => x.aceite);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {menor.nascimento ? (
          <span className="text-muted-foreground">
            Nascimento: {formatarDataBR(menor.nascimento)}
            {idade !== null ? ` (${idade} anos)` : ""}
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">Data de nascimento não informada.</span>
        )}
        {menor.situacao === "menor" && <Badge variant="outline">Menor de idade</Badge>}
        {podeEditar && !editando && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditando(true)}>
            {menor.nascimento ? "Corrigir" : "Informar"}
          </Button>
        )}
      </div>

      {editando && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvarData.mutate(data);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`nascimento-admin-${alunoId}`} className="text-xs">
              Data de nascimento
            </Label>
            <Input
              id={`nascimento-admin-${alunoId}`}
              type="date"
              min="1900-01-01"
              max={hojeBrasilia()}
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="h-8 w-40"
            />
          </div>
          <Button type="submit" size="sm" className="h-8" disabled={!data || salvarData.isPending}>
            Salvar
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditando(false)}>
            Cancelar
          </Button>
        </form>
      )}

      {menor.situacao === "menor" && (
        <div className="space-y-1 rounded-md border p-2">
          <p className="font-medium">Responsável legal</p>
          {aceites.length === 0 && (
            <p className="text-muted-foreground">
              Nada autorizado ainda. Saúde, digital, rosto e inteligência artificial esperam o aceite dele, pelo link
              que o aluno pede no app (ou a recepção, para a digital, no termo impresso).
            </p>
          )}
          {aceites.map(({ p, aceite }) => (
            <div key={p} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {ROTULO_PROPOSITO[p]}: {aceite!.responsavel_nome} ({aceite!.responsavel_email}), em{" "}
                {formatarDataBR(aceite!.aceito_em)}
              </span>
              {confirmar === p ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-xs"
                    disabled={retirar.isPending}
                    onClick={() => retirar.mutate(p)}
                  >
                    Confirmar retirada
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmar(null)}>
                    Manter
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmar(p)}>
                  Retirar
                </Button>
              )}
            </div>
          ))}
          {menor.pedidoAberto && (
            <p className="text-muted-foreground">
              Pedido aberto, enviado a {menor.pedidoAberto.responsavel_email} em{" "}
              {formatarDataBR(menor.pedidoAberto.enviado_em)}, válido até {formatarDataBR(menor.pedidoAberto.expira_em)}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
