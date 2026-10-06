import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { servir } from "../_shared/servir.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { linkDoApp } from "../_shared/linkDoApp.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { academiaDoCadastro, decidirCadastro, type ContaExistente, type VinculoNaAcademia } from "./fluxo.ts";
import { emailEquipePendente } from "./email.ts";

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

type Papel = "professor" | "nutricionista" | "recepcao";
const PAPEIS_VALIDOS = new Set<Papel>(["professor", "nutricionista", "recepcao"]);

type CadastrarMembroPayload = {
  email: string;
  /** Obrigatório só para quem ainda não tem conta (o convite leva o nome). */
  full_name?: string;
  telefone?: string;
  cpf?: string;
  papel: Papel;
  /** A academia escolhida na tela (a unidade do seletor do cabeçalho). */
  organization_id?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validação de CPF pelo módulo 11.
 *
 * Duplicada de src/lib/cpf.ts de propósito: edge function roda em Deno e
 * não importa do bundle do app. O banco tem a mesma regra em
 * public.cpf_valido() e é ele quem garante — isto existe para o gestor ver
 * uma mensagem que dá para entender, em vez de um erro de constraint.
 */
function cpfValido(valor: string): boolean {
  const c = valor.replace(/\D/g, "");
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto >= 10 ? 0 : resto;
  };

  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

// Cadastro de um funcionário (professor, nutricionista ou recepção) e do
// parceiro do profissional autônomo. Ninguém escolhe a senha de outra pessoa
// (auditoria de 06/10/2026, ver fluxo.ts):
//   * e-mail sem conta → o convite do Auth, e a senha nasce no link do e-mail;
//   * e-mail com conta → o vínculo nasce pendente, vai o link de definir a
//     senha, e o acesso só vale quando a pessoa entra por ele.
servir("cadastrar-membro-equipe", async (req: Request) => {
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
  const linkDefinirSenha = linkDoApp(Deno.env.get("SITE_URL"), "/auth/definir-senha");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("cadastrar-membro-equipe: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  try {
    const payload: Partial<CadastrarMembroPayload> = await req.json();
    const email = payload.email?.trim().toLowerCase();
    const fullName = payload.full_name?.trim() || null;
    const telefone = payload.telefone?.trim() || null;
    const cpf = payload.cpf?.trim() || null;
    const papel = payload.papel;

    // CPF é opcional, mas se vier tem que ser real: é a chave de leitura
    // da catraca e a de deduplicação da base. Sem esta checagem o gestor
    // receberia o erro cru da constraint do banco.
    if (cpf && !cpfValido(cpf)) {
      return jsonResponse({ error: `CPF inválido: "${cpf}". Confira os dígitos.` }, 400);
    }

    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "E-mail inválido." }, 400);
    }
    if (!papel || !PAPEIS_VALIDOS.has(papel)) {
      return jsonResponse({ error: "Papel inválido. Use professor, nutricionista ou recepcao." }, 400);
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

    // A academia do novo membro é a que a tela manda (a unidade escolhida no
    // seletor), e quem chama tem de ser gestor ativo dela. Filtra por usuário
    // e papel, sem .maybeSingle(): quem é gestor de uma academia e aluno de
    // outra não quebra.
    const { data: vinculosGestor, error: callerMembershipError } = await adminClient
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", callerId)
      .eq("status", "active")
      .eq("role", "gestor");
    if (callerMembershipError) {
      console.error("cadastrar-membro-equipe: falha ao ler os vínculos", callerMembershipError.code);
      return jsonResponse({ error: "Erro ao validar permissões." }, 500);
    }
    const escolha = academiaDoCadastro(
      payload.organization_id,
      (vinculosGestor ?? []).map((v) => v.organization_id as string),
    );
    if (!escolha.ok) return jsonResponse({ error: escolha.erro }, escolha.status);
    const organizationId = escolha.organizationId;

    // Cada cadastro manda um e-mail: laço é o que se freia, não o lote da
    // configuração da academia.
    const freioGeral = [
      { chave: `equipe:user:${callerId}`, limite: 100, janelaSeg: 60 * 60 },
      { chave: `equipe:org:${organizationId}`, limite: 300, janelaSeg: 24 * 60 * 60 },
    ];
    if (!(await dentroDoFreio(adminClient, freioGeral))) {
      return jsonResponse({ error: MENSAGEM_FREIO }, 429);
    }

    const { data: contas, error: contaError } = await adminClient.rpc("conta_por_email", { _email: email });
    if (contaError) {
      console.error("cadastrar-membro-equipe: conta_por_email", contaError.code);
      return jsonResponse({ error: "Erro ao conferir o e-mail." }, 500);
    }
    const conta = ((contas ?? []) as NonNullable<ContaExistente>[])[0] ?? null;

    let vinculo: VinculoNaAcademia = null;
    if (conta) {
      // Filtra por organização e usuário: um vínculo só.
      const { data, error } = await adminClient
        .from("organization_members")
        .select("role, status")
        .eq("organization_id", organizationId)
        .eq("user_id", conta.user_id)
        .maybeSingle();
      if (error) {
        console.error("cadastrar-membro-equipe: falha ao ler o vínculo", error.code);
        return jsonResponse({ error: "Erro ao conferir a equipe." }, 500);
      }
      vinculo = (data as VinculoNaAcademia) ?? null;
    }

    const decisao = decidirCadastro(conta, vinculo, fullName);
    if (decisao.acao === "recusar") {
      return jsonResponse({ error: decisao.erro, ...(decisao.precisaNome ? { precisa_nome: true } : {}) }, decisao.status);
    }

    if (decisao.acao === "pendente") {
      // Quem já tem conta: o pedido revela que o e-mail existe, então o freio
      // é mais curto aqui.
      const freioConta = [
        { chave: `equipe:conta:user:${callerId}`, limite: 20, janelaSeg: 60 * 60 },
        { chave: `equipe:conta:org:${organizationId}`, limite: 50, janelaSeg: 24 * 60 * 60 },
      ];
      if (!(await dentroDoFreio(adminClient, freioConta))) {
        return jsonResponse({ error: "Muitos convites para quem já tem conta no ArkeFit hoje. Tente amanhã." }, 429);
      }
      // O vínculo nasce PENDENTE: só vale quando a pessoa entra pelo link.
      const { error: membroError } = await adminClient
        .from("organization_members")
        .upsert(
          { organization_id: organizationId, user_id: conta!.user_id, role: papel, status: "pending" },
          { onConflict: "organization_id,user_id" },
        );
      if (membroError) {
        console.error("cadastrar-membro-equipe: falha no vínculo pendente", membroError.code);
        return jsonResponse({ error: "Erro ao vincular a pessoa à equipe." }, 500);
      }
      const aviso = await avisarPendente(adminClient, {
        userId: conta!.user_id,
        organizationId,
        papel,
        email,
        nomeInformado: fullName,
        telefone,
        link: linkDefinirSenha,
      });
      return jsonResponse({ user_id: conta!.user_id, conta_existente: true, pendente: true, reenvio: decisao.reenvio, aviso });
    }

    // Sem conta: o convite do Auth. A conta nasce sem senha, e a senha nasce
    // no link do e-mail; até lá ninguém entra nela.
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: linkDefinirSenha,
    });
    if (inviteError || !invited.user) {
      // Só o status e o código: a mensagem do Auth pode trazer o e-mail.
      console.error("cadastrar-membro-equipe: falha ao convidar", resumoDoErro(inviteError));
      if (inviteError?.status === 429 || /rate limit/i.test(inviteError?.message ?? "")) {
        return jsonResponse({ error: "O limite de e-mails de convite por hora foi atingido. Tente de novo daqui a uma hora." }, 429);
      }
      return jsonResponse({ error: "Não foi possível enviar o convite para esse e-mail." }, 400);
    }

    const newUserId = invited.user.id;
    const rollback = async () => {
      const { error } = await adminClient.auth.admin.deleteUser(newUserId);
      if (error) console.error("cadastrar-membro-equipe: falha ao desfazer a conta", resumoDoErro(error));
    };

    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        { user_id: newUserId, full_name: fullName, phone: telefone, cpf, status: "active" },
        { onConflict: "user_id" }
      );
    if (profileError) {
      console.error("cadastrar-membro-equipe: falha no perfil", profileError.code);
      await rollback();
      return jsonResponse({ error: "Erro ao preparar o perfil do usuário." }, 500);
    }

    const { error: membershipError } = await adminClient
      .from("organization_members")
      .insert({ organization_id: organizationId, user_id: newUserId, role: papel, status: "active" });
    if (membershipError) {
      console.error("cadastrar-membro-equipe: falha no vínculo", membershipError.code);
      await rollback();
      return jsonResponse({ error: "Erro ao vincular o usuário à organização." }, 500);
    }

    return jsonResponse({ user_id: newUserId, convite_enviado: true });
  } catch (error) {
    console.error("cadastrar-membro-equipe: erro inesperado", resumoDoErro(error));
    return jsonResponse({ error: "Erro inesperado ao cadastrar o funcionário." }, 500);
  }
});

/**
 * O link de definir a senha a quem já tinha conta: o vínculo pendente só vale
 * quando a pessoa entra por ele. O perfil é da pessoa: completa só o que
 * falta, sem trocar o que ela usa. Devolve o aviso para a tela, ou nulo.
 */
async function avisarPendente(
  admin: SupabaseClient,
  o: {
    userId: string;
    organizationId: string;
    papel: Papel;
    email: string;
    nomeInformado: string | null;
    telefone: string | null;
    link: string;
  },
): Promise<string | null> {
  const { data: perfil } = await admin.from("profiles").select("full_name, phone").eq("user_id", o.userId).maybeSingle();
  const completar: Record<string, string> = {};
  if (!perfil?.full_name?.trim() && o.nomeInformado) completar.full_name = o.nomeInformado;
  if (!perfil?.phone && o.telefone) completar.phone = o.telefone;
  if (Object.keys(completar).length) {
    const { error } = await admin.from("profiles").update(completar).eq("user_id", o.userId);
    if (error) console.error("cadastrar-membro-equipe: falha ao completar o perfil", error.code);
  }

  const falhou =
    "O acesso está pendente, mas o e-mail com o link não saiu. Cadastre de novo com o mesmo e-mail para reenviar: o acesso só vale depois do link.";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return falhou;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: o.email,
    options: { redirectTo: o.link },
  });
  if (error || !data?.properties?.action_link) {
    console.error("cadastrar-membro-equipe: falha ao gerar o link", resumoDoErro(error));
    return falhou;
  }

  const { data: org } = await admin.from("organizations").select("nome").eq("id", o.organizationId).maybeSingle();
  const conteudo = emailEquipePendente({
    nome: perfil?.full_name?.trim() || o.nomeInformado || "",
    academia: (org?.nome as string | undefined) ?? "A academia",
    papel: o.papel,
    link: data.properties.action_link,
  });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_ACESSO_FROM") ?? "ArkeFit <acesso@arkefit.com.br>",
        to: [o.email],
        subject: conteudo.assunto,
        html: conteudo.html,
        text: conteudo.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // Só o status vai para log: a resposta do Resend ecoa o endereço.
    if (!r.ok) {
      console.error("cadastrar-membro-equipe: Resend", r.status);
      return falhou;
    }
  } catch (e) {
    console.error("cadastrar-membro-equipe: Resend", resumoDoErro(e));
    return falhou;
  }
  return null;
}
