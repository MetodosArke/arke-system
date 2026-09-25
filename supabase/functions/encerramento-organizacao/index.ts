import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { encerrarCobrancasDoAluno } from "../_shared/encerrarCobrancas.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { todasAsLinhas } from "../_shared/paginar.ts";
import { pausarAssinatura } from "../asaas-assinatura-ciclo/fluxo.ts";

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
//   aviso      → e-mail à gestão da academia e à ArkeFit com as datas;
//   término    → cobranças dos alunos canceladas no Asaas, mensalidade B2B
//                pausada (a já vencida fica: é dívida, não cobrança futura),
//                depois o banco marca a organização como encerrada;
//   eliminação → arquivo fiscal da ArkeFit, arquivos do storage, contas que
//                só existiam ali, e por fim a organização.
//
// Cada passo que depende do Asaas ou do storage é retomável: se o tempo
// acaba ou algo falha, a próxima rodada continua de onde parou, e a falha
// fica no registro do encerramento para a Visão Master mostrar.

const NOME = "encerramento-organizacao";
const ORCAMENTO_MS = 110_000;
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

  let canceladas = 0;
  for (const alunoId of comCobranca) {
    if (Date.now() - inicio > ORCAMENTO_MS) throw new SemTempo(`${comCobranca.size} alunos com cobrança; continua na próxima rodada`);
    const r = await encerrarCobrancasDoAluno(admin, alunoId, ambiente, null, "Encerramento da academia");
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

function emailDeAviso(e: { organizacao_nome: string; iniciativa: string; termino_em: string; eliminacao_em: string }, siteUrl: string) {
  const data = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const quem = e.iniciativa === "academia" ? "a pedido da academia" : "por decisão da ArkeFit";
  const texto = [
    `O contrato da ${e.organizacao_nome} com o ARKE termina em ${data(e.termino_em)}, ${quem}.`,
    "",
    `Até lá tudo segue funcionando. Em ${data(e.termino_em)}, as cobranças dos alunos pelo ARKE param, as digitais saem das catracas e o painel fica só para exportação.`,
    `Até ${data(e.eliminacao_em)}, a gestão pode exportar todos os dados da academia em Organização → Exportar todos os dados. Depois disso, os dados são eliminados, como prevê o contrato.`,
    "",
    `Para retirar o aviso antes do término, ou tirar dúvidas: ${siteUrl}`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">${texto
    .split("\n")
    .map((l) => (l ? `<p style="margin:0 0 12px">${l.replace(/[<>&]/g, "")}</p>` : ""))
    .join("")}</div>`;
  return { assunto: `ARKE: encerramento do contrato em ${data(e.termino_em)}`, texto, html };
}

Deno.serve(async (req: Request) => {
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
  const resultado = { avisos: 0, terminos: 0, eliminacoes: 0, pendentes: 0, falhas: 0 };
  try {
    // 1. Avisos ainda sem e-mail.
    const { data: avisos } = await admin
      .from("organizacao_encerramentos")
      .select("id, organization_id, organizacao_nome, iniciativa, termino_em, eliminacao_em")
      .eq("etapa", "aviso")
      .is("email_enviado_em", null)
      .order("solicitado_em");
    for (const a of avisos ?? []) {
      if (!resendKey) break;
      const [{ data: gestores }, { data: arke }] = await Promise.all([
        admin.rpc("emails_gestores_organizacao", { _organization_id: a.organization_id }),
        admin.rpc("emails_superadmin"),
      ]);
      const emails = [...((gestores ?? []) as { email: string }[]), ...((arke ?? []) as { email: string }[])].map((d) => d.email);
      const para = [...new Set(emails)].filter(Boolean);
      if (!para.length) continue;
      const m = emailDeAviso(a as never, siteUrl);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
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
      await admin.from("organizacao_encerramentos").update({ email_enviado_em: new Date().toISOString() }).eq("id", a.id);
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
        console.error("encerramento: falhou", enc.proxima, descreverErro(e));
        await admin.rpc("registrar_falha_encerramento", { _encerramento_id: enc.id, _erro: descreverErro(e) });
      }
    }

    // Falha num encerramento não derruba a rotina: fica no registro dele, e a
    // Visão Master mostra. A rotina só falha se não conseguiu nem olhar.
    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, ...resultado });
  } catch (e) {
    console.error("encerramento: erro inesperado", descreverErro(e));
    await registrarExecucao(admin, NOME, false, descreverErro(e));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
