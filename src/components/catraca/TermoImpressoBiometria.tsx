import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileSignature, Loader2, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { imprimirTermoBiometria } from "@/lib/termoBiometria";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { useMenorDeIdade } from "@/components/responsavel/useMenorDeIdade";
import { PedidoResponsavel } from "@/components/responsavel/PedidoResponsavel";

const TIPOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const LIMITE = 5 * 1024 * 1024;

/**
 * Autorização da digital para o aluno que não usa o app: a recepção imprime
 * o termo (o mesmo texto e a mesma versão do app), o aluno assina, e a
 * recepção anexa a foto ou o PDF do termo assinado. Quem consente é o aluno —
 * a assinatura é dele; a equipe só registra, e o arquivo fica como prova.
 *
 * Aluno menor (06/10/2026): o termo sai com o nome e a assinatura do
 * responsável legal, e o registro só vale depois do aceite dele pelo link do
 * e-mail, que a recepção envia daqui. Sem data de nascimento, o registro
 * espera a data (na ficha, em Dados).
 *
 * O banco confere de novo tudo o que esta tela confere: papel (gestão ou
 * recepção), aluno em dia, que o arquivo existe na pasta do aluno e, para o
 * menor, o aceite vigente do responsável.
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
  const menor = useMenorDeIdade(alunoId);
  const liberacao = menor.liberacao("biometria");
  const aceite = menor.aceiteVigente("biometria");

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

  const ehMenor = menor.situacao === "menor";
  const podeRegistrar = liberacao === "livre";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium">Aluno sem app: termo impresso</p>
      <p className="text-xs text-muted-foreground">
        {ehMenor
          ? "Imprima, peça ao aluno e ao responsável legal para ler e assinar, e anexe o termo assinado (foto ou PDF)."
          : "Imprima, peça ao aluno para ler e assinar, e anexe o termo assinado (foto ou PDF). É ele quem autoriza — o arquivo é a prova."}
      </p>
      {liberacao === "informar_data" && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Sem a data de nascimento do aluno, não dá para saber se a autorização depende do responsável legal. Informe a
          data em Dados, acima, antes de registrar.
        </p>
      )}
      {ehMenor && aceite && (
        <p className="text-xs text-muted-foreground">
          Aluno menor de 18 anos: {aceite.responsavel_nome} autorizou como responsável legal em{" "}
          {formatarDataBR(aceite.aceito_em)}, pelo link enviado ao e-mail.
        </p>
      )}
      {liberacao === "pedir_responsavel" && (
        <div className="space-y-2 rounded-md bg-amber-500/5 p-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Aluno menor de 18 anos: a autorização só vale depois do aceite do responsável legal, pelo link enviado ao
            e-mail dele (LGPD, art. 14). Envie daqui:
          </p>
          <PedidoResponsavel alunoId={alunoId} propositos={["biometria"]} pedidoAberto={menor.pedidoAberto} pelaAcademia />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          type="button"
          disabled={liberacao === "carregando" || liberacao === "informar_data"}
          onClick={() => {
            const responsavel = ehMenor ? { nome: aceite?.responsavel_nome ?? null } : null;
            if (!imprimirTermoBiometria({ academia, aluno: alunoNome, cpf: alunoCpf, responsavel })) {
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
          disabled={!podeRegistrar}
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
        />
        <Button size="sm" type="button" disabled={!arquivo || !podeRegistrar || registrar.isPending} onClick={() => registrar.mutate()}>
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
