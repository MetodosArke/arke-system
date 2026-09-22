import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, QrCode, XCircle } from "lucide-react";
import { CHAVE_CHECKIN_PENDENTE } from "@/lib/checkin";

/**
 * Destino do QR Code da recepção (/checkin?o=<academia>&c=<código>). Rota
 * pública de propósito: sem sessão, o código fica guardado na aba e a pessoa
 * vai para o login — a home do aluno retoma o check-in logo depois. O código
 * muda a cada 10 minutos, então foto do QR enviada para casa não serve.
 */
export default function AlunoCheckin() {
  const { user, isLoading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<"enviando" | "registrada" | "ja_registrada" | "erro">("enviando");
  const [mensagem, setMensagem] = useState("");
  const enviado = useRef(false);
  const organizacao = params.get("o");
  const codigo = params.get("c");

  useEffect(() => {
    if (isLoading || enviado.current) return;
    if (!organizacao || !codigo) {
      setEstado("erro");
      setMensagem("QR Code incompleto. Escaneie o da tela da recepção.");
      return;
    }
    if (!user) {
      try {
        sessionStorage.setItem(CHAVE_CHECKIN_PENDENTE, `?o=${encodeURIComponent(organizacao)}&c=${encodeURIComponent(codigo)}`);
      } catch {
        // sem armazenamento: depois do login, é escanear de novo
      }
      navigate("/auth/login", { replace: true });
      return;
    }
    enviado.current = true;
    void (async () => {
      const { data, error } = await supabase.rpc("registrar_presenca_qr", { _organization_id: organizacao, _codigo: codigo });
      if (error) {
        setEstado("erro");
        setMensagem(error.message);
      } else {
        setEstado(data === "ja_registrada" ? "ja_registrada" : "registrada");
      }
    })();
  }, [isLoading, user, organizacao, codigo, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="py-8 text-center space-y-3">
          {estado === "enviando" && <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />}
          {(estado === "registrada" || estado === "ja_registrada") && <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-600" />}
          {estado === "erro" && <XCircle className="h-10 w-10 mx-auto text-destructive" />}
          <p className="font-semibold">
            {estado === "enviando" && "Registrando sua presença..."}
            {estado === "registrada" && "Presença registrada. Bom treino!"}
            {estado === "ja_registrada" && "Sua presença de hoje já estava registrada."}
            {estado === "erro" && "Não foi possível registrar"}
          </p>
          {estado === "erro" && <p className="text-sm text-muted-foreground">{mensagem}</p>}
          <Button asChild variant="outline">
            <Link to="/app">
              <QrCode className="h-4 w-4 mr-2" /> Ir para o app
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
