import { createClient } from "npm:@supabase/supabase-js@2";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { todasAsLinhas } from "../_shared/paginar.ts";
import { emLotes, VALIDADE_SEG } from "../_shared/avisoPush.ts";
import { enviarAvisos, type Inscricao } from "../_shared/push.ts";
import { servir } from "../_shared/servir.ts";
import {
  AVISO_COBRANCA,
  COLUNA_DA_ETAPA,
  emHorarioComercial,
  etapaDoAviso,
  relogioBrasilia,
  TOPICO_COBRANCA,
  type MensalidadeVencida,
} from "./regras.ts";

// A recuperação da mensalidade vencida (15/10/2026): o aviso no celular do
// aluno no D+1 e no D+3, dentro da tolerância, para ele pagar antes do
// bloqueio sem a recepção precisar ligar. O Asaas já manda os dele por e-mail
// e SMS (no vencimento sem pagamento e a cada 7 dias); este é o que só o app
// tem. Só o cron chama, com o token do alerta de rotinas.
//
// Cada aviso é reservado no banco antes de sair, por uma atualização
// condicional (a coluna da etapa ainda vazia e a mensalidade ainda em
// aberto): duas rodadas ao mesmo tempo não mandam o mesmo aviso, e o aviso
// reservado que não chegou não sai de novo. Menos um aviso é melhor que dois.

const NOME = "aviso-cobranca-atrasada";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Candidata = MensalidadeVencida & { mensalidade_id: string; user_id: string };

servir("aviso-cobranca-atrasada", async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const doCron = token ? !!(await admin.rpc("conferir_token_alerta_rotinas", { _token: token })).data : false;
  if (!doCron) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    const relogio = relogioBrasilia(new Date());
    if (!emHorarioComercial(relogio)) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, fora_do_horario: true });
    }
    // Sem a chave, nada sai: reservar agora gastaria o aviso do dia.
    if (!Deno.env.get("VAPID_PRIVATE_KEY")) {
      await registrarExecucao(admin, NOME, false, "VAPID_PRIVATE_KEY ausente");
      return jsonResponse({ error: "Aviso no celular sem configuração." }, 500);
    }

    const candidatas = await todasAsLinhas<Candidata>((de, ate) =>
      admin.rpc("mensalidades_para_aviso_de_cobranca").order("mensalidade_id").range(de, ate),
    );

    const avisar = new Set<string>();
    let reservadas = 0;
    let falhas = 0;
    for (const m of candidatas) {
      const etapa = etapaDoAviso(m, relogio.hoje);
      if (!etapa) continue;
      const coluna = COLUNA_DA_ETAPA[etapa];
      const { data, error } = await admin
        .from("mensalidades")
        .update({ [coluna]: new Date().toISOString() })
        .eq("id", m.mensalidade_id)
        .is(coluna, null)
        .in("status", ["pendente", "atrasado"])
        .select("id");
      if (error) {
        falhas++;
        console.error(`${NOME}: reserva recusada`, error.code);
        continue;
      }
      // Zero linhas: outra rodada reservou antes, ou a mensalidade foi paga.
      if (data?.length) {
        reservadas++;
        avisar.add(m.user_id);
      }
    }

    // Um aviso por pessoa, mesmo com duas mensalidades vencidas. Os ids vão
    // em lotes de 200: uma lista longa no `.in()` não cabe no endereço.
    let enviados = 0;
    if (avisar.size) {
      const inscricoes: Inscricao[] = [];
      for (const lote of emLotes([...avisar], 200)) {
        inscricoes.push(
          ...(await todasAsLinhas<Inscricao>((de, ate) =>
            admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", lote).order("id").range(de, ate),
          )),
        );
      }
      ({ enviados } = await enviarAvisos(admin, inscricoes, AVISO_COBRANCA, {
        validadeSeg: VALIDADE_SEG.cobranca,
        topico: TOPICO_COBRANCA,
        urgencia: "normal",
      }));
    }

    if (falhas) await registrarExecucao(admin, NOME, false, `${falhas} reserva(s) recusada(s) pelo banco`);
    else await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: falhas === 0, candidatas: candidatas.length, reservadas, pessoas: avisar.size, enviados, falhas });
  } catch (e) {
    console.error(`${NOME}: erro inesperado`, resumoDoErro(e));
    await registrarExecucao(admin, NOME, false, descreverErro(e));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
