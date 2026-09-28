import { useLocation, useNavigate } from "react-router-dom";
import { Dumbbell } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PrescricaoTreino } from "@/components/prescricao/PrescricaoTreino";

// A tela de treinos da academia. O editor é o mesmo do mentor da ArkeFit
// (`PrescricaoTreino`); aqui ele trabalha com a biblioteca e os alunos da
// organização.
export default function AdminTreinos() {
  const { organization } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const alunoIdFromNav = (location.state as { alunoId?: string } | null)?.alunoId;

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-20">
      <div className="flex items-center gap-2">
        <Dumbbell className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">Treinos</h1>
      </div>
      {organization && (
        <PrescricaoTreino
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
