import { createClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { hojeBrasilia } from "../_shared/data.ts";
import { dentroDoFreio, MENSAGEM_FREIO, regrasAsaas } from "../_shared/freio.ts";
import { MENSAGEM_SO_QUEM_COBRA, podeCobrarNaAcademia } from "../_shared/papelCobranca.ts";
import { servir } from "../_shared/servir.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { contaParaNovaCobranca, divisaoDaCobranca } from "../_shared/contaCobranca.ts";
import { contaDaCobranca, lembrarClienteDaAcademia } from "../_shared/contaDaAcademia.ts";
import { assinaturaAtivaNoAsaas, criarAssinaturaDoPlano, obterOuCriarCustomer } from "./fluxo.ts";

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

type CreateMatriculaPayload = {
  aluno_id: string;
  plano_id: string;
  valor_cobrado?: number;
};

/**
 * Hoje no fuso de Brasília. Em UTC, depois das 21h a data já é a de amanhã, e
 * a primeira mensalidade venceria um dia depois da matrícula.
 */
const hojeEmBrasilia = hojeBrasilia;

// --- Asaas: customer e assinatura sem duplicar -------------------------------
//
// As chamadas ao Asaas moram em ./fluxo.ts (desde 06/10/2026), para o sandbox
// exercitar o código real. Por que a operação é idempotente:
//
//   1. O Asaas exige `cpfCnpj` para criar a assinatura (o customer nasce sem,
//      visto no sandbox), e ele não era enviado — a criação falharia antes de
//      qualquer cobrança nascer. (Até 21/09/2026 nenhuma assinatura de aluno
//      tinha sido criada pelo ARKE.)
//   2. Nada impedia duas assinaturas para o mesmo aluno. O caminho mais curto
//      estava na própria função: criou no Asaas, falhou ao gravar no banco, a
//      tela continua oferecendo "Tentar cobrar" — e a primeira assinatura fica
//      órfã, cobrando o aluno todo mês sem ninguém ver.
//
// A resposta é procurar pelo `externalReference` (`plano:<aluno>`) antes de criar.

function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}

// Matricula o aluno num plano próprio da academia e cria a assinatura
// recorrente no Asaas. Em qual conta (`_shared/contaCobranca.ts`):
//   * modo desligado (o padrão): na conta da ArkeFit, com o mesmo split do
//     Método — a academia recebe a mensalidade menos a taxa de processamento
//     (config global em plataforma_config, editável pelo Super Admin), que
//     cobre o custo que o Asaas cobra da ArkeFit;
//   * `organizations.cobranca_conta_academia` ligado: na conta Asaas da
//     academia, com a chave dela, sem split e sem taxa — a tarifa do Asaas é
//     cobrada direto dela. A matrícula guarda a conta em `conta_asaas`.
servir("academia-criar-matricula", async (req: Request) => {
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
    const payload: Partial<CreateMatriculaPayload> = await req.json();
    const alunoId = payload.aluno_id;
    const planoId = payload.plano_id;

    if (!alunoId || !planoId) {
      return jsonResponse({ error: "aluno_id e plano_id são obrigatórios." }, 400);
    }

    // Cliente com o JWT do chamador: as leituras abaixo passam pela regra de
    // acesso de cada tabela. Quem pode matricular é conferido à parte, logo
    // depois de achar o aluno: a regra de leitura deixa o próprio aluno ler o
    // cadastro, o plano e a academia dele.
    const asUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Quem está matriculando (pra comissão de venda — ver
    // gerar_comissao_se_configurada) — mesmo padrão de extração de
    // identidade usado em convidar-membro.
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
    const callerId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
    if (claimsError || !callerId) {
      return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
    }

    const { data: aluno, error: alunoError } = await asUser
      .from("alunos")
      .select("id, organization_id, user_id")
      .eq("id", alunoId)
      .single();
    if (alunoError || !aluno) {
      return jsonResponse({ error: "Aluno não encontrado ou sem permissão de acesso." }, 404);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    if (!(await podeCobrarNaAcademia(admin, callerId, aluno.organization_id, claimsData?.claims))) {
      return jsonResponse({ error: MENSAGEM_SO_QUEM_COBRA }, 403);
    }
    if (!(await dentroDoFreio(admin, regrasAsaas(callerId, aluno.organization_id)))) {
      return jsonResponse({ error: MENSAGEM_FREIO }, 429);
    }

    const { data: plano, error: planoError } = await asUser
      .from("planos_academia")
      .select("id, nome, periodicidade, valor, ativo")
      .eq("id", planoId)
      .single();
    if (planoError || !plano) {
      return jsonResponse({ error: "Plano não encontrado." }, 404);
    }
    if (!plano.ativo) {
      return jsonResponse({ error: "Este plano está inativo." }, 422);
    }

    const { data: org, error: orgError } = await asUser
      .from("organizations")
      .select("id, nome, asaas_wallet_id, onboarding_completed, status, cobranca_conta_academia")
      .eq("id", aluno.organization_id)
      .single();
    if (orgError || !org) {
      return jsonResponse({ error: "Organização não encontrada." }, 404);
    }
    if (!org.asaas_wallet_id) {
      return jsonResponse(
        { error: "A academia ainda não configurou a conta de recebimentos no Asaas (Onboarding → Recebimentos)." },
        422
      );
    }
    // D5: cobrança de aluno só com o onboarding da academia concluído
    // (organização em trial é homologação e passa).
    if (!org.onboarding_completed && org.status !== "trial") {
      return jsonResponse(
        { error: "Conclua o onboarding da academia (Painel → Onboarding) antes de cobrar alunos pelo ARKE." },
        422
      );
    }

    // Organização em trial é homologação e fala com o sandbox do Asaas.
    const ambiente = ambienteAsaas(org.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    // A conta da cobrança nova: a da ArkeFit, ou a da academia com o modo
    // ligado (a chave do cofre, conferida contra a carteira de hoje).
    const conta = await contaDaCobranca(
      admin,
      ambiente,
      org,
      contaParaNovaCobranca("plano", org.cobranca_conta_academia as boolean | null),
      { conferirCarteira: true },
    );
    if ("erro" in conta) {
      return jsonResponse({ error: conta.erro }, conta.status);
    }
    const asaasApiUrl = conta.api;
    const asaasApiKey = conta.chave;

    const valorCobrado = payload.valor_cobrado && payload.valor_cobrado > 0 ? payload.valor_cobrado : Number(plano.valor);

    // A partir daqui usa o client de service_role: gestor não tem (nem
    // deveria ter) acesso de leitura a plataforma_config (RLS só libera
    // admin_arke) — já validamos acima que ele é gestão ou recepção da
    // organização do aluno, então seguir com privilégio elevado aqui é seguro.

    // Taxa de processamento (config global, editável pelo Super Admin em
    // Configurações da Plataforma) — cobre o custo real que o Asaas cobra
    // da ARKE, retido via split no momento da cobrança. Vem da função do
    // banco, e não de uma conta própria: era a quarta cópia da regra, e ficou
    // sem o piso da taxa fixa do boleto/PIX, que em plano abaixo de ~R$ 50
    // faria o Asaas recusar a assinatura (split maior que o valor líquido).
    // Na conta da academia não há taxa: a academia fica com o valor inteiro.
    let taxaArke: number | null = null;
    if (conta.nome === "arkefit") {
      const { data: taxa, error: taxaError } = await admin.rpc("arke_taxa_processamento", { _valor: valorCobrado });
      if (taxaError || taxa === null || taxa === undefined) {
        console.error("Taxa de processamento indisponível", taxaError?.code);
        return jsonResponse({ error: "Não foi possível calcular a taxa de processamento." }, 500);
      }
      taxaArke = Number(taxa);
    }
    const divisao = divisaoDaCobranca(conta.nome, valorCobrado, taxaArke, org.asaas_wallet_id);
    if ("erro" in divisao) {
      return jsonResponse({ error: divisao.erro }, 500);
    }
    const valorRepasseArke = divisao.repasse;
    const valorLiquidoAcademia = divisao.liquido;
    if (valorLiquidoAcademia < 0) {
      return jsonResponse({ error: "O valor cobrado é menor que a taxa de processamento da plataforma." }, 422);
    }

    const { data: profile } = await asUser
      .from("profiles")
      .select("full_name, cpf, phone")
      .eq("user_id", aluno.user_id)
      .maybeSingle();

    // O Asaas não cria cliente sem CPF — dizer agora, com o caminho.
    const cpf = somenteDigitos(profile?.cpf);
    if (cpf.length !== 11) {
      return jsonResponse(
        {
          error:
            "Cadastre o CPF do aluno (ficha do aluno) antes de criar a matrícula — o Asaas exige CPF para emitir a cobrança.",
        },
        422
      );
    }

    // Matrícula viva (ativa ou pausada): recusa ANTES de tocar no gateway. A
    // versão anterior conferia isto depois de criar a assinatura no Asaas — o
    // 409 voltava, e a assinatura recém-criada ficava lá, órfã, cobrando o
    // aluno. A pausada conta porque retomá-la depois daria duas cobranças.
    const { data: matriculaViva } = await admin
      .from("aluno_matriculas_academia")
      .select("id, status")
      .eq("aluno_id", alunoId)
      .in("status", ["ativa", "pausada"])
      .limit(1)
      .maybeSingle();
    if (matriculaViva) {
      return jsonResponse(
        {
          error:
            matriculaViva.status === "pausada"
              ? "Este aluno tem uma matrícula pausada. Retome ou cancele a atual antes de criar outra."
              : "Este aluno já tem uma matrícula ativa. Cancele a atual antes de criar outra.",
        },
        409,
      );
    }

    // --- Asaas: cria (ou reaproveita) o customer e a assinatura ---
    const asaasHeaders = { "Content-Type": "application/json", access_token: asaasApiKey };

    // Na conta da academia, o cliente achado com os avisos desligados (o da
    // nota fiscal) ou anonimizado volta a receber a fatura.
    const customer = await obterOuCriarCustomer(
      asaasApiUrl,
      asaasApiKey,
      {
        alunoId: aluno.id,
        nome: profile?.full_name ?? "Aluno ARKE",
        cpf,
        telefone: somenteDigitos(profile?.phone) || null,
      },
      { reativar: conta.nome === "academia" },
    );
    if ("erro" in customer) {
      return jsonResponse({ error: customer.erro }, 502);
    }

    // Assinatura de plano ativa no Asaas sem matrícula ativa aqui é órfã
    // (criou lá e falhou ao gravar, ou foi cancelada só de um lado).
    // Diferente do Método, não se adota: pode ser de outro plano ou outro
    // valor, e adotar esconderia o problema. Recusa e diz onde olhar.
    const referencia = `plano:${aluno.id}`;
    let orfa = await assinaturaAtivaNoAsaas(asaasApiUrl, asaasHeaders, referencia);
    // Na conta da academia, a órfã também pode estar na conta da ArkeFit (de
    // antes de ligar o modo): o aluno seria cobrado nas duas.
    if (!orfa && conta.nome === "academia") {
      orfa = await assinaturaAtivaNoAsaas(ambiente.api, { "Content-Type": "application/json", access_token: ambiente.chave }, referencia);
    }
    if (orfa) {
      console.error("Assinatura de plano órfã no Asaas", orfa.id, "aluno", aluno.id);
      return jsonResponse(
        {
          error:
            `Já existe uma assinatura ativa no Asaas para este aluno (${orfa.id}) sem matrícula correspondente no ARKE. ` +
            "Cancele-a no Asaas antes de criar a nova, para o aluno não ser cobrado duas vezes.",
        },
        409
      );
    }

    // A matrícula vale do dia em que é feita: a primeira mensalidade vence no
    // ato e as seguintes no mesmo dia do mês (o Asaas ajusta 29–31 nos meses
    // mais curtos). Antes a academia escolhia o dia e a primeira cobrança caía
    // no próximo — até quatro semanas de plano sem cobrança.
    const primeiroVencimento = hojeEmBrasilia();
    const diaVencimento = Number(primeiroVencimento.slice(8, 10));

    // Na conta da ArkeFit, a academia recebe o valor líquido (mensalidade
    // menos a taxa de processamento) pelo split; o restante fica retido pela
    // ArkeFit, o mesmo mecanismo da assinatura do Método. Na conta da
    // academia, sem split: ela recebe o valor inteiro.
    const criada = await criarAssinaturaDoPlano(asaasApiUrl, asaasApiKey, {
      customerId: customer.id,
      valor: valorCobrado,
      periodicidade: plano.periodicidade,
      primeiroVencimento,
      descricao: `${org.nome} — ${plano.nome}`,
      referencia,
      split: divisao.split,
    });
    if (!criada.ok) {
      return jsonResponse({ error: criada.erro }, 502);
    }
    const subscription = criada.assinatura;
    if (conta.nome === "academia") {
      await lembrarClienteDaAcademia(admin, {
        alunoId: aluno.id,
        organizationId: aluno.organization_id,
        ambiente: conta.ambiente,
        customerId: customer.id,
      });
    }

    // --- Persistência (service role, client já criado acima) ---

    const { data: matricula, error: insertError } = await admin
      .from("aluno_matriculas_academia")
      .insert({
        organization_id: aluno.organization_id,
        aluno_id: aluno.id,
        plano_id: plano.id,
        valor_cobrado: valorCobrado,
        valor_repasse_arke: valorRepasseArke,
        valor_liquido_academia: valorLiquidoAcademia,
        dia_vencimento: diaVencimento,
        // O cliente da conta da academia mora em asaas_clientes_academia;
        // esta coluna é sempre o da conta da ArkeFit.
        asaas_customer_id: conta.nome === "arkefit" ? customer.id : null,
        asaas_subscription_id: subscription.id,
        conta_asaas: conta.nome,
        registrado_por: callerId,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Erro ao gravar matrícula", resumoDoErro(insertError));
      return jsonResponse(
        {
          error:
            `A assinatura foi criada no Asaas (${subscription.id}), mas a matrícula não foi gravada aqui. ` +
            "Cancele essa assinatura no Asaas antes de tentar de novo, para o aluno não ser cobrado duas vezes.",
        },
        500
      );
    }

    return jsonResponse({ matricula, asaas_subscription_id: subscription.id, conta: conta.nome });
  } catch (error) {
    console.error("academia-criar-matricula error", resumoDoErro(error));
    return jsonResponse({ error: "Erro inesperado ao criar matrícula." }, 500);
  }
});
