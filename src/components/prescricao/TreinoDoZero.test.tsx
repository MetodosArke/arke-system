import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TreinoDoZero, type ExercicioDoAcervo } from "./TreinoDoZero";
import type { ItemDoZero } from "@/lib/treinoDoZero";

vi.mock("@/hooks/useModeloExercicio", () => ({ useModeloExercicio: () => ({ preferencia: null }) }));
vi.mock("@/hooks/useListasAcervo", () => ({ useListasAcervo: () => ({ grupos: [], equipamentos: [] }) }));

const acervo: ExercicioDoAcervo[] = [
  {
    id: "ex-agachamento",
    nome: "Agachamento livre",
    grupo_muscular: "Pernas",
    grupos_musculares: ["Pernas"],
    equipamento: "Barra",
    organization_id: null,
    ativo: true,
    series_padrao: 4,
    repeticoes_padrao: "10",
    descanso_padrao_seg: 90,
    descricao_execucao: "Desça até 90 graus",
    video_url: null,
    gif_url: "https://exemplo/agachamento.gif",
    gif_masculino_url: null,
    gif_feminino_url: null,
  },
];

describe("montar o treino do zero", () => {
  it("o exercício entra pelo acervo, com o exercicio_id e as séries padrão dele", () => {
    const onChange = vi.fn();
    render(<TreinoDoZero itens={[]} onChange={onChange} exercicios={acervo} modeloPreferido={null} />);
    expect(screen.getByText(/Nenhum exercício ainda/)).toBeInTheDocument();
    // Sem escolher no acervo, não há o que adicionar.
    expect(screen.getByRole("button", { name: /Adicionar exercício/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Agachamento livre/ }));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar exercício/ }));

    const [itens] = onChange.mock.calls[0] as [ItemDoZero[]];
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      chave: 1,
      exercicio_id: "ex-agachamento",
      nome_exercicio: "Agachamento livre",
      divisao: "A",
      descricao_execucao: "Desça até 90 graus",
    });
    expect(itens[0].series_lista).toHaveLength(4);
    expect(itens[0].series_lista[0]).toMatchObject({ reps: "10", descanso_seg: 90 });
  });

  it("lista por divisão, e cada item sai pelo botão com o nome dele", () => {
    const onChange = vi.fn();
    const itens: ItemDoZero[] = [
      { chave: 1, exercicio_id: "ex-agachamento", nome_exercicio: "Agachamento livre", divisao: "A", series_lista: [{ reps: "10", descanso_seg: 90, tecnica: null }], descricao_execucao: "", observacoes: "" },
      { chave: 2, exercicio_id: "ex-agachamento", nome_exercicio: "Agachamento livre", divisao: "B", series_lista: [{ reps: "8", descanso_seg: 60, tecnica: null }], descricao_execucao: "", observacoes: "" },
    ];
    render(<TreinoDoZero itens={itens} onChange={onChange} exercicios={acervo} modeloPreferido={null} />);
    expect(screen.getByText("Treino A", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Treino B", { selector: "p" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Remover Agachamento livre" })[1]);
    expect(onChange).toHaveBeenCalledWith([itens[0]]);
  });
});
