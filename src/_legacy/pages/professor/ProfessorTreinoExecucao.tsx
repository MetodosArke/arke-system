import { useSearchParams } from "react-router-dom";
import TreinoExecucaoBase from "./ProfessorTreinoExecucaoBase";

export default function ProfessorTreinoExecucao() {
  const [searchParams] = useSearchParams();
  const alunoId = searchParams.get("alunoId") || "";
  
  return <TreinoExecucaoBase alunoIdOverride={alunoId} backPath="/professor" />;
}
