import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, UserPlus } from "lucide-react";
import { ConvitePrimeiroAcesso } from "@/components/admin/ConvitePrimeiroAcesso";

/**
 * Alunos: importar a planilha do sistema anterior ou cadastrar. O convite de
 * primeiro acesso (link e QR Code) já aparece aqui para ser divulgado assim que
 * a academia concluir — antes disso, quem entra vê "seu app está quase pronto".
 */
export function EtapaAlunos() {
  const navigate = useNavigate();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate("/admin/alunos/importar")}>
          <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Importar planilha
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/admin/alunos")}>
          <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Cadastrar aluno
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        A importação reconhece as colunas das planilhas do EVO, Tecnofit, Next Fit e Pacto. Depois, divulgue o convite abaixo na
        recepção e no WhatsApp.
      </p>
      <ConvitePrimeiroAcesso />
    </div>
  );
}
