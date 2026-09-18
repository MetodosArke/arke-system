import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Upload, FileSpreadsheet, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

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
  { value: "nivel_atacado", label: "Plano (essencial/integrado/elite)" },
  { value: "ignorar", label: "— Ignorar coluna —" },
] as const;

type CampoDestino = (typeof CAMPOS_DESTINO)[number]["value"];

interface LinhaResultado {
  linha: number;
  nome: string;
  email: string;
  status: "pendente" | "sucesso" | "erro";
  mensagem?: string;
}

export default function AdminImportarAlunos() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [colunas, setColunas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [mapeamento, setMapeamento] = useState<Record<string, CampoDestino>>({});
  const [resultados, setResultados] = useState<LinhaResultado[] | null>(null);
  const [importando, setImportando] = useState(false);

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
        const normalizado = col.trim().toLowerCase();
        if (/nome/.test(normalizado)) autoMapa[col] = "full_name";
        else if (/e-?mail/.test(normalizado)) autoMapa[col] = "email";
        else if (/telefone|celular|fone/.test(normalizado)) autoMapa[col] = "telefone";
        else if (/cpf/.test(normalizado)) autoMapa[col] = "cpf";
        else if (/plano|nivel|nível/.test(normalizado)) autoMapa[col] = "nivel_atacado";
        else autoMapa[col] = "ignorar";
      }
      setMapeamento(autoMapa);
    } catch (error) {
      console.error(error);
      toast({ title: "Erro ao ler o arquivo", description: "Verifique se é um .csv ou .xlsx válido.", variant: "destructive" });
    }
  };

  const camposMapeados = new Set(Object.values(mapeamento));
  const mapeamentoValido = camposMapeados.has("full_name") && camposMapeados.has("email") && camposMapeados.has("nivel_atacado");

  const linhaParaRegistro = (linha: Record<string, string>) => {
    const registro: Record<CampoDestino, string> = {
      full_name: "",
      email: "",
      telefone: "",
      cpf: "",
      nivel_atacado: "",
      ignorar: "",
    };
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
      return { linha: i + 1, nome: reg.full_name, email: reg.email, status: "pendente" };
    });
    setResultados(inicial);

    for (let i = 0; i < linhas.length; i++) {
      const registro = linhaParaRegistro(linhas[i]);
      const nivel = registro.nivel_atacado.trim().toLowerCase();
      const nivelValido = ["essencial", "integrado", "elite"].includes(nivel);

      if (!registro.full_name || !registro.email || !nivelValido) {
        setResultados((prev) =>
          prev!.map((r, idx) =>
            idx === i ? { ...r, status: "erro", mensagem: "Nome, e-mail e plano válido são obrigatórios." } : r
          )
        );
        continue;
      }

      try {
        const { error } = await supabase.functions.invoke<{ user_id: string }>("convidar-membro", {
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
        setResultados((prev) => (prev ? prev.map((r, idx) => (idx === i ? { ...r, status: "sucesso" } : r)) : prev));
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
          <p className="text-xs text-muted-foreground">Formatos aceitos: .csv e .xlsx — até 5MB / 2000 linhas.</p>
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
                Mapeie pelo menos Nome, E-mail e Plano para prosseguir.
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
                      {r.status === "sucesso" && (
                        <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> OK</Badge>
                      )}
                      {r.status === "erro" && (
                        <Badge variant="destructive" className="gap-1" title={r.mensagem}>
                          <XCircle className="h-3 w-3" /> {r.mensagem ?? "Erro"}
                        </Badge>
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
