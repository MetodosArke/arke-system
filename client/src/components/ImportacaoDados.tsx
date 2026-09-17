import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { parseImportFile, type ParsedImportFile } from "@/lib/importFile";

type Toast = { title: string; detail: string };
export type ImportEntity = "unidades" | "planos" | "alunos" | "leads" | "turmas";

const ENTITY_LABEL: Record<ImportEntity, string> = { unidades: "Unidades", planos: "Planos de mensalidade", alunos: "Alunos", leads: "Leads", turmas: "Turmas" };
const ENTITY_COLUMNS: Record<ImportEntity, string> = {
  unidades: "nome, slug (opcional), cidade",
  planos: "nome, valor_mensal, periodicidade (mensal/trimestral/semestral/anual — opcional, padrão mensal)",
  alunos: "nome, cpf, email, telefone, data_nascimento (DD/MM/AAAA), responsavel_nome, responsavel_cpf, unidade, plano, valor_mensal, dia_vencimento",
  leads: "nome, email, telefone, origem, interesse, notas",
  turmas: "nome, descricao, limite_vagas, duracao_min",
};

export function ImportacaoDados({ organizationId, onToast, entities }: { organizationId: string; onToast: (toast: Toast) => void; entities?: ImportEntity[] }) {
  const allowedEntities = entities ?? (Object.keys(ENTITY_LABEL) as ImportEntity[]);
  const [entity, setEntity] = useState<ImportEntity>(allowedEntities[0]);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const utils = trpc.useUtils();

  const historyQuery = trpc.importacao.history.useQuery({ organizationId }, { enabled: Boolean(organizationId) });
  const preview = trpc.importacao.preview.useMutation({ onError: (error) => onToast({ title: "Erro ao pré-visualizar", detail: error.message }) });
  const commit = trpc.importacao.commit.useMutation({
    onSuccess: (result) => {
      onToast({ title: "Importação concluída", detail: `${result.inserted} registro(s) importado(s)${result.errors.length ? `, ${result.errors.length} com erro` : ""}.` });
      setFile(null);
      setFileName("");
      preview.reset();
      utils.importacao.history.invalidate({ organizationId });
    },
    onError: (error) => onToast({ title: "Erro ao importar", detail: error.message }),
  });

  const resetForEntity = (next: ImportEntity) => { setEntity(next); setFile(null); setFileName(""); preview.reset(); };

  const handleFile = async (selected?: File) => {
    if (!selected) return;
    setParsing(true);
    preview.reset();
    try {
      const parsed = await parseImportFile(selected);
      if (!parsed.rows.length) { onToast({ title: "Arquivo vazio", detail: "Não encontramos linhas de dados neste arquivo." }); return; }
      setFile(parsed);
      setFileName(selected.name);
    } catch (error) {
      onToast({ title: "Erro ao ler arquivo", detail: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setParsing(false);
    }
  };

  const runPreview = () => { if (!file) return; preview.mutate({ organizationId, entity, rows: file.rows }); };

  const confirmImport = () => {
    if (!file) return;
    commit.mutate({ organizationId, entity, fileName, rows: file.rows });
    setConfirming(false);
  };

  return <Card className="rounded-2xl border-[#e5ece5] bg-white shadow-sm">
    <CardHeader><CardTitle className="text-base text-[#2b271f]">Importação de dados</CardTitle><p className="mt-1 text-xs text-[#918a7d]">Envie uma planilha (.csv, .xlsx ou .xls) para cadastrar vários registros de uma vez.</p></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-1.5">{allowedEntities.map((key) => <button key={key} onClick={() => resetForEntity(key)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${entity === key ? "bg-[#15130f] text-white" : "bg-[#faf7ef] text-[#4b4438]"}`}>{ENTITY_LABEL[key]}</button>)}</div>
      <p className="rounded-lg bg-[#faf7ef] p-2.5 text-[11px] leading-5 text-[#77877d]"><strong className="text-[#4b4438]">Colunas esperadas:</strong> {ENTITY_COLUMNS[entity]}. A primeira linha do arquivo deve ser o cabeçalho com esses nomes.</p>

      <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#d8d0c0] bg-[#faf7ef] p-4 text-xs font-semibold text-[#4b4438] ${parsing ? "opacity-60" : ""}`}>
        <Upload size={15} /> {parsing ? "Lendo arquivo..." : fileName || "Selecionar arquivo .csv/.xlsx"}
        <input type="file" accept=".csv,.xlsx,.xls" disabled={parsing} className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />
      </label>

      {file && <div className="flex items-center justify-between rounded-lg border border-[#eee9df] p-2.5"><div className="flex items-center gap-2 text-xs text-[#4b4438]"><FileSpreadsheet size={14} /> {fileName} · {file.rows.length} linha(s) lida(s)</div><Button onClick={runPreview} disabled={preview.isPending} className="h-8 rounded-lg bg-[#15130f] px-3 text-[11px] text-white">{preview.isPending ? "Analisando..." : "Pré-visualizar"}</Button></div>}

      {preview.data && <div className="space-y-2 rounded-xl border border-[#eee9df] p-3">
        <div className="flex items-center gap-2 text-xs"><Badge className="border-0 bg-[#e5f2df] text-[#4e8b5b]">{preview.data.validRows} válida(s)</Badge>{preview.data.errorRows > 0 && <Badge className="border-0 bg-[#f8e6df] text-[#9a493e]">{preview.data.errorRows} com erro</Badge>}</div>
        {preview.data.errors.length > 0 && <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-[#faf7ef] p-2 text-[11px] text-[#9a493e]">{preview.data.errors.map((error, index) => <p key={index}>Linha {error.row}{error.campo ? ` · ${error.campo}` : ""}: {error.motivo}</p>)}</div>}
        {preview.data.validRows > 0 && <Button onClick={() => setConfirming(true)} disabled={commit.isPending} className="h-9 rounded-lg bg-[#15130f] px-4 text-xs text-white">{commit.isPending ? "Importando..." : `Importar ${preview.data.validRows} registro(s)`}</Button>}
      </div>}

      {confirming && preview.data && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15130f]/45 p-5" role="dialog" aria-modal="true">
        <div className="w-full max-w-md rounded-3xl border border-[#e4e0d7] bg-[#fffdf9] p-6 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[.14em] text-[#b08317]">Confirmação necessária</p>
          <h2 className="mt-2 text-xl font-semibold text-[#2b271f]">Importar {preview.data.validRows} registro(s) de {ENTITY_LABEL[entity].toLowerCase()}?</h2>
          <p className="mt-3 text-sm leading-6 text-[#6f786f]">{preview.data.errorRows > 0 ? `${preview.data.errorRows} linha(s) com erro serão ignoradas e não entram no sistema. ` : ""}Esta ação cria os registros diretamente — os alunos importados não recebem convite automático.</p>
          <div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirming(false)} className="rounded-xl">Cancelar</Button><Button onClick={confirmImport} disabled={commit.isPending} className="rounded-xl bg-[#15130f] text-white">{commit.isPending ? "Importando..." : "Confirmar importação"}</Button></div>
        </div>
      </div>}

      {(historyQuery.data ?? []).length > 0 && <div className="space-y-1.5"><p className="text-[10px] font-semibold uppercase tracking-[.1em] text-[#9b9488]">Importações anteriores</p>{(historyQuery.data ?? []).slice(0, 6).map((batch) => <div key={batch.id} className="flex items-center justify-between rounded-lg border border-[#eee9df] p-2 text-[11px] text-[#5c5445]"><span className="truncate">{batch.file_name} · {ENTITY_LABEL[batch.entity as ImportEntity] ?? batch.entity}</span><span className="shrink-0 text-[#9b9488]">{batch.valid_rows}/{batch.total_rows} · {new Date(batch.created_at).toLocaleDateString("pt-BR")}</span></div>)}</div>}
    </CardContent>
  </Card>;
}

export default ImportacaoDados;
