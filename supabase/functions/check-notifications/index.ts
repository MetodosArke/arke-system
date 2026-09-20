import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";
import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// ATENÇÃO — função NÃO portada para o schema multitenant. Ela é resquício do
// protótipo pré-reset e hoje está fail-closed por CRON_SECRET, sem nenhum
// cron.schedule apontando para ela. Antes de agendar, é preciso corrigir:
//   - `notificacao_preferencias`, `progresso_semanal`, `registro_serie` e
//     `notificacoes` não existem mais no banco (as leituras caem no default
//     "tudo ligado" e o insert da caixa de entrada falha em silêncio);
//   - `dieta_adesao`, `registro_treino` e `compromisso_semanal` são
//     consultados com `profiles.user_id`, mas a chave dessas tabelas é
//     `alunos.id` / `aluno_id` — nenhuma das buscas casa;
//   - a varredura pega todo `profiles` ativo da plataforma, sem filtro por
//     `organization_id` nem por "é aluno", então gestor e professor recebem
//     lembrete de hidratação;
//   - a cópia usa gamificação punitiva ("não perca pontos"), que a
//     metodologia ARKE abandonou (ver CLAUDE.md).
// Como as buscas por id errado retornam vazio, agendar sem corrigir dispara
// lembrete diário para todo mundo. Ver CLAUDE.md, pendência (3).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Varre profiles ativos de TODAS as organizações e manda push — sem
  // nenhum caller hoje (não está em nenhum cron.schedule nem chamada do
  // frontend), então era invocável publicamente por qualquer um, o que
  // vira spam pra plataforma inteira e custo de envio de graça. Exige um
  // segredo compartilhado (o mesmo que o cron/scheduler deve enviar no
  // header) em vez de abrir por padrão.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || headerSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: "Não autorizado." }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidPublicKey = vapidPrivateKey ? deriveVapidPublicKey(vapidPrivateKey) : null;

    if (vapidPrivateKey && vapidPublicKey) {
      webpush.setVapidDetails(
        "mailto:noreply@metodosarke.com.br",
        vapidPublicKey,
        vapidPrivateKey
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    const dayOfWeek = today.getDay();

    const { data: allUsers } = await supabase
      .from("profiles")
      .select("user_id, full_name, status")
      .eq("status", "active");

    if (!allUsers || allUsers.length === 0) {
      return new Response(JSON.stringify({ message: "No active users" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalNotifications = 0;

    for (const userProfile of allUsers) {
      const userId = userProfile.user_id;

      const { data: prefs } = await supabase
        .from("notificacao_preferencias")
        .select("*")
        .eq("user_id", userId)
        .single();

      const preferences = prefs || {
        lembrete_agua: true,
        progresso_semanal: true,
        meta_treinos_semana: true,
        compromisso_semanal: true,
        constancia_treino: true,
        revisao_rotina: true,
        desempenho_dieta: true,
      };

      const notifications: PushPayload[] = [];

      // 1. Lembrete de água
      if (preferences.lembrete_agua) {
        const { data: adesaoHoje } = await supabase
          .from("dieta_adesao")
          .select("agua_ml")
          .eq("aluno_id", userId)
          .eq("data", todayStr);

        const totalAgua = adesaoHoje?.reduce((sum, a) => sum + (a.agua_ml || 0), 0) || 0;
        if (totalAgua < 1500) {
          notifications.push({
            title: "💧 Lembrete de Hidratação",
            body: "Você ainda não registrou 1,5L de água hoje. Beba água e registre no app!",
            url: "/#/app/dieta",
          });
        }
      }

      // 2. Progresso semanal (Sunday)
      if (preferences.progresso_semanal && dayOfWeek === 0) {
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - 7);
        const weekStart = startOfWeek.toISOString().split("T")[0];

        const { data: progressoRecente } = await supabase
          .from("progresso_semanal")
          .select("id")
          .eq("aluno_id", userId)
          .gte("data", weekStart)
          .limit(1);

        if (!progressoRecente || progressoRecente.length === 0) {
          notifications.push({
            title: "📊 Hora do Progresso Semanal!",
            body: "Domingo é dia de registrar seu progresso! Não perca pontos - atualize suas medidas.",
            url: "/#/app/evolucao",
          });
        }
      }

      // 3. Meta de treinos (Monday)
      if (preferences.meta_treinos_semana && dayOfWeek === 1) {
        notifications.push({
          title: "🔥 Nova Semana, Novos Objetivos!",
          body: "Comece a semana definindo sua meta de treinos. Cada treino te aproxima do seu objetivo!",
          url: "/#/app/treinos",
        });
      }

      // 4. Compromisso semanal (Wednesday)
      if (preferences.compromisso_semanal && dayOfWeek === 3) {
        const weekId = getWeekId(today);
        const { data: compromisso } = await supabase
          .from("compromisso_semanal")
          .select("id")
          .eq("user_id", userId)
          .eq("semana", weekId)
          .limit(1);

        if (!compromisso || compromisso.length === 0) {
          notifications.push({
            title: "🎯 Compromisso da Semana",
            body: "Você ainda não definiu seu compromisso semanal! Faça agora e ganhe pontos.",
            url: "/#/app/jornada",
          });
        }
      }

      // 5. Constância de treino (3 days without training)
      if (preferences.constancia_treino) {
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(today.getDate() - 3);
        const threeDaysStr = threeDaysAgo.toISOString().split("T")[0];

        const { data: treinosRecentes } = await supabase
          .from("registro_treino")
          .select("id")
          .eq("aluno_id", userId)
          .gte("data", threeDaysStr)
          .limit(1);

        if (!treinosRecentes || treinosRecentes.length === 0) {
          const sevenDaysAgo = new Date(today);
          sevenDaysAgo.setDate(today.getDate() - 7);
          const sevenDaysStr = sevenDaysAgo.toISOString().split("T")[0];

          // Considera "atividade" qualquer registro_treino nos últimos 7 dias
          // OU qualquer série concluída (registro_serie.concluida = true) cujo
          // registro_treino pai esteja dentro dos últimos 7 dias.
          const { data: treinosSemana } = await supabase
            .from("registro_treino")
            .select("id, data, registro_serie(concluida)")
            .eq("aluno_id", userId)
            .gte("data", sevenDaysStr);

          const teveAtividade = (treinosSemana || []).some((rt: any) => {
            // Qualquer registro de treino na janela já conta como atividade
            // (mesmo sem finalizar, pois houve sessão iniciada);
            // ou pelo menos uma série marcada como concluída.
            if (rt) return true;
            return (rt.registro_serie || []).some((s: any) => s.concluida === true);
          });

          if (!teveAtividade) {
            if (preferences.revisao_rotina) {
              notifications.push({
                title: "⚠️ Revisão de Rotina",
                body: "Faz uma semana sem treinar. Que tal rever sua rotina? Pequenos ajustes fazem grande diferença!",
                url: "/#/app/rotina",
              });
            }
          } else {
            notifications.push({
              title: "💪 Bora Treinar!",
              body: "Já fazem 3 dias sem treino! Constância é a parte mais importante do processo. Vamos lá!",
              url: "/#/app/treinos",
            });
          }
        }
      }

      // 7. Desempenho dieta < 30%
      if (preferences.desempenho_dieta) {
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);
        const sevenDaysStr = sevenDaysAgo.toISOString().split("T")[0];

        const { data: adesaoSemana } = await supabase
          .from("dieta_adesao")
          .select("adesao_percentual")
          .eq("aluno_id", userId)
          .gte("data", sevenDaysStr);

        if (adesaoSemana && adesaoSemana.length > 0) {
          const avgAdesao = adesaoSemana.reduce((sum, a) => sum + a.adesao_percentual, 0) / adesaoSemana.length;
          if (avgAdesao < 30) {
            notifications.push({
              title: "🥗 Atenção com a Dieta",
              body: "Seu desempenho com a dieta está abaixo de 30%. Que tal conversar com a nutri pelo app?",
              url: "/#/app/dieta",
            });
          }
        }
      }

      // Send notifications
      for (const notif of notifications) {
        await supabase.from("notificacoes").insert({
          user_id: userId,
          titulo: notif.title,
          mensagem: notif.body,
          tipo: "lembrete",
        });

        if (vapidPrivateKey) {
          const { data: subscriptions } = await supabase
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth")
            .eq("user_id", userId);

          if (subscriptions) {
            for (const sub of subscriptions) {
              try {
                await webpush.sendNotification(
                  {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth },
                  },
                  JSON.stringify(notif)
                );
                console.log(`Push sent successfully to ${sub.endpoint.substring(0, 60)}...`);
              } catch (err: any) {
                const pushErrorMessage = String(err.body || err.message || "");
                const shouldDeleteSubscription =
                  err.statusCode === 410 ||
                  err.statusCode === 404 ||
                  (err.statusCode === 403 && pushErrorMessage.toLowerCase().includes("vapid credentials"));

                console.error(`Push failed (${err.statusCode}):`, pushErrorMessage);
                if (shouldDeleteSubscription) {
                  await supabase
                    .from("push_subscriptions")
                    .delete()
                    .eq("endpoint", sub.endpoint)
                    .eq("user_id", userId);

                  console.log(`Removed invalid push subscription for ${userId}`);
                }
              }
            }
          }
        }

        totalNotifications++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, notifications_sent: totalNotifications }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in check-notifications:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getWeekId(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay() + 1);
  return d.toISOString().split("T")[0];
}

function deriveVapidPublicKey(privateKey: string): string {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(base64UrlToBuffer(privateKey));
  return toBase64Url(ecdh.getPublicKey(undefined, "uncompressed"));
}

function base64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
