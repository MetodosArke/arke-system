import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRascunho } from "@/hooks/useRascunho";
import { chaveRascunho, descreverQuandoSalvou } from "@/lib/rascunho";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UtensilsCrossed, Plus, Trash2, FolderOpen, UserRound, FileUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Json } from "@/integrations/supabase/types";

// Extração via Google Gemini (gemini-1.5-flash, edge function
// parse-dieta-pdf) — tem tier gratuito generoso, então fica habilitada por
// padrão. Requer a secret GEMINI_API_KEY configurada no projeto Supabase;
// sem ela a função retorna um erro claro em vez de falhar silenciosamente.
const PARSER_DIETA_PDF_HABILITADO = true;

interface ItemExtraidoPdf {
  alimento: string;
  quantidade: string;
  substituicoes: string[];
}

interface RefeicaoExtraidaPdf {
  nome: string;
  horario: string | null;
  itens: ItemExtraidoPdf[];
}

interface DietaExtraidaPdf {
  titulo_dieta: string;
  observacoes_gerais: string | null;
  refeicoes: RefeicaoExtraidaPdf[];
}

// Espelha o limite da edge function, que recusa base64 acima de 20.000.000
// de caracteres: 4 * ceil(n/3) <= 20.000.000 dá exatamente 15.000.000 bytes
// de binário. Checar no cliente evita o usuário esperar o upload inteiro no
// 4G só para receber o erro no final.
const TAMANHO_MAXIMO_PDF_BYTES = 15_000_000;

// Leitura via FileReader (nativo e assíncrono) em vez de percorrer o
// ArrayBuffer manualmente: em celular, montar a string na main thread
// congela a interface por segundos, e o spread de dezenas de milhares de
// argumentos em String.fromCharCode estoura a pilha de chamadas.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo no dispositivo."));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      const separador = dataUrl.indexOf(",");
      if (separador < 0) {
        reject(new Error("Não foi possível ler o arquivo no dispositivo."));
        return;
      }
      resolve(dataUrl.slice(separador + 1));
    };
    reader.readAsDataURL(file);
  });
}

const STATUS_DIETA_LABEL: Record<string, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  concluido: "Concluído",
};

export default function AdminDietas() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const alunoIdFromNav = (location.state as { alunoId?: string } | null)?.alunoId;

  const [novoModeloTitulo, setNovoModeloTitulo] = useState("");
  const [modeloSelecionado, setModeloSelecionado] = useState<string | null>(null);
  const [novaRefeicao, setNovaRefeicao] = useState({
    nome_refeicao: "",
    horario_sugerido: "",
    itens: "",
    calorias_kcal: "",
    proteinas_g: "",
    carboidratos_g: "",
    gorduras_g: "",
  });
  const [alimentoBibliotecaId, setAlimentoBibliotecaId] = useState("");

  // Mesmo raciocínio do exercício: as refeições já adicionadas estão no
  // banco, e o que corre risco é a que está sendo escrita — onde `itens`
  // costuma ser uma lista digitada linha a linha.
  const { rascunhoDisponivel: refeicaoSalva, descartar: descartarRefeicao } = useRascunho(
    modeloSelecionado ? chaveRascunho("dieta-refeicao", modeloSelecionado) : null,
    novaRefeicao,
    { ativo: !!novaRefeicao.nome_refeicao || !!novaRefeicao.itens }
  );

  useEffect(() => {
    if (refeicaoSalva?.dados && !novaRefeicao.nome_refeicao) {
      setNovaRefeicao(refeicaoSalva.dados);
      descartarRefeicao();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refeicaoSalva]);
  const [importarPdfAberto, setImportarPdfAberto] = useState(false);
  const [dietaExtraida, setDietaExtraida] = useState<DietaExtraidaPdf | null>(null);
  // "modelo": salva na Biblioteca para reaproveitar depois; "aluno": publica
  // direto no prontuário do aluno já selecionado na aba "Publicar para
  // Aluno", sem passar pela Biblioteca.
  const [importarPdfModo, setImportarPdfModo] = useState<"modelo" | "aluno">("modelo");

  const { data: bibliotecaAlimentos = [] } = useQuery({
    queryKey: ["alimentos-biblioteca"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alimentos_biblioteca")
        .select("id, nome, categoria, porcao_g, calorias_kcal, proteinas_g, carboidratos_g, gorduras_g")
        .order("categoria")
        .order("nome");
      if (error) throw error;
      return data;
    },
  });

  const adicionarAlimentoDaBiblioteca = (id: string) => {
    setAlimentoBibliotecaId(id);
    const item = bibliotecaAlimentos.find((a) => a.id === id);
    if (!item) return;
    setNovaRefeicao((p) => ({
      ...p,
      itens: p.itens ? `${p.itens}, ${item.nome} (${item.porcao_g}g)` : `${item.nome} (${item.porcao_g}g)`,
      calorias_kcal: String((Number(p.calorias_kcal) || 0) + Number(item.calorias_kcal)),
      proteinas_g: String((Number(p.proteinas_g) || 0) + Number(item.proteinas_g)),
      carboidratos_g: String((Number(p.carboidratos_g) || 0) + Number(item.carboidratos_g)),
      gorduras_g: String((Number(p.gorduras_g) || 0) + Number(item.gorduras_g)),
    }));
  };

  const [abaAtiva, setAbaAtiva] = useState(alunoIdFromNav ? "publicar" : "biblioteca");
  const [alunoPublicar, setAlunoPublicar] = useState<string>(alunoIdFromNav ?? "");
  const [modeloPublicar, setModeloPublicar] = useState<string>("");
  const [tituloPublicar, setTituloPublicar] = useState("");
  const [modeloCarregadoId, setModeloCarregadoId] = useState<string | null>(null);
  const [perfilAberto, setPerfilAberto] = useState(false);

  // Rascunho da extração de PDF.
  //
  // É o conteúdo mais caro da tela: custou uma chamada ao Gemini e uma
  // revisão item a item. E até aqui ele era descartado por um clique —
  // fechar o diálogo fazia `setDietaExtraida(null)`, jogando fora a
  // extração inteira sem perguntar. Agora ela espera na sessão de
  // trabalho, e a pessoa decide se retoma ou descarta.
  const rascunhoPdf = { dietaExtraida, novoModeloTitulo, importarPdfModo, alunoPublicar };
  type RascunhoPdf = typeof rascunhoPdf;

  const { rascunhoDisponivel: pdfSalvo, descartar: descartarRascunhoPdf } = useRascunho<RascunhoPdf>(
    organization?.id ? chaveRascunho("dieta-pdf", organization.id) : null,
    rascunhoPdf,
    { ativo: !!dietaExtraida }
  );

  const restaurarPdf = () => {
    const d = pdfSalvo?.dados;
    if (!d?.dietaExtraida) return;
    setDietaExtraida(d.dietaExtraida);
    setNovoModeloTitulo(d.novoModeloTitulo ?? "");
    setImportarPdfModo(d.importarPdfModo ?? "modelo");
    if (d.alunoPublicar) setAlunoPublicar(d.alunoPublicar);
    descartarRascunhoPdf();
  };

  useEffect(() => {
    if (alunoIdFromNav) {
      setAlunoPublicar(alunoIdFromNav);
      setAbaAtiva("publicar");
    }
  }, [alunoIdFromNav]);

  // Alterações ainda não salvas: rascunho de modelo/refeição não confirmado
  // ou seleção de publicação preenchida mas não enviada.
  const temAlteracoesNaoSalvas = useMemo(
    () =>
      novoModeloTitulo.trim() !== "" ||
      novaRefeicao.nome_refeicao.trim() !== "" ||
      tituloPublicar.trim() !== "",
    [novoModeloTitulo, novaRefeicao.nome_refeicao, tituloPublicar]
  );

  const cancelar = () => {
    if (temAlteracoesNaoSalvas) {
      const confirmar = window.confirm(
        "Você tem alterações não salvas. Deseja realmente sair sem salvar?"
      );
      if (!confirmar) return;
    }
    navigate("/admin");
  };

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-dieta", organization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos_dieta")
        .select("id, titulo")
        .eq("organization_id", organization!.id)
        .order("titulo");
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id,
  });

  const { data: refeicoes = [] } = useQuery({
    queryKey: ["modelo-dieta-refeicoes", modeloSelecionado],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_dieta_refeicoes")
        .select("*")
        .eq("modelo_id", modeloSelecionado!)
        .order("ordem");
      if (error) throw error;
      return data;
    },
    enabled: !!modeloSelecionado,
  });

  const { data: alunos = [] } = useQuery({
    queryKey: ["admin-alunos-select-dieta", organization?.id],
    queryFn: async () => {
      const { data: alunosData, error } = await supabase
        .from("alunos")
        .select("id, user_id, nivel_atacado")
        .eq("organization_id", organization!.id)
        .in("nivel_atacado", ["integrado", "elite"]);
      if (error) throw error;
      const userIds = alunosData.map((a) => a.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
        : { data: [] as { user_id: string; full_name: string }[] };
      const nomeByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p.full_name]));
      return alunosData.map((a) => ({ id: a.id, nome: nomeByUserId.get(a.user_id) ?? "—" }));
    },
    enabled: !!organization?.id,
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["dietas-historico", alunoPublicar],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dietas")
        .select("id, titulo, status, versao_id, created_at")
        .eq("aluno_id", alunoPublicar)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!alunoPublicar,
  });

  const { data: refeicoesModeloCarregado = [] } = useQuery({
    queryKey: ["modelo-dieta-refeicoes-carregado", modeloCarregadoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_dieta_refeicoes")
        .select("*")
        .eq("modelo_id", modeloCarregadoId!)
        .order("ordem");
      if (error) throw error;
      return data;
    },
    enabled: !!modeloCarregadoId,
  });

  const { data: perfilAluno } = useQuery({
    queryKey: ["aluno-perfil-rapido-dieta", alunoPublicar],
    queryFn: async () => {
      const [{ data: alunoRow }, { data: anamneseRow }] = await Promise.all([
        supabase.from("alunos").select("objetivo").eq("id", alunoPublicar).maybeSingle(),
        supabase.from("anamnese_acolhimento").select("dores_lesoes").eq("aluno_id", alunoPublicar).maybeSingle(),
      ]);
      return {
        objetivo: alunoRow?.objetivo ?? null,
        doresLesoes: anamneseRow?.dores_lesoes ?? null,
      };
    },
    enabled: !!alunoPublicar && perfilAberto,
  });

  const ultimaFichaAtiva = historico.find((h) => h.status === "ativo") ?? null;

  const criarModelo = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização não encontrada");
      const { data, error } = await supabase
        .from("modelos_dieta")
        .insert({ organization_id: organization.id, titulo: novoModeloTitulo })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setNovoModeloTitulo("");
      setModeloSelecionado(id);
      void queryClient.invalidateQueries({ queryKey: ["modelos-dieta", organization?.id] });
    },
    onError: (error: Error) => toast({ title: "Erro ao criar modelo", description: error.message, variant: "destructive" }),
  });

  const adicionarRefeicao = useMutation({
    mutationFn: async () => {
      if (!modeloSelecionado) throw new Error("Selecione um modelo");
      const { error } = await supabase.from("modelo_dieta_refeicoes").insert({
        modelo_id: modeloSelecionado,
        ordem: refeicoes.length,
        nome_refeicao: novaRefeicao.nome_refeicao,
        horario_sugerido: novaRefeicao.horario_sugerido || null,
        itens: novaRefeicao.itens || null,
        calorias_kcal: novaRefeicao.calorias_kcal ? Number(novaRefeicao.calorias_kcal) : null,
        proteinas_g: novaRefeicao.proteinas_g ? Number(novaRefeicao.proteinas_g) : null,
        carboidratos_g: novaRefeicao.carboidratos_g ? Number(novaRefeicao.carboidratos_g) : null,
        gorduras_g: novaRefeicao.gorduras_g ? Number(novaRefeicao.gorduras_g) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNovaRefeicao({
        nome_refeicao: "",
        horario_sugerido: "",
        itens: "",
        calorias_kcal: "",
        proteinas_g: "",
        carboidratos_g: "",
        gorduras_g: "",
      });
      setAlimentoBibliotecaId("");
      descartarRefeicao();
      void queryClient.invalidateQueries({ queryKey: ["modelo-dieta-refeicoes", modeloSelecionado] });
    },
    onError: (error: Error) => toast({ title: "Erro ao adicionar refeição", description: error.message, variant: "destructive" }),
  });

  const importarDietaPdf = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > TAMANHO_MAXIMO_PDF_BYTES) {
        throw new Error("PDF muito grande (máximo 15MB). Envie um arquivo menor ou comprimido.");
      }
      const fileBase64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke<DietaExtraidaPdf & { error?: string }>(
        "parse-dieta-pdf",
        { body: { file_base64: fileBase64 } }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data) throw new Error("Resposta vazia da extração.");
      return data;
    },
    onSuccess: (dieta) => {
      if (!dieta.refeicoes || dieta.refeicoes.length === 0) {
        toast({
          title: "Nenhuma refeição identificada",
          description: "Não encontramos refeições estruturadas neste PDF. Tente um arquivo mais legível ou preencha manualmente.",
          variant: "destructive",
        });
        return;
      }
      setDietaExtraida(dieta);
      setNovoModeloTitulo(dieta.titulo_dieta || "Dieta importada de PDF");
    },
    onError: (error: Error) =>
      toast({ title: "Erro ao importar PDF", description: error.message, variant: "destructive" }),
  });

  const confirmarImportacaoPdf = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error("Organização não encontrada");
      if (!dietaExtraida || dietaExtraida.refeicoes.length === 0) throw new Error("Nada para importar");
      const titulo = novoModeloTitulo.trim() || dietaExtraida.titulo_dieta || "Dieta importada de PDF";

      if (importarPdfModo === "aluno") {
        if (!alunoPublicar) throw new Error("Selecione o aluno antes de importar.");
        const snapshot = dietaExtraida.refeicoes.map((r, index) => ({
          ordem: index + 1,
          nome_refeicao: r.nome || `Refeição ${index + 1}`,
          horario_sugerido: r.horario || null,
          itens: r.itens.map((i) => `${i.alimento} — ${i.quantidade}`).join("\n") || null,
          itens_estruturados: r.itens,
          calorias_kcal: null,
          proteinas_g: null,
          carboidratos_g: null,
          gorduras_g: null,
        }));
        const { error } = await supabase.from("dietas").insert({
          organization_id: organization.id,
          aluno_id: alunoPublicar,
          titulo,
          snapshot_conteudo: snapshot as unknown as Json,
          observacoes_gerais: dietaExtraida.observacoes_gerais || null,
        });
        if (error) throw error;
        return null;
      }

      const { data: modelo, error: modeloError } = await supabase
        .from("modelos_dieta")
        .insert({
          organization_id: organization.id,
          titulo,
          observacoes: dietaExtraida.observacoes_gerais || null,
        })
        .select("id")
        .single();
      if (modeloError) throw modeloError;
      const { error: refeicoesError } = await supabase.from("modelo_dieta_refeicoes").insert(
        dietaExtraida.refeicoes.map((r, index) => ({
          modelo_id: modelo.id,
          ordem: index + 1,
          nome_refeicao: r.nome || `Refeição ${index + 1}`,
          horario_sugerido: r.horario || null,
          itens: r.itens.map((i) => `${i.alimento} — ${i.quantidade}`).join("\n") || null,
          itens_estruturados: r.itens as unknown as Json,
        }))
      );
      if (refeicoesError) throw refeicoesError;
      return modelo.id;
    },
    onSuccess: (id) => {
      setNovoModeloTitulo("");
      setDietaExtraida(null);
      // Importada de verdade: o rascunho perdeu a razão de existir e não
      // pode ficar oferecendo restaurar o que já virou dieta.
      descartarRascunhoPdf();
      setImportarPdfAberto(false);
      if (importarPdfModo === "aluno") {
        toast({ title: "Dieta publicada!", description: "O PDF foi importado e já está disponível para o aluno." });
        void queryClient.invalidateQueries({ queryKey: ["dietas-historico", alunoPublicar] });
        navigate("/admin");
        return;
      }
      toast({ title: "Modelo importado!", description: "Revise as refeições e ajuste o que for preciso antes de publicar." });
      setModeloSelecionado(id);
      void queryClient.invalidateQueries({ queryKey: ["modelos-dieta", organization?.id] });
    },
    onError: (error: Error) =>
      toast({
        title: importarPdfModo === "aluno" ? "Erro ao publicar dieta" : "Erro ao salvar modelo importado",
        description: error.message,
        variant: "destructive",
      }),
  });

  const removerRefeicao = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("modelo_dieta_refeicoes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["modelo-dieta-refeicoes", modeloSelecionado] }),
  });

  const publicar = useMutation({
    mutationFn: async () => {
      if (!alunoPublicar || !modeloPublicar || !tituloPublicar) throw new Error("Preencha aluno, modelo e título");
      const { error } = await supabase.rpc("publicar_dieta", {
        _aluno_id: alunoPublicar,
        _modelo_id: modeloPublicar,
        _titulo: tituloPublicar,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Dieta publicada!", description: "O snapshot foi congelado e já está disponível para o aluno." });
      setTituloPublicar("");
      void queryClient.invalidateQueries({ queryKey: ["dietas-historico", alunoPublicar] });
      navigate("/admin");
    },
    onError: (error: Error) => toast({ title: "Erro ao publicar", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Dietas</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Disponível apenas para alunos nos níveis Integrado ou Elite (o nível Essencial não inclui nutrição).
      </p>

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList>
          <TabsTrigger value="biblioteca">Biblioteca de Modelos</TabsTrigger>
          <TabsTrigger value="publicar">Publicar para Aluno</TabsTrigger>
        </TabsList>

        <TabsContent value="biblioteca" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Novo modelo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Input placeholder="Título do modelo" value={novoModeloTitulo} onChange={(e) => setNovoModeloTitulo(e.target.value)} />
              <Button disabled={!novoModeloTitulo.trim() || criarModelo.isPending} onClick={() => criarModelo.mutate()}>
                <Plus className="h-4 w-4 mr-1" /> Criar
              </Button>
              {PARSER_DIETA_PDF_HABILITADO && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setImportarPdfModo("modelo");
                    setImportarPdfAberto(true);
                  }}
                >
                  <FileUp className="h-4 w-4 mr-1" /> Importar de PDF
                </Button>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {modelos.map((m) => (
              <Button
                key={m.id}
                variant={modeloSelecionado === m.id ? "default" : "outline"}
                size="sm"
                onClick={() => setModeloSelecionado(m.id)}
              >
                {m.titulo}
              </Button>
            ))}
          </div>

          {modeloSelecionado && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Refeições</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Refeição</TableHead>
                      <TableHead>Horário</TableHead>
                      <TableHead>Itens</TableHead>
                      <TableHead>Macros</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {refeicoes.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.nome_refeicao}</TableCell>
                        <TableCell>{r.horario_sugerido ?? "—"}</TableCell>
                        <TableCell className="max-w-xs truncate">{r.itens ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {r.calorias_kcal ? `${r.calorias_kcal}kcal` : ""}
                          {r.proteinas_g ? ` · ${r.proteinas_g}g P` : ""}
                          {r.carboidratos_g ? ` · ${r.carboidratos_g}g C` : ""}
                          {r.gorduras_g ? ` · ${r.gorduras_g}g G` : ""}
                          {!r.calorias_kcal && !r.proteinas_g && !r.carboidratos_g && !r.gorduras_g && "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" onClick={() => removerRefeicao.mutate(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="pt-2 border-t border-border space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Adicionar alimento da Tabela B.A.S.E.® (opcional)</Label>
                  <Combobox
                    value={alimentoBibliotecaId}
                    onValueChange={adicionarAlimentoDaBiblioteca}
                    placeholder="Buscar alimento (soma calorias e macros automaticamente)..."
                    searchPlaceholder="Digite o nome do alimento ou categoria..."
                    emptyText="Nenhum alimento encontrado."
                    options={bibliotecaAlimentos.map((a) => ({
                      value: a.id,
                      label: `${a.categoria} — ${a.nome} (${a.porcao_g}g · ${a.calorias_kcal}kcal)`,
                    }))}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    placeholder="Nome da refeição (ex.: Café da manhã)"
                    value={novaRefeicao.nome_refeicao}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, nome_refeicao: e.target.value }))}
                  />
                  <Input
                    type="time"
                    value={novaRefeicao.horario_sugerido}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, horario_sugerido: e.target.value }))}
                  />
                  <Textarea
                    className="sm:col-span-2"
                    placeholder="Itens da refeição"
                    value={novaRefeicao.itens}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, itens: e.target.value }))}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Calorias (kcal)"
                    value={novaRefeicao.calorias_kcal}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, calorias_kcal: e.target.value }))}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Proteína (g)"
                    value={novaRefeicao.proteinas_g}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, proteinas_g: e.target.value }))}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Carboidrato (g)"
                    value={novaRefeicao.carboidratos_g}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, carboidratos_g: e.target.value }))}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Gordura (g)"
                    value={novaRefeicao.gorduras_g}
                    onChange={(e) => setNovaRefeicao((p) => ({ ...p, gorduras_g: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  disabled={!novaRefeicao.nome_refeicao.trim() || adicionarRefeicao.isPending}
                  onClick={() => adicionarRefeicao.mutate()}
                >
                  <Plus className="h-4 w-4 mr-1" /> Adicionar refeição
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="publicar">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Publicar dieta</CardTitle>
              <p className="text-xs text-muted-foreground">
                Cria uma cópia congelada (snapshot) do modelo para o aluno. Só aparecem alunos Integrado/Elite.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Aluno</Label>
                  {alunoPublicar && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => setPerfilAberto(true)}>
                      <UserRound className="h-3.5 w-3.5 mr-1" />
                      Perfil Rápido
                    </Button>
                  )}
                </div>
                <Select value={alunoPublicar} onValueChange={setAlunoPublicar}>
                  <SelectTrigger><SelectValue placeholder="Selecione o aluno" /></SelectTrigger>
                  <SelectContent>
                    {alunos.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Modelo</Label>
                <div className="flex gap-2">
                  <Select
                    value={modeloPublicar}
                    onValueChange={(v) => {
                      setModeloPublicar(v);
                      setModeloCarregadoId(null);
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione o modelo" /></SelectTrigger>
                    <SelectContent>
                      {modelos.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.titulo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!modeloPublicar}
                    onClick={() => setModeloCarregadoId(modeloPublicar)}
                  >
                    <FolderOpen className="h-4 w-4 mr-1" />
                    Carregar Modelo
                  </Button>
                </div>
              </div>

              {PARSER_DIETA_PDF_HABILITADO && (
                <div className="pt-1">
                  <p className="text-xs text-muted-foreground mb-1.5">
                    Ou pule o modelo e publique um PDF direto para este aluno:
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!alunoPublicar}
                    onClick={() => {
                      setImportarPdfModo("aluno");
                      setImportarPdfAberto(true);
                    }}
                  >
                    <FileUp className="h-4 w-4 mr-1" /> Importar de PDF para este aluno
                  </Button>
                </div>
              )}

              {modeloCarregadoId && (
                <div className="space-y-1.5 pt-1 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground pt-2">Ficha carregada</p>
                  {refeicoesModeloCarregado.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Este modelo ainda não tem refeições cadastradas.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Refeição</TableHead>
                          <TableHead>Horário</TableHead>
                          <TableHead>Itens</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {refeicoesModeloCarregado.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{r.nome_refeicao}</TableCell>
                            <TableCell>{r.horario_sugerido ?? "—"}</TableCell>
                            <TableCell className="max-w-xs truncate">{r.itens ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Título da dieta publicada</Label>
                <Input value={tituloPublicar} onChange={(e) => setTituloPublicar(e.target.value)} placeholder="Ex.: Plano Alimentar — Fase 1" />
              </div>
            </CardContent>
          </Card>

          {alunoPublicar && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Histórico de versões</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Cada publicação gera uma versão travada (snapshot imutável) — o histórico abaixo é só
                  para consulta e rastreabilidade; versões antigas não podem ser editadas.
                </p>
              </CardHeader>
              <CardContent>
                {historico.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma dieta publicada para este aluno ainda.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Título</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Publicado em</TableHead>
                        <TableHead>Versão</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historico.map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{h.titulo}</TableCell>
                          <TableCell>
                            <Badge variant={h.status === "ativo" ? "default" : "outline"}>
                              {STATUS_DIETA_LABEL[h.status ?? ""] ?? h.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{new Date(h.created_at).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {h.versao_id.slice(0, 8)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="max-w-3xl mx-auto flex items-center justify-end gap-2 px-4 py-3">
          <Button variant="outline" onClick={cancelar}>
            Cancelar
          </Button>
          <Button
            className="gradient-primary text-primary-foreground font-semibold"
            disabled={!alunoPublicar || !modeloPublicar || !tituloPublicar || publicar.isPending}
            onClick={() => publicar.mutate()}
          >
            {publicar.isPending ? "Publicando..." : "Salvar e Publicar B.A.S.E.®"}
          </Button>
        </div>
      </div>

      <Sheet open={perfilAberto} onOpenChange={setPerfilAberto}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Perfil Rápido do Aluno</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Objetivo</p>
              <p className="text-sm">{perfilAluno?.objetivo || "Não informado"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Lesões / Restrições</p>
              <p className="text-sm whitespace-pre-wrap">{perfilAluno?.doresLesoes || "Nenhuma relatada"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Última Ficha Ativa</p>
              {ultimaFichaAtiva ? (
                <p className="text-sm">
                  {ultimaFichaAtiva.titulo} — publicada em{" "}
                  {new Date(ultimaFichaAtiva.created_at).toLocaleDateString("pt-BR")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma dieta ativa publicada.</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={importarPdfAberto}
        onOpenChange={(open) => {
          setImportarPdfAberto(open);
          // Antes, fechar o diálogo descartava a extração inteira sem
          // perguntar. Ela agora fica no rascunho da sessão, e reabrir
          // oferece retomar.
          if (!open) setDietaExtraida(null);
        }}
      >
        <DialogContent
          className="max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>
              {importarPdfModo === "aluno" ? "Importar PDF direto para o aluno" : "Importar dieta de PDF"}
            </DialogTitle>
          </DialogHeader>

          {!dietaExtraida && pdfSalvo?.dados?.dietaExtraida && (
            // Retomar custa um clique; refazer custa outra extração paga e
            // outra revisão item a item.
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-xs">
                Há uma extração não finalizada desta sessão ({descreverQuandoSalvou(pdfSalvo.salvoEm)}):{" "}
                <span className="font-medium">
                  {pdfSalvo.dados.dietaExtraida.refeicoes?.length ?? 0} refeição(ões)
                </span>
                .
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={restaurarPdf}>
                  Retomar
                </Button>
                <Button size="sm" variant="ghost" onClick={descartarRascunhoPdf}>
                  Descartar
                </Button>
              </div>
            </div>
          )}

          {!dietaExtraida ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {importarPdfModo === "aluno"
                  ? "Envie um PDF com um plano alimentar — ele será publicado direto no prontuário do aluno selecionado, sem passar pela Biblioteca de Modelos."
                  : "Envie um PDF com um plano alimentar (de outro sistema ou digitado livremente). A extração é automática (Google Gemini) — revise sempre as refeições antes de publicar para um aluno."}
              </p>
              <Input
                type="file"
                accept="application/pdf,.pdf"
                disabled={importarDietaPdf.isPending}
                onChange={(e) => {
                  const input = e.target;
                  const file = input.files?.[0];
                  if (!file) return;
                  // Só zera o input depois que a leitura terminar: em alguns
                  // navegadores Android, limpar o value com o arquivo ainda
                  // sendo lido invalida a referência e a leitura falha.
                  importarDietaPdf.mutate(file, {
                    onSettled: () => {
                      input.value = "";
                    },
                  });
                }}
              />
              {importarDietaPdf.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> A extrair e estruturar dieta com IA...
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{importarPdfModo === "aluno" ? "Título da dieta" : "Título do modelo"}</Label>
                <Input
                  placeholder="Ex.: Plano importado — Fase 1"
                  value={novoModeloTitulo}
                  onChange={(e) => setNovoModeloTitulo(e.target.value)}
                />
              </div>
              {dietaExtraida.observacoes_gerais && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Observações gerais</Label>
                  <p className="text-sm whitespace-pre-line rounded-md border border-border p-2 bg-muted/30">
                    {dietaExtraida.observacoes_gerais}
                  </p>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {dietaExtraida.refeicoes.length} refeiç{dietaExtraida.refeicoes.length === 1 ? "ão encontrada" : "ões encontradas"}.{" "}
                {importarPdfModo === "aluno"
                  ? "Revise antes de publicar — a dieta publicada é uma versão travada (snapshot), não editável depois."
                  : "Revise antes de salvar — você poderá editar cada refeição depois na Biblioteca."}
              </p>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {dietaExtraida.refeicoes.map((r, i) => (
                  <div key={i} className="p-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{r.nome}</p>
                      {r.horario && <span className="text-xs text-muted-foreground">{r.horario}</span>}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {r.itens.map((item, j) => (
                        <li key={j} className="text-xs text-muted-foreground">
                          {item.alimento} — {item.quantidade}
                          {item.substituicoes.length > 0 && (
                            <span className="italic"> (substituições: {item.substituicoes.join(", ")})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            {dietaExtraida && (
              <Button variant="outline" onClick={() => setDietaExtraida(null)}>
                Voltar
              </Button>
            )}
            <Button
              disabled={!dietaExtraida || confirmarImportacaoPdf.isPending}
              onClick={() => confirmarImportacaoPdf.mutate()}
            >
              {confirmarImportacaoPdf.isPending
                ? "Salvando..."
                : importarPdfModo === "aluno"
                  ? "Publicar para o aluno"
                  : "Salvar modelo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
