import { createClient } from "npm:@supabase/supabase-js@2";
import { consultarVigia, MODELO_VIGIA } from "../_shared/ia.ts";
import { interpretarResposta, validarQuadro } from "../_shared/vigiaAnalise.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import { montarEmailAvisos, type Aviso } from "./email.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "vigia";

// O Vigia, a parte que fala com o mundo lá fora. Chamado de 5 em 5 minutos
// pelo cron `arke-vigia-analise`, com o token do alerta de rotinas.
//
// As regras — detectar e corrigir — rodam no banco, pelo cron `arke-vigia`
// (public.vigia_varrer): se esta função quebrar, as correções continuam.
// Aqui ficam as duas coisas que precisam de fora do banco:
//   1. avisos por e-mail: aprovação pedida e caso que o Vigia não resolveu
//      e precisa de uma pessoa — cada um avisado uma vez;
//   2. a análise por IA, só quando o quadro de anomalias mudou e no máximo 4
//      por hora (public.vigia_quadro decide). Falha aberta: modelo fora do ar
//      vira uma linha "indisponível", e nada do quadro nem da resposta vai
//      para log.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "https://www.arkefit.com.br";
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("vigia: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    const { data: ativo, error: erroAtivo } = await admin.rpc("vigia_ativo");
    if (erroAtivo) {
      await registrarExecucao(admin, NOME, false, `vigia_ativo: ${erroAtivo.code}`);
      return jsonResponse({ error: "Falha ao ler o interruptor." }, 500);
    }
    if (!ativo) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, ativo: false });
    }

    // ── 1. Avisos ──
    // "Já avisei" só depois do envio: se o e-mail falha, o aviso sai de novo
    // na próxima passada.
    let avisos = 0;
    let falhaAviso: string | undefined;
    const { data: pendentes, error: erroAvisos } = await admin.rpc("vigia_avisos_pendentes");
    if (erroAvisos) {
      falhaAviso = `vigia_avisos_pendentes: ${erroAvisos.code}`;
    } else if ((pendentes ?? []).length) {
      const lista = pendentes as Aviso[];
      const { data: dest } = await admin.rpc("emails_superadmin");
      const emails = (dest ?? []).map((d: { email: string }) => d.email).filter(Boolean);
      if (!resendKey) {
        falhaAviso = "RESEND_API_KEY ausente";
      } else if (emails.length) {
        const m = montarEmailAvisos(lista, siteUrl);
        const de = Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit Alertas <alertas@arkefit.com.br>";
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from: de, to: emails, subject: m.assunto, html: m.html, text: m.texto }),
        });
        // Só o status vai para log: a resposta do Resend ecoa os endereços.
        if (r.ok) {
          const { error: erroMarca } = await admin.rpc("vigia_marcar_avisadas", { _ids: lista.map((a) => a.id) });
          if (erroMarca) console.error("vigia: aviso enviado, mas falhou ao registrar", erroMarca.code);
          avisos = lista.length;
        } else {
          falhaAviso = `Resend recusou HTTP ${r.status}`;
        }
      }
    }

    // ── 2. Análise por IA ──
    const { data: quadro, error: erroQuadro } = await admin.rpc("vigia_quadro");
    if (erroQuadro) {
      console.error("vigia: falha ao montar o quadro", erroQuadro.code);
      await registrarExecucao(admin, NOME, false, `vigia_quadro: ${erroQuadro.code}`);
      return jsonResponse({ error: "Falha ao montar o quadro." }, 500);
    }

    let analise = "sem_mudanca";
    if (quadro?.analisar) {
      const r = await consultarVigia((n) => Deno.env.get(n), quadro.enviar);
      let registro: Record<string, unknown>;
      if (r.ok === false) {
        registro = { _status: r.motivo, _analise: {}, _motivo: r.detalhe };
      } else {
        const validado = validarQuadro(quadro.enviar);
        const i = validado.ok ? interpretarResposta(r.resposta, validado.quadro) : null;
        registro = i?.ok
          ? { _status: "ok", _analise: i.analise, _motivo: null }
          : { _status: "resposta_invalida", _analise: {}, _motivo: i?.ok === false ? i.motivo : "quadro inválido" };
        registro._latencia_ms = r.latenciaMs;
        registro._tokens_entrada = r.tokensEntrada;
        registro._tokens_saida = r.tokensSaida;
      }
      const { error: erroRegistro } = await admin.rpc("vigia_registrar_analise", {
        _assinatura: quadro.assinatura,
        _quadro: quadro.enviar,
        _mapa: quadro.mapa,
        _modelo: MODELO_VIGIA,
        _latencia_ms: null,
        _tokens_entrada: null,
        _tokens_saida: null,
        ...registro,
      });
      if (erroRegistro) console.error("vigia: análise feita, mas falhou ao registrar", erroRegistro.code);
      analise = String(registro._status);
    }

    await registrarExecucao(admin, NOME, !falhaAviso, falhaAviso);
    return jsonResponse({ ok: !falhaAviso, avisos, analise });
  } catch (erro) {
    console.error("vigia: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
