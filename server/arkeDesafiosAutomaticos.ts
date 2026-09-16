import { calcAuto } from "./arkeGamification";
import {
  type Desafio,
  createNotificacao,
  listAlunosComArkeAtivoIds,
  listArkeModulesEnabled,
  listDesafioParticipantes,
  listDesafioProgressoForDesafio,
  listDesafios,
  listStudentsInOrganization,
  setDesafioProgresso,
} from "./supabaseAdmin";
import { listActiveStaffUserIds } from "./db";
import { sendPushToUser } from "./push";
import { captureException } from "./_core/errorMonitoring";

// Sessão A, fatia A4: fecha o desafio explicitamente pausado desde o
// checkpoint da fórmula portada — até aqui `calcAuto` (arkeGamification.ts)
// só calculava progresso automático em memória, na leitura da pontuação,
// nunca persistia em desafio_progresso. Este cron persiste, para o aluno
// ver o próprio progresso fora da tela de pontuação e a equipe ser avisada
// quando um desafio fecha sozinho.
//
// Preserva ajuste manual (CLAUDE.md — nunca sobrescrever uma decisão da
// equipe com uma heurística automática): antes de gravar, olha a linha já
// existente em desafio_progresso — se origem='manual', pula esse aluno
// neste desafio, sempre. Só grava linhas novas/já 'automatico'.
const STAFF_ROLES = ["owner", "admin", "manager", "professional", "nutricionista"] as const;

async function participantesDoDesafio(desafio: Desafio, alunosComArkeAtivo: string[]): Promise<string[]> {
  if (desafio.para_todos) return alunosComArkeAtivo;
  const participantes = await listDesafioParticipantes(desafio.id);
  return participantes.map((p) => p.aluno_id);
}

export type ArkeDesafiosAutomaticosResultado = { desafiosProcessados: number; progressosAtualizados: number; concluidosAgora: number; falhas: number };

export async function runArkeDesafiosAutomaticos(): Promise<ArkeDesafiosAutomaticosResultado> {
  const resultado: ArkeDesafiosAutomaticosResultado = { desafiosProcessados: 0, progressosAtualizados: 0, concluidosAgora: 0, falhas: 0 };
  const hoje = new Date().toISOString().slice(0, 10);

  for (const arkeModule of await listArkeModulesEnabled()) {
    const organizationId = arkeModule.organization_id;
    let alunosComArkeAtivo: string[] | null = null;
    let staffNotificado: string[] | null = null;
    let studentsNameById: Map<string, string> | null = null;

    // "livre" nunca é automático (só a equipe valida, comportamento
    // preservado); desafios que ainda não começaram não têm o que calcular.
    const desafios = (await listDesafios(organizationId)).filter((d) => d.tipo !== "livre" && d.data_inicio <= hoje);

    for (const desafio of desafios) {
      resultado.desafiosProcessados += 1;
      if (!alunosComArkeAtivo) alunosComArkeAtivo = await listAlunosComArkeAtivoIds(organizationId);

      let participantes: string[];
      let progressoExistente: Awaited<ReturnType<typeof listDesafioProgressoForDesafio>>;
      try {
        [participantes, progressoExistente] = await Promise.all([
          participantesDoDesafio(desafio, alunosComArkeAtivo),
          listDesafioProgressoForDesafio(desafio.id),
        ]);
      } catch (error) {
        captureException(error, { job: "arke_desafios_automaticos", organizationId, desafioId: desafio.id });
        resultado.falhas += 1;
        continue;
      }

      const progressoByAluno = new Map(progressoExistente.map((p) => [p.aluno_id, p]));
      const encerrado = desafio.data_fim < hoje;

      for (const alunoId of participantes) {
        const existente = progressoByAluno.get(alunoId);
        if (existente?.origem === "manual") continue;

        try {
          const auto = await calcAuto(alunoId, desafio);
          if (!auto) continue;
          const concluido = auto.isInverse ? auto.valor <= auto.meta && encerrado : auto.meta > 0 && auto.valor >= auto.meta;
          const jaEstavaConcluido = existente?.concluido ?? false;

          await setDesafioProgresso({ desafioId: desafio.id, alunoId, organizationId, concluido, valorAtual: auto.valor, origem: "automatico" });
          resultado.progressosAtualizados += 1;

          // Notificação da equipe (A7), não bloqueante — só na transição
          // false→true, mesmo padrão do chat (notifyUser/notifyStaff em routers.ts).
          if (concluido && !jaEstavaConcluido) {
            resultado.concluidosAgora += 1;
            if (!studentsNameById) studentsNameById = new Map((await listStudentsInOrganization(organizationId)).map((s) => [s.user_id, s.full_name || "Aluno"]));
            if (!staffNotificado) staffNotificado = await listActiveStaffUserIds(organizationId, STAFF_ROLES);
            const nome = studentsNameById.get(alunoId) ?? "Aluno";
            const titulo = "🏆 Desafio concluído";
            const mensagem = `${nome} concluiu automaticamente "${desafio.titulo}".`;
            await Promise.all(staffNotificado.map(async (userId) => {
              await createNotificacao({ userId, titulo, mensagem, tipo: "desafio" });
              sendPushToUser(userId, { title: titulo, body: mensagem, url: "/" }).catch(() => {});
            }));
          }
        } catch (error) {
          captureException(error, { job: "arke_desafios_automaticos", organizationId, desafioId: desafio.id, alunoId });
          resultado.falhas += 1;
        }
      }
    }
  }

  return resultado;
}
