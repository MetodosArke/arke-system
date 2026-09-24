import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileSignature, Loader2, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { imprimirTermoBiometria } from "@/lib/termoBiometria";

const TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const LIMITE = 5 * 1024 * 1024;

/**
 * Autorização da digital para o aluno que não usa o app: a recepção imprime
 * o termo (o mesmo texto e a mesma versão do app), o aluno assina, e a
 * recepção anexa a foto ou o PDF do termo assinado. Quem consente é o aluno —
 * a assinatura é dele; a equipe só registra, e o arquivo fica como prova.
 *
 * O banco confere de novo tudo o que esta tela confere: papel (gestão ou
 * recepção), aluno em dia, e que o arquivo existe na pasta do aluno.
 */
export function TermoImpressoBiometria({
  alunoId,
  organizationId,
  academia,
  alunoNome,
  alunoCpf,
  emDia,
  aoRegistrar,
}: {
  alunoId: string;
  organizationId: string;
  academia: string;
  alunoNome: string;
  alunoCpf: string | null;
  emDia: boolean;
  aoRegistrar: () => void;
}) {
  const { toast } = useToast();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const registrar = useMutation({
    mutationFn: async () => {
      if (!arquivo) throw new Error("Anexe o termo assinado.");
      if (!TIPOS.includes(arquivo.type)) throw new Error("Anexe PDF ou foto (JPG, PNG ou WebP).");
      if (arquivo.size > LIMITE) throw new Error("O arquivo passa de 5 MB. Tire a foto com resolução menor.");
      const extensao = arquivo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
      const caminho = `${organizationId}/${alunoId}/termo-digital-${Date.now()}.${extensao}`;
      const { error: erroEnvio } = await supabase.storage
        .from("termos-biometria")
        .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (erroEnvio) throw new Error(erroEnvio.message);
      const { error } = await supabase.rpc("registrar_consentimento_biometria_termo", {
        _aluno_id: alunoId,
        _termo_arquivo: caminho,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setArquivo(null);
      if (entrada.current) entrada.current.value = "";
      toast({ title: "Autorização registrada", description: "O termo assinado ficou guardado no cadastro do aluno." });
      aoRegistrar();
    },
    onError: (e: Error) => toast({ title: "Não foi possível registrar", description: e.message, variant: "destructive" }),
  });

  if (!emDia) {
    return (
      <p className="text-xs text-muted-foreground">
        Aluno sem app: o termo impresso fica disponível quando a situação dele estiver <strong>em dia</strong>.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium">Aluno sem app: termo impresso</p>
      <p className="text-xs text-muted-foreground">
        Imprima, peça ao aluno para ler e assinar, e anexe o termo assinado (foto ou PDF). É ele quem autoriza — o
        arquivo é a prova.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => {
            if (!imprimirTermoBiometria({ academia, aluno: alunoNome, cpf: alunoCpf })) {
              toast({ title: "O navegador bloqueou a janela de impressão", description: "Permita pop-ups para o ARKE e tente de novo.", variant: "destructive" });
            }
          }}
        >
          <Printer className="mr-1.5 h-3.5 w-3.5" /> Imprimir termo
        </Button>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          aria-label="Termo assinado"
          className="max-w-full text-xs"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
        <Button size="sm" type="button" disabled={!arquivo || registrar.isPending} onClick={() => registrar.mutate()}>
          {registrar.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSignature className="mr-1.5 h-3.5 w-3.5" />
          )}
          Registrar autorização
        </Button>
      </div>
    </div>
  );
}
