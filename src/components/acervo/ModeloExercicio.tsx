import { Button } from "@/components/ui/button";
import { MidiaExercicio } from "@/components/acervo/MidiaExercicio";
import { useModeloExercicio } from "@/hooks/useModeloExercicio";
import {
  devePerguntarModelo,
  escolherMidiaExercicio,
  ROTULO_MODELO,
  type MidiasDoExercicio,
  type ModeloExercicio,
} from "@/lib/modeloExercicio";
import { cn } from "@/lib/utils";

const MODELOS: ModeloExercicio[] = ["masculino", "feminino"];

/**
 * A troca entre o modelo masculino e o feminino dos GIFs. Grava a escolha da
 * própria pessoa e vale para todos os exercícios.
 */
export function AlternarModelo({ className }: { className?: string }) {
  const { preferencia, definir, definindo } = useModeloExercicio();
  const atual = preferencia ?? "masculino";
  return (
    <div role="group" aria-label="Modelo dos GIFs de exercício" className={cn("inline-flex rounded-md border border-border p-0.5", className)}>
      {MODELOS.map((modelo) => (
        <button
          key={modelo}
          type="button"
          aria-pressed={atual === modelo}
          disabled={definindo}
          onClick={() => atual !== modelo && definir(modelo)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            atual === modelo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {ROTULO_MODELO[modelo]}
        </button>
      ))}
    </div>
  );
}

/**
 * A mídia do exercício pela regra do modelo (`escolherMidiaExercicio`), com a
 * troca logo abaixo quando o exercício tem os dois GIFs. `comVideo={false}`
 * mostra só a imagem, para as telas que abrem o vídeo à parte.
 */
export function MidiaComModelo({
  midias,
  nome,
  className,
  comVideo = true,
}: {
  midias: MidiasDoExercicio;
  nome: string;
  className?: string;
  comVideo?: boolean;
}) {
  const { preferencia } = useModeloExercicio();
  const midia = escolherMidiaExercicio(midias, preferencia);
  const videoUrl = comVideo ? midia.videoUrl : null;
  if (!videoUrl && !midia.imagemUrl) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      <MidiaExercicio videoUrl={videoUrl} imagemUrl={midia.imagemUrl} nome={nome} />
      {midia.temOsDois && <AlternarModelo />}
    </div>
  );
}

/**
 * A pergunta da primeira vez: "Ver os exercícios com modelo masculino ou
 * feminino?". Aparece em linha, sem bloquear o treino, só quando algum
 * exercício da tela tem os dois GIFs; "Agora não" deixa o masculino.
 */
export function PerguntaModelo({ exercicios, className }: { exercicios: MidiasDoExercicio[]; className?: string }) {
  const { preferencia, carregada, pulou, pular, definir, definindo } = useModeloExercicio();
  if (!devePerguntarModelo(preferencia, { carregada, pulou }, exercicios)) return null;
  return (
    <section aria-labelledby="pergunta-modelo-titulo" className={cn("rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2", className)}>
      <p id="pergunta-modelo-titulo" className="text-sm font-medium">
        Ver os exercícios com modelo masculino ou feminino?
      </p>
      <p className="text-xs text-muted-foreground">É só a pessoa que aparece no GIF. Dá para trocar depois, em qualquer exercício.</p>
      <div className="flex flex-wrap gap-2">
        {MODELOS.map((modelo) => (
          <Button key={modelo} type="button" size="sm" variant="outline" disabled={definindo} onClick={() => definir(modelo)}>
            {ROTULO_MODELO[modelo]}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={pular}>
          Agora não
        </Button>
      </div>
    </section>
  );
}
