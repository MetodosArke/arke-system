import { createClient } from "npm:@supabase/supabase-js@2";
import { hashDoTokenCatraca } from "../_shared/tokenCatraca.ts";
import { servir } from "../_shared/servir.ts";
import {
  alunosCitados,
  conferirLogs,
  emLotes,
  erroDaLinha,
  MAXIMO_POR_LOTE,
  type Descarte,
  type LinhaConferida,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type SincronizarLogsPayload = {
  device_token: string;
  logs: unknown[];
};

// ARKE® Gateway Local — recebe em lote os acessos que o middleware Node.js
// validou localmente (cache offline) enquanto a internet estava fora, e
// grava em acessos_catraca_logs com validado_offline=true, preservando o
// horário real do evento (ocorrido_em) em vez da hora da sincronização.
//
// Cada registro é conferido (fluxo.ts) e a resposta diz, pelo `id_local`, o
// que foi aceito e o que foi recusado de vez: o Gateway tira os dois da fila,
// e um registro com problema não trava mais os que vêm atrás dele.
servir("catraca-sincronizar-logs-offline", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const payload: Partial<SincronizarLogsPayload> = await req.json();
    const deviceToken = typeof payload.device_token === "string" ? payload.device_token.trim() : "";
    const logs = Array.isArray(payload.logs) ? payload.logs : [];

    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);
    if (logs.length === 0) return jsonResponse({ inseridos: 0, aceitos: [], descartados: [] });
    const tokenHash = await hashDoTokenCatraca(deviceToken);
    if (!tokenHash) return jsonResponse({ error: "Dispositivo não autorizado." }, 401);
    if (logs.length > MAXIMO_POR_LOTE) {
      return jsonResponse({ error: `Máximo de ${MAXIMO_POR_LOTE} logs por sincronização.` }, 400);
    }

    const { data: catraca, error: catracaError } = await admin
      .from("organizacao_catracas")
      .select("id, organization_id")
      .eq("device_token_hash", tokenHash)
      .maybeSingle();
    if (catracaError) {
      console.error("Erro ao consultar catraca:", catracaError.code);
      return jsonResponse({ error: "Falha ao validar dispositivo." }, 500);
    }
    if (!catraca) {
      return jsonResponse({ error: "Dispositivo não autorizado." }, 401);
    }

    // Os alunos citados que existem e são desta academia. Em lotes: 500 ids
    // no `.in()` não cabem no endereço da consulta.
    const alunosDaAcademia = new Set<string>();
    for (const lote of emLotes(alunosCitados(logs))) {
      const { data, error } = await admin
        .from("alunos")
        .select("id")
        .eq("organization_id", catraca.organization_id)
        .in("id", lote);
      if (error) {
        console.error("Erro ao conferir os alunos do lote:", error.code);
        return jsonResponse({ error: "Falha ao conferir os alunos." }, 500);
      }
      for (const a of data ?? []) alunosDaAcademia.add(String(a.id).toLowerCase());
    }

    const { linhas, descartados } = conferirLogs(logs, {
      organizationId: catraca.organization_id,
      catracaId: catraca.id,
      agora: new Date(),
      alunosDaAcademia,
    });

    const aceitos: string[] = [];
    let inseridos = 0;
    const aceitar = (l: LinhaConferida) => {
      inseridos++;
      if (l.id_local) aceitos.push(l.id_local);
    };

    if (linhas.length > 0) {
      const { error: insertError } = await admin.from("acessos_catraca_logs").insert(linhas.map((l) => l.linha));
      if (!insertError) {
        linhas.forEach(aceitar);
      } else if (!erroDaLinha(insertError.code)) {
        // Conexão ou banco fora: nada entrou (a instrução é uma só), e o
        // Gateway manda tudo de novo na próxima.
        console.error("Erro ao inserir logs offline:", insertError.code);
        return jsonResponse({ error: "Falha ao gravar os logs offline." }, 500);
      } else {
        // Uma linha passou na conferência e o banco recusou (o aluno excluído
        // entre a conferência e a gravação, por exemplo). Linha por linha:
        // a recusada sai da fila; se a conexão cair no meio, o resto fica
        // fora das duas listas e volta na próxima.
        for (const l of linhas) {
          const { error } = await admin.from("acessos_catraca_logs").insert(l.linha);
          if (!error) aceitar(l);
          else if (erroDaLinha(error.code)) descartados.push({ id_local: l.id_local, motivo: "recusado pelo banco" } satisfies Descarte);
          else {
            console.error("Erro ao inserir log offline, linha a linha:", error.code);
            break;
          }
        }
      }
    }

    if (descartados.length > 0) {
      // Só quantos e por quê: nada do registro vai para o log.
      const porMotivo: Record<string, number> = {};
      for (const d of descartados) porMotivo[d.motivo] = (porMotivo[d.motivo] ?? 0) + 1;
      console.warn("Acessos offline recusados:", JSON.stringify(porMotivo));
    }

    return jsonResponse({ inseridos, aceitos, descartados });
  } catch (error) {
    console.error("Erro inesperado em catraca-sincronizar-logs-offline:", error instanceof Error ? error.name : typeof error);
    return jsonResponse({ error: "Erro inesperado ao sincronizar logs offline." }, 500);
  }
});
