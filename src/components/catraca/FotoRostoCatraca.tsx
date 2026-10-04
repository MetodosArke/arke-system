import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, ScanFace } from "lucide-react";
import { lerCadastroRosto, situacaoDoRosto } from "@/lib/cadastroRosto";
import { prepararFotoRosto } from "@/lib/fotoRosto";
import { emPerfilSimulado } from "@/lib/impersonation";
import { AvisoPerfilSimulado } from "@/components/AvisoPerfilSimulado";

/**
 * O aluno manda a foto do próprio rosto para as catracas da academia
 * (decisão do responsável de 02/10/2026: o rosto entra pela câmera do
 * leitor, com a recepção, ou por foto enviada no app).
 *
 * A foto fica só na memória desta tela, fora de rascunho e de qualquer
 * armazenamento do aparelho, e sai daqui reduzida (480x640, até 100 KB). Na
 * nuvem ela mora numa tabela que ninguém lê pela API e é apagada assim que
 * os leitores a recebem, ou em 24 horas.
 *
 * Só aparece quando a academia tem leitor facial que aceita foto e o texto
 * vigente da autorização cobre o rosto. Sem a autorização do próprio aluno,
 * o banco recusa o envio.
 *
 * Uma vez só pelo app (decisão do responsável, 02/10/2026): cadastrado o
 * rosto, ou com a foto a caminho, trocar é com a recepção, pela câmera do
 * leitor. Tentativa que falhou não conta, e o aluno tenta de novo.
 */
export function FotoRostoCatraca({ alunoId }: { alunoId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const simulado = emPerfilSimulado();

  const { data: rosto } = useQuery({
    queryKey: ["cadastro-rosto", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cadastro_rosto", { _aluno_id: alunoId });
      if (error) throw error;
      return lerCadastroRosto(data);
    },
    // Enquanto a foto chega às catracas, a situação muda sozinha.
    refetchInterval: (q) => ((q.state.data?.ultimo?.pendentes ?? 0) > 0 ? 5_000 : false),
  });

  const enviar = useMutation({
    mutationFn: async (dataUrl: string) => {
      const { data, error } = await supabase.rpc("enviar_foto_rosto", { _aluno_id: alunoId, _foto: dataUrl });
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    onSuccess: (catracas) => {
      setFoto(null);
      toast({
        title: "Foto enviada",
        description: `A foto vai para ${catracas === 1 ? "a catraca" : `as ${catracas} catracas`} da academia e é apagada do ArkeFit assim que chega.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["cadastro-rosto", alunoId] });
    },
    onError: (e: Error) => toast({ title: "A foto não foi enviada", description: e.message, variant: "destructive" }),
  });

  if (!rosto?.foto_pelo_app || !rosto.texto_cobre_rosto) return null;

  const situacao = situacaoDoRosto(rosto.ultimo);

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setPreparando(true);
    try {
      setFoto(await prepararFotoRosto(arquivo));
    } catch (e) {
      toast({ title: "Não deu para usar esta foto", description: (e as Error).message, variant: "destructive" });
    } finally {
      setPreparando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <ScanFace className="h-4 w-4 text-primary" /> Meu rosto na catraca
      </p>
      {!rosto.autorizado ? (
        <p className="text-xs text-muted-foreground">
          Para entrar pelo rosto, autorize acima o uso da biometria na catraca. Depois é só mandar uma foto daqui.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Uma foto de frente, com boa luz, sem boné e sem óculos escuros. Ela vai só para os leitores da sua academia e é
            apagada do ArkeFit assim que eles a recebem.
          </p>
          {situacao && (
            <p
              className={`text-xs ${situacao.tom === "falhou" ? "text-destructive" : situacao.tom === "ok" ? "text-success" : "text-muted-foreground"}`}
              role="status"
            >
              {situacao.texto}
            </p>
          )}
          <input
            ref={entrada}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(e) => void escolher(e.target.files?.[0])}
          />
          {!rosto.pode_enviar_pelo_app ? (
            <p className="text-xs text-muted-foreground">Para trocar a foto do rosto, fale com a recepção da academia.</p>
          ) : simulado ? (
            <AvisoPerfilSimulado />
          ) : foto ? (
            <div className="flex items-end gap-3">
              <img src={foto} alt="Prévia da foto do rosto" className="h-32 w-24 rounded-md border object-cover" />
              <div className="flex flex-col gap-2">
                <Button size="sm" disabled={enviar.isPending} onClick={() => enviar.mutate(foto)}>
                  {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Enviar para as catracas
                </Button>
                <Button size="sm" variant="ghost" disabled={enviar.isPending} onClick={() => setFoto(null)}>
                  Tirar outra
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" disabled={preparando} onClick={() => entrada.current?.click()}>
              {preparando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              {rosto.ultimo ? "Tentar com outra foto" : "Tirar a foto"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
