import { createClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "../_shared/verificacao.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { encerrarCobrancasDoAluno } from "../_shared/encerrarCobrancas.ts";
import { abridorDaContaDaAcademia } from "../_shared/contaCobranca.ts";
import { anonimizarClienteNaSaida } from "../_shared/saidaAsaas.ts";
import { apagarArquivosDoAluno, apagarArquivosPorUrl } from "../_shared/arquivosDoAluno.ts";
import { servir } from "../_shared/servir.ts";

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

type AnonimizarPayload = {
  aluno_id: string;
};

// Anonimização a pedido (LGPD), dentro desta academia: nunca apaga o registro
// do aluno nem os dados financeiros (assinaturas, pagamentos, mensalidades,
// IDs do Asaas), que precisam sobreviver para a contabilidade. Apaga o resto
// do que é da pessoa nesta academia e desativa o vínculo. O trabalho do banco
// mora em `anonimizar_dados_do_aluno`.
servir("anonimizar-aluno", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing required Supabase environment variables");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<AnonimizarPayload> = await req.json();
    const alunoId = payload.aluno_id?.trim();
    if (!alunoId) {
      return jsonResponse({ error: "aluno_id é obrigatório." }, 400);
    }

    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: aluno, error: alunoError } = await adminClient
      .from("alunos")
      .select("id, user_id, organization_id, anonimizado_em")
      .eq("id", alunoId)
      .maybeSingle();
    if (alunoError) {
      console.error("Error loading aluno", alunoError.code);
      return jsonResponse({ error: "Erro ao carregar o aluno." }, 500);
    }
    if (!aluno) {
      return jsonResponse({ error: "Aluno não encontrado." }, 404);
    }
    if (aluno.anonimizado_em) {
      return jsonResponse({ error: "Este aluno já foi anonimizado." }, 409);
    }

    const { data: callerRoles, error: callerRolesError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);
    if (callerRolesError) {
      console.error("Error loading caller roles", callerRolesError.code);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const callerIsAdminArke = verificada(claimsData?.claims) && (callerRoles ?? []).some((r) => r.role === "admin_arke");

    let autorizado = callerIsAdminArke;
    if (!autorizado) {
      // Pergunta direta: o chamador é gestor DESTA organização? Antes a
      // consulta pegava "o vínculo" do chamador com .maybeSingle() e só
      // depois comparava com a organização do aluno — então quem tem
      // vínculo ativo em duas academias fazia a consulta falhar e levava
      // 403 na própria academia. Fixar a organização elimina a
      // ambiguidade em vez de desempatá-la.
      const { data: vinculosGestor, error: callerMembershipError } = await adminClient
        .from("organization_members")
        .select("id")
        .eq("user_id", callerId)
        .eq("organization_id", aluno.organization_id)
        .eq("role", "gestor")
        .eq("status", "active")
        .limit(1);
      if (callerMembershipError) {
        console.error("Error loading caller membership", callerMembershipError.code);
        return jsonResponse({ error: "Erro ao validar permissões." }, 500);
      }
      autorizado = !!vinculosGestor?.length;
    }
    if (!autorizado) {
      return jsonResponse({ error: "Apenas o gestor da organização pode anonimizar um aluno." }, 403);
    }

    const emailAnonimizado = `anonimizado_${aluno.id}@arkefit.local`;

    // Preservar o registro financeiro e certo — auditoria fiscal precisa
    // dele. Seguir COBRANDO quem exerceu o direito de apagamento, nao. Por
    // isso a cobranca e encerrada no gateway antes, e as linhas ficam.
    const { data: orgDoAluno } = await adminClient
      .from("organizations")
      .select("status")
      .eq("id", aluno.organization_id)
      .maybeSingle();
    const ambiente = ambienteAsaas(orgDoAluno?.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    const encerramento = await encerrarCobrancasDoAluno(
      adminClient,
      aluno.id,
      { api: ambiente.api, chave: ambiente.chave },
      callerId,
      "Aluno anonimizado a pedido (LGPD).",
      // A mensalidade e a avulsa que nasceram na conta da academia são canceladas lá.
      abridorDaContaDaAcademia(adminClient, ambiente, aluno.organization_id),
    );
    if (!encerramento.ok) {
      return jsonResponse({ error: encerramento.erro }, 502);
    }

    // A conta de login é da pessoa, não da academia: só é anonimizada quando
    // ela não tem vínculo vivo em outro lugar. Antes daqui, a anonimização
    // trocava o e-mail e o perfil de quem também era aluna ou professora na
    // academia ao lado, e cortava o acesso dela lá (auditoria de 05/10/2026).
    // O login vem antes do banco para a nova tentativa, se algo falhar no
    // meio, refazer as duas partes: trocar o e-mail de novo não muda nada.
    const { data: outrosVinculos, error: outrosError } = await adminClient.rpc("pessoa_tem_outro_vinculo", {
      _aluno_id: aluno.id,
    });
    if (outrosError) {
      console.error("Error checking other links", outrosError.code);
      return jsonResponse({ error: "Erro ao conferir os vínculos da pessoa." }, 500);
    }
    // O cadastro dela no Asaas (auditoria de 05/10/2026): antes do banco,
    // porque o CPF ainda está no perfil. Não trava a anonimização: se o
    // Asaas falhar, fica a pendência, e a rotina `retentar-saida-asaas`
    // tenta de novo de hora em hora (`_shared/saidaAsaas.ts`).
    const asaas = await anonimizarClienteNaSaida(adminClient, aluno, !!outrosVinculos, (n) => Deno.env.get(n));

    if (!outrosVinculos) {
      const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(aluno.user_id, {
        email: emailAnonimizado,
        user_metadata: { full_name: null },
      });
      if (authUpdateError) {
        console.error("Error anonymizing auth user", authUpdateError.status);
        return jsonResponse({ error: "Erro ao anonimizar o e-mail de acesso." }, 500);
      }
    }

    // O banco numa transação só: a ficha, as autorizações, a saúde, as
    // conversas, o feed, o vínculo desta academia e, sem outro vínculo, o
    // perfil. Fica o que a lei manda guardar, sem identificar a pessoa.
    const { data: feito, error: anonError } = await adminClient.rpc("anonimizar_dados_do_aluno", {
      _aluno_id: aluno.id,
      _ator: callerId,
    });
    if (anonError) {
      console.error("Error anonymizing aluno", anonError.code);
      return jsonResponse({ error: "Erro ao anonimizar o aluno." }, 500);
    }
    const resultado = feito as { avatar_url: string | null; imagens_feed: string[] | null };

    // Atestado e vídeo de conversa são dado de saúde identificável: saem com a
    // anonimização. O termo da digital fica — é a prova de que a autorização
    // foi dada, guardada pelo prazo legal, como diz a Política de Privacidade.
    // As fotos do feed e a foto de perfil ficam em bucket público: a URL é o
    // único rastro delas.
    const privados = await apagarArquivosDoAluno(adminClient, aluno.organization_id, aluno.id, ["atestados", "chat-videos"]);
    const publicos = await apagarArquivosPorUrl(adminClient, [
      ...(resultado.imagens_feed ?? []),
      ...(resultado.avatar_url ? [resultado.avatar_url] : []),
    ]);

    return jsonResponse({
      success: true,
      outros_vinculos: !!outrosVinculos,
      // "anonimizado", ou "pendente" quando o Asaas falhou e a rotina tenta de novo.
      cadastro_no_asaas: asaas.situacao === "anonimizado" ? "anonimizado" : "pendente",
      arquivos_apagados: privados.apagados + publicos.apagados,
      arquivos_pendentes: [...privados.falhas, ...publicos.falhas],
    });
  } catch (error) {
    console.error("Unexpected error in anonimizar-aluno", error instanceof Error ? error.name : "erro");
    return jsonResponse({ error: "Erro inesperado ao anonimizar o aluno." }, 500);
  }
});
