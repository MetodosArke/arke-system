import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { todasAsLinhas } from "../_shared/paginar.ts";
import { dataBrasilia } from "../_shared/data.ts";
import { emLotes, VALIDADE_SEG } from "../_shared/avisoPush.ts";
import { enviarAvisos, type Inscricao } from "../_shared/push.ts";
import { cabecalhosDoResend, chaveDeIdempotencia, envioAceito, resumoParaChave } from "../_shared/idempotenciaEmail.ts";
import { linkDoApp } from "../_shared/linkDoApp.ts";
import { servir } from "../_shared/servir.ts";
import {
  AVISO_PUSH,
  avisosDoDia,
  dentroDoHorario,
  emailDoAviso,
  horaBrasilia,
  TOPICO_PUSH,
  type Candidato,
  type TipoAviso,
} from "./regras.ts";

// Os avisos automáticos de retenção ao aluno (26/10/2026): o convite de novo
// a quem não entrou, os lembretes de 3 e 5 dias sem treinar e o pedido do
// atestado novo. Só o cron chama, com o token do alerta de rotinas. Quem pode
// receber vem do banco; qual aviso sai, de regras.ts.
//
// Cada aviso é reservado no banco antes de sair (`reservar_aviso_ao_aluno`):
// duas rodadas ao mesmo tempo não mandam o mesmo aviso, e o aviso reservado
// que não chegou não sai de novo. Menos um aviso é melhor que dois. A reserva
// marca também a tarefa aberta do caso na fila da equipe.

const NOME = "aviso-retencao-aluno";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Linha = Candidato & { aluno_id: string; user_id: string; email: string | null; nome: string; academia: string };
type Email = { from: string; to: string[]; subject: string; html: string; text: string };

servir("aviso-retencao-aluno", async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const doCron = token ? !!(await admin.rpc("conferir_token_alerta_rotinas", { _token: token })).data : false;
  if (!doCron) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    const agora = new Date();
    if (!dentroDoHorario(horaBrasilia(agora))) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, fora_do_horario: true });
    }
    // Sem as chaves, nada sai: reservar agora gastaria o aviso do período.
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey || !Deno.env.get("VAPID_PRIVATE_KEY")) {
      await registrarExecucao(admin, NOME, false, "RESEND_API_KEY ou VAPID_PRIVATE_KEY ausente");
      return jsonResponse({ error: "Avisos sem configuração." }, 500);
    }
    const siteUrl = Deno.env.get("SITE_URL");
    const de = Deno.env.get("EMAIL_ACESSO_FROM") ?? "ArkeFit <acesso@arkefit.com.br>";
    const hoje = dataBrasilia(agora);

    const candidatos = await todasAsLinhas<Linha>((inicio, fim) =>
      admin.rpc("alunos_para_avisos_de_retencao").order("aluno_id").range(inicio, fim),
    );

    const pushPorTipo = new Map<Exclude<TipoAviso, "convite">, Set<string>>();
    const emails: { reserva: string; email: Email }[] = [];
    let reservados = 0;
    let falhas = 0;
    for (const c of candidatos) {
      for (const aviso of avisosDoDia(c, hoje)) {
        const { data: reserva, error } = await admin.rpc("reservar_aviso_ao_aluno", {
          _aluno_id: c.aluno_id,
          _tipo: aviso.tipo,
          _referencia: aviso.referencia,
          _canais: aviso.canais,
        });
        if (error) {
          falhas++;
          console.error(`${NOME}: reserva recusada`, error.code);
          continue;
        }
        // Nulo: outra rodada reservou antes.
        if (!reserva) continue;
        reservados++;

        if (aviso.canais.includes("push") && aviso.tipo !== "convite") {
          const tipo = aviso.tipo;
          if (!pushPorTipo.has(tipo)) pushPorTipo.set(tipo, new Set());
          pushPorTipo.get(tipo)!.add(c.user_id);
        }
        if (aviso.canais.includes("email") && c.email) {
          const link = aviso.tipo === "convite" ? await linkDeCriarSenha(admin, c.email, siteUrl) : linkDoApp(siteUrl, aviso.tipo === "atestado" ? "/app" : "/app/treinos");
          if (!link) {
            falhas++;
            continue;
          }
          const conteudo = emailDoAviso(aviso.tipo, {
            nome: c.nome,
            academia: c.academia,
            link,
            linkPerfil: linkDoApp(siteUrl, "/app/perfil"),
            atestadoValidade: aviso.tipo === "atestado" ? aviso.referencia : null,
          });
          emails.push({
            reserva: String(reserva),
            email: { from: de, to: [c.email], subject: conteudo.assunto, html: conteudo.html, text: conteudo.texto },
          });
        }
      }
    }

    // Os e-mails em lotes de 100 (`/emails/batch`): o Resend aceita poucas
    // chamadas por segundo, e um envio por aluno estouraria o limite. A chave
    // do lote é o resumo das reservas dele: a mesma rodada repetida não manda
    // de novo, e o lote de outro dia nunca colide com este.
    let emailsEnviados = 0;
    for (const lote of emLotes(emails, 100)) {
      const chave = chaveDeIdempotencia("aviso-retencao", hoje, await resumoParaChave(...lote.map((e) => e.reserva)));
      try {
        const r = await fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: cabecalhosDoResend(resendKey, chave),
          body: JSON.stringify(lote.map((e) => e.email)),
          signal: AbortSignal.timeout(30_000),
        });
        // Só o status vai para log: a resposta do Resend ecoa os endereços.
        if (envioAceito(r.status)) emailsEnviados += lote.length;
        else {
          falhas++;
          console.error(`${NOME}: Resend recusou o lote`, r.status);
        }
      } catch (e) {
        falhas++;
        console.error(`${NOME}: Resend`, resumoDoErro(e));
      }
    }

    // Um aviso por pessoa e por tipo. Os ids vão em lotes de 200: uma lista
    // longa no `.in()` não cabe no endereço.
    let pushEnviados = 0;
    for (const [tipo, pessoas] of pushPorTipo) {
      const inscricoes: Inscricao[] = [];
      for (const lote of emLotes([...pessoas], 200)) {
        inscricoes.push(
          ...(await todasAsLinhas<Inscricao>((inicio, fim) =>
            admin.from("push_subscriptions").select("endpoint, p256dh, auth").in("user_id", lote).order("id").range(inicio, fim),
          )),
        );
      }
      const { enviados } = await enviarAvisos(admin, inscricoes, AVISO_PUSH[tipo], {
        validadeSeg: VALIDADE_SEG.retencao,
        topico: TOPICO_PUSH[tipo],
        urgencia: "low",
      });
      pushEnviados += enviados;
    }

    if (falhas) await registrarExecucao(admin, NOME, false, `${falhas} falha(s) na reserva ou no envio`);
    else await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: falhas === 0, candidatos: candidatos.length, reservados, emails: emailsEnviados, avisos_celular: pushEnviados, falhas });
  } catch (e) {
    console.error(`${NOME}: erro inesperado`, resumoDoErro(e));
    await registrarExecucao(admin, NOME, false, descreverErro(e));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});

/** O link de criar a senha do convite, o mesmo da matrícula (`convidar-membro`). Nulo se o Auth recusar. */
async function linkDeCriarSenha(admin: SupabaseClient, email: string, siteUrl: string | undefined): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: linkDoApp(siteUrl, "/auth/definir-senha") },
  });
  if (error || !data?.properties?.action_link) {
    console.error(`${NOME}: link do convite não gerado`, resumoDoErro(error));
    return null;
  }
  return data.properties.action_link;
}
