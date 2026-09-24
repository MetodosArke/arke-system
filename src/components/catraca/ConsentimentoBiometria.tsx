import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Fingerprint } from "lucide-react";

/** Espelho de `public.versao_consentimento_biometrico()`. Mudou lá, muda aqui — o teste confere. */
export const VERSAO_CONSENTIMENTO_BIOMETRIA = "2026-09-23";

const formatarData = (valor: string) => new Date(valor).toLocaleDateString("pt-BR");

/**
 * O aluno autoriza — ou retira a autorização — do uso da própria digital na
 * catraca da academia.
 *
 * Até a versão 1.0 quem registrava isto era a equipe, com um clique na ficha.
 * Consentimento dado por terceiro não é consentimento (LGPD art. 11, I exige o
 * do titular), então agora só o próprio aluno autoriza, aqui, e o banco recusa
 * qualquer outro caminho. Retirar a autorização apaga a digital de todas as
 * catracas da academia: pelo Gateway, sozinho, ou por tarefa para a recepção
 * onde o equipamento não tem gestão remota — e a data aparece aqui quando
 * termina.
 *
 * Só aparece para quem é de academia com catraca: pedir autorização para algo
 * que não existe confunde e ensina a aceitar sem ler.
 */
export function ConsentimentoBiometria({ alunoId, organizationId }: { alunoId: string; organizationId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: temCatraca = false } = useQuery({
    queryKey: ["academia-tem-catraca", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("academia_tem_catraca", { _org: organizationId });
      if (error) throw error;
      return !!data;
    },
  });

  const { data: consentimentos = [], isLoading } = useQuery({
    queryKey: ["consentimento-biometrico", alunoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aluno_consentimento_biometrico")
        .select("id, aceito_em, versao_texto, revogado_em, excluido_do_equipamento_em")
        .eq("aluno_id", alunoId)
        .order("aceito_em", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const vigente = consentimentos.find((c) => !c.revogado_em && c.versao_texto === VERSAO_CONSENTIMENTO_BIOMETRIA);
  const antigo = consentimentos.find((c) => !c.revogado_em && c.versao_texto !== VERSAO_CONSENTIMENTO_BIOMETRIA);
  const ultimaRevogacao = consentimentos.find((c) => c.revogado_em);

  const alternar = useMutation({
    mutationFn: async (autorizar: boolean) => {
      const { error } = autorizar
        ? await supabase.rpc("consentir_biometria", { _aluno_id: alunoId })
        : await supabase.rpc("revogar_consentimento_biometrico", { _aluno_id: alunoId });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, autorizar) => {
      toast({
        title: autorizar ? "Autorização registrada" : "Autorização retirada",
        description: autorizar
          ? "Agora a recepção pode cadastrar a sua digital na catraca."
          : "A sua digital vai ser apagada das catracas da academia.",
      });
      void queryClient.invalidateQueries({ queryKey: ["consentimento-biometrico", alunoId] });
    },
    onError: (e: Error) => toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return null;
  // Sem catraca e sem histórico: nada a perguntar. Com histórico, a pessoa
  // continua vendo (e podendo retirar) o que já autorizou.
  if (!temCatraca && consentimentos.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="consentimento-biometria" className="flex items-center gap-1.5 text-sm font-medium">
            <Fingerprint className="h-4 w-4 text-primary" /> Uso da minha digital na catraca
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Autorizo o uso da minha impressão digital para o <strong>controle de acesso e frequência</strong> na
            academia. A digital fica guardada <strong>somente nas catracas da academia</strong>; o ARKE guarda apenas o
            número com que a catraca me identifica. Ela é apagada das catracas quando eu retirar esta autorização ou
            deixar a academia, e o registro desta autorização é mantido pelo prazo legal, como prova.
          </p>
          {vigente && (
            <p className="mt-1 text-[11px] text-muted-foreground">Autorizado em {formatarData(vigente.aceito_em)}.</p>
          )}
          {!vigente && antigo && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
              O texto desta autorização mudou desde {formatarData(antigo.aceito_em)}. Confirme de novo para a catraca
              continuar usando a sua digital, ou{" "}
              {/* Sem isto, quem não quer confirmar o texto novo ficaria sem
                  como retirar a autorização antiga — e a digital, no equipamento. */}
              <button
                type="button"
                className="underline underline-offset-2"
                disabled={alternar.isPending}
                onClick={() => alternar.mutate(false)}
              >
                retire a autorização anterior
              </button>
              .
            </p>
          )}
          {!vigente && !antigo && ultimaRevogacao?.revogado_em && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Autorização retirada em {formatarData(ultimaRevogacao.revogado_em)}.{" "}
              {ultimaRevogacao.excluido_do_equipamento_em
                ? `Digital apagada das catracas em ${formatarData(ultimaRevogacao.excluido_do_equipamento_em)}.`
                : "A academia está apagando a digital das catracas."}
            </p>
          )}
        </div>
        <Switch
          id="consentimento-biometria"
          checked={!!vigente}
          disabled={alternar.isPending}
          onCheckedChange={(v) => alternar.mutate(v)}
          aria-label="Uso da minha digital na catraca"
        />
      </div>
    </div>
  );
}
