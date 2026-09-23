import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Globe, Loader2, Sparkles } from "lucide-react";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

type Resposta = {
  resumo?: string;
  exige_atencao?: boolean;
  reaproveitado?: boolean;
  sem_consentimento?: boolean;
  indisponivel?: boolean;
  motivo?: string;
};

/** Espelho de `public.versao_consentimento_ia()`. Mudou lá, muda aqui. */
const VERSAO_TEXTO = "2026-09-23.3";

type Proposito = "anamnese" | "chat";

const PROPOSITOS: { chave: Proposito; titulo: string; texto: string }[] = [
  {
    chave: "anamnese",
    titulo: "Resumo da minha anamnese para a equipe",
    texto:
      "Autorizo que a inteligência artificial do ARKE leia a minha anamnese para resumir, à equipe que me " +
      "acompanha, o histórico que exige cuidado no treino.",
  },
  {
    chave: "chat",
    titulo: "Apoio à resposta do meu mentor",
    texto:
      "Autorizo que a inteligência artificial do ARKE leia as minhas últimas mensagens com o mentor para " +
      "sugerir a ele um rascunho de resposta. Quem escreve e envia continua sendo o mentor.",
  },
];

/**
 * O consentimento do aluno para a IA ler dado dele.
 *
 * **Específico e destacado** (LGPD art. 11, I), e por isso um bloco próprio em
 * vez de uma linha no termo geral: o consentimento da anamnese não cobre isto,
 * pela mesma razão que não cobria a digital — são finalidades diferentes, e
 * consentimento genérico não é consentimento.
 *
 * **Um interruptor por propósito, e não um só.** Ler a anamnese e ler a
 * conversa são coisas diferentes, e é perfeitamente coerente alguém aceitar
 * uma e recusar a outra. Juntá-las num botão recriaria o consentimento
 * genérico que este bloco existe para evitar.
 *
 * A finalidade e a retenção aparecem na tela com as mesmas palavras que ficam
 * gravadas na tabela. Quem autoriza precisa ver o que está autorizando, e não
 * um resumo simpático do que está autorizando.
 */
export function ConsentimentoSentinela({ alunoId, organizationId }: { alunoId: string; organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: vigentes = [], isLoading } = useQuery({
    queryKey: ["consentimento-ia", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_consentimento_ia")
        .select("id, proposito, aceito_em, versao_texto")
        .eq("aluno_id", alunoId)
        .is("revogado_em", null);
      if (error) throw error;
      // Consentimento dado sob texto antigo não conta — é a mesma regra do
      // banco, e é o que faz a pessoa ser perguntada de novo quando o termo
      // muda de sentido.
      return (data ?? []).filter((c) => c.versao_texto === VERSAO_TEXTO);
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ proposito, autorizar }: { proposito: Proposito; autorizar: boolean }) => {
      if (autorizar) {
        // Revoga o que houver de versão antiga antes de gravar a nova: o
        // índice de unicidade é por aluno e propósito entre os não revogados.
        await supabase
          .from("aluno_consentimento_ia")
          .update({ revogado_em: new Date().toISOString() })
          .eq("aluno_id", alunoId)
          .eq("proposito", proposito)
          .is("revogado_em", null);
        const { error } = await supabase
          .from("aluno_consentimento_ia")
          .insert({ aluno_id: alunoId, organization_id: organizationId, proposito });
        if (error) throw error;
      } else {
        // Revogar, não apagar: o registro de que houve autorização e de quando
        // ela foi retirada é o que prova depois que a regra foi seguida.
        const { error } = await supabase
          .from("aluno_consentimento_ia")
          .update({ revogado_em: new Date().toISOString() })
          .eq("aluno_id", alunoId)
          .eq("proposito", proposito)
          .is("revogado_em", null);
        if (error) throw error;
      }
    },
    onSuccess: (_, { autorizar }) => {
      toast({
        title: autorizar ? "Autorização registrada" : "Autorização retirada",
        description: autorizar
          ? "Você pode retirar esta autorização quando quiser."
          : "O que havia sido gerado a partir desse dado foi apagado.",
      });
      void queryClient.invalidateQueries({ queryKey: ["consentimento-ia", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;

  return (
    <div className="space-y-3 rounded-md border p-3">
      {PROPOSITOS.map(({ chave, titulo, texto }) => {
        const atual = vigentes.find((c) => c.proposito === chave);
        return (
          <div key={chave} className="flex items-start justify-between gap-3">
            <div>
              <Label htmlFor={`consentimento-ia-${chave}`} className="text-sm font-medium">
                {titulo}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">{texto}</p>
              {atual?.aceito_em && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Autorizado em {new Date(atual.aceito_em).toLocaleDateString("pt-BR")}.
                </p>
              )}
            </div>
            <Switch
              id={`consentimento-ia-${chave}`}
              checked={!!atual}
              disabled={alternar.isPending}
              onCheckedChange={(v) => alternar.mutate({ proposito: chave, autorizar: v })}
              aria-label={titulo}
            />
          </div>
        );
      })}

      {/*
        Onde o dado é processado vem dito aqui, e não só na Política, porque é
        a informação que mais pesa para quem decide autorizar ou não. Desde a
        troca para o Amazon Bedrock em São Paulo não há transferência
        internacional — e a região está fixa em `_shared/ia.ts`, que recusa
        modelo que rotearia para fora do país. Se isso mudar, esta frase muda
        junto, com versão nova do termo.
      */}
      <div className="flex items-start gap-2 border-t pt-3">
        <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="text-[11px] leading-snug text-muted-foreground">
          O processamento é feito <strong>no Brasil</strong>, em servidores da Amazon Web Services em São
          Paulo. O provedor não guarda o conteúdo e não o utiliza para treinar modelos. Não enviamos o seu
          nome, CPF, e-mail nem telefone — mas{" "}
          <strong>
            as mensagens que você escreveu são enviadas como você as escreveu, inclusive qualquer dado
            pessoal que você tenha digitado nelas
          </strong>
          . O que o ARKE guarda fica enquanto durar a sua matrícula.{" "}
          <strong>Você pode retirar qualquer destas autorizações quando quiser</strong>, e o que tiver sido
          gerado a partir do dado é apagado.
        </p>
      </div>
    </div>
  );
}

/**
 * O resumo, para quem atende o aluno.
 *
 * Não substitui ler a anamnese — resume o que precisa de atenção **antes** do
 * primeiro contato. E diz de onde veio: um texto de IA apresentado como se
 * fosse avaliação profissional seria o mesmo problema que a fronteira
 * CREF/CRN existe para evitar.
 */
export function ResumoSentinela({ alunoId }: { alunoId: string }) {
  const { toast } = useToast();

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sentinela-anamnese", { body: { aluno_id: alunoId } });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível falar com o Sentinela."));
      return data as Resposta;
    },
    onError: (e: Error) => toast({ title: "Sem resumo agora", description: e.message }),
  });

  const { data: salvo } = useQuery({
    queryKey: ["sentinela-anamnese", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sentinela_anamnese")
        .select("resumo, exige_atencao, created_at")
        .eq("aluno_id", alunoId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const r = gerar.data;
  const resumo = r?.resumo ?? salvo?.resumo ?? null;
  const atencao = r?.exige_atencao ?? salvo?.exige_atencao ?? false;

  if (r?.sem_consentimento) {
    return (
      <p className="text-xs text-muted-foreground">
        {r.motivo ?? "O aluno não autorizou a análise da anamnese por IA."} Leia a anamnese na íntegra na aba
        de acolhimento.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {resumo ? (
        <div className={`rounded-md border p-3 ${atencao ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
          {atencao && (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Histórico que exige cuidado
            </p>
          )}
          <p className="text-sm">{resumo}</p>
          <p className="mt-2 text-[11px] italic text-muted-foreground">
            Resumo gerado por IA a partir do que o aluno declarou. Não é avaliação profissional e não substitui ler a
            anamnese.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {r?.indisponivel ? r.motivo : "Nenhum resumo gerado ainda."}
        </p>
      )}
      <Button size="sm" variant="outline" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
        {gerar.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        {resumo ? "Atualizar resumo" : "Gerar resumo"}
      </Button>
    </div>
  );
}
