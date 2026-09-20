import { useEffect, useRef, useState } from "react";
import {
  lerRascunho,
  gravarRascunho,
  descartarRascunho,
  rascunhoExpirado,
  armazenamentoPadrao,
  type EscopoRascunho,
} from "@/lib/rascunho";

interface Opcoes {
  /** Pausa a gravação — use para não persistir formulário de diálogo fechado. */
  ativo?: boolean;
  /** Espera antes de gravar, para não escrever a cada tecla. */
  esperaMs?: number;
  horasDeValidade?: number;
  /**
   * `sessao` (padrão) some ao fechar a aba — é o certo em máquina de
   * recepção compartilhada e em formulário com dado de saúde.
   */
  escopo?: EscopoRascunho;
}

/**
 * Autosave de formulário em rascunho local.
 *
 * Não restaura sozinho: devolve o que encontrou e deixa a tela decidir. Um
 * formulário que se preenche sozinho com dados de ontem faz a pessoa salvar
 * sem perceber — quem abriu "nova avaliação" quer campo limpo até dizer o
 * contrário. Quem decide é quem conhece o contexto da tela.
 */
export function useRascunho<T>(chave: string | null, valor: T, opcoes: Opcoes = {}) {
  const { ativo = true, esperaMs = 800, horasDeValidade = 48, escopo = "sessao" } = opcoes;
  const armazenamento = armazenamentoPadrao(escopo);

  const [rascunhoDisponivel, setRascunhoDisponivel] = useState<{ dados: T; salvoEm: Date } | null>(null);
  // Sem isto, o primeiro render gravaria o formulário vazio por cima do
  // rascunho que acabamos de encontrar.
  const jaMontou = useRef(false);

  useEffect(() => {
    if (!chave) return;
    const encontrado = lerRascunho<T>(chave, armazenamento);
    if (encontrado && !rascunhoExpirado(encontrado.salvoEm, horasDeValidade)) {
      setRascunhoDisponivel(encontrado);
    } else if (encontrado) {
      // Velho demais para ser da tarefa de agora: some em vez de ficar
      // oferecendo restauração que ninguém quer.
      descartarRascunho(chave, armazenamento);
    }
    jaMontou.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, horasDeValidade, escopo]);

  useEffect(() => {
    if (!chave || !ativo) return;
    if (!jaMontou.current) {
      jaMontou.current = true;
      return;
    }
    const id = setTimeout(() => gravarRascunho(chave, valor, armazenamento), esperaMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, valor, ativo, esperaMs, escopo]);

  const descartar = () => {
    if (chave) descartarRascunho(chave, armazenamento);
    setRascunhoDisponivel(null);
  };

  return { rascunhoDisponivel, descartar };
}
