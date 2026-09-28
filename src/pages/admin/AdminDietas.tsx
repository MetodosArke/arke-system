import { useLocation, useNavigate } from "react-router-dom";
import { UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PrescricaoDieta } from "@/components/prescricao/PrescricaoDieta";
import { podePrescrever } from "@/lib/prescricaoPermitida";

// A tela de dietas da academia. O editor, com a importação de PDF, é o mesmo
// do mentor da ArkeFit (`PrescricaoDieta`); aqui ele trabalha com a biblioteca
// e os alunos da organização.
export default function AdminDietas() {
  const { organization, organizationRole, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const alunoIdFromNav = (location.state as { alunoId?: string } | null)?.alunoId;
  const permitido = podePrescrever("dieta", {
    tipoOrganizacao: organization?.tipo,
    especialidade: organization?.especialidadeProfissional,
    papel: organizationRole,
    adminArke: hasRole("admin_arke"),
  });

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
      {organization && !permitido && (
        <p className="text-sm text-muted-foreground">Neste painel, a dieta é prescrita pela nutricionista. Você vê a dieta na ficha do aluno.</p>
      )}
      {organization && permitido && (
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
