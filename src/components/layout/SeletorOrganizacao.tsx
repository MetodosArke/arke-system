import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

const PAPEL: Record<string, string> = {
  gestor: "Gestão",
  professor: "Professor",
  nutricionista: "Nutricionista",
  recepcao: "Recepção",
  aluno: "Aluno",
};

/**
 * Multiunidade: quem tem vínculo em mais de uma organização (rede com várias
 * unidades, professor em duas academias, gestor que treina em outra) troca de
 * unidade aqui, sem sair da conta. Some para quem tem uma só.
 */
export function SeletorOrganizacao() {
  const { vinculos, organization, trocarOrganizacao } = useAuth();
  if (vinculos.length < 2 || !organization) return null;

  return (
    <Select value={organization.id} onValueChange={trocarOrganizacao}>
      <SelectTrigger className="h-8 max-w-[11rem] sm:max-w-[16rem] text-xs gap-1.5" aria-label="Trocar de unidade">
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {vinculos.map((v) => (
          <SelectItem key={v.organizationId} value={v.organizationId} className="text-xs">
            {v.nome} <span className="text-muted-foreground">· {PAPEL[v.role] ?? v.role}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
