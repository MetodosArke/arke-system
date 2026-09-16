import { createNotificacao, hasCheckinDesde, hasProgressoSemanalDesde, listAlunosComArkeAtivoIds, listArkeModulesEnabled } from "./supabaseAdmin";
import { sendPushToUser } from "./push";
import { captureException } from "./_core/errorMonitoring";

// Porta (adaptada) a rotina de 6 lembretes "check-notifications" do
// arke-app original. Lá, metade dos sinais dependia de tabelas de
// auto-registro que nunca foram portadas para o SaaS novo (dieta_adesao,
// registro_treino, compromisso_semanal — ver a mesma nota em
// supabaseAdmin.ts junto de desafios/competições): fingir esses sinais
// seria "afirmar resultado não verificado" (CLAUDE.md §6). Esta versão usa
// só os sinais que o SaaS novo realmente grava: progresso_semanal
// (Evolução, PR #32) e checkin_diario (Check-in diário, PR #31) — mais um
// lembrete de início de semana que, no original, também não dependia de
// nenhum dado.
const diasAtras = (dias: number) => {
  const data = new Date();
  data.setUTCDate(data.getUTCDate() - dias);
  return data.toISOString().slice(0, 10);
};

type Lembrete = { titulo: string; mensagem: string };

async function lembretesParaAluno(userId: string, hoje: Date): Promise<Lembrete[]> {
  const lembretes: Lembrete[] = [];
  const diaSemana = hoje.getUTCDay();

  if (diaSemana === 0 && !(await hasProgressoSemanalDesde(userId, diasAtras(7)))) {
    lembretes.push({ titulo: "📊 Hora do progresso semanal!", mensagem: "Domingo é dia de registrar sua evolução. Atualize suas medidas no app." });
  }

  if (diaSemana === 1) {
    lembretes.push({ titulo: "🔥 Nova semana, novos objetivos!", mensagem: "Comece a semana com o pé direito. Bora treinar?" });
  }

  if (!(await hasCheckinDesde(userId, diasAtras(7)))) {
    lembretes.push({ titulo: "⚠️ Revisão de rotina", mensagem: "Faz uma semana sem check-in. Que tal revisar sua rotina com seu profissional?" });
  } else if (!(await hasCheckinDesde(userId, diasAtras(3)))) {
    lembretes.push({ titulo: "💪 Bora treinar!", mensagem: "Já fazem 3 dias sem check-in. Constância é o que mais importa — vamos lá!" });
  }

  return lembretes;
}

export type ArkeLembretesResultado = { alunosProcessados: number; lembretesEnviados: number; falhas: number };

export async function runArkeLembretesDiarios(): Promise<ArkeLembretesResultado> {
  const resultado: ArkeLembretesResultado = { alunosProcessados: 0, lembretesEnviados: 0, falhas: 0 };
  const hoje = new Date();

  for (const arkeModule of await listArkeModulesEnabled()) {
    for (const userId of await listAlunosComArkeAtivoIds(arkeModule.organization_id)) {
      resultado.alunosProcessados += 1;
      try {
        for (const lembrete of await lembretesParaAluno(userId, hoje)) {
          await createNotificacao({ userId, titulo: lembrete.titulo, mensagem: lembrete.mensagem, tipo: "lembrete" });
          sendPushToUser(userId, { title: lembrete.titulo, body: lembrete.mensagem, url: "/" }).catch(() => {});
          resultado.lembretesEnviados += 1;
        }
      } catch (error) {
        captureException(error, { job: "arke_lembretes_diarios", userId });
        resultado.falhas += 1;
      }
    }
  }

  return resultado;
}
