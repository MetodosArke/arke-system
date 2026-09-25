import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { baixarPlanilha, dataBr, type Aba } from "@/lib/exportarPlanilha";
import { hojeBrasilia } from "@/lib/dataBrasilia";
import { porLotes, todasAsLinhas } from "@/lib/paginar";

const STATUS: Record<string, string> = {
  pendente: "Pendente",
  confirmado: "Pago",
  atrasado: "Atrasado",
  cancelado: "Cancelado",
  estornado: "Estornado",
};
const SITUACAO: Record<string, string> = { em_dia: "Em dia", inadimplente: "Inadimplente", pausado: "Pausado" };

/**
 * Todos os dados da academia numa planilha: alunos com contato e endereço,
 * matrículas, mensalidades, cobranças avulsas, presenças e avaliações
 * físicas. É o que o contrato promete no encerramento (30 dias para exportar)
 * e serve também para levar a base a outro sistema. Tudo em páginas: numa
 * academia grande as presenças passam de mil linhas.
 */
export function ExportarDadosAcademia({ variante = "outline" }: { variante?: "default" | "outline" }) {
  const { organization } = useAuth();
  const { toast } = useToast();
  const [gerando, setGerando] = useState(false);

  const exportar = async () => {
    if (!organization) return;
    setGerando(true);
    try {
      const org = organization.id;
      const [alunos, emails, planos, matriculas, mensalidades, avulsas, presencas, avaliacoes] = await Promise.all([
        todasAsLinhas((de, ate) =>
          supabase
            .from("alunos")
            .select("id, user_id, data_inicio, data_nascimento, objetivo, situacao_academia, metodo_arke_status, nivel_atacado")
            .eq("organization_id", org)
            .order("id")
            .range(de, ate)
        ),
        todasAsLinhas((de, ate) => supabase.rpc("emails_alunos_organizacao", { _organization_id: org }).order("aluno_id").range(de, ate)),
        todasAsLinhas((de, ate) => supabase.from("planos_academia").select("id, nome, periodicidade, valor").eq("organization_id", org).order("id").range(de, ate)),
        todasAsLinhas((de, ate) =>
          supabase
            .from("aluno_matriculas_academia")
            .select("aluno_id, plano_id, valor_cobrado, data_inicio, dia_vencimento, status")
            .eq("organization_id", org)
            .order("id")
            .range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase
            .from("mensalidades")
            .select("aluno_id, competencia, vencimento, valor, status, data_pagamento, forma_pagamento")
            .eq("organization_id", org)
            .order("vencimento")
            .order("id")
            .range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase
            .from("cobrancas_avulsas")
            .select("aluno_id, descricao, vencimento, valor, status, data_pagamento")
            .eq("organization_id", org)
            .order("vencimento")
            .order("id")
            .range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase.from("presencas").select("aluno_id, dia, origem").eq("organization_id", org).order("dia").order("id").range(de, ate)
        ),
        todasAsLinhas((de, ate) =>
          supabase
            .from("avaliacoes_fisicas")
            .select("aluno_id, data_avaliacao, peso_kg, altura_cm, imc, percentual_gordura, musculo_percentual, perim_cintura, perim_quadril, observacoes")
            .eq("organization_id", org)
            .order("data_avaliacao")
            .order("id")
            .range(de, ate)
        ),
      ]);
      const perfis = await porLotes(
        alunos.map((a) => a.user_id),
        (lote) =>
          supabase
            .from("profiles")
            .select("user_id, full_name, phone, cpf, cep, logradouro, endereco_numero, complemento, bairro, cidade, uf")
            .in("user_id", lote)
      );
      const perfil = new Map(perfis.map((p) => [p.user_id, p]));
      const email = new Map(emails.map((e) => [e.aluno_id, e.email]));
      const nomeAluno = new Map(alunos.map((a) => [a.id, perfil.get(a.user_id)?.full_name ?? ""]));
      const nomePlano = new Map(planos.map((p) => [p.id, p.nome]));
      const nome = (id: string | null) => (id ? nomeAluno.get(id) ?? "" : "");

      const abas: Aba[] = [
        {
          nome: "Alunos",
          linhas: [
            ["Nome", "E-mail", "Telefone", "CPF", "Nascimento", "Início", "Situação", "Método ARKE", "Objetivo", "CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade", "UF"],
            ...alunos.map((a) => {
              const p = perfil.get(a.user_id);
              return [
                p?.full_name ?? "",
                email.get(a.id) ?? "",
                p?.phone ?? "",
                p?.cpf ?? "",
                dataBr(a.data_nascimento),
                dataBr(a.data_inicio),
                SITUACAO[a.situacao_academia ?? ""] ?? a.situacao_academia ?? "",
                a.metodo_arke_status === "ativo" ? a.nivel_atacado ?? "Sim" : "",
                a.objetivo ?? "",
                p?.cep ?? "",
                p?.logradouro ?? "",
                p?.endereco_numero ?? "",
                p?.complemento ?? "",
                p?.bairro ?? "",
                p?.cidade ?? "",
                p?.uf ?? "",
              ];
            }),
          ],
        },
        {
          nome: "Matrículas",
          linhas: [
            ["Aluno", "Plano", "Valor", "Início", "Dia de vencimento", "Situação"],
            ...matriculas.map((m) => [nome(m.aluno_id), nomePlano.get(m.plano_id) ?? "", Number(m.valor_cobrado), dataBr(m.data_inicio), m.dia_vencimento, m.status]),
          ],
        },
        {
          nome: "Mensalidades",
          linhas: [
            ["Aluno", "Competência", "Vencimento", "Valor", "Status", "Pagamento", "Forma"],
            ...mensalidades.map((m) => [nome(m.aluno_id), dataBr(m.competencia), dataBr(m.vencimento), Number(m.valor), STATUS[m.status] ?? m.status, dataBr(m.data_pagamento), m.forma_pagamento ?? ""]),
          ],
        },
        {
          nome: "Cobranças avulsas",
          linhas: [
            ["Aluno", "Descrição", "Vencimento", "Valor", "Status", "Pagamento"],
            ...avulsas.map((c) => [nome(c.aluno_id), c.descricao, dataBr(c.vencimento), Number(c.valor), STATUS[c.status] ?? c.status, dataBr(c.data_pagamento)]),
          ],
        },
        {
          nome: "Presenças",
          linhas: [["Aluno", "Dia", "Origem"], ...presencas.map((p) => [nome(p.aluno_id), dataBr(p.dia), p.origem ?? ""])],
        },
        {
          nome: "Avaliações físicas",
          linhas: [
            ["Aluno", "Data", "Peso (kg)", "Altura (cm)", "IMC", "Gordura (%)", "Músculo (%)", "Cintura (cm)", "Quadril (cm)", "Observações"],
            ...avaliacoes.map((a) => [
              nome(a.aluno_id),
              dataBr(a.data_avaliacao),
              a.peso_kg,
              a.altura_cm,
              a.imc,
              a.percentual_gordura,
              a.musculo_percentual,
              a.perim_cintura,
              a.perim_quadril,
              a.observacoes ?? "",
            ]),
          ],
        },
      ];
      await baixarPlanilha(`arke-dados-${organization.slug ?? "academia"}-${hojeBrasilia()}.xlsx`, abas);
    } catch (e) {
      toast({ title: "Não foi possível exportar", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setGerando(false);
    }
  };

  return (
    <Button variant={variante} onClick={() => void exportar()} disabled={gerando || !organization}>
      <Download className="mr-2 h-4 w-4" />
      {gerando ? "Gerando…" : "Exportar todos os dados"}
    </Button>
  );
}
