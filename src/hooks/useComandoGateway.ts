import { useCallback, useEffect, useRef, useState } from "react";
import { aguardarComando, solicitarComando, type Comando, type TipoComando } from "@/lib/gateway";

export type EstadoComando =
  | { fase: "ocioso" }
  | { fase: "enviando"; tipo: TipoComando }
  | { fase: "aguardando"; tipo: TipoComando; comando: Comando | null }
  | { fase: "fim"; tipo: TipoComando; comando: Comando };

/**
 * Pede uma ordem ao Gateway e acompanha até o fim, para a tela mostrar o que
 * está acontecendo ("aguardando o Gateway", "em execução", o resultado) em
 * vez de um botão que gira sem dizer nada enquanto o aluno está com o dedo
 * no leitor.
 */
export function useComandoGateway() {
  const [estado, setEstado] = useState<EstadoComando>({ fase: "ocioso" });
  // A ordem continua no Gateway se a tela fechar; só a tela para de acompanhar.
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const executar = useCallback(
    async (
      catracaId: string,
      tipo: TipoComando,
      opcoes: { parametros?: Record<string, unknown>; alunoId?: string | null; motivo?: string | null } = {}
    ): Promise<Comando> => {
      setEstado({ fase: "enviando", tipo });
      try {
        const id = await solicitarComando(catracaId, tipo, opcoes);
        setEstado({ fase: "aguardando", tipo, comando: null });
        const comando = await aguardarComando(id, {
          aoMudar: (c) => vivo.current && setEstado({ fase: "aguardando", tipo, comando: c }),
        });
        if (vivo.current) setEstado({ fase: "fim", tipo, comando });
        return comando;
      } catch (e) {
        setEstado({ fase: "ocioso" });
        throw e;
      }
    },
    []
  );

  const limpar = useCallback(() => setEstado({ fase: "ocioso" }), []);
  const emAndamento = estado.fase === "enviando" || estado.fase === "aguardando";

  return { estado, executar, limpar, emAndamento };
}
