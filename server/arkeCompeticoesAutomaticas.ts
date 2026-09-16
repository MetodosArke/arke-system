import { computeScoreAluno } from "./arkeGamification";
import {
  listAlunosComArkeAtivoIds,
  listArkeModulesEnabled,
  listCompeticaoParticipantes,
  listCompeticaoPontuacaoForCompeticao,
  listCompeticoes,
  setCompeticaoPontuacao,
} from "./supabaseAdmin";
import { captureException } from "./_core/errorMonitoring";

// Sessão A, fatia A5: para competições com modo_pontuacao='automatica',
// o ranking passa a vir do mesmo motor de pontuação já usado em
// arke.meu.minhaPontuacao (computeScoreAluno), na janela [data_inicio,
// data_fim] da própria competição — nunca mais um número que a equipe tem
// que digitar do zero. Competições 'manual' (padrão) continuam exatamente
// como antes, sem esse cron tocar nelas.
//
// Mesma preservação de ajuste manual de A4: antes de gravar, olha a linha
// já existente em competicao_pontuacao — se origem='manual', pula esse
// aluno nesta competição.
export type ArkeCompeticoesAutomaticasResultado = { competicoesProcessadas: number; pontuacoesAtualizadas: number; falhas: number };

export async function runArkeCompeticoesAutomaticas(): Promise<ArkeCompeticoesAutomaticasResultado> {
  const resultado: ArkeCompeticoesAutomaticasResultado = { competicoesProcessadas: 0, pontuacoesAtualizadas: 0, falhas: 0 };

  for (const arkeModule of await listArkeModulesEnabled()) {
    const organizationId = arkeModule.organization_id;
    let alunosComArkeAtivo: string[] | null = null;

    const competicoes = (await listCompeticoes(organizationId)).filter((c) => c.modo_pontuacao === "automatica");

    for (const competicao of competicoes) {
      resultado.competicoesProcessadas += 1;
      if (!alunosComArkeAtivo) alunosComArkeAtivo = await listAlunosComArkeAtivoIds(organizationId);

      let participantes: string[];
      let pontuacaoExistente: Awaited<ReturnType<typeof listCompeticaoPontuacaoForCompeticao>>;
      try {
        [participantes, pontuacaoExistente] = await Promise.all([
          competicao.para_todos ? Promise.resolve(alunosComArkeAtivo) : listCompeticaoParticipantes(competicao.id).then((rows) => rows.map((row) => row.aluno_id)),
          listCompeticaoPontuacaoForCompeticao(competicao.id),
        ]);
      } catch (error) {
        captureException(error, { job: "arke_competicoes_automaticas", organizationId, competicaoId: competicao.id });
        resultado.falhas += 1;
        continue;
      }

      const origemByAluno = new Map(pontuacaoExistente.map((item) => [item.aluno_id, item.origem]));

      for (const alunoId of participantes) {
        if (origemByAluno.get(alunoId) === "manual") continue;
        try {
          const score = await computeScoreAluno(alunoId, organizationId, competicao.data_inicio, competicao.data_fim);
          await setCompeticaoPontuacao({ competicaoId: competicao.id, alunoId, organizationId, valor: score.total, origem: "automatico" });
          resultado.pontuacoesAtualizadas += 1;
        } catch (error) {
          captureException(error, { job: "arke_competicoes_automaticas", organizationId, competicaoId: competicao.id, alunoId });
          resultado.falhas += 1;
        }
      }
    }
  }

  return resultado;
}
