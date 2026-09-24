import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, ExternalLink, Plus, RotateCcw } from "lucide-react";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { lerReais, reais } from "@/lib/numeros";
import { taxaProcessamento } from "@/lib/repasse";
import { useTaxaProcessamento } from "@/hooks/useTaxaProcessamento";
import {
  ROTULO_SITUACAO,
  TIPOS_COBRANCA,
  cancelarCobrancaAvulsa,
  emAberto,
  emitirCobrancaAvulsa,
  reemitirCobrancaAvulsa,
  rotuloTipo,
  situacaoCobranca,
  type CobrancaAvulsa,
  type SituacaoCobranca,
  type TipoCobrancaAvulsa,
} from "@/lib/cobrancaAvulsa";

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const COR: Record<SituacaoCobranca, "default" | "destructive" | "outline" | "secondary"> = {
  emissao_nao_confirmada: "destructive",
  a_vencer: "outline",
  vence_hoje: "outline",
  vencida: "destructive",
  paga: "default",
  cancelada: "secondary",
  estornada: "secondary",
};

const FORM_VAZIO = { tipo: "taxa_matricula" as TipoCobrancaAvulsa, descricao: "", valor: "", vencimento: "" };

/**
 * Cobranças avulsas do aluno na ficha: taxa de matrícula, avaliação, personal,
 * diária, produto. A academia recebe o valor menos a taxa de processamento,
 * e a prévia mostra isso antes de emitir — sem ela, a equipe descobriria a
 * divisão no extrato.
 *
 * Emitir e cancelar é da gestão e da recepção (o servidor confere de novo);
 * o resto da equipe vê a lista.
 */
export function CobrancasAvulsas({ alunoId }: { alunoId: string }) {
  const { organizationRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // A mesma regra do servidor: vínculo de gestão ou recepção nesta academia.
  const podeCobrar = organizationRole === "gestor" || organizationRole === "recepcao";
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [paraCancelar, setParaCancelar] = useState<CobrancaAvulsa | null>(null);
  const hoje = hojeBrasilia();

  const chave = ["cobrancas-avulsas", alunoId];
  const { data: cobrancas } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cobrancas_avulsas")
        .select("id, tipo, descricao, valor, vencimento, status, invoice_url, asaas_payment_id, data_pagamento, created_at")
        .eq("aluno_id", alunoId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as CobrancaAvulsa[];
    },
  });

  const { data: taxa } = useTaxaProcessamento(aberto);

  const atualizar = () => void queryClient.invalidateQueries({ queryKey: chave });
  const valorNumero = lerReais(form.valor);
  const valorValido = Number.isFinite(valorNumero) && valorNumero > 0;
  const taxaPrevia = valorValido && taxa ? taxaProcessamento(valorNumero, taxa) : null;

  const emitir = useMutation({
    mutationFn: () =>
      emitirCobrancaAvulsa({
        aluno_id: alunoId,
        tipo: form.tipo,
        descricao: form.descricao.trim() || undefined,
        valor: valorNumero,
        vencimento: form.vencimento || undefined,
      }),
    onSuccess: (r) => {
      setAberto(false);
      setForm(FORM_VAZIO);
      atualizar();
      toast({
        title: "Cobrança emitida",
        description: r.invoice_url ? "O aluno recebe a fatura por e-mail e vê no app. O link também está na lista." : undefined,
      });
    },
    onError: (e: Error) => {
      atualizar();
      toast({ title: "Não foi possível emitir", description: e.message, variant: "destructive" });
    },
  });

  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarCobrancaAvulsa(id),
    onSuccess: () => {
      setParaCancelar(null);
      atualizar();
      toast({ title: "Cobrança cancelada", description: "O aluno não deve mais esse valor." });
    },
    onError: (e: Error) => {
      setParaCancelar(null);
      atualizar();
      toast({ title: "Não foi possível cancelar", description: e.message, variant: "destructive" });
    },
  });

  const reemitir = useMutation({
    mutationFn: (id: string) => reemitirCobrancaAvulsa(id),
    onSuccess: () => {
      atualizar();
      toast({ title: "Cobrança emitida" });
    },
    onError: (e: Error) => {
      atualizar();
      toast({ title: "Não foi possível emitir", description: e.message, variant: "destructive" });
    },
  });

  const copiar = (link: string) =>
    void navigator.clipboard.writeText(link).then(() => toast({ title: "Link da fatura copiado" }));

  return (
    <div className="space-y-2">
      {!cobrancas?.length ? (
        <p className="text-sm text-muted-foreground">Nenhuma cobrança avulsa.</p>
      ) : (
        <ul className="space-y-1.5">
          {cobrancas.map((c) => {
            const situacao = situacaoCobranca(c, hoje);
            return (
              <li key={c.id} className="rounded-md border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {reais(c.valor)} · vence {dataCurta(c.vencimento)}
                      {c.data_pagamento ? ` · paga em ${dataCurta(c.data_pagamento)}` : ""}
                    </p>
                  </div>
                  <Badge variant={COR[situacao]} className="shrink-0 text-[10px]">
                    {ROTULO_SITUACAO[situacao]}
                  </Badge>
                </div>
                {(c.invoice_url && emAberto(c)) || (podeCobrar && emAberto(c)) ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {c.invoice_url && emAberto(c) && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => copiar(c.invoice_url!)}>
                          <Copy className="mr-1 h-3 w-3" /> Copiar link
                        </Button>
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                          <a href={c.invoice_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="mr-1 h-3 w-3" /> Abrir fatura
                          </a>
                        </Button>
                      </>
                    )}
                    {podeCobrar && situacao === "emissao_nao_confirmada" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={reemitir.isPending}
                        onClick={() => reemitir.mutate(c.id)}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" /> Tentar de novo
                      </Button>
                    )}
                    {podeCobrar && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setParaCancelar(c)}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {podeCobrar && (
        <Button size="sm" variant="outline" onClick={() => setAberto(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Nova cobrança
        </Button>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova cobrança avulsa</DialogTitle>
            <DialogDescription>
              O aluno recebe a fatura por e-mail e vê no app; paga por PIX, boleto ou cartão.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="avulsa-tipo">Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as TipoCobrancaAvulsa })}>
                <SelectTrigger id="avulsa-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_COBRANCA.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="avulsa-descricao">Descrição</Label>
              <Input
                id="avulsa-descricao"
                maxLength={120}
                placeholder={rotuloTipo(form.tipo)}
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="avulsa-valor">Valor (R$)</Label>
                <Input
                  id="avulsa-valor"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={form.valor}
                  onChange={(e) => setForm({ ...form, valor: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="avulsa-vencimento">Vencimento</Label>
                <Input
                  id="avulsa-vencimento"
                  type="date"
                  min={hoje}
                  value={form.vencimento || hoje}
                  onChange={(e) => setForm({ ...form, vencimento: e.target.value })}
                />
              </div>
            </div>
            {taxaPrevia !== null && (
              <p className="text-xs text-muted-foreground">
                O aluno paga {reais(valorNumero)} · a academia recebe {reais(Math.max(0, valorNumero - taxaPrevia))} (taxa de
                processamento de {reais(taxaPrevia)}).
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button onClick={() => emitir.mutate()} disabled={emitir.isPending || !valorValido}>
              {emitir.isPending ? "Emitindo..." : "Emitir cobrança"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!paraCancelar} onOpenChange={(o) => !o && setParaCancelar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              {paraCancelar ? `${paraCancelar.descricao}, ${reais(paraCancelar.valor)}. ` : ""}A fatura deixa de valer e o
              aluno não recebe mais lembretes dela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelar.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (paraCancelar) cancelar.mutate(paraCancelar.id);
              }}
            >
              {cancelar.isPending ? "Cancelando..." : "Cancelar cobrança"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
