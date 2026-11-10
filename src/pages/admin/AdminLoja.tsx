import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Plus, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { todasAsLinhas, porLotes } from "@/lib/paginar";
import { perfisDosUsuarios } from "@/lib/perfis";
import { reais } from "@/lib/numeros";
import { formatarDataBR, hojeBrasilia } from "@/lib/dataBrasilia";
import { cancelarCobrancaAvulsa, emitirCobrancaAvulsa } from "@/lib/cobrancaAvulsa";
import { exigirGravacao } from "@/lib/gravacao";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { PrestadorPagamentos } from "@/components/pagamento/PrestadorPagamentos";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tables } from "@/integrations/supabase/types";

type Produto = Tables<"produtos_loja">;
type Forma = "dinheiro" | "pix" | "cartao" | "cobranca";

const FORMAS: { valor: Forma; rotulo: string }[] = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "pix", rotulo: "PIX (na hora)" },
  { valor: "cartao", rotulo: "Cartão na maquininha" },
  { valor: "cobranca", rotulo: "Cobrança ao aluno (Asaas)" },
];
const ROTULO_FORMA: Record<string, string> = { dinheiro: "Dinheiro", pix: "PIX", cartao: "Cartão", cobranca: "Cobrança" };
const ROTULO_STATUS: Record<string, string> = { paga: "Paga", pendente: "Aguardando pagamento", cancelada: "Cancelada" };

const PRODUTO_VAZIO = { id: "", nome: "", descricao: "", preco: "", estoque: "", ativo: true };

/**
 * A loja da academia (reunião de 10/11/2026): o catálogo de produtos e as vendas.
 * Vende no balcão (dinheiro, PIX ou cartão, já pagos) ou por cobrança ao aluno no
 * Asaas, a cobrança avulsa de tipo "produto". O estoque, a receita do balcão e a
 * venda que acompanha a cobrança ficam no banco (`registrar_venda_loja`). Sem nota
 * fiscal: produto pede NF-e, que fica fora por enquanto.
 */
export default function AdminLoja() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const orgId = organization?.id;
  const [produtoForm, setProdutoForm] = useState<typeof PRODUTO_VAZIO | null>(null);
  const [venda, setVenda] = useState({ produto: "", quantidade: "1", forma: "dinheiro" as Forma, aluno: "" });
  const [mes, setMes] = useState(() => hojeBrasilia().slice(0, 7));

  const produtos = useQuery({
    queryKey: ["loja-produtos", orgId],
    queryFn: () =>
      todasAsLinhas((de, ate) =>
        supabase.from("produtos_loja").select("*").eq("organization_id", orgId!).order("nome").order("id").range(de, ate)
      ),
    enabled: !!orgId,
  });

  const alunos = useQuery({
    queryKey: ["loja-alunos", orgId],
    queryFn: async () => {
      const lista = await todasAsLinhas((de, ate) =>
        supabase.from("alunos").select("id, user_id").eq("organization_id", orgId!).is("anonimizado_em", null).order("id").range(de, ate)
      );
      const perfis = await perfisDosUsuarios(lista.map((a) => a.user_id));
      return lista
        .map((a) => ({ id: a.id, nome: perfis.get(a.user_id)?.full_name ?? "Aluno" }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
    enabled: !!orgId,
  });

  const vendas = useQuery({
    queryKey: ["loja-vendas", orgId, mes],
    queryFn: async () => {
      const [ano, m] = mes.split("-").map(Number);
      const inicio = `${mes}-01T00:00:00-03:00`;
      const proximo = m === 12 ? `${ano + 1}-01` : `${ano}-${String(m + 1).padStart(2, "0")}`;
      const lista = await todasAsLinhas((de, ate) =>
        supabase
          .from("vendas_loja")
          .select("*")
          .eq("organization_id", orgId!)
          .gte("created_at", inicio)
          .lt("created_at", `${proximo}-01T00:00:00-03:00`)
          .order("created_at", { ascending: false })
          .order("id")
          .range(de, ate)
      );
      const cobrancas = await porLotes(
        lista.map((v) => v.cobranca_avulsa_id).filter((id): id is string => !!id),
        (lote) => supabase.from("cobrancas_avulsas").select("id, status, invoice_url").in("id", lote)
      );
      return { lista, cobranca: new Map(cobrancas.map((c) => [c.id, c])) };
    },
    enabled: !!orgId,
  });

  const nomeProduto = useMemo(() => new Map((produtos.data ?? []).map((p) => [p.id, p.nome])), [produtos.data]);
  const nomeAluno = useMemo(() => new Map((alunos.data ?? []).map((a) => [a.id, a.nome])), [alunos.data]);
  const ativos = (produtos.data ?? []).filter((p) => p.ativo);
  const produtoDaVenda = ativos.find((p) => p.id === venda.produto);
  const totalDaVenda = produtoDaVenda ? produtoDaVenda.preco * (Number(venda.quantidade) || 0) : 0;
  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ["loja-produtos", orgId] });
    void queryClient.invalidateQueries({ queryKey: ["loja-vendas", orgId] });
  };

  const salvarProduto = useMutation({
    mutationFn: async (p: typeof PRODUTO_VAZIO) => {
      const preco = Number(p.preco.replace(",", "."));
      if (!p.nome.trim()) throw new Error("Dê um nome ao produto.");
      if (!(preco > 0)) throw new Error("O preço tem de ser maior que zero.");
      const estoque = p.estoque.trim() === "" ? null : Number(p.estoque);
      if (estoque !== null && !(Number.isInteger(estoque) && estoque >= 0)) throw new Error("O estoque é um número inteiro, zero ou mais.");
      const dados = { nome: p.nome.trim(), descricao: p.descricao.trim() || null, preco, estoque, ativo: p.ativo };
      if (p.id) {
        await exigirGravacao(supabase.from("produtos_loja").update(dados).eq("id", p.id).select("id"));
      } else {
        const { error } = await supabase.from("produtos_loja").insert({ ...dados, organization_id: orgId! });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Produto salvo" });
      setProdutoForm(null);
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  const vender = useMutation({
    mutationFn: async (v: typeof venda) => {
      const produto = ativos.find((p) => p.id === v.produto);
      if (!produto) throw new Error("Escolha o produto.");
      const quantidade = Number(v.quantidade);
      const { data: vendaId, error } = await supabase.rpc("registrar_venda_loja", {
        _produto_id: produto.id,
        _quantidade: quantidade,
        _forma: v.forma,
        _aluno_id: v.aluno || undefined,
      });
      if (error) throw error;
      if (v.forma !== "cobranca") return null;
      // A venda já reservou o estoque; a cobrança sai pela cobrança avulsa. Se a
      // emissão falhar, a venda é cancelada e o estoque volta.
      try {
        const cobranca = await emitirCobrancaAvulsa({
          aluno_id: v.aluno,
          tipo: "produto",
          descricao: `${quantidade} × ${produto.nome}`,
          valor: Math.round(produto.preco * quantidade * 100) / 100,
          vencimento: hojeBrasilia(),
        });
        const { error: erroVinculo } = await supabase.rpc("vincular_cobranca_venda_loja", { _venda_id: vendaId, _cobranca_id: cobranca.cobranca_id });
        if (erroVinculo) throw erroVinculo;
        return cobranca.invoice_url;
      } catch (e) {
        await supabase.rpc("cancelar_venda_loja", { _venda_id: vendaId });
        throw e;
      }
    },
    onSuccess: (fatura) => {
      toast({
        title: "Venda registrada",
        description: fatura ? "A cobrança foi enviada ao aluno; a venda fica paga quando ele pagar." : "O estoque e o financeiro já estão atualizados.",
      });
      setVenda({ produto: "", quantidade: "1", forma: "dinheiro", aluno: "" });
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível vender", description: e.message, variant: "destructive" }),
  });

  const cancelar = useMutation({
    mutationFn: async (v: { id: string; cobranca_avulsa_id: string | null; status: string }) => {
      const cobranca = v.cobranca_avulsa_id ? vendas.data?.cobranca.get(v.cobranca_avulsa_id) : undefined;
      // A cobrança em aberto é cancelada no Asaas, e a venda cancela junto, pelo banco.
      if (cobranca && (cobranca.status === "pendente" || cobranca.status === "atrasado")) {
        await cancelarCobrancaAvulsa(cobranca.id);
        return;
      }
      const { error } = await supabase.rpc("cancelar_venda_loja", { _venda_id: v.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Venda cancelada", description: "O estoque voltou." });
      recarregar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível cancelar", description: e.message, variant: "destructive" }),
  });

  const podeVender =
    !!produtoDaVenda && Number(venda.quantidade) >= 1 && (venda.forma !== "cobranca" || !!venda.aluno) && !vender.isPending;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center gap-2">
        <ShoppingBag className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Loja</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Cadastre os produtos e registre as vendas. O estoque baixa na venda, e o que entra no balcão vai direto ao
        financeiro. Esta loja não emite nota fiscal.
      </p>
      {/* A venda por cobrança sai pelo Asaas: o prestador aparece aqui. */}
      <PrestadorPagamentos />

      <Tabs defaultValue="vender">
        <TabsList>
          <TabsTrigger value="vender">Vender</TabsTrigger>
          <TabsTrigger value="produtos">Produtos</TabsTrigger>
          <TabsTrigger value="vendas">Vendas</TabsTrigger>
        </TabsList>

        <TabsContent value="vender" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Nova venda</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {produtos.error && <ErroAoCarregar oQue="os produtos" onTentarDeNovo={() => void produtos.refetch()} tentando={produtos.isFetching} />}
              {!produtos.error && !produtos.isLoading && ativos.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum produto ativo. Cadastre o primeiro na aba Produtos.</p>
              )}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <div className="space-y-1.5">
                  <Label>Produto</Label>
                  <Select value={venda.produto} onValueChange={(v) => setVenda((s) => ({ ...s, produto: v }))}>
                    <SelectTrigger aria-label="Produto"><SelectValue placeholder="Escolha o produto" /></SelectTrigger>
                    <SelectContent>
                      {ativos.map((p) => (
                        <SelectItem key={p.id} value={p.id} disabled={p.estoque === 0}>
                          {p.nome} · {reais(p.preco)}{p.estoque !== null ? ` · ${p.estoque} em estoque` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loja-qtd">Quantidade</Label>
                  <Input id="loja-qtd" type="number" min={1} max={100} value={venda.quantidade} onChange={(e) => setVenda((s) => ({ ...s, quantidade: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Pagamento</Label>
                  <Select value={venda.forma} onValueChange={(v) => setVenda((s) => ({ ...s, forma: v as Forma }))}>
                    <SelectTrigger aria-label="Forma de pagamento"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FORMAS.map((f) => (
                        <SelectItem key={f.valor} value={f.valor}>{f.rotulo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Aluno {venda.forma === "cobranca" ? "" : "(opcional)"}</Label>
                  <Select value={venda.aluno || "nenhum"} onValueChange={(v) => setVenda((s) => ({ ...s, aluno: v === "nenhum" ? "" : v }))}>
                    <SelectTrigger aria-label="Aluno"><SelectValue placeholder="Escolha o aluno" /></SelectTrigger>
                    <SelectContent>
                      {venda.forma !== "cobranca" && <SelectItem value="nenhum">Sem aluno (balcão)</SelectItem>}
                      {(alunos.data ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {alunos.error && <p className="text-xs text-destructive">Não foi possível carregar os alunos.</p>}
                </div>
              </div>
              {venda.forma === "cobranca" && (
                <p className="text-xs text-muted-foreground">
                  A cobrança vai para o aluno pelo Asaas, com vencimento hoje. A venda fica aguardando e passa a paga quando
                  ele pagar.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-sm">Total: <b>{reais(totalDaVenda)}</b></p>
                <Button disabled={!podeVender} onClick={() => vender.mutate(venda)}>
                  {vender.isPending ? "Registrando..." : "Registrar venda"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="produtos" className="mt-4 space-y-3">
          <Button size="sm" onClick={() => setProdutoForm({ ...PRODUTO_VAZIO })}>
            <Plus className="h-4 w-4 mr-1" /> Novo produto
          </Button>
          {produtos.isLoading && <p className="text-sm text-muted-foreground" role="status">Carregando…</p>}
          {produtos.error && <ErroAoCarregar oQue="os produtos" onTentarDeNovo={() => void produtos.refetch()} tentando={produtos.isFetching} />}
          {!produtos.isLoading && !produtos.error && (produtos.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum produto cadastrado ainda.</p>
          )}
          {(produtos.data ?? []).length > 0 && (
            <Card>
              <Table cabecalhoFixo>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Preço</TableHead>
                    <TableHead>Estoque</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead><span className="sr-only">Ações</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(produtos.data ?? []).map((p: Produto) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell>{reais(p.preco)}</TableCell>
                      <TableCell>{p.estoque === null ? "Sem controle" : p.estoque}</TableCell>
                      <TableCell>
                        <Badge variant={p.ativo ? "secondary" : "outline"}>{p.ativo ? "À venda" : "Inativo"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Editar ${p.nome}`}
                          onClick={() =>
                            setProdutoForm({
                              id: p.id,
                              nome: p.nome,
                              descricao: p.descricao ?? "",
                              preco: String(p.preco),
                              estoque: p.estoque === null ? "" : String(p.estoque),
                              ativo: p.ativo,
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="vendas" className="mt-4 space-y-3">
          <Input type="month" aria-label="Mês das vendas" className="h-8 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
          {vendas.isLoading && <p className="text-sm text-muted-foreground" role="status">Carregando…</p>}
          {vendas.error && <ErroAoCarregar oQue="as vendas" onTentarDeNovo={() => void vendas.refetch()} tentando={vendas.isFetching} />}
          {!vendas.isLoading && !vendas.error && (vendas.data?.lista ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma venda neste mês.</p>
          )}
          {(vendas.data?.lista ?? []).length > 0 && (
            <Card>
              <Table cabecalhoFixo>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Aluno</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Pagamento</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead><span className="sr-only">Ações</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(vendas.data?.lista ?? []).map((v) => {
                    const cobranca = v.cobranca_avulsa_id ? vendas.data?.cobranca.get(v.cobranca_avulsa_id) : undefined;
                    const podeCancelar = v.status !== "cancelada" && !(v.forma_pagamento === "cobranca" && v.status === "paga");
                    return (
                      <TableRow key={v.id}>
                        <TableCell>{formatarDataBR(v.created_at)}</TableCell>
                        <TableCell>{v.quantidade} × {nomeProduto.get(v.produto_id) ?? "Produto"}</TableCell>
                        <TableCell>{v.aluno_id ? nomeAluno.get(v.aluno_id) ?? "Aluno" : "Balcão"}</TableCell>
                        <TableCell>{reais(v.valor_total)}</TableCell>
                        <TableCell>
                          {ROTULO_FORMA[v.forma_pagamento] ?? v.forma_pagamento}
                          {cobranca?.invoice_url && v.status === "pendente" && (
                            <a href={cobranca.invoice_url} target="_blank" rel="noreferrer" className="block text-xs text-primary underline">
                              Fatura
                            </a>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={v.status === "paga" ? "secondary" : v.status === "cancelada" ? "outline" : "default"}>
                            {ROTULO_STATUS[v.status] ?? v.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {podeCancelar && (
                            <Button size="sm" variant="ghost" disabled={cancelar.isPending} onClick={() => cancelar.mutate(v)}>
                              Cancelar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!produtoForm} onOpenChange={(o) => !o && setProdutoForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{produtoForm?.id ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>
          {produtoForm && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="loja-nome">Nome</Label>
                <Input id="loja-nome" maxLength={120} value={produtoForm.nome} onChange={(e) => setProdutoForm({ ...produtoForm, nome: e.target.value })} />
              </div>
              <div className="grid gap-3 grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="loja-preco">Preço (R$)</Label>
                  <Input id="loja-preco" inputMode="decimal" value={produtoForm.preco} onChange={(e) => setProdutoForm({ ...produtoForm, preco: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="loja-estoque">Estoque</Label>
                  <Input
                    id="loja-estoque"
                    type="number"
                    min={0}
                    placeholder="Sem controle"
                    value={produtoForm.estoque}
                    onChange={(e) => setProdutoForm({ ...produtoForm, estoque: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loja-descricao">Descrição (opcional)</Label>
                <Textarea id="loja-descricao" maxLength={1000} value={produtoForm.descricao} onChange={(e) => setProdutoForm({ ...produtoForm, descricao: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={produtoForm.ativo} onChange={(e) => setProdutoForm({ ...produtoForm, ativo: e.target.checked })} />
                À venda
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setProdutoForm(null)}>Cancelar</Button>
                <Button disabled={salvarProduto.isPending} onClick={() => salvarProduto.mutate(produtoForm)}>
                  {salvarProduto.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
