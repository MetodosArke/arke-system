import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeletorExercicio, type ExercicioSelecionavel } from "@/components/acervo/SeletorExercicio";
import { EditorSeries } from "@/components/acervo/EditorSeries";
import { MiniaturaExercicio } from "@/components/acervo/MidiaExercicio";
import { escolherMidiaExercicio } from "@/lib/modeloExercicio";
import { DIVISOES, divisoesDoTreino, rotuloTecnica, seriesDoExercicio, type SerieDetalhe } from "@/lib/seriesTreino";
import { MAXIMO_DE_ITENS, proximaChave, type ItemDoZero } from "@/lib/treinoDoZero";

const SERIES_PADRAO: SerieDetalhe[] = Array.from({ length: 3 }, () => ({ reps: "12", descanso_seg: 60, tecnica: null }));

/** O exercício do acervo como a prescrição o lê (`PrescricaoTreino`). */
export type ExercicioDoAcervo = ExercicioSelecionavel & {
  id: string;
  nome: string;
  series_padrao: number;
  repeticoes_padrao: string;
  descanso_padrao_seg: number;
  descricao_execucao: string | null;
  video_url: string | null;
};

type NovoItem = Omit<ItemDoZero, "chave" | "exercicio_id" | "nome_exercicio"> & { exercicio_id: string };

const NOVO_VAZIO = (divisao: string): NovoItem => ({
  exercicio_id: "",
  divisao,
  series_lista: SERIES_PADRAO,
  descricao_execucao: "",
  observacoes: "",
});

/**
 * Monta o treino do aluno sem modelo: os exercícios vêm do acervo (o global e
 * o da academia do aluno), cada um com a divisão e as séries. A lista fica só
 * na tela até a publicação, que é de `PrescricaoTreino`.
 */
export function TreinoDoZero<T extends ExercicioDoAcervo>({
  itens,
  onChange,
  exercicios,
  modeloPreferido,
}: {
  itens: ItemDoZero[];
  onChange: (itens: ItemDoZero[]) => void;
  /** O acervo que o seletor oferece (`exercicioDoEscopo`). */
  exercicios: T[];
  modeloPreferido: Parameters<typeof escolherMidiaExercicio>[1];
}) {
  const [novo, setNovo] = useState<NovoItem>(NOVO_VAZIO("A"));
  const acervoPorId = new Map(exercicios.map((e) => [e.id, e]));
  const escolhido = novo.exercicio_id ? acervoPorId.get(novo.exercicio_id) : undefined;
  const divisoes = divisoesDoTreino(itens);
  // As divisões já usadas e a próxima: não se pula de A para D.
  const divisoesOferecidas = DIVISOES.filter((d) => divisoes.includes(d) || d === DIVISOES[Math.min(DIVISOES.length - 1, divisoes.length)]);

  const escolher = (ex: T) =>
    setNovo((p) => ({
      ...p,
      exercicio_id: ex.id,
      series_lista: seriesDoExercicio({ series: ex.series_padrao, repeticoes: ex.repeticoes_padrao, descanso_seg: ex.descanso_padrao_seg }),
      descricao_execucao: ex.descricao_execucao ?? "",
    }));

  const adicionar = () => {
    if (!escolhido) return;
    onChange([...itens, { ...novo, chave: proximaChave(itens), nome_exercicio: escolhido.nome }]);
    // O próximo entra na mesma divisão: normalmente se monta uma divisão inteira de cada vez.
    setNovo(NOVO_VAZIO(novo.divisao));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        O treino é montado só para este aluno e não entra na biblioteca de modelos. Cada exercício vem do acervo, para o
        aluno ver o GIF; o exercício que ainda não está lá se cadastra no acervo antes.
      </p>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum exercício ainda. Escolha no acervo e adicione.</p>
      ) : (
        divisoes.map((div) => (
          <div key={div} className="space-y-1">
            <p className="text-sm font-semibold">Treino {div}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Exercício</TableHead>
                  <TableHead>Séries</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens
                  .filter((i) => i.divisao === div)
                  .map((i) => {
                    const doAcervo = acervoPorId.get(i.exercicio_id);
                    const tecnicas = [...new Set(i.series_lista.map((s) => rotuloTecnica(s.tecnica)).filter(Boolean))];
                    return (
                      <TableRow key={i.chave}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <MiniaturaExercicio
                              imagemUrl={doAcervo ? escolherMidiaExercicio(doAcervo, modeloPreferido).imagemUrl : null}
                              videoUrl={doAcervo?.video_url}
                              nome={i.nome_exercicio}
                            />
                            <span>{i.nome_exercicio}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {i.series_lista.length} × {i.series_lista.map((s) => s.reps).join("-")}
                          <span className="text-muted-foreground"> · {i.series_lista[0]?.descanso_seg ?? 0}s</span>
                          {tecnicas.map((t) => (
                            <Badge key={t} variant="outline" className="ml-1 text-[10px]">
                              {t}
                            </Badge>
                          ))}
                        </TableCell>
                        <TableCell className="w-10">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remover ${i.nome_exercicio}`}
                            onClick={() => onChange(itens.filter((x) => x.chave !== i.chave))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        ))
      )}

      <div className="pt-3 border-t border-border space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Divisão</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Divisão do treino">
            {divisoesOferecidas.map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={novo.divisao === d ? "default" : "outline"}
                aria-pressed={novo.divisao === d}
                onClick={() => setNovo((p) => ({ ...p, divisao: d }))}
              >
                Treino {d}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Escolha no acervo (filtre por grupo e equipamento)</Label>
          <SeletorExercicio exercicios={exercicios} selecionadoId={novo.exercicio_id} onSelect={escolher} />
          {escolhido && <p className="text-sm font-medium">Escolhido: {escolhido.nome}</p>}
        </div>

        {escolhido && (
          <>
            <EditorSeries series={novo.series_lista} onChange={(series_lista) => setNovo((p) => ({ ...p, series_lista }))} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input
                placeholder="Como executar (opcional)"
                aria-label="Como executar"
                value={novo.descricao_execucao}
                onChange={(e) => setNovo((p) => ({ ...p, descricao_execucao: e.target.value }))}
              />
              <Input
                placeholder="Observação para o aluno (opcional)"
                aria-label="Observação para o aluno"
                value={novo.observacoes}
                onChange={(e) => setNovo((p) => ({ ...p, observacoes: e.target.value }))}
              />
            </div>
          </>
        )}

        <Button size="sm" disabled={!escolhido || itens.length >= MAXIMO_DE_ITENS} onClick={adicionar}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar exercício
        </Button>
      </div>
    </div>
  );
}
