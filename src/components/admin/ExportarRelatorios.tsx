import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { porLotes, todasAsLinhas } from "@/lib/paginar";
import { perfisDosUsuarios } from "@/lib/perfis";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart3 } from "lucide-react";
import { baixarPlanilha, intervaloDoMes } from "@/lib/exportarPlanilha";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { montarRelatorios, type Cobranca } from "@/lib/relatoriosFinanceiro";
import { rotuloTipo, type TipoCobrancaAvulsa } from "@/lib/cobrancaAvulsa";

const COLUNAS_MENSALIDADE = "id, aluno_id, matricula_id, competencia, vencimento, valor, status, data_pagamento, forma_pagamento";
const COLUNAS_AVULSA = "id, aluno_id, tipo, descricao, vencimento, valor, status, data_pagamento";

/**
 * Os relatórios de gestão do mês, numa planilha: resumo, recebidas, a receber,
 * inadimplência e por plano (`montarRelatorios`). Lê as mensalidades e as
 * cobranças avulsas da academia que pesam no mês: as da competência, as pagas
 * no mês e todas as que estão em aberto, em páginas.
 */
export function ExportarRelatorios() {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [mes, setMes] = useState(() => hojeBrasilia().slice(0, 7));
  const [gerando, setGerando] = useState(false);

  const exportar = async () => {
    if (!organization) return;
    setGerando(true);
    try {
      const { inicio, fim } = intervaloDoMes(mes);
      const orgId = organization.id;
      const [mComp, mPagas, mAbertas, aPagas, aAbertas] = await Promise.all([
        todasAsLinhas((de, ate) =>
          supabase.from("mensalidades").select(COLUNAS_MENSALIDADE).eq("organization_id", orgId)
            .gte("competencia", inicio).lte("competencia", fim).order("id").range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase.from("mensalidades").select(COLUNAS_MENSALIDADE).eq("organization_id", orgId)
            .gte("data_pagamento", inicio).lte("data_pagamento", fim).order("id").range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase.from("mensalidades").select(COLUNAS_MENSALIDADE).eq("organization_id", orgId)
            .in("status", ["pendente", "atrasado"]).order("id").range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase.from("cobrancas_avulsas").select(COLUNAS_AVULSA).eq("organization_id", orgId)
            .gte("data_pagamento", inicio).lte("data_pagamento", fim).order("id").range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase.from("cobrancas_avulsas").select(COLUNAS_AVULSA).eq("organization_id", orgId)
            .in("status", ["pendente", "atrasado"]).order("id").range(de, ate)
        ),
      ]);
      // A mesma cobrança pode vir de mais de uma consulta: uma vez só.
      const unicas = <T extends { id: string }>(...listas: T[][]) => [...new Map(listas.flat().map((x) => [x.id, x])).values()];
      const mens = unicas(mComp, mPagas, mAbertas);
      const avul = unicas(aPagas, aAbertas);

      const matriculas = await porLotes(
        [...new Set(mens.map((m) => m.matricula_id).filter((id): id is string => !!id))],
        (lote) => supabase.from("aluno_matriculas_academia").select("id, plano_id").in("id", lote)
      );
      const planos = await porLotes(
        [...new Set(matriculas.map((m) => m.plano_id).filter((id): id is string => !!id))],
        (lote) => supabase.from("planos_academia").select("id, nome").in("id", lote)
      );
      const planoDaMatricula = new Map(matriculas.map((m) => [m.id, planos.find((p) => p.id === m.plano_id)?.nome ?? null]));
      const alunos = await porLotes([...new Set([...mens, ...avul].map((x) => x.aluno_id))], (lote) =>
        supabase.from("alunos").select("id, user_id").in("id", lote)
      );
      const perfis = await perfisDosUsuarios(alunos.map((a) => a.user_id));
      const nomeAluno = new Map(alunos.map((a) => [a.id, perfis.get(a.user_id)?.full_name ?? "Aluno"]));

      const cobrancas: Cobranca[] = [
        ...mens.map((m) => ({
          origem: "Mensalidade" as const,
          aluno: nomeAluno.get(m.aluno_id) ?? "Aluno",
          descricao: "Mensalidade",
          plano: m.matricula_id ? planoDaMatricula.get(m.matricula_id) ?? null : null,
          competencia: m.competencia,
          vencimento: m.vencimento,
          valor: Number(m.valor),
          status: m.status,
          data_pagamento: m.data_pagamento,
          forma_pagamento: m.forma_pagamento,
        })),
        ...avul.map((a) => ({
          origem: "Avulsa" as const,
          aluno: nomeAluno.get(a.aluno_id) ?? "Aluno",
          descricao: a.descricao || rotuloTipo(a.tipo as TipoCobrancaAvulsa),
          plano: null,
          competencia: null,
          vencimento: a.vencimento,
          valor: Number(a.valor),
          status: a.status,
          data_pagamento: a.data_pagamento,
          forma_pagamento: null,
        })),
      ];
      await baixarPlanilha(`relatorios-${organization.slug}-${mes}`, montarRelatorios(cobrancas, mes, hojeBrasilia()));
      toast({ title: "Relatórios exportados", description: `Mês de ${mes.split("-").reverse().join("/")}.` });
    } catch (e) {
      toast({ title: "Não foi possível exportar", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Input type="month" aria-label="Mês dos relatórios" className="h-8 w-40" value={mes} onChange={(e) => setMes(e.target.value)} />
      <Button size="sm" variant="outline" disabled={gerando || !mes} onClick={() => void exportar()}>
        <BarChart3 className="h-4 w-4 mr-1.5" /> {gerando ? "Gerando..." : "Relatórios de gestão"}
      </Button>
    </div>
  );
}
