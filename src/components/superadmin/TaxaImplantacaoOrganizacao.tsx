import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { lerReais, reais } from "@/lib/numeros";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const STATUS: Record<string, string> = { pendente: "Em aberto", atrasado: "Vencida", confirmado: "Paga", cancelado: "Cancelada", estornado: "Estornada" };

/**
 * Visão Master → ficha da organização → Taxa de implantação. Valor e
 * parcelamento de cada contrato; o valor de referência (Configurações) vem
 * preenchido. Cada parcela é uma cobrança B2B: a academia escolhe PIX, boleto
 * ou cartão na fatura, e o atraso entra na regra de inadimplência B2B.
 */
export function TaxaImplantacaoOrganizacao({ organizationId }: { organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [valor, setValor] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [vencimento, setVencimento] = useState(() => hojeBrasilia());

  const { data, isLoading, isError } = useQuery({
    queryKey: ["taxa-implantacao", organizationId],
    queryFn: async () => {
      const [taxa, cobrancas, referencia] = await Promise.all([
        supabase.from("taxas_implantacao").select("valor_total, parcelas, created_at").eq("organization_id", organizationId).eq("status", "emitida").maybeSingle(),
        supabase
          .from("cobrancas_b2b")
          .select("id, valor, vencimento, status, invoice_url, descricao")
          .eq("organization_id", organizationId)
          .ilike("descricao", "%Taxa de implantação%")
          .order("vencimento")
          .limit(12),
        supabase.from("plataforma_config").select("valor").eq("chave", "taxa_implantacao_referencia").maybeSingle(),
      ]);
      if (taxa.error) throw taxa.error;
      if (cobrancas.error) throw cobrancas.error;
      return { taxa: taxa.data, parcelas: cobrancas.data ?? [], referencia: referencia.data?.valor ?? null };
    },
  });

  // Preenche o valor de referência uma vez: quem apaga o campo para digitar
  // outro valor não o vê voltar sozinho.
  const preenchido = useRef(false);
  useEffect(() => {
    if (preenchido.current || data === undefined) return;
    preenchido.current = true;
    if (data.referencia != null) setValor(String(data.referencia).replace(".", ","));
  }, [data]);

  const total = lerReais(valor);
  const n = Number(parcelas);
  const emitir = useMutation({
    mutationFn: async (pedido: { valor: number; parcelas: number; primeiro_vencimento: string }) => {
      const { data: r, error } = await supabase.functions.invoke("asaas-taxa-implantacao", { body: { organization_id: organizationId, ...pedido } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível emitir a taxa."));
      return r as { adotada: boolean; parcelas: { valor: number; vencimento: string }[] };
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["taxa-implantacao", organizationId] });
      toast({
        title: r.adotada ? "Taxa já existia no Asaas e foi registrada" : "Taxa de implantação emitida",
        description: `${r.parcelas.length} cobrança(s); a academia escolhe PIX, boleto ou cartão na fatura.`,
      });
    },
    onError: (e: Error) => toast({ title: "Não foi possível emitir", description: e.message, variant: "destructive" }),
  });

  // Sem os dados, o formulário não aparece: com a taxa já emitida, ele
  // ofereceria emitir de novo até a consulta responder.
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError) return <p className="text-sm text-destructive">Não foi possível carregar a taxa de implantação.</p>;

  if (data?.taxa) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          {reais(data.taxa.valor_total)} em {data.taxa.parcelas}× · emitida em {dataCurta(data.taxa.created_at)}
        </p>
        <ul className="space-y-1">
          {data.parcelas.map((p) => (
            <li key={p.id} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {dataCurta(p.vencimento ?? "")} · {reais(p.valor)}
              </span>
              <span className="flex items-center gap-2">
                {p.invoice_url && (
                  <a href={p.invoice_url} target="_blank" rel="noopener noreferrer" className="underline">
                    Fatura
                  </a>
                )}
                <Badge variant={p.status === "confirmado" ? "default" : p.status === "atrasado" ? "destructive" : "outline"} className="text-[10px]">
                  {STATUS[p.status] ?? p.status}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const valido = Number.isFinite(total) && total > 0 && total / n >= 5 && vencimento >= hojeBrasilia();
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="taxa-valor" className="text-xs">
            Valor (R$)
          </Label>
          <Input id="taxa-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Parcelas</Label>
          <Select value={parcelas} onValueChange={setParcelas}>
            <SelectTrigger aria-label="Parcelas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((v) => (
                <SelectItem key={v} value={v}>
                  {v === "1" ? "À vista" : `${v}×`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="taxa-venc" className="text-xs">
            1º vencimento
          </Label>
          <Input id="taxa-venc" type="date" value={vencimento} min={hojeBrasilia()} onChange={(e) => setVencimento(e.target.value)} />
        </div>
      </div>
      {Number.isFinite(total) && total > 0 && (
        <p className="text-xs text-muted-foreground">
          {n > 1 ? `${n}× de cerca de ${reais(total / n)}, mês a mês` : `À vista, ${reais(total)}`}. A academia escolhe PIX, boleto ou cartão em cada fatura.
          {total / n < 5 && " Cada parcela precisa ser de pelo menos R$ 5,00."}
        </p>
      )}
      <Button size="sm" disabled={!valido || emitir.isPending} onClick={() => emitir.mutate({ valor: total, parcelas: n, primeiro_vencimento: vencimento })}>
        {emitir.isPending ? "Emitindo…" : "Emitir taxa de implantação"}
      </Button>
    </div>
  );
}
