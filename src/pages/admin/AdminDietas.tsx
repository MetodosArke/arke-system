import { useLocation, useNavigate } from "react-router-dom";
import { UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PrescricaoDieta } from "@/components/prescricao/PrescricaoDieta";

// A tela de dietas da academia. O editor, com a importação de PDF, é o mesmo
// do mentor da ArkeFit (`PrescricaoDieta`); aqui ele trabalha com a biblioteca
// e os alunos da organização.
export default function AdminDietas() {
  const { organization } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const alunoIdFromNav = (location.state as { alunoId?: string } | null)?.alunoId;

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Dietas</h1>
      </div>
      <p className="text-xs text-muted-foreground">
        Para os alunos do plano Free, a dieta vem da nutricionista da academia. Os alunos do Método ARKE são acompanhados
        pela nutricionista da ArkeFit.
      </p>
      {organization && (
        <PrescricaoDieta
          escopo={{ tipo: "academia", organizationId: organization.id }}
          alunoInicial={alunoIdFromNav}
          rodape="fixo"
          aoPublicar={() => navigate("/admin")}
          aoCancelar={() => navigate("/admin")}
        />
      )}
    </div>
  );
}
