import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { diaBrasilia, formatarDataBR, hojeBrasilia } from "@/lib/dataBrasilia";
import {
  LIMIARES,
  ORDEM_DOS_TIPOS,
  papelVeSugestao,
  sugestoesDoTreino,
  veSugestaoDeProgressao,
  type ItemDaFicha,
  type RegistroDoTreino,
  type SugestaoDoExercicio,
  type TipoSugestao,
} from "@/lib/sugestaoProgressao";

/**
 * A sugestão de progressão da carga, na publicação do treino (16/10/2026).
 *
 * Fica em um lugar só: no editor de treino (`PrescricaoTreino`), logo abaixo
 * do aluno escolhido e acima de "Como montar o treino", que é o caminho que
 * já existe para mudar o treino (publicar uma versão nova). O mesmo editor
 * serve à academia (Prescrever Treinos) e ao mentor da ArkeFit (a ficha do
 * aluno do Método), e cada um vê a sugestão do aluno de quem é dono do treino.
 *
 * A sugestão é calculada na leitura e não é gravada, como o plano do aluno.
 * Tudo é lido pelo RLS de quem olha: as respostas do fim do treino (esforço,
 * sensação, sono e energia) e a progressão suspensa só voltam para quem atende
 * a saúde (`atende_saude()`, sem a recepção) e para o mentor no Método.
 * A regra é a de `src/lib/sugestaoProgressao.ts`. Esta tela só lê: nada aqui
 * muda o treino do aluno, e o aluno não vê esta sugestão.
 */

const COR_DO_TIPO: Record<TipoSugestao, string> = {
  segurar: "text-warning",
  rever: "text-warning",
  subir: "text-success",
  manter: "text-foreground",
  sem_dados: "text-muted-foreground",
};

type BemEstar = { esforco_percebido: number | null; sensacao: string | null; sono: number | null; energia: number | null };

/** O embutido de uma tabela um para um vem como objeto; por garantia, aceita a lista. */
function umSo<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const nomes = (lista: SugestaoDoExercicio[]) => lista.map((e) => `${e.divisao} · ${e.nome}`).join(", ");

export function SugestaoProgressao({ alunoId, escopo }: { alunoId: string; escopo: "academia" | "metodo" }) {
  const { user, organization, organizationRole } = useAuth();
  const contexto = {
    escopo,
    papel: organizationRole,
    tipoOrganizacao: organization?.tipo,
    especialidade: organization?.especialidadeProfissional,
  };
  // Pergunta o papel antes de ler: quem não vê a sugestão nem pede os dados.
  const podeVer = papelVeSugestao(contexto);

  const { data, error, isLoading, refetch, isFetching } = useQuery({
    // A pessoa entra na chave: o que o RLS devolve depende de quem pede.
    queryKey: ["sugestao-progressao", user?.id ?? null, alunoId],
    queryFn: async () => {
      const hoje = hojeBrasilia();
      const [treino, registros, aluno, suspensa, anamnese, checkins] = await Promise.all([
        supabase
          .from("treinos")
          .select("id, snapshot_conteudo")
          .eq("aluno_id", alunoId)
          .eq("status", "ativo")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Um treino por dia (`aluno_id, data` é único): 21 dias são no máximo 22 linhas.
        supabase
          .from("registro_treino")
          .select(
            "data, treino_id, registro_serie(exercicio_id, exercicio_ordem, serie_numero, carga_kg, repeticoes, concluida), registro_treino_bem_estar(esforco_percebido, sensacao, sono, energia)",
          )
          .eq("aluno_id", alunoId)
          .gte("data", diaBrasilia(-LIMIARES.janelaDias))
          .order("data"),
        supabase.from("alunos").select("metodo_arke_status").eq("id", alunoId).maybeSingle(),
        supabase.from("aluno_progressao_bloqueada").select("bloqueada_em").eq("aluno_id", alunoId).maybeSingle(),
        supabase.from("anamnese_acolhimento").select("consentimento_lgpd_revogado_em").eq("aluno_id", alunoId).maybeSingle(),
        supabase
          .from("checkins")
          .select("data")
          .eq("aluno_id", alunoId)
          .eq("motivo_dificuldade", "desconforto_dor")
          .gte("data", diaBrasilia(-LIMIARES.dorDias)),
      ]);
      for (const r of [treino, registros, aluno, suspensa, anamnese, checkins]) if (r.error) throw r.error;

      const lidos: RegistroDoTreino[] = (registros.data ?? []).map((r) => {
        const bemEstar = umSo(r.registro_treino_bem_estar as unknown as BemEstar | BemEstar[] | null);
        return {
          data: r.data,
          treino_id: r.treino_id,
          esforco_percebido: bemEstar?.esforco_percebido ?? null,
          sensacao: bemEstar?.sensacao ?? null,
          sono: bemEstar?.sono ?? null,
          energia: bemEstar?.energia ?? null,
          series: r.registro_serie ?? [],
        };
      });
      return {
        alunoNoMetodo: aluno.data?.metodo_arke_status === "ativo",
        resultado: sugestoesDoTreino({
          hoje,
          treino: treino.data
            ? { id: treino.data.id, exercicios: (treino.data.snapshot_conteudo as unknown as ItemDaFicha[] | null) ?? [] }
            : null,
          registros: lidos,
          datasComDorNoCheckin: (checkins.data ?? []).map((c) => c.data),
          progressaoSuspensa: !!suspensa.data?.bloqueada_em,
          consentimentoSaudeRetirado: !!anamnese.data?.consentimento_lgpd_revogado_em,
        }),
      };
    },
    enabled: podeVer && !!alunoId,
  });

  if (!podeVer) return null;

  if (isLoading) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Calculando a sugestão de progressão...
      </p>
    );
  }
  if (error) {
    return <ErroAoCarregar oQue="a sugestão de progressão" onTentarDeNovo={() => void refetch()} tentando={isFetching} className="p-3" />;
  }
  if (!data) return null;
  // A sugestão é de quem é dono do treino: a academia no Free, o mentor no Método.
  if (!veSugestaoDeProgressao({ ...contexto, alunoNoMetodo: data.alunoNoMetodo })) return null;

  const { resultado } = data;
  return (
    <section aria-labelledby="sugestao-progressao-titulo" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <h3 id="sugestao-progressao-titulo" className="flex items-center gap-1.5 text-sm font-semibold">
        <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />
        Sugestão de progressão da carga
      </h3>
      <p className="text-xs text-muted-foreground">
        Calculada por regra, dos últimos treinos do aluno: séries feitas, esforço, sono, energia e dor. A decisão é sua. Nada muda no
        treino até você publicar uma versão nova, logo abaixo. O aluno não vê esta sugestão.
      </p>

      {resultado.estado === "sem_autorizacao" && (
        <p className="text-sm">
          Sem sugestão: o aluno retirou a autorização de uso dos dados de saúde, e ela depende deles.
        </p>
      )}
      {resultado.estado === "sem_treino" && <p className="text-sm">Sem sugestão: o aluno ainda não tem um treino ativo.</p>}
      {resultado.estado === "pronto" && <ListaDeSugestoes resultado={resultado} />}
    </section>
  );
}

function ListaDeSugestoes({ resultado }: { resultado: Extract<ReturnType<typeof sugestoesDoTreino>, { estado: "pronto" }> }) {
  const porTipo = (tipo: TipoSugestao) => resultado.exercicios.filter((e) => e.sugestao.tipo === tipo);
  // Segurar, rever e subir pedem a atenção do professor, um a um; manter e sem dados vão numa linha cada.
  const destacados = ORDEM_DOS_TIPOS.filter((t) => t !== "manter" && t !== "sem_dados").flatMap(porTipo);
  const manter = porTipo("manter");
  const semDados = porTipo("sem_dados");
  const { dor } = resultado;

  return (
    <div className="space-y-2">
      {dor.recente && (
        <p className="text-sm font-medium text-warning">
          {dor.suspensa
            ? "A progressão está suspensa por relato de dor."
            : `O aluno relatou dor em ${formatarDataBR(dor.ultimaData)}.`}{" "}
          Converse com ele antes de mexer na carga.
        </p>
      )}

      {destacados.length > 0 && (
        <ul className="space-y-1.5">
          {destacados.map((e) => (
            <li key={`${e.divisao}-${e.ordem}`} className="text-sm">
              <span className="font-medium">
                {e.divisao} · {e.nome}:
              </span>{" "}
              <span className={`font-medium ${COR_DO_TIPO[e.sugestao.tipo]}`}>{e.sugestao.frase}.</span>
              {e.sugestao.referencia && <span className="block text-xs text-muted-foreground">{e.sugestao.referencia}</span>}
            </li>
          ))}
        </ul>
      )}

      {manter.length > 0 && (
        <p className="text-sm">
          <span className="font-medium">Manter, ainda progredindo dentro da faixa:</span> {nomes(manter)}.
        </p>
      )}

      {semDados.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {semDados.length === resultado.exercicios.length ? "Ainda sem dados para sugerir. " : `Ainda sem dados para sugerir: ${nomes(semDados)}. `}
          A sugestão aparece quando o aluno anota carga e repetições, na execução do treino, em {LIMIARES.sessoesMinimas} treinos das últimas{" "}
          {LIMIARES.janelaDias / 7} semanas, e quando a série tem as repetições em número (por exemplo, 8-12).
        </p>
      )}
    </div>
  );
}
