import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { encerrarCobrancasDoAluno } from "../_shared/encerrarCobrancas.ts";
import { abridorDaContaDaAcademia } from "../_shared/contaDaAcademia.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { todasAsLinhas } from "../_shared/paginar.ts";
import { pausarAssinatura } from "../asaas-assinatura-ciclo/fluxo.ts";
import { anonimizarClientesDaEliminacao, retentarPendentes } from "../_shared/saidaAsaas.ts";
import { servir } from "../_shared/servir.ts";
import { enviarAvisos } from "../_shared/push.ts";
import { topicoDoId, VALIDADE_SEG } from "../_shared/avisoPush.ts";
import {
  chaveDoAviso,
  chaveDoLote,
  emailDeAviso,
  loteDeEmails,
  pushAoAluno,
  type AvisoEncerramento,
  type DestinatarioAluno,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-alerta-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Encerramento de academia: executa o que o banco diz que venceu (ver a
// migration 20261281010000). De hora em hora pelo cron; a ArkeFit também pode
// chamar "executar agora" pela Visão Master, para o que já venceu.
//
//   aviso      → e-mail à gestão da academia e à ArkeFit com as datas; e a
//                cada aluno (matrícula viva ou Método ativo), e-mail e aviso
//                no celular com o prazo e o que acontece com os dados dele;
//   término    → cobranças dos alunos canceladas no Asaas, mensalidade B2B
//                pausada (a já vencida fica: é dívida, não cobrança futura),
//                depois o banco marca a organização como encerrada e agenda
//                a remoção das digitais;
//   janela     → a cada rodada, o banco confere o que da remoção já foi
//                confirmado (a prova fica no registro do encerramento);
//   eliminação → arquivo fiscal da ArkeFit, o cliente de cada aluno
//                anonimizado na conta Asaas da ArkeFit (a da academia é dela),
//                arquivos do storage, contas que só existiam ali, e por fim a
//                organização.
//
// Cada passo que depende do Asaas ou do storage é retomável: se o tempo
// acaba ou algo falha, a próxima rodada continua de onde parou, e a falha
// fica no registro do encerramento para a Visão Master mostrar.

const NOME = "encerramento-organizacao";
const ORCAMENTO_MS = 110_000;
// O passo do Asaas não começa lote novo depois disto: cada chamada tem prazo
// de 20 s, e o resto da eliminação precisa de tempo na mesma rodada.
const ORCAMENTO_ASAAS_MS = 60_000;
// As pendências de saída da academia, antes: nenhuma começa depois disto.
const ORCAMENTO_PENDENCIAS_MS = 20_000;
// Buckets organizados por <organização>/...; e por <usuário>/... (contas apagadas).
const BUCKETS_DA_ORGANIZACAO = ["atestados", "chat-videos", "termos-biometria", "exercicio-videos", "exercicio-imagens", "dietas"];
const BUCKETS_DO_USUARIO = ["avatars", "feed-images"];

type Encerramento = { id: string; organization_id: string; proxima: "termino" | "eliminacao"; organizacao_nome: string };

class SemTempo extends Error {}

/** Apaga tudo sob um prefixo, descendo nas subpastas. Devolve quantos arquivos saíram. */
async function apagarPasta(admin: SupabaseClient, bucket: string, prefixo: string, profundidade = 0): Promise<number> {
  if (profundidade > 5) return 0;
  let apagados = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(prefixo, { limit: 1000 });
    if (error) throw new Error(`storage ${bucket}: ${error.message}`);
    const arquivos = (data ?? []).filter((i) => i.id).map((i) => `${prefixo}/${i.name}`);
    const pastas = (data ?? []).filter((i) => !i.id).map((i) => `${prefixo}/${i.name}`);
    for (const pasta of pastas) apagados += await apagarPasta(admin, bucket, pasta, profundidade + 1);
    if (arquivos.length) {
      const { error: erroRemover } = await admin.storage.from(bucket).remove(arquivos);
      if (erroRemover) throw new Error(`storage ${bucket}: ${erroRemover.message}`);
      apagados += arquivos.length;
    }
    // A listagem vem de mil em mil; apagou tudo o que veio, lista de novo até esvaziar.
    if (arquivos.length < 1000) return apagados;
  }
}

async function executarTermino(admin: SupabaseClient, enc: Encerramento, inicio: number) {
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, status, asaas_subscription_id_b2b")
    .eq("id", enc.organization_id)
    .single();
  if (error || !org) throw new Error(`organização: ${error?.message ?? "não encontrada"}`);
  const ambiente = ambienteAsaas(org.status as string, (n) => Deno.env.get(n));
  if ("erro" in ambiente) throw new Error(ambiente.erro);

  // Só quem ainda tem cobrança viva precisa do gateway.
  const comCobranca = new Set<string>();
  for (const [tabela, status] of [
    ["aluno_assinaturas", ["ativa", "atrasada", "pausada"]],
    ["aluno_matriculas_academia", ["ativa", "pausada"]],
    ["cobrancas_avulsas", ["pendente", "atrasado"]],
  ] as const) {
    const linhas = await todasAsLinhas<{ aluno_id: string }>((de, ate) =>
      admin.from(tabela).select("aluno_id").eq("organization_id", org.id).in("status", [...status]).order("id").range(de, ate)
    );
    for (const l of linhas) comCobranca.add(l.aluno_id);
  }

  // A mensalidade e a avulsa que nasceram na conta da academia são canceladas
  // lá; a conta abre uma vez só, na primeira que precisar.
  const abrir = abridorDaContaDaAcademia(admin, ambiente, org.id as string);
  let contaAberta: Promise<{ api: string; chave: string } | { erro: string }> | null = null;
  const contaDaAcademia = () => (contaAberta ??= abrir());

  let canceladas = 0;
  for (const alunoId of comCobranca) {
    if (Date.now() - inicio > ORCAMENTO_MS) throw new SemTempo(`${comCobranca.size} alunos com cobrança; continua na próxima rodada`);
    const r = await encerrarCobrancasDoAluno(admin, alunoId, ambiente, null, "Encerramento da academia", contaDaAcademia);
    if (!r.ok) throw new Error(r.erro);
    canceladas += r.canceladas;
  }

  // A mensalidade B2B para de emitir; a cobrança já vencida continua no
  // Asaas, porque é dívida da academia com a ArkeFit, não cobrança futura.
  if (org.asaas_subscription_id_b2b) {
    const r = await pausarAssinatura(ambiente.api, ambiente.chave, org.asaas_subscription_id_b2b as string, hojeBrasilia());
    if (!r.ok) throw new Error(r.erro);
    canceladas += r.cobrancasRemovidas.length;
  }

  const { error: erroConcluir } = await admin.rpc("concluir_termino_organizacao", {
    _encerramento_id: enc.id,
    _cobrancas_canceladas: canceladas,
  });
  if (erroConcluir) throw new Error(`concluir término: ${erroConcluir.message}`);
}

async function executarEliminacao(admin: SupabaseClient, enc: Encerramento, inicio: number) {
  const contas = await todasAsLinhas<{ user_id: string }>((de, ate) =>
    admin.rpc("preparar_eliminacao_organizacao", { _encerramento_id: enc.id }).order("user_id").range(de, ate)
  );

  // O cadastro dos alunos no Asaas, antes de as contas saírem (o CPF está no
  // perfil) e de a organização sair (o ambiente vem do status dela). Primeiro
  // a saída de quem saiu antes e ficou pendente, enquanto a chave da conta da
  // academia ainda está no cofre; depois cada aluno, só na conta da ArkeFit
  // (20261396010000). Em lotes, retomável pelo cursor.
  const env = (n: string) => Deno.env.get(n);
  try {
    await retentarPendentes(admin, env, 20, { organizationId: enc.organization_id, ate: inicio + ORCAMENTO_PENDENCIAS_MS });
  } catch (e) {
    // A rotina de hora em hora tenta de novo; a eliminação não espera por ela.
    console.error("encerramento: pendências do Asaas da academia", resumoDoErro(e));
  }
  const asaas = await anonimizarClientesDaEliminacao(admin, enc, env, { inicio, orcamentoMs: ORCAMENTO_ASAAS_MS });
  if (!asaas.concluido) throw new SemTempo("clientes do Asaas a anonimizar; continua na próxima rodada");

  let arquivos = 0;
  for (const bucket of BUCKETS_DA_ORGANIZACAO) arquivos += await apagarPasta(admin, bucket, enc.organization_id);

  // A conta sai antes da organização: se a rodada parar no meio, a próxima
  // ainda acha a organização e recomeça daqui.
  const { data: registro } = await admin.from("organizacao_encerramentos").select("contas_apagadas, arquivos_apagados").eq("id", enc.id).single();
  let contasApagadas = (registro?.contas_apagadas as number | null) ?? 0;
  arquivos += (registro?.arquivos_apagados as number | null) ?? 0;
  for (const { user_id } of contas) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      await admin.from("organizacao_encerramentos").update({ contas_apagadas: contasApagadas, arquivos_apagados: arquivos }).eq("id", enc.id);
      throw new SemTempo(`${contas.length} contas a apagar; continua na próxima rodada`);
    }
    for (const bucket of BUCKETS_DO_USUARIO) arquivos += await apagarPasta(admin, bucket, user_id);
    const { error } = await admin.auth.admin.deleteUser(user_id);
    if (error) throw new Error(`conta: ${error.message}`);
    contasApagadas++;
  }

  const { error: erroEliminar } = await admin.rpc("eliminar_organizacao", {
    _encerramento_id: enc.id,
    _arquivos: arquivos,
    _contas: contasApagadas,
  });
  if (erroEliminar) throw new Error(`eliminar: ${erroEliminar.message}`);
}

type EmCurso = AvisoEncerramento & { id: string; organization_id: string; etapa: "aviso" | "encerrada" };

/**
 * O aviso a cada aluno, em lotes de até 100 que o banco reserva antes do
 * envio. Lote que não foi confirmado volta igual na rodada seguinte, com a
 * mesma chave de idempotência: o Resend devolve o envio anterior em vez de
 * mandar de novo. O aviso no celular sai depois do e-mail, uma vez por aluno.
 */
async function avisarAlunos(
  admin: SupabaseClient,
  enc: EmCurso,
  envio: { resendKey: string; de: string; siteUrl: string },
  inicio: number,
): Promise<{ emails: number; pushes: number }> {
  let emails = 0;
  let pushes = 0;
  for (;;) {
    if (Date.now() - inicio > ORCAMENTO_MS) throw new SemTempo("alunos a avisar; continua na próxima rodada");
    const { data, error } = await admin.rpc("reservar_aviso_encerramento_alunos", { _encerramento_id: enc.id, _limite: 100 });
    if (error) throw new Error(`reservar aviso: ${error.code}`);
    const reservados = (data ?? []) as (DestinatarioAluno & { lote: string })[];
    if (!reservados.length) return { emails, pushes };
    const lote = reservados[0].lote;

    const corpo = loteDeEmails(enc, reservados, envio.de, envio.siteUrl);
    let enviados = corpo.length;
    if (corpo.length) {
      const r = await fetch("https://api.resend.com/emails/batch", {
        signal: AbortSignal.timeout(30_000),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${envio.resendKey}`,
          "Idempotency-Key": chaveDoLote(enc.id, lote),
        },
        body: JSON.stringify(corpo),
      });
      // Só o status vai para log: a resposta do Resend ecoa os endereços.
      if (r.status === 400 || r.status === 422) {
        // Lote recusado pelo conteúdo: repetir daria o mesmo erro e travaria
        // os lotes seguintes. Fica como tentado, sem contar como avisado.
        console.error("encerramento: Resend recusou o lote de alunos", r.status);
        enviados = 0;
      } else if (!r.ok) {
        throw new Error(`Resend recusou o lote HTTP ${r.status}`);
      }
    }
    const { error: erroEmail } = await admin.rpc("confirmar_aviso_encerramento_alunos", {
      _encerramento_id: enc.id,
      _lote: lote,
      _canal: "email",
      _enviados: enviados,
    });
    if (erroEmail) throw new Error(`confirmar aviso: ${erroEmail.code}`);
    emails += enviados;

    const ids = reservados.map((d) => d.user_id);
    const { data: inscricoes, error: erroInscricoes } = await admin
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", ids);
    if (erroInscricoes) throw new Error(`inscrições: ${erroInscricoes.code}`);
    const porUsuario = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>();
    for (const s of (inscricoes ?? []) as { user_id: string; endpoint: string; p256dh: string; auth: string }[]) {
      porUsuario.set(s.user_id, [...(porUsuario.get(s.user_id) ?? []), s]);
    }
    const aviso = { ...pushAoAluno(enc), tag: `encerramento:${enc.organization_id}` };
    const alcancados: string[] = [];
    const usuarios = [...porUsuario];
    // Dez alunos ao mesmo tempo; cada envio tem o próprio prazo (push.ts).
    for (let i = 0; i < usuarios.length; i += 10) {
      await Promise.all(
        usuarios.slice(i, i + 10).map(async ([userId, lista]) => {
          const res = await enviarAvisos(admin, lista, aviso, { validadeSeg: VALIDADE_SEG.encerramento, topico: topicoDoId(enc.id) });
          if (res.enviados > 0) alcancados.push(userId);
        }),
      );
    }
    if (alcancados.length) {
      const { error: erroPush } = await admin.rpc("confirmar_aviso_encerramento_alunos", {
        _encerramento_id: enc.id,
        _lote: lote,
        _canal: "push",
        _user_ids: alcancados,
      });
      if (erroPush) console.error("encerramento: push enviado, mas não registrado", erroPush.code);
      pushes += alcancados.length;
    }
  }
}

servir("encerramento-organizacao", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Quem chama: o cron (token do Vault) ou a ArkeFit pela Visão Master.
  const token = req.headers.get("x-alerta-token");
  const doCron = token ? !!(await admin.rpc("conferir_token_alerta_rotinas", { _token: token })).data : false;
  if (!doCron) {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return jsonResponse({ error: "Não autorizado." }, 401);
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: claims } = await asUser.auth.getClaims(auth.replace("Bearer ", ""));
    const uid = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (!uid) return jsonResponse({ error: "Não autorizado." }, 401);
    const { data: papeis } = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (!verificada(claims?.claims) || !(papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke")) {
      return jsonResponse({ error: "Só a ArkeFit executa o encerramento." }, 403);
    }
  }

  const inicio = Date.now();
  const resultado = {
    avisos: 0,
    terminos: 0,
    eliminacoes: 0,
    pendentes: 0,
    falhas: 0,
    alunos_avisados: 0,
    alunos_avisados_no_celular: 0,
  };
  try {
    // 1. Avisos ainda sem e-mail à gestão e à ArkeFit. A chave de
    // idempotência segura o e-mail repetido quando o registro do envio falha.
    const { data: avisos, error: erroAvisos } = await admin
      .from("organizacao_encerramentos")
      .select("id, organization_id, organizacao_nome, iniciativa, termino_em, eliminacao_em")
      .eq("etapa", "aviso")
      .is("email_enviado_em", null)
      .order("solicitado_em");
    if (erroAvisos) throw new Error(`avisos: ${erroAvisos.code}`);
    for (const a of avisos ?? []) {
      if (!resendKey) break;
      const [{ data: gestores }, { data: arke }] = await Promise.all([
        admin.rpc("emails_gestores_organizacao", { _organization_id: a.organization_id }),
        admin.rpc("emails_superadmin"),
      ]);
      const emails = [...((gestores ?? []) as { email: string }[]), ...((arke ?? []) as { email: string }[])].map((d) => d.email);
      const para = [...new Set(emails)].filter(Boolean);
      if (!para.length) continue;
      const m = emailDeAviso(a as AvisoEncerramento, siteUrl);
      const r = await fetch("https://api.resend.com/emails", {
        signal: AbortSignal.timeout(15_000),
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": chaveDoAviso(a.id) },
        body: JSON.stringify({
          from: Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit <alertas@arkefit.com.br>",
          to: para,
          subject: m.assunto,
          html: m.html,
          text: m.texto,
        }),
      });
      // Só o status vai para log: a resposta do Resend ecoa os endereços.
      if (!r.ok) {
        console.error("encerramento: Resend recusou", r.status);
        resultado.falhas++;
        continue;
      }
      const { error: erroMarca } = await admin
        .from("organizacao_encerramentos")
        .update({ email_enviado_em: new Date().toISOString() })
        .eq("id", a.id);
      if (erroMarca) {
        console.error("encerramento: aviso enviado, mas não registrado", erroMarca.code);
        resultado.falhas++;
        continue;
      }
      resultado.avisos++;
    }

    // 2. Término e eliminação do que venceu.
    const { data: vencidos, error } = await admin.rpc("encerramentos_vencidos");
    if (error) throw new Error(`encerramentos_vencidos: ${error.message}`);
    for (const enc of (vencidos ?? []) as Encerramento[]) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        resultado.pendentes++;
        continue;
      }
      try {
        if (enc.proxima === "termino") {
          await executarTermino(admin, enc, inicio);
          resultado.terminos++;
        } else {
          await executarEliminacao(admin, enc, inicio);
          resultado.eliminacoes++;
        }
      } catch (e) {
        if (e instanceof SemTempo) {
          resultado.pendentes++;
          continue;
        }
        resultado.falhas++;
        console.error("encerramento: falhou", enc.proxima, resumoDoErro(e));
        await admin.rpc("registrar_falha_encerramento", { _encerramento_id: enc.id, _erro: descreverErro(e) });
      }
    }

    // 3. A prova da remoção das digitais, conferida a cada rodada enquanto a
    // academia está na janela de exportação. Sem dado pessoal: só contagens.
    const { error: erroConferir } = await admin.rpc("conferir_remocoes_encerramentos");
    if (erroConferir) {
      console.error("encerramento: conferência da remoção falhou", erroConferir.code);
      resultado.falhas++;
    }

    // 4. O aviso aos alunos, com o tempo que sobrou: o aviso tem 30 dias, e
    // uma academia grande termina nas rodadas seguintes.
    const { data: emCurso, error: erroEmCurso } = await admin
      .from("organizacao_encerramentos")
      .select("id, organization_id, organizacao_nome, iniciativa, etapa, termino_em, eliminacao_em")
      .in("etapa", ["aviso", "encerrada"])
      .not("organization_id", "is", null)
      .order("solicitado_em");
    if (erroEmCurso) throw new Error(`encerramentos em curso: ${erroEmCurso.code}`);
    for (const enc of (emCurso ?? []) as EmCurso[]) {
      if (!resendKey) break;
      try {
        const r = await avisarAlunos(
          admin,
          enc,
          { resendKey, de: Deno.env.get("EMAIL_ACESSO_FROM") ?? "ArkeFit <acesso@arkefit.com.br>", siteUrl },
          inicio,
        );
        resultado.alunos_avisados += r.emails;
        resultado.alunos_avisados_no_celular += r.pushes;
      } catch (e) {
        if (e instanceof SemTempo) {
          resultado.pendentes++;
          break;
        }
        resultado.falhas++;
        console.error("encerramento: aviso aos alunos falhou", resumoDoErro(e));
        await admin.rpc("registrar_falha_encerramento", { _encerramento_id: enc.id, _erro: `aviso aos alunos: ${descreverErro(e)}` });
      }
    }

    // Falha num encerramento não derruba a rotina: fica no registro dele, e a
    // Visão Master mostra. A rotina só falha se não conseguiu nem olhar.
    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, ...resultado });
  } catch (e) {
    console.error("encerramento: erro inesperado", resumoDoErro(e));
    await registrarExecucao(admin, NOME, false, descreverErro(e));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
