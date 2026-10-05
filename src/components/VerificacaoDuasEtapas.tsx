import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, ShieldCheck } from "lucide-react";

type Estado =
  | { tipo: "carregando" }
  | { tipo: "ok" }
  | { tipo: "cadastrar"; fatorId: string; qr: string; segredo: string }
  | { tipo: "verificar"; fatorId: string }
  | { tipo: "erro"; mensagem: string };

const DESCRICAO_ARKEFIT =
  "A conta da ArkeFit alcança todas as academias. Além da senha, ela pede um código do aplicativo autenticador do seu celular.";

/**
 * Verificação em duas etapas. Na primeira vez, cadastra o aplicativo
 * autenticador pelo QR code; nas seguintes, pede o código de 6 dígitos.
 *
 * Três usos:
 * - **tela inteira** (padrão): as contas da ArkeFit (Super Admin e Admin
 *   ARKE), que atravessam todas as academias e podem entrar como qualquer
 *   perfil. O banco só aceita o papel da ArkeFit numa sessão verificada
 *   (`has_role`, migration 20261283010000).
 * - **embutida**, dentro de uma janela: as ações da gestão que pedem as duas
 *   etapas (exportar todos os dados, encerrar a academia, trocar o e-mail de
 *   login), por `useDuasEtapasNaAcao`. Quem ainda não ativou ativa ali.
 * - **soSeAtivada**: a entrada no painel de quem ligou as duas etapas pede o
 *   código; quem não ligou passa direto. Enquanto confere, mostra o painel.
 *
 * Perdeu o celular: o fator é removido no banco (`auth.mfa_factors` da conta),
 * e na entrada seguinte a tela pede o cadastro de novo.
 */
export function VerificacaoDuasEtapas({
  children,
  variante = "tela",
  descricao = DESCRICAO_ARKEFIT,
  soSeAtivada = false,
}: {
  children: ReactNode;
  variante?: "tela" | "embutida";
  descricao?: ReactNode;
  soSeAtivada?: boolean;
}) {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroCodigo, setErroCodigo] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: nivel, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!vivo) return;
      if (error) return setEstado({ tipo: "erro", mensagem: error.message });
      if (nivel.currentLevel === "aal2") return setEstado({ tipo: "ok" });
      // `nextLevel` só é aal2 quando a conta tem um aplicativo cadastrado.
      if (soSeAtivada && nivel.nextLevel !== "aal2") return setEstado({ tipo: "ok" });

      const { data: fatores, error: erroFatores } = await supabase.auth.mfa.listFactors();
      if (!vivo) return;
      if (erroFatores) return setEstado({ tipo: "erro", mensagem: erroFatores.message });
      const verificado = fatores.totp.find((f) => f.status === "verified");
      if (verificado) return setEstado({ tipo: "verificar", fatorId: verificado.id });
      if (soSeAtivada) return setEstado({ tipo: "ok" });

      // Cadastro que começou e não terminou (a pessoa recarregou a página): recomeça do zero.
      for (const f of fatores.all.filter((f) => f.status !== "verified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: novo, error: erroNovo } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ARKE" });
      if (!vivo) return;
      if (erroNovo) return setEstado({ tipo: "erro", mensagem: erroNovo.message });
      setEstado({ tipo: "cadastrar", fatorId: novo.id, qr: novo.totp.qr_code, segredo: novo.totp.secret });
    })();
    return () => {
      vivo = false;
    };
  }, [soSeAtivada]);

  if (estado.tipo === "ok") return <>{children}</>;
  // Quem só confere se a pessoa ligou as duas etapas não segura o painel
  // enquanto pergunta: a resposta quase sempre é "não ligou".
  if (soSeAtivada && estado.tipo === "carregando") return <>{children}</>;

  const confirmar = async (fatorId: string) => {
    setEnviando(true);
    setErroCodigo(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fatorId, code: codigo.trim() });
    setEnviando(false);
    if (error) {
      setErroCodigo("Código não confere. Confira no aplicativo e digite o código atual.");
      return;
    }
    // O que foi pedido antes da verificação voltou negado: pede de novo, agora verificado.
    await queryClient.invalidateQueries();
    setEstado({ tipo: "ok" });
  };

  const conteudo = (
    <>
      {estado.tipo === "carregando" && <p className="text-muted-foreground">Conferindo a verificação…</p>}
      {estado.tipo === "erro" && <p className="text-destructive">{estado.mensagem}</p>}
      {estado.tipo === "cadastrar" && (
        <>
          <p>
            1. Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou outro) e leia o QR code.
          </p>
          <img src={estado.qr} alt="QR code para o aplicativo autenticador" className="mx-auto h-44 w-44 rounded bg-white p-2" />
          <p className="text-xs text-muted-foreground">
            Sem câmera? Digite no aplicativo o código <span className="font-mono break-all">{estado.segredo}</span>
          </p>
          <p>2. Digite o código de 6 dígitos que aparece no aplicativo.</p>
        </>
      )}
      {estado.tipo === "verificar" && <p>Digite o código de 6 dígitos do aplicativo autenticador.</p>}
      {(estado.tipo === "cadastrar" || estado.tipo === "verificar") && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar(estado.fatorId);
          }}
        >
          <Label htmlFor="codigo-2fa">Código</Label>
          <Input
            id="codigo-2fa"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
          />
          {erroCodigo && <p className="text-xs text-destructive">{erroCodigo}</p>}
          <Button type="submit" className="w-full" disabled={enviando || codigo.length !== 6}>
            {enviando ? "Conferindo…" : "Confirmar"}
          </Button>
        </form>
      )}
    </>
  );

  if (variante === "embutida") {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">{descricao}</p>
        {conteudo}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Verificação em duas etapas
          </CardTitle>
          <CardDescription>{descricao}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {conteudo}
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
