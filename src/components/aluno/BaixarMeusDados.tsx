import { useState } from "react";
import { Download, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { emPerfilSimulado } from "@/lib/impersonation";
import { RECUSA_SIMULADO, baixarJson, lerMeusDados, montarMeusDados, nomeDoArquivoMeusDados } from "@/lib/meusDados";

/**
 * "Baixar os meus dados", na Privacidade do perfil do aluno (06/10/2026).
 *
 * Na sessão simulada não baixa: quem simula vê as telas como a pessoa vê, mas
 * levar o arquivo inteiro com a saúde, as mensagens e o CPF dela é exercer um
 * direito que é só dela. A aba diz antes (`emPerfilSimulado`), e o banco
 * confirma na hora (`sessao_simulada`), porque a marca da aba pode faltar.
 */
export function BaixarMeusDados() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [gerando, setGerando] = useState(false);
  const simulado = emPerfilSimulado();

  const baixar = async () => {
    if (!user) return;
    setGerando(true);
    try {
      const { data: sessaoSimulada, error: erroSessao } = await supabase.rpc("sessao_simulada");
      if (erroSessao) throw new Error(erroSessao.message);
      if (sessaoSimulada) {
        toast({ title: "Não foi possível baixar", description: RECUSA_SIMULADO, variant: "destructive" });
        return;
      }
      const leituras = await lerMeusDados(user.id, user.email ?? null);
      baixarJson(nomeDoArquivoMeusDados(), montarMeusDados(leituras, new Date().toISOString()));
      toast({ title: "Arquivo baixado", description: "Os seus dados estão no arquivo, no formato JSON." });
    } catch {
      // Sem a mensagem do banco na tela: ela não ajuda a pessoa e pode citar tabela.
      toast({
        title: "Não foi possível baixar agora",
        description: "Uma parte dos dados não carregou, e o arquivo sairia incompleto. Tente de novo em instantes.",
        variant: "destructive",
      });
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Os seus dados</p>
      <p className="text-xs text-muted-foreground">
        Um arquivo com o seu cadastro, anamnese, avaliações, treinos, dietas, presenças, mensagens, autorizações e pagamentos,
        de todas as academias em que você tem matrícula.
      </p>
      <Button size="sm" variant="outline" disabled={gerando || simulado || !user} onClick={() => void baixar()}>
        <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {gerando ? "Preparando o arquivo..." : "Baixar os meus dados"}
      </Button>
      {simulado && (
        <p className="flex items-start gap-1.5 text-[11px] text-warning">
          <UserCog className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {RECUSA_SIMULADO}
        </p>
      )}
    </div>
  );
}
