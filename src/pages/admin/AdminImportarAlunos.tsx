import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { erroCpf } from "@/lib/cpf";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, ArrowLeft, CheckCircle2, XCircle, MessageCircle } from "lucide-react";
import { abrirWhatsAppAtivacao } from "@/lib/whatsappAtivacao";
import type { TablesInsert } from "@/integrations/supabase/types";

// Limites de sanidade: este importador roda inteiramente no navegador do
// staff (nenhum arquivo é enviado a um servidor além das linhas já
// processadas), mas ainda assim protegemos contra arquivos enormes que
// travariam a aba ou estourariam o parser.
const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024; // 5MB
const LINHAS_MAXIMAS = 2000;

const CAMPOS_DESTINO = [
  { value: "full_name", label: "Nome completo" },
  { value: "email", label: "E-mail" },
  { value: "telefone", label: "Telefone" },
  { value: "cpf", label: "CPF" },
  { value: "nivel_atacado", label: "Nível do Método ARKE (opcional — essencial/integrado/elite)" },
  // Histórico de avaliação física — opcionais: preenchidos só se a academia
  // de origem exportar esses dados (ex.: migrando de NextFit/Pacto). Vão
  // direto para avaliacoes_fisicas, criando o primeiro registro do aluno
  // no ArkeFit em vez de ele começar "do zero".
  { value: "peso_kg", label: "Avaliação física — Peso (kg)" },
  { value: "altura_cm", label: "Avaliação física — Altura (cm)" },
  { value: "percentual_gordura", label: "Avaliação física — % Gordura" },
  { value: "dc_triceps", label: "Dobra cutânea — Tríceps (mm)" },
  { value: "dc_subescapular", label: "Dobra cutânea — Subescapular (mm)" },
  { value: "dc_suprailiaca", label: "Dobra cutânea — Suprailíaca (mm)" },
  { value: "dc_abdominal", label: "Dobra cutânea — Abdominal (mm)" },
  { value: "dc_coxa", label: "Dobra cutânea — Coxa (mm)" },
  { value: "dc_peitoral", label: "Dobra cutânea — Peitoral (mm)" },
  { value: "dc_axilar_media", label: "Dobra cutânea — Axilar média (mm)" },
  { value: "perim_braco", label: "Perimetria — Braço (cm)" },
  { value: "perim_antebraco", label: "Perimetria — Antebraço (cm)" },
  { value: "perim_cintura", label: "Perimetria — Cintura (cm)" },
  { value: "perim_abdomen", label: "Perimetria — Abdômen (cm)" },
  { value: "perim_quadril", label: "Perimetria — Quadril (cm)" },
  { value: "perim_coxa", label: "Perimetria — Coxa (cm)" },
  { value: "perim_panturrilha", label: "Perimetria — Panturrilha (cm)" },
  { value: "historico_clinico", label: "Histórico clínico / observações da ficha antiga" },
  { value: "ignorar", label: "— Ignorar coluna —" },
] as const;

type CampoDestino = (typeof CAMPOS_DESTINO)[number]["value"];

// Colunas de avaliação física: se pelo menos uma vier preenchida numa
// linha, criamos o registro inicial em avaliacoes_fisicas pro aluno
// importado — dá continuidade ao histórico em vez de começar do zero.
const CAMPOS_AVALIACAO_FISICA = [
  "peso_kg",
  "altura_cm",
  "percentual_gordura",
  "dc_triceps",
  "dc_subescapular",
  "dc_suprailiaca",
  "dc_abdominal",
  "dc_coxa",
  "dc_peitoral",
  "dc_axilar_media",
  "perim_braco",
  "perim_antebraco",
  "perim_cintura",
  "perim_abdomen",
  "perim_quadril",
  "perim_coxa",
  "perim_panturrilha",
] as const satisfies readonly CampoDestino[];

// Remove acentos e baixa a caixa pra comparar nomes de coluna de forma
// tolerante ("Tríceps", "triceps", "TRICEPS" todos batem).
const normalizarTexto = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const temPerimetria = (t: string) => /circunferencia|perimetro|perimetria|circumference/.test(t);
const temDobra = (t: string) => /dobra|prega\s*cutanea|skinfold|\bdc\b/.test(t);

// De-para automático: reconhece nomes de coluna em variações de
// português e inglês (planilhas de outros sistemas — NextFit, Pacto,
// exportações internacionais — não usam sempre os mesmos nomes). Ordem
// importa: regras mais específicas (que combinam uma palavra-chave de
// dobra/perimetria com a parte do corpo) vêm antes das genéricas, pra
// "Abdômen" isolado (ambíguo) não virar nem dobra nem perimetria
// sozinho — melhor deixar sem mapear do que mapear errado.
const REGRAS_AUTO_MAPA: { campo: CampoDestino; teste: (t: string) => boolean }[] = [
  { campo: "full_name", teste: (t) => /\bnome\b|\bname\b/.test(t) },
  { campo: "email", teste: (t) => /e-?mail/.test(t) },
  { campo: "telefone", teste: (t) => /telefone|celular|\bfone\b|\bphone\b|whatsapp/.test(t) },
  { campo: "cpf", teste: (t) => /\bcpf\b/.test(t) },
  { campo: "nivel_atacado", teste: (t) => /\bplano\b|\bnivel\b|\blevel\b|\bplan\b/.test(t) },

  { campo: "perim_braco", teste: (t) => temPerimetria(t) && /\bbraco\b|\barm\b/.test(t) && !/antebraco|forearm/.test(t) },
  { campo: "perim_antebraco", teste: (t) => temPerimetria(t) && /antebraco|forearm/.test(t) },
  { campo: "perim_cintura", teste: (t) => temPerimetria(t) && /cintura|waist/.test(t) },
  { campo: "perim_abdomen", teste: (t) => temPerimetria(t) && /abdomen|abdominal/.test(t) },
  { campo: "perim_quadril", teste: (t) => temPerimetria(t) && /quadril|\bhip\b/.test(t) },
  { campo: "perim_coxa", teste: (t) => temPerimetria(t) && /coxa|thigh/.test(t) },
  { campo: "perim_panturrilha", teste: (t) => temPerimetria(t) && /panturrilha|\bcalf\b/.test(t) },

  { campo: "dc_triceps", teste: (t) => temDobra(t) && /triceps/.test(t) },
  { campo: "dc_subescapular", teste: (t) => temDobra(t) && /subescapular|subscapular/.test(t) },
  { campo: "dc_suprailiaca", teste: (t) => temDobra(t) && /supra.?ili/.test(t) },
  { campo: "dc_abdominal", teste: (t) => temDobra(t) && /abdomen|abdominal/.test(t) },
  { campo: "dc_coxa", teste: (t) => temDobra(t) && /coxa|thigh/.test(t) },
  { campo: "dc_peitoral", teste: (t) => temDobra(t) && /peitoral|peito|chest/.test(t) },
  { campo: "dc_axilar_media", teste: (t) => temDobra(t) && /axilar/.test(t) },

  { campo: "peso_kg", teste: (t) => /\bpeso\b|\bweight\b/.test(t) },
  { campo: "altura_cm", teste: (t) => /\baltura\b|\bheight\b|\bestatura\b/.test(t) },
  { campo: "percentual_gordura", teste: (t) => /gordura|body\s*fat|\bbf%?\b/.test(t) },
  { campo: "historico_clinico", teste: (t) => /historico|observa|\bobs\b|\bnota\b|\bnote\b/.test(t) },
];

const detectarCampo = (nomeColuna: string): CampoDestino => {
  const normalizado = normalizarTexto(nomeColuna);
  return REGRAS_AUTO_MAPA.find((regra) => regra.teste(normalizado))?.campo ?? "ignorar";
};

// Planilhas brasileiras costumam usar vírgula decimal ("70,5") — aceita
// os dois formatos.
const paraNumero = (valor: string): number | null => {
  if (!valor.trim()) return null;
  const normalizado = valor.trim().replace(",", ".");
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
};

// Cria o primeiro registro de avaliação física do aluno importado, a
// partir das colunas históricas mapeadas na planilha (peso, dobras,
// perimetria, histórico clínico). Não usa edge function: staff já tem
// permissão de INSERT direto em avaliacoes_fisicas via RLS (mesma regra
// usada pelo AvaliacaoFisicaDialog no cadastro manual).
async function importarAvaliacaoFisica(params: {
  organizationId: string;
  userId: string;
  registro: Record<CampoDestino, string>;
}): Promise<{ error?: string }> {
  const { data: aluno, error: erroAluno } = await supabase
    .from("alunos")
    .select("id")
    .eq("user_id", params.userId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (erroAluno || !aluno) {
    return { error: erroAluno?.message ?? "aluno não encontrado após o convite" };
  }

  const payload: Record<string, string | number> = {
    organization_id: params.organizationId,
    aluno_id: aluno.id,
  };
  for (const campo of CAMPOS_AVALIACAO_FISICA) {
    const numero = paraNumero(params.registro[campo]);
    if (numero !== null) payload[campo] = numero;
  }
  const historico = params.registro.historico_clinico.trim();
  if (historico) payload.historico_clinico = historico;

  const { error: erroInsert } = await supabase
    .from("avaliacoes_fisicas")
    .insert(payload as TablesInsert<"avaliacoes_fisicas">);
  return erroInsert ? { error: erroInsert.message } : {};
}

interface LinhaResultado {
  linha: number;
  nome: string;
  email: string;
  telefone?: string;
  user_id?: string;
  status: "pendente" | "sucesso" | "erro";
  mensagem?: string;
}

export default function AdminImportarAlunos() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [colunas, setColunas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [mapeamento, setMapeamento] = useState<Record<string, CampoDestino>>({});
  const [resultados, setResultados] = useState<LinhaResultado[] | null>(null);
  const [importando, setImportando] = useState(false);
  const [enviandoWhatsAppLinha, setEnviandoWhatsAppLinha] = useState<number | null>(null);

  const enviarWhatsApp = async (r: LinhaResultado) => {
    if (!r.user_id) return;
    setEnviandoWhatsAppLinha(r.linha);
    const resultado = await abrirWhatsAppAtivacao({
      userId: r.user_id,
      telefone: r.telefone,
      alunoNome: r.nome,
      organizacaoNome: organization?.nome ?? "sua academia",
    });
    setEnviandoWhatsAppLinha(null);
    if (!resultado.ok) {
      toast({ title: "Não foi possível gerar o link", description: resultado.erro, variant: "destructive" });
    }
  };

  const handleArquivo = async (file: File) => {
    if (file.size > TAMANHO_MAXIMO_BYTES) {
      toast({ title: "Arquivo muito grande", description: "O limite é 5MB por importação.", variant: "destructive" });
      return;
    }
    try {
      // Import dinâmico: mantém a lib de parsing (pesada) fora do bundle
      // principal, carregada só quando o staff realmente usa o importador.
      const { read: readWorkbook, utils: xlsxUtils } = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = readWorkbook(buffer, { type: "array" });
      const primeiraAba = workbook.SheetNames[0];
      const linhasBrutas = xlsxUtils.sheet_to_json<Record<string, string>>(workbook.Sheets[primeiraAba], {
        defval: "",
        raw: false,
      });
      if (linhasBrutas.length === 0) {
        toast({ title: "Planilha vazia", description: "Nenhuma linha encontrada.", variant: "destructive" });
        return;
      }
      const limitadas = linhasBrutas.slice(0, LINHAS_MAXIMAS);
      if (linhasBrutas.length > LINHAS_MAXIMAS) {
        toast({ title: "Arquivo truncado", description: `Só as primeiras ${LINHAS_MAXIMAS} linhas foram carregadas.` });
      }
      const colunasDetectadas = Object.keys(limitadas[0]);
      setColunas(colunasDetectadas);
      setLinhas(limitadas);
      setResultados(null);

      // De-para automático por nome de coluna aproximado
      const autoMapa: Record<string, CampoDestino> = {};
      for (const col of colunasDetectadas) {
        autoMapa[col] = detectarCampo(col);
      }
      setMapeamento(autoMapa);
    } catch (error) {
      console.error(error);
      toast({ title: "Erro ao ler o arquivo", description: "Verifique se é um .csv ou .xlsx válido.", variant: "destructive" });
    }
  };

  const camposMapeados = new Set(Object.values(mapeamento));
  const mapeamentoValido = camposMapeados.has("full_name") && camposMapeados.has("email");

  const linhaParaRegistro = (linha: Record<string, string>) => {
    const registro = Object.fromEntries(CAMPOS_DESTINO.map((c) => [c.value, ""])) as Record<CampoDestino, string>;
    for (const [coluna, campo] of Object.entries(mapeamento)) {
      if (campo === "ignorar") continue;
      registro[campo] = String(linha[coluna] ?? "").trim();
    }
    return registro;
  };

  const iniciarImportacao = async () => {
    if (!mapeamentoValido) return;
    setImportando(true);
    const inicial: LinhaResultado[] = linhas.map((linha, i) => {
      const reg = linhaParaRegistro(linha);
      return { linha: i + 1, nome: reg.full_name, email: reg.email, telefone: reg.telefone, status: "pendente" };
    });
    setResultados(inicial);

    for (let i = 0; i < linhas.length; i++) {
      const registro = linhaParaRegistro(linhas[i]);
      // Nível do Método ARKE não trava a importação: a academia ainda não tem
      // como importar seus próprios planos, e o aluno importado nem foi
      // apresentado ao método ainda — isso é negociação pós-implantação.
      // Sem valor válido na planilha, o aluno fica sem nível nenhum (não
      // "essencial" por padrão) até o staff registrar a adesão de verdade.
      const nivelBruto = registro.nivel_atacado.trim().toLowerCase();
      const nivel = ["essencial", "integrado", "elite"].includes(nivelBruto)
        ? (nivelBruto as "essencial" | "integrado" | "elite")
        : undefined;

      if (!registro.full_name || !registro.email) {
        setResultados((prev) =>
          prev!.map((r, idx) => (idx === i ? { ...r, status: "erro", mensagem: "Nome e e-mail são obrigatórios." } : r))
        );
        continue;
      }

      // Barrado antes da chamada de rede: numa planilha de sistema antigo o
      // CPF vem truncado, com dígito trocado ou com sequência de
      // preenchimento. Gastar um round-trip por linha ruim atrasa a
      // importação inteira, e o CPF é a chave de leitura da catraca — deixar
      // passar vira aluno que não entra na academia meses depois.
      const problemaCpf = registro.cpf ? erroCpf(registro.cpf) : null;
      if (problemaCpf) {
        setResultados((prev) =>
          prev!.map((r, idx) => (idx === i ? { ...r, status: "erro", mensagem: problemaCpf } : r))
        );
        continue;
      }

      try {
        const { data, error } = await supabase.functions.invoke<{ user_id: string }>("convidar-membro", {
          body: {
            email: registro.email,
            full_name: registro.full_name,
            telefone: registro.telefone || undefined,
            cpf: registro.cpf || undefined,
            papel: "aluno",
            nivel_atacado: nivel,
          },
        });
        if (error) throw error;

        let mensagemAvaliacao: string | undefined;
        const temHistorico = CAMPOS_AVALIACAO_FISICA.some((campo) => registro[campo].trim() !== "");
        if (data?.user_id && temHistorico && organization?.id) {
          const { error: erroAvaliacao } = await importarAvaliacaoFisica({
            organizationId: organization.id,
            userId: data.user_id,
            registro,
          });
          if (erroAvaliacao) {
            mensagemAvaliacao = `Aluno importado, mas a avaliação física antiga não foi salva: ${erroAvaliacao}`;
          }
        }

        // Ficha genérica de transição: aluno migrado de outro sistema já
        // vê um treino no app desde o primeiro dia, sem depender de
        // passar pelo onboarding sozinho (a mesma function que resolve o
        // "app vazio" no onboarding — aqui chamada pelo staff em nome do
        // aluno recém-importado). Falha aqui não invalida a importação,
        // só é reportada na linha.
        if (data?.user_id) {
          const { data: alunoRow } = await supabase.from("alunos").select("id").eq("user_id", data.user_id).maybeSingle();
          if (alunoRow) {
            const { error: erroTreino } = await supabase.functions.invoke("publicar-treino-boas-vindas", {
              body: { aluno_id: alunoRow.id },
            });
            if (erroTreino) {
              mensagemAvaliacao = mensagemAvaliacao
                ? `${mensagemAvaliacao} | Treino de transição não publicado: ${erroTreino.message}`
                : `Aluno importado, mas o treino de transição não foi publicado: ${erroTreino.message}`;
            }
          }
        }

        setResultados((prev) =>
          prev
            ? prev.map((r, idx) =>
                idx === i
                  ? { ...r, status: "sucesso", user_id: data?.user_id, mensagem: mensagemAvaliacao }
                  : r
              )
            : prev
        );
      } catch (error) {
        const mensagem = error instanceof Error ? error.message : "Erro desconhecido";
        setResultados((prev) => (prev ? prev.map((r, idx) => (idx === i ? { ...r, status: "erro", mensagem } : r)) : prev));
      }
    }

    setImportando(false);
    toast({ title: "Importação concluída", description: "Confira o resultado de cada linha abaixo." });
  };

  const totalSucesso = resultados?.filter((r) => r.status === "sucesso").length ?? 0;
  const totalErro = resultados?.filter((r) => r.status === "erro").length ?? 0;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/admin/alunos")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Importar Alunos em Massa</h1>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">1. Selecione o arquivo</CardTitle>
          <p className="text-xs text-muted-foreground">
            Formatos aceitos: .csv e .xlsx — até 5MB / 2000 linhas. As colunas são reconhecidas automaticamente
            mesmo com nomes diferentes ou em inglês (ex.: "weight" vira Peso, "waist circumference" vira
            Perimetria — Cintura) — confira o de-para abaixo antes de importar. Se a planilha tiver dados de
            avaliação física (peso, dobras, perimetria) de um sistema anterior, dá pra mapear essas colunas
            também — o histórico do aluno já entra pronto no ArkeFit.
          </p>
        </CardHeader>
        <CardContent>
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:bg-accent/30 transition-colors">
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Clique para escolher um arquivo .csv ou .xlsx</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleArquivo(file);
              }}
            />
          </label>
        </CardContent>
      </Card>

      {colunas.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">2. De-para de colunas</CardTitle>
            <p className="text-xs text-muted-foreground">
              {linhas.length} linha(s) detectada(s). Indique o que cada coluna da planilha representa.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {colunas.map((col) => (
              <div key={col} className="flex items-center gap-3">
                <span className="flex-1 text-sm font-medium truncate">{col}</span>
                <Select
                  value={mapeamento[col] ?? "ignorar"}
                  onValueChange={(v) => setMapeamento((prev) => ({ ...prev, [col]: v as CampoDestino }))}
                >
                  <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CAMPOS_DESTINO.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {!mapeamentoValido && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Mapeie pelo menos Nome e E-mail para prosseguir.
              </p>
            )}
            <Button disabled={!mapeamentoValido || importando} onClick={() => void iniciarImportacao()}>
              {importando ? "Importando..." : `Importar ${linhas.length} aluno(s)`}
            </Button>
          </CardContent>
        </Card>
      )}

      {resultados && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">3. Resultado</CardTitle>
            <div className="flex gap-2">
              <Badge variant="default">{totalSucesso} importado(s)</Badge>
              {totalErro > 0 && <Badge variant="destructive">{totalErro} com erro</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultados.map((r) => (
                  <TableRow key={r.linha}>
                    <TableCell className="text-xs text-muted-foreground">{r.linha}</TableCell>
                    <TableCell>{r.nome || "—"}</TableCell>
                    <TableCell className="text-xs">{r.email || "—"}</TableCell>
                    <TableCell>
                      {r.status === "pendente" && <span className="text-xs text-muted-foreground">Aguardando...</span>}
                      {r.status === "sucesso" && !r.mensagem && (
                        <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> OK</Badge>
                      )}
                      {r.status === "sucesso" && r.mensagem && (
                        <Badge variant="outline" className="gap-1 text-amber-600 dark:text-amber-400" title={r.mensagem}>
                          <CheckCircle2 className="h-3 w-3" /> Importado, com aviso
                        </Badge>
                      )}
                      {r.status === "erro" && (
                        <Badge variant="destructive" className="gap-1" title={r.mensagem}>
                          <XCircle className="h-3 w-3" /> {r.mensagem ?? "Erro"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === "sucesso" && r.user_id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Enviar Ativação via WhatsApp"
                          disabled={enviandoWhatsAppLinha === r.linha}
                          onClick={() => void enviarWhatsApp(r)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
