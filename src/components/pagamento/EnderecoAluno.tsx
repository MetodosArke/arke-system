import { useEffect, useState, type ComponentProps } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buscarCep, formatarCep } from "@/lib/brasilApi";
import { ENDERECO_VAZIO, enderecoCompleto, salvarEndereco, type Endereco } from "@/lib/notaFiscal";

/**
 * Endereço do aluno. A prefeitura exige o endereço de quem recebe o serviço na
 * nota fiscal da academia, e sem ele a nota não sai. O CEP completa rua,
 * bairro, cidade e UF; a pessoa confere e põe o número.
 *
 * O aluno edita o dele no app; a gestão e a recepção, o de quem não usa o app.
 * A gravação passa por `atualizar_endereco_aluno`, que confere quem pede —
 * a regra do cadastro só deixa cada um alterar o próprio.
 */
export function EnderecoAluno({ alunoId, podeEditar }: { alunoId: string; podeEditar: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const chave = ["endereco-aluno", alunoId];
  const [form, setForm] = useState<Endereco>(ENDERECO_VAZIO);
  const [buscando, setBuscando] = useState(false);

  const { data: salvo } = useQuery({
    queryKey: chave,
    queryFn: async (): Promise<Endereco> => {
      const { data: aluno, error } = await supabase.from("alunos").select("user_id").eq("id", alunoId).single();
      if (error) throw error;
      const { data: p, error: e2 } = await supabase
        .from("profiles")
        .select("cep, logradouro, endereco_numero, complemento, bairro, cidade, uf")
        .eq("user_id", aluno.user_id)
        .maybeSingle();
      if (e2) throw e2;
      return {
        cep: p?.cep ? formatarCep(p.cep) : "",
        logradouro: p?.logradouro ?? "",
        numero: p?.endereco_numero ?? "",
        complemento: p?.complemento ?? "",
        bairro: p?.bairro ?? "",
        cidade: p?.cidade ?? "",
        uf: p?.uf ?? "",
      };
    },
  });

  useEffect(() => {
    if (salvo) setForm(salvo);
  }, [salvo]);

  const salvar = useMutation({
    mutationFn: (e: Endereco) => salvarEndereco(alunoId, e),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chave });
      toast({ title: "Endereço salvo" });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const aoMudarCep = async (valor: string) => {
    const cep = formatarCep(valor);
    setForm((f) => ({ ...f, cep }));
    if (cep.replace(/\D/g, "").length !== 8) return;
    setBuscando(true);
    const r = await buscarCep(cep);
    setBuscando(false);
    // Preenche só o que veio; a pessoa confere e completa o resto.
    if (r) setForm((f) => ({ ...f, cep, logradouro: r.logradouro || f.logradouro, bairro: r.bairro || f.bairro, cidade: r.cidade || f.cidade, uf: r.uf || f.uf }));
  };

  if (!podeEditar) {
    return salvo && enderecoCompleto(salvo) ? (
      <p className="text-sm">
        {salvo.logradouro}, {salvo.numero}
        {salvo.complemento ? ` — ${salvo.complemento}` : ""} · {salvo.bairro} · {salvo.cidade}/{salvo.uf} · {salvo.cep}
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">Sem endereço cadastrado.</p>
    );
  }

  const campo = (id: keyof Endereco, rotulo: string, extra: Partial<ComponentProps<typeof Input>> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`endereco-${id}`} className="text-xs">
        {rotulo}
      </Label>
      <Input id={`endereco-${id}`} value={form[id]} onChange={(e) => setForm({ ...form, [id]: e.target.value })} {...extra} />
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label htmlFor="endereco-cep" className="text-xs">
            CEP
          </Label>
          <Input id="endereco-cep" inputMode="numeric" value={form.cep} onChange={(e) => void aoMudarCep(e.target.value)} />
        </div>
        <div className="col-span-2">{campo("logradouro", buscando ? "Rua (buscando…)" : "Rua")}</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {campo("numero", "Número")}
        <div className="col-span-2">{campo("complemento", "Complemento (opcional)")}</div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        <div className="col-span-2">{campo("bairro", "Bairro")}</div>
        <div className="col-span-2">{campo("cidade", "Cidade")}</div>
        {campo("uf", "UF", { maxLength: 2 })}
      </div>
      <Button size="sm" variant="outline" disabled={salvar.isPending || !enderecoCompleto(form)} onClick={() => salvar.mutate(form)}>
        {salvar.isPending ? "Salvando..." : "Salvar endereço"}
      </Button>
    </div>
  );
}
