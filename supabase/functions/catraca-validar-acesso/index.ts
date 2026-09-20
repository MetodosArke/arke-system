import { createClient } from "npm:@supabase/supabase-js@2";

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

const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

type ValidarAcessoPayload = {
  device_token: string;
  /** Caminho de quem digita o documento no teclado da catraca. */
  cpf?: string;
  /**
   * Caminho da biometria. A digital é comparada DENTRO do equipamento
   * (1:N local) e o que chega aqui é o número do usuário no aparelho —
   * nenhum dado biométrico trafega para decidir acesso.
   */
  identificador_catraca?: string;
};

// ARKE® Gateway Local — validação de acesso de catracas.
// Dispositivo se autentica com um device_token próprio (não é um usuário
// autenticado do Supabase Auth), por isso a função roda com verify_jwt
// desabilitado e faz a própria checagem de autorização: o token precisa
// bater com uma catraca cadastrada e ativa antes de qualquer consulta a
// dados de aluno. Alvo de latência: responder em menos de 300ms.
Deno.serve(async (req: Request) => {
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
    const payload: Partial<ValidarAcessoPayload> = await req.json();
    const deviceToken = payload.device_token?.trim();
    const cpf = payload.cpf ? somenteDigitos(payload.cpf) : "";
    const identificador = payload.identificador_catraca?.trim() ?? "";

    if (!deviceToken) return jsonResponse({ error: "device_token é obrigatório." }, 400);
    if (!cpf && !identificador) {
      return jsonResponse({ error: "Informe cpf ou identificador_catraca." }, 400);
    }

    // Para os logs de acesso: quando a identificação veio da biometria não
    // existe CPF vindo do equipamento. Guardar o identificador prefixado
    // mantém a linha rastreável em vez de gravar string vazia.
    const credencialParaLog = cpf || `id:${identificador}`;

    const { data: catraca, error: catracaError } = await admin
      .from("organizacao_catracas")
      .select("id, organization_id, status, organizations(tipo)")
      .eq("device_token", deviceToken)
      .maybeSingle();

    if (catracaError) {
      console.error("Erro ao consultar catraca:", catracaError);
      return jsonResponse({ error: "Falha ao validar dispositivo." }, 500);
    }
    if (!catraca) {
      return jsonResponse({ liberado: false, motivo: "Dispositivo não autorizado." }, 401);
    }
    if (catraca.status !== "ativo") {
      await admin.from("acessos_catraca_logs").insert({
        organization_id: catraca.organization_id,
        catraca_id: catraca.id,
        cpf_consultado: credencialParaLog,
        resultado: "negado_catraca_inativa",
      });
      return jsonResponse({ liberado: false, motivo: "Dispositivo inativo." });
    }

    // Dois caminhos de identificação, sempre presos à organização da
    // catraca: o identificador é único por organização, nunca global —
    // equipamentos de academias diferentes numeram usuários a partir do 1
    // e colidiriam entre si.
    let aluno: { id: string; user_id: string | null } | null = null;

    if (identificador) {
      const { data } = await admin
        .from("alunos")
        .select("id, user_id")
        .eq("organization_id", catraca.organization_id)
        .eq("identificador_catraca", identificador)
        .maybeSingle();
      aluno = data ?? null;
    } else {
      const { data: profile } = await admin
        .from("profiles")
        .select("user_id")
        .eq("cpf", cpf)
        .maybeSingle();
      if (profile) {
        const { data } = await admin
          .from("alunos")
          .select("id, user_id")
          .eq("organization_id", catraca.organization_id)
          .eq("user_id", profile.user_id)
          .maybeSingle();
        aluno = data ?? null;
      }
    }

    if (!aluno) {
      await admin.from("acessos_catraca_logs").insert({
        organization_id: catraca.organization_id,
        catraca_id: catraca.id,
        cpf_consultado: credencialParaLog,
        resultado: "negado_nao_encontrado",
      });
      return jsonResponse({ liberado: false, motivo: "Aluno não encontrado nesta academia." });
    }

    // Nome vem do perfil, não do equipamento: é o que o display mostra, e
    // vale tanto na liberação quanto na negativa para a recepção saber de
    // quem se trata sem precisar consultar outra tela.
    const { data: perfilAluno } = aluno.user_id
      ? await admin.from("profiles").select("full_name").eq("user_id", aluno.user_id).maybeSingle()
      : { data: null };
    const nomeAluno = perfilAluno?.full_name ?? undefined;

    // Controle de acesso físico é da academia — checa adimplência do
    // Plano da Academia (aluno_matriculas_academia/mensalidades), não do
    // Método ARKE (produto de coaching à parte, sem relação com entrar
    // no prédio). Sem matrícula de academia cadastrada = libera (não
    // bloqueia quem a academia ainda não migrou pro módulo de mensalidades).
    const { data: matriculaAtiva } = await admin
      .from("aluno_matriculas_academia")
      .select("id")
      .eq("aluno_id", aluno.id)
      .eq("status", "ativa")
      .maybeSingle();

    let inadimplente = false;
    if (matriculaAtiva) {
      const { data: mensalidadeAtrasada } = await admin
        .from("mensalidades")
        .select("id")
        .eq("matricula_id", matriculaAtiva.id)
        .eq("status", "atrasado")
        .limit(1)
        .maybeSingle();
      inadimplente = !!mensalidadeAtrasada;
    }

    // Redundância de turma: em Studios (turmas de horário fixo e
    // capacidade limitada), assinatura em dia não basta — o aluno
    // também precisa ter um agendamento ativo para o bloco de horário
    // atual, senão a catraca libera gente fora do horário da turma dela.
    const organizacaoInfo = Array.isArray(catraca.organizations) ? catraca.organizations[0] : catraca.organizations;
    let semAgendamento = false;
    let falhaAoVerificarAgendamento = false;
    if (!inadimplente && organizacaoInfo?.tipo === "studio") {
      const { data: possuiAgendamento, error: agendamentoError } = await admin.rpc(
        "aluno_possui_agendamento_ativo_agora",
        { _aluno_id: aluno.id }
      );
      if (agendamentoError) {
        // Fail-closed: se a checagem de agendamento falhar, negar em vez
        // de liberar silenciosamente — do contrário a redundância vira um
        // no-op justamente quando ela deveria pegar o problema.
        console.error("Erro ao verificar agendamento do studio:", agendamentoError);
        falhaAoVerificarAgendamento = true;
      } else {
        semAgendamento = !possuiAgendamento;
      }
    }

    const resultado = inadimplente
      ? "negado_inadimplente"
      : falhaAoVerificarAgendamento
        ? "negado_falha_verificacao_agendamento"
        : semAgendamento
          ? "negado_sem_agendamento"
          : "liberado";
    await admin.from("acessos_catraca_logs").insert({
      organization_id: catraca.organization_id,
      catraca_id: catraca.id,
      aluno_id: aluno.id,
      cpf_consultado: credencialParaLog,
      resultado,
    });

    if (inadimplente) {
      return jsonResponse({ liberado: false, motivo: "Mensalidade da academia em atraso.", aluno_nome: nomeAluno });
    }
    if (falhaAoVerificarAgendamento) {
      return jsonResponse({
        liberado: false,
        motivo: "Falha ao verificar agendamento. Tente novamente.",
        aluno_nome: nomeAluno,
      });
    }
    if (semAgendamento) {
      return jsonResponse({
        liberado: false,
        motivo: "Sem agendamento ativo para este horário.",
        aluno_nome: nomeAluno,
      });
    }

    return jsonResponse({ liberado: true, motivo: "Acesso liberado.", aluno_nome: nomeAluno });
  } catch (error) {
    console.error("Erro inesperado em catraca-validar-acesso:", error);
    return jsonResponse({ error: "Erro inesperado ao validar acesso." }, 500);
  }
});
