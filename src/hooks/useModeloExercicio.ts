import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { exigirGravacao } from "@/lib/gravacao";
import { porLotes } from "@/lib/paginar";
import {
  exercicioDoAcervo,
  globaisPorNome,
  lerModelo,
  nomesSemVinculo,
  type GifsDoAcervo,
  type ItemDoAcervo,
  type MidiasDoExercicio,
  type ModeloExercicio,
} from "@/lib/modeloExercicio";

const chavePulo = (userId: string) => `arke:modelo-exercicio-pulou:${userId}`;

function lerPulo(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(chavePulo(userId)) === "1";
  } catch {
    return false;
  }
}

/**
 * O modelo dos GIFs de exercício que a pessoa escolheu (`profiles.modelo_exercicio`).
 *
 * A pessoa grava a própria linha pelo RLS de `profiles`; a gravação confere a
 * linha devolvida (`exigirGravacao`), porque o RLS que descarta responde 200
 * com zero linhas. "Agora não" fica só neste navegador: é conveniência de
 * quem vê, e não uma escolha — o padrão segue o masculino.
 */
export function useModeloExercicio() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const chave = useMemo(() => ["modelo-exercicio", userId], [userId]);

  const consulta = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("modelo_exercicio").eq("user_id", userId!).maybeSingle();
      if (error) throw error;
      return lerModelo(data?.modelo_exercicio);
    },
    enabled: !!userId,
    staleTime: 30 * 60_000,
  });

  const [pulouAgora, setPulouAgora] = useState(false);
  const pulou = pulouAgora || lerPulo(userId);

  const pular = useCallback(() => {
    setPulouAgora(true);
    if (!userId) return;
    try {
      localStorage.setItem(chavePulo(userId), "1");
    } catch {
      // Sem armazenamento (janela privada): pula só nesta tela.
    }
  }, [userId]);

  const definir = useMutation({
    mutationFn: async (modelo: ModeloExercicio) => {
      await exigirGravacao(supabase.from("profiles").update({ modelo_exercicio: modelo }).eq("user_id", userId!).select("user_id"));
      return modelo;
    },
    // A troca aparece na hora; se a gravação falhar, volta ao que era.
    onMutate: (modelo) => {
      const anterior = queryClient.getQueryData<ModeloExercicio | null>(chave) ?? null;
      queryClient.setQueryData(chave, modelo);
      return { anterior };
    },
    onError: (erro, _modelo, contexto) => {
      queryClient.setQueryData(chave, contexto?.anterior ?? null);
      toast({
        title: "Não foi possível guardar a escolha",
        description: erro instanceof Error ? erro.message : "Tente de novo.",
        variant: "destructive",
      });
    },
  });

  return {
    preferencia: consulta.data ?? null,
    /** A escolha foi lida do banco (sem erro): só então a pergunta pode aparecer. */
    carregada: consulta.isSuccess,
    pulou,
    pular,
    definir: (modelo: ModeloExercicio) => definir.mutate(modelo),
    definindo: definir.isPending,
  };
}

const COLUNAS_GIFS = "id, nome, organization_id, gif_masculino_url, gif_feminino_url";

/**
 * Os GIFs por modelo dos exercícios de um treino publicado, lidos do acervo
 * pelo `exercicio_id` do snapshot. O snapshot congela a prescrição; a mídia
 * vem do acervo, para o GIF novo aparecer sem republicar a ficha. O item sem
 * `exercicio_id` (os modelos das academias nasceram sem ele até 09/10/2026)
 * usa o exercício global de nome exato (`exercicioDoAcervo`). Se a leitura
 * falhar, o treino segue com a mídia do snapshot (`gif_url`).
 */
export function useGifsDoAcervo(itens: ItemDoAcervo[]) {
  const ids = useMemo(() => [...new Set(itens.map((i) => i.exercicio_id).filter((i): i is string => !!i))].sort(), [itens]);
  const nomes = useMemo(() => nomesSemVinculo(itens), [itens]);
  const consulta = useQuery({
    queryKey: ["acervo-gifs-por-modelo", ids.join(","), nomes.join("\n")],
    queryFn: async () => {
      const [porIdLinhas, porNomeLinhas] = await Promise.all([
        porLotes(ids, (lote) => supabase.from("exercicios_biblioteca").select(COLUNAS_GIFS).in("id", lote)),
        porLotes(nomes, (lote) =>
          supabase.from("exercicios_biblioteca").select(COLUNAS_GIFS).is("organization_id", null).in("nome", lote),
        ),
      ]);
      return {
        porId: new Map((porIdLinhas as GifsDoAcervo[]).map((l) => [l.id, l])),
        porNome: globaisPorNome(porNomeLinhas as GifsDoAcervo[]),
      };
    },
    enabled: ids.length + nomes.length > 0,
    staleTime: 10 * 60_000,
  });
  const mapas = consulta.data;
  return useCallback(
    <T extends MidiasDoExercicio & ItemDoAcervo>(ex: T): T => {
      const doAcervo = mapas ? exercicioDoAcervo(ex, mapas.porId, mapas.porNome) : undefined;
      if (!doAcervo) return ex;
      return { ...ex, gif_masculino_url: doAcervo.gif_masculino_url, gif_feminino_url: doAcervo.gif_feminino_url };
    },
    [mapas],
  );
}
