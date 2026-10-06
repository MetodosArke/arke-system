import type { ReactNode } from "react";
import { Building2, LogOut, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

function TelaDeAcesso({
  icone,
  titulo,
  texto,
  acoes,
  alerta,
}: {
  icone: ReactNode;
  titulo: string;
  texto: string;
  acoes: ReactNode;
  alerta?: boolean;
}) {
  return (
    <div
      role={alerta ? "alert" : undefined}
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center"
    >
      {icone}
      <div className="space-y-1">
        <h1 className="text-base font-semibold">{titulo}</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{texto}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">{acoes}</div>
    </div>
  );
}

function BotaoSair() {
  const { signOut } = useAuth();
  return (
    <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
      <LogOut className="mr-2 h-4 w-4" /> Sair
    </Button>
  );
}

/**
 * A leitura do acesso falhou mesmo depois de tentar de novo. Até 06/10/2026
 * isso virava "sem vínculo", e a gestão caía no app do aluno; agora a tela diz
 * o que houve e não manda ninguém para lugar nenhum.
 */
export function ErroAoCarregarAcesso() {
  const { tentarAcessoDeNovo } = useAuth();
  return (
    <TelaDeAcesso
      alerta
      icone={<WifiOff className="h-10 w-10 text-muted-foreground" aria-hidden />}
      titulo="Não conseguimos carregar o seu acesso"
      texto="Pode ser a conexão com a internet. Seus dados estão guardados: confira a conexão e tente de novo."
      acoes={
        <>
          <Button className="w-full" onClick={tentarAcessoDeNovo}>
            <RefreshCw className="mr-2 h-4 w-4" /> Tentar de novo
          </Button>
          <BotaoSair />
        </>
      }
    />
  );
}

/**
 * Conta sem vínculo ativo com nenhuma academia: o aluno desligado, ou quem
 * criou a conta sem matrícula. Antes a home do aluno ficava em "carregando"
 * para sempre.
 */
export function SemAcademiaVinculada() {
  return (
    <TelaDeAcesso
      icone={<Building2 className="h-10 w-10 text-muted-foreground" aria-hidden />}
      titulo="Nenhuma academia vinculada a esta conta"
      texto="O app do aluno abre com a matrícula numa academia. Se você treina numa academia que usa o ArkeFit, peça à recepção para conferir o seu cadastro com o e-mail desta conta."
      acoes={<BotaoSair />}
    />
  );
}
