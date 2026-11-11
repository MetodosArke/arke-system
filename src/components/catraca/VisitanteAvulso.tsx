import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useComandoGateway } from "@/hooks/useComandoGateway";
import { passoDoCheckin, type RespostaCheckin } from "@/lib/checkinParceiro";
import { ProgressoComando } from "@/components/catraca/ProgressoComando";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Forma = "dinheiro" | "pix" | "cartao";
type Visita = { catracaId: string; nome: string; aula: string; valor: string; forma: Forma };

/**
 * O visitante da aula avulsa (decidido em 10/11/2026): sistema simples. A
 * recepção registra o nome, a aula e o valor recebido no balcão (em branco na
 * cortesia), e a catraca libera como no check-in de parceiro, sem cadastrar
 * aluno. Fica só o registro do acesso, e o valor vai ao financeiro
 * (`registrar_visitante_avulso`).
 */
export function VisitanteAvulso({ organizationId, catracas }: { organizationId: string; catracas: { id: string; nome: string; status: string | null }[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const liberacao = useComandoGateway();
  const [aviso, setAviso] = useState<string | null>(null);
  const ativas = catracas.filter((c) => c.status === "ativo");
  const [visita, setVisita] = useState<Visita>({ catracaId: "", nome: "", aula: "", valor: "", forma: "dinheiro" });
  const catracaId = visita.catracaId || (ativas.length === 1 ? ativas[0].id : "");

  const registrar = useMutation({
    mutationFn: async (v: Visita & { catracaId: string }) => {
      const valor = v.valor.trim() ? Number(v.valor.replace(",", ".")) : null;
      if (valor !== null && !(valor >= 0)) throw new Error("Valor inválido.");
      const { data, error } = await supabase.rpc("registrar_visitante_avulso", {
        _catraca_id: v.catracaId,
        _nome: v.nome,
        _aula: v.aula || undefined,
        _valor: valor ?? undefined,
        _forma: valor ? v.forma : undefined,
      });
      if (error) throw error;
      const passo = passoDoCheckin(data as Partial<RespostaCheckin>);
      if (passo.tipo === "recusado") throw new Error(passo.erro);
      return passo;
    },
    onSuccess: (passo) => {
      setVisita((s) => ({ ...s, nome: "", aula: "", valor: "" }));
      void queryClient.invalidateQueries({ queryKey: ["admin-catracas-logs", organizationId] });
      toast({ title: "Visitante registrado", description: passo.tipo === "acompanhar" ? "Liberando a catraca…" : passo.aviso });
      if (passo.tipo === "acompanhar") {
        setAviso(null);
        void liberacao
          .acompanhar(passo.comandoId, "liberar_catraca")
          .catch(() => setAviso("Não foi possível acompanhar a liberação. Se a catraca não abriu, libere pelo botão da recepção."));
      } else {
        liberacao.limpar();
        setAviso(passo.aviso);
      }
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar o visitante", description: e.message, variant: "destructive" }),
  });

  const naoConfirmada = liberacao.estado.fase === "fim" && liberacao.estado.comando.status !== "concluido";
  const temValor = Number(visita.valor.replace(",", ".")) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <UserPlus className="h-4 w-4" aria-hidden /> Visitante avulso
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Aula avulsa ou experimental de quem não é aluno: sem cadastro, fica só o registro do acesso. O valor recebido vai ao
          financeiro; deixe em branco na cortesia.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {ativas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma catraca ativa. O visitante avulso passa pela catraca da academia.</p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {ativas.length > 1 && (
                <div className="space-y-1.5">
                  <Label>Catraca</Label>
                  <Select value={catracaId} onValueChange={(v) => setVisita((s) => ({ ...s, catracaId: v }))}>
                    <SelectTrigger aria-label="Catraca"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {ativas.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="avulso-nome">Nome do visitante</Label>
                <Input id="avulso-nome" maxLength={120} value={visita.nome} onChange={(e) => setVisita((s) => ({ ...s, nome: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="avulso-aula">Aula (opcional)</Label>
                <Input id="avulso-aula" maxLength={120} placeholder="Aula avulsa" value={visita.aula} onChange={(e) => setVisita((s) => ({ ...s, aula: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="avulso-valor">Valor recebido (R$)</Label>
                <Input id="avulso-valor" inputMode="decimal" placeholder="Cortesia" value={visita.valor} onChange={(e) => setVisita((s) => ({ ...s, valor: e.target.value }))} />
              </div>
              {temValor && (
                <div className="space-y-1.5">
                  <Label>Pagamento</Label>
                  <Select value={visita.forma} onValueChange={(v) => setVisita((s) => ({ ...s, forma: v as Forma }))}>
                    <SelectTrigger aria-label="Forma de pagamento"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dinheiro">Dinheiro</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                      <SelectItem value="cartao">Cartão na maquininha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <Button
              className="w-full"
              disabled={!catracaId || !visita.nome.trim() || registrar.isPending || liberacao.emAndamento}
              onClick={() => registrar.mutate({ ...visita, catracaId })}
            >
              {registrar.isPending ? "Registrando…" : "Registrar e liberar"}
            </Button>
            <ProgressoComando estado={liberacao.estado} />
            {naoConfirmada && (
              <p className="text-xs text-muted-foreground">O visitante ficou registrado. Libere pelo botão da recepção ou no próprio equipamento.</p>
            )}
            {aviso && (
              <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                {aviso}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
