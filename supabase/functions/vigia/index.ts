import { createClient } from "npm:@supabase/supabase-js@2";
import { consultarVigia, MODELO_VIGIA } from "../_shared/ia.ts";
import { interpretarResposta, validarQuadro } from "../_shared/vigiaAnalise.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "vigia";

// O Vigia, o agente de saúde técnica, em modo sombra: nada aqui executa
// correção nenhuma — só registra o que faria. Chamado de 5 em 5 minutos pelo
// cron `arke-vigia`, com o token do alerta de rotinas.
//
// Duas camadas, na ordem:
//   1. as regras (public.vigia_varrer), que sempre rodam;
//   2. a análise por IA, só quando o quadro de anomalias mudou — mesmo
//      problema persistindo não gera chamada nova a cada varredura — e no
//      máximo 4 por hora (public.vigia_quadro decide).
//
// A análise é falha aberta: modelo fora do ar vira uma linha "indisponível"
// e a varredura segue — as regras não dependem dela. Nada do quadro nem da
// resposta vai para log; só status.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("vigia: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  try {
    const { data: varredura, error: erroVarredura } = await admin.rpc("vigia_varrer");
    if (erroVarredura) {
      console.error("vigia: falha na varredura das regras", erroVarredura.code);
      await registrarExecucao(admin, NOME, false, `vigia_varrer: ${erroVarredura.code}`);
      return jsonResponse({ error: "Falha na varredura." }, 500);
    }
    if (varredura?.ativo === false) {
      await registrarExecucao(admin, NOME, true);
      return jsonResponse({ ok: true, ativo: false });
    }

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

    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, varredura, analise });
  } catch (erro) {
    console.error("vigia: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
