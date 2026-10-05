import { createClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { consultarSituacao } from "../asaas-conta-academia/fluxo.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import {
  chamadoDevido,
  conferirAsaasDevido,
  emailDevido,
  montarChamado,
  montarEmail,
  proximaEtapa,
  type Implantacao,
} from "./fluxo.ts";
import { servir } from "../_shared/servir.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "agente-implantacao";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bruno, o agente de implantação (semana 2 do plano dos agentes, 03/10/2026).
//
// Chamado de hora em hora pela rotina `arke-agente-implantacao`, com o token
// do alerta de rotinas (header x-alerta-token). Para cada academia em
// implantação: registra a etapa da vez (o relógio do "1 dia útil parado"),
// confere a aprovação do Asaas uma vez por dia, abre o chamado da ArkeFit
// quando a academia para, e manda um e-mail por rodada, quando há um devido.
// A decisão mora no fluxo.ts; aqui só se lê, executa e registra.
//
// Quem tem o token pode mandar `agora` e `organizacoes` no corpo: é como a
// corrente de teste exercita a função fora do horário comercial e só sobre a
// academia dela. Quem tem o token já dispara a rotina inteira. As datas que o
// agente grava (início da etapa, reserva e envio) usam esse mesmo relógio, para
// a decisão e o registro nunca divergirem.
//
// Nada da academia vai para log além do id: só códigos de erro e status HTTP.
servir("agente-implantacao", async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  const corpo = (await req.json().catch(() => ({}))) as { agora?: unknown; organizacoes?: unknown };
  const agoraPedido = typeof corpo.agora === "string" ? new Date(corpo.agora) : null;
  const agora = agoraPedido && !Number.isNaN(agoraPedido.getTime()) ? agoraPedido : new Date();
  const so = Array.isArray(corpo.organizacoes) ? corpo.organizacoes.filter((x): x is string => typeof x === "string" && UUID.test(x)) : null;

  try {
    const { data: cfg } = await admin.from("plataforma_config").select("valor").eq("chave", "agente_implantacao_ativo").maybeSingle();
    if (Number(cfg?.valor ?? 0) !== 1) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, desligado: true });
    }

    const { data: lista, error: erroLista } = await admin.rpc("implantacoes_para_agente");
    if (erroLista) {
      await registrarExecucao(admin, NOME, false, `implantacoes_para_agente: ${erroLista.code}`);
      return jsonResponse({ error: "Falha ao ler as implantações." }, 500);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const site = Deno.env.get("SITE_URL") ?? "https://app.arkefit.com.br";
    const de = Deno.env.get("EMAIL_IMPLANTACAO_FROM") ?? "ArkeFit <implantacao@arkefit.com.br>";
    const { data: textos } = await admin.from("plataforma_textos").select("chave, valor").in("chave", ["agente_implantacao_assinatura", "suporte_email"]);
    const texto = (chave: string) => (textos ?? []).find((t) => t.chave === chave)?.valor?.trim() || null;
    const assinatura = texto("agente_implantacao_assinatura") ?? "Equipe de implantação ArkeFit";
    const responderPara = texto("suporte_email");

    const enviar = async (para: string[], idempotencia: string, email: { assunto: string; html: string; texto: string }) => {
      if (!resendKey) return { ok: false as const, erro: "RESEND_API_KEY ausente" };
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}`, "Idempotency-Key": idempotencia },
          body: JSON.stringify({
            from: de,
            to: para,
            ...(responderPara ? { reply_to: responderPara } : {}),
            subject: email.assunto,
            html: email.html,
            text: email.texto,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) return { ok: false as const, erro: `Resend HTTP ${r.status}` };
        const j = await r.json().catch(() => ({}));
        return { ok: true as const, id: typeof j?.id === "string" ? (j.id as string) : null };
      } catch (erro) {
        return { ok: false as const, erro: descreverErro(erro) };
      }
    };

    // Reserva, envia e registra: duas rodadas não mandam a mesma mensagem.
    const mensagem = async (
      org: string,
      tipo: string,
      chave: string,
      etapa: string | null,
      motivo: string,
      para: string[],
      email: { assunto: string; html: string; texto: string }
    ) => {
      const { data: reservada, error } = await admin.rpc("reservar_mensagem_implantacao", {
        _organization_id: org,
        _tipo: tipo,
        _chave: chave,
        _etapa: etapa,
        _motivo: motivo,
        _agora: agora.toISOString(),
      });
      if (error) return { ok: false, erro: `reserva: ${error.code}` };
      if (!reservada) return { ok: false, erro: null }; // outra rodada pegou
      const r = await enviar(para, `${NOME}/${org}/${tipo}/${chave}`, email);
      await admin.rpc("concluir_mensagem_implantacao", {
        _organization_id: org,
        _tipo: tipo,
        _chave: chave,
        _ok: r.ok,
        _resend_id: r.ok ? r.id : null,
        _erro: r.ok ? null : r.erro,
        _destinatarios: para.length,
        _agora: agora.toISOString(),
      });
      return r.ok ? { ok: true, erro: null } : { ok: false, erro: r.erro };
    };

    let emails = 0;
    let chamados = 0;
    const erros: string[] = [];

    // O aviso à ArkeFit: a qualquer hora, porque é a fila dela.
    const avisarArkefit = async (imp: Implantacao, chamado: { etapa: string; motivo: string }, id: string) => {
      const { data: destinatarios } = await admin.rpc("emails_superadmin");
      const para = ((destinatarios ?? []) as { email: string }[]).map((d) => d.email).filter(Boolean);
      if (!para.length) return;
      const r = await mensagem(
        imp.organization_id,
        "chamado_arkefit",
        `${chamado.etapa}:${id}`,
        chamado.etapa,
        chamado.motivo,
        para,
        montarChamado(imp, chamado, { site })
      );
      if (!r.ok && r.erro) erros.push(r.erro);
    };

    for (const imp of (lista ?? []) as Implantacao[]) {
      if (so && !so.includes(imp.organization_id)) continue;
      try {
        // 1. A aprovação do Asaas, uma vez por dia.
        if (conferirAsaasDevido(imp, agora)) {
          let status: string | null = null;
          const amb = ambienteAsaas(imp.status, (n) => Deno.env.get(n));
          const { data: chave } = await admin.rpc("ler_chave_subconta_asaas", { _organization_id: imp.organization_id });
          if (!("erro" in amb) && chave) {
            const asaasApiUrl = amb.api;
            const r = await consultarSituacao(asaasApiUrl, String(chave));
            if (r.ok) status = r.situacao.general;
            else erros.push(`asaas ${imp.organization_id}`);
          }
          await admin.rpc("registrar_conferencia_asaas_implantacao", { _organization_id: imp.organization_id, _status: status });
          if (status) imp.asaas_conta_status = status;
          if (status === "REJECTED") {
            const { data: id } = await admin.rpc("abrir_chamado_implantacao", {
              _organization_id: imp.organization_id,
              _etapa: "asaas_aprovada",
              _motivo: "O Asaas recusou a conta de recebimentos aberta pelo ArkeFit.",
            });
            if (id) {
              chamados++;
              await avisarArkefit(imp, { etapa: "asaas_aprovada", motivo: "O Asaas recusou a conta de recebimentos aberta pelo ArkeFit." }, String(id));
            }
          }
        }

        // 2. A etapa da vez, e o chamado se ela parou.
        const prox = proximaEtapa(imp.etapas);
        let desde: Date | null = null;
        if (prox) {
          const { data: d, error } = await admin.rpc("registrar_etapa_implantacao", {
            _organization_id: imp.organization_id,
            _etapa: prox.etapa,
            _agora: agora.toISOString(),
          });
          if (error) throw new Error(`registrar_etapa: ${error.code}`);
          desde = d ? new Date(String(d)) : null;
        }
        const chamado = chamadoDevido(imp, desde, agora);
        if (chamado) {
          const { data: id, error } = await admin.rpc("abrir_chamado_implantacao", {
            _organization_id: imp.organization_id,
            _etapa: chamado.etapa,
            _motivo: chamado.motivo,
          });
          if (error) erros.push(`chamado: ${error.code}`);
          else if (id) {
            chamados++;
            await avisarArkefit(imp, chamado, String(id));
          }
        }

        // 3. O e-mail devido, se houver.
        const email = emailDevido(imp, agora);
        if (email) {
          const r = await mensagem(
            imp.organization_id,
            email.tipo,
            email.chave,
            email.etapa,
            email.motivo,
            imp.emails,
            montarEmail(email, imp, { site, assinatura })
          );
          if (r.ok) {
            emails++;
            if (email.tipo === "kit_lancamento") await admin.rpc("marcar_implantacao_concluida", { _organization_id: imp.organization_id });
          } else if (r.erro) erros.push(r.erro);
        }
      } catch (erro) {
        console.error("agente-implantacao: falha numa academia", imp.organization_id, erro instanceof Error ? erro.name : typeof erro);
        erros.push(descreverErro(erro));
      }
    }

    await registrarExecucao(admin, NOME, erros.length === 0, erros.length ? `${erros.length} falha(s); a última: ${erros[erros.length - 1]}` : undefined);
    return jsonResponse({ ok: erros.length === 0, emails, chamados, falhas: erros.length });
  } catch (erro) {
    console.error("agente-implantacao: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
