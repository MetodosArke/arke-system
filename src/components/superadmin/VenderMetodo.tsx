import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { erroCpfObrigatorio } from "@/lib/cpf";
import { erroDataNascimento } from "@/lib/menorDeIdade";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { reais } from "@/lib/numeros";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { PrestadorPagamentos } from "@/components/pagamento/PrestadorPagamentos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Nivel = "integrado" | "elite";
type Venda = {
  organizacao: string;
  nome: string;
  email: string;
  cpf: string;
  nascimento: string;
  telefone: string;
  nivel: Nivel;
  valor: string;
};
const VAZIA: Venda = { organizacao: "", nome: "", email: "", cpf: "", nascimento: "", telefone: "", nivel: "integrado", valor: "" };

/**
 * A venda do Método ARKE pela Visão Master (pedido do Jean, 11/11/2026). Dois
 * caminhos: o aluno sem academia, na organização do Método direto (a ArkeFit
 * fica com o valor inteiro), e o aluno de academia parceira (com o repasse dela).
 * Sem tabela de preço por enquanto: o valor mensal é digitado aqui.
 *
 * O aluno já matriculado na academia é achado pelo CPF; quem não está é
 * cadastrado (convite para criar a senha). Depois vem a assinatura, pela mesma
 * função da academia (`asaas-create-subscription`).
 */
export function VenderMetodo() {
  const { toast } = useToast();
  const [venda, setVenda] = useState<Venda>(VAZIA);
  const campo = (k: keyof Venda) => (e: React.ChangeEvent<HTMLInputElement>) => setVenda((v) => ({ ...v, [k]: e.target.value }));

  const organizacoes = useQuery({
    queryKey: ["venda-metodo-organizacoes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("organizacoes_para_venda_metodo");
      if (error) throw error;
      return data ?? [];
    },
  });
  const escolhida = (organizacoes.data ?? []).find((o) => o.id === venda.organizacao);

  const vender = useMutation({
    mutationFn: async (v: Venda) => {
      const valor = Number(v.valor.replace(",", "."));
      if (!v.organizacao) throw new Error("Escolha para onde vai o aluno.");
      if (!(valor > 0)) throw new Error("Digite o valor mensal.");
      const problemaCpf = erroCpfObrigatorio(v.cpf);
      if (problemaCpf) throw new Error(problemaCpf);

      const aderir = () =>
        supabase.rpc("aderir_metodo_pela_arkefit", { _organization_id: v.organizacao, _cpf: v.cpf, _nivel: v.nivel });
      let { data: alunoId, error } = await aderir();
      let cadastrado = false;
      // Quem ainda não está na academia (ou é aluno direto novo) é cadastrado antes.
      if (error?.code === "P0002") {
        const problemaNascimento = erroDataNascimento(v.nascimento, hojeBrasilia());
        if (problemaNascimento) throw new Error(`O aluno não está nesta academia; para cadastrar: ${problemaNascimento}`);
        if (!v.nome.trim() || !v.email.trim()) throw new Error("O aluno não está nesta academia: preencha o nome e o e-mail para cadastrar.");
        const { error: erroCadastro } = await supabase.functions.invoke("convidar-membro", {
          body: {
            email: v.email.trim(),
            full_name: v.nome.trim(),
            telefone: v.telefone,
            cpf: v.cpf,
            data_nascimento: v.nascimento,
            papel: "aluno",
            organization_id: v.organizacao,
          },
        });
        if (erroCadastro) throw new Error(await mensagemDeErroEdge(erroCadastro, "Não foi possível cadastrar o aluno."));
        cadastrado = true;
        ({ data: alunoId, error } = await aderir());
      }
      if (error) throw error;

      const { data, error: erroCobranca } = await supabase.functions.invoke("asaas-create-subscription", {
        body: { aluno_id: alunoId, valor_cobrado: valor },
      });
      if (erroCobranca || data?.error) {
        // A adesão já vale; a assinatura pode ser tentada de novo com a mesma venda.
        throw new Error(
          `A adesão foi registrada, mas a assinatura não saiu: ${data?.error ?? (await mensagemDeErroEdge(erroCobranca, "falha no Asaas"))} Tente de novo: a adesão não duplica.`,
        );
      }
      return { cadastrado };
    },
    onSuccess: ({ cadastrado }) => {
      toast({
        title: "Método vendido",
        description: `${cadastrado ? "O aluno recebeu o convite para criar a senha. " : ""}A assinatura foi criada, e o Asaas envia a primeira cobrança, que vence hoje. O aluno entra na carteira do mentor.`,
      });
      setVenda(VAZIA);
    },
    onError: (e: Error) => toast({ title: "Não foi possível concluir a venda", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HeartHandshake className="h-4 w-4 text-primary" aria-hidden /> Vender o Método ARKE
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Para o aluno sem academia, escolha <b>ArkeFit — Método online</b>: a ArkeFit fica com o valor inteiro. Para o aluno de
          academia parceira, escolha a academia: o repasse dela vale como sempre. O aluno já matriculado é achado pelo CPF.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {organizacoes.error && (
          <ErroAoCarregar oQue="as academias" onTentarDeNovo={() => void organizacoes.refetch()} tentando={organizacoes.isFetching} />
        )}
        <div className="space-y-1.5">
          <Label>Para onde vai o aluno</Label>
          <Select value={venda.organizacao} onValueChange={(v) => setVenda((s) => ({ ...s, organizacao: v }))}>
            <SelectTrigger aria-label="Para onde vai o aluno"><SelectValue placeholder="Escolha" /></SelectTrigger>
            <SelectContent>
              {(organizacoes.data ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id} disabled={!o.repasse_negociado}>
                  {o.metodo_direto ? `${o.nome} (sem academia)` : o.nome}
                  {o.ficticia ? " · demonstração" : ""}
                  {!o.repasse_negociado ? " · sem repasse negociado" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vm-cpf">CPF</Label>
            <Input id="vm-cpf" inputMode="numeric" value={venda.cpf} onChange={campo("cpf")} />
          </div>
          <div className="space-y-1.5">
            <Label>Nível</Label>
            <Select value={venda.nivel} onValueChange={(v) => setVenda((s) => ({ ...s, nivel: v as Nivel }))}>
              <SelectTrigger aria-label="Nível"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="integrado">Integrado</SelectItem>
                <SelectItem value="elite">Elite</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vm-valor">Valor mensal (R$)</Label>
            <Input id="vm-valor" inputMode="decimal" value={venda.valor} onChange={campo("valor")} placeholder="Digitado na venda" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Se o aluno ainda não estiver {escolhida?.metodo_direto ? "cadastrado" : "nesta academia"}, preencha também os dados para o cadastro:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vm-nome">Nome completo</Label>
            <Input id="vm-nome" value={venda.nome} onChange={campo("nome")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vm-email">E-mail</Label>
            <Input id="vm-email" type="email" value={venda.email} onChange={campo("email")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vm-nasc">Data de nascimento</Label>
            <Input id="vm-nasc" type="date" max={hojeBrasilia()} value={venda.nascimento} onChange={campo("nascimento")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vm-tel">Telefone (opcional)</Label>
            <Input id="vm-tel" inputMode="tel" value={venda.telefone} onChange={campo("telefone")} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-sm">
            {Number(venda.valor.replace(",", ".")) > 0 ? <>Assinatura mensal de <b>{reais(Number(venda.valor.replace(",", ".")))}</b>, a primeira vencendo hoje.</> : " "}
          </p>
          <Button disabled={vender.isPending || !venda.organizacao} onClick={() => vender.mutate(venda)}>
            {vender.isPending ? "Vendendo..." : "Vender o Método"}
          </Button>
        </div>
        <PrestadorPagamentos />
      </CardContent>
    </Card>
  );
}
