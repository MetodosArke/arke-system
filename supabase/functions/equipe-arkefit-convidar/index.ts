import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { servir } from "../_shared/servir.ts";
import { verificada } from "../_shared/verificacao.ts";
import { dentroDoFreio, MENSAGEM_FREIO } from "../_shared/freio.ts";
import { linkDoApp } from "../_shared/linkDoApp.ts";
import { resumoDoErro } from "../_shared/resumoDoErro.ts";
import { emailJaCadastrado, respostaDoErroDoAuth } from "../_shared/erroDoAuth.ts";
import { MENSAGEM_PERFIL_SIMULADO, sessaoSimulada } from "../_shared/sessaoSimulada.ts";
import {
  JA_CRIOU_A_SENHA,
  JA_TEM_CONTA,
  SO_SOCIO,
  avisoAosSocios,
  emailDeNovoConvite,
  lerPedido,
  nomeDoAcesso,
  quandoEmBrasilia,
} from "./fluxo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// A equipe da ArkeFit entra por convite de um sócio, e sai pela retirada do
// acesso (08/10/2026). Três ações, todas só para o sócio com as duas etapas:
//   * convidar: e-mail sem conta recebe o convite do Auth, sem senha, e a
//     senha nasce no link do e-mail. E-mail que já tem conta é recusado (o
//     pré-sequestro; ver fluxo.ts). O perfil, os papéis do nível, a linha da
//     equipe e a auditoria gravam juntos no banco; se falharem, a conta é
//     apagada. Os outros sócios recebem o aviso;
//   * reenviar: o link de definir a senha de novo, a quem ainda não a criou;
//   * retirar: pelo banco, com a sessão de quem pede (a regra mora em
//     `retirar_acesso_equipe_arkefit`: nunca o próprio acesso nem o último
//     sócio), e o aviso aos outros sócios.
servir("equipe-arkefit-convidar", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("equipe-arkefit-convidar: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const linkDefinirSenha = linkDoApp(Deno.env.get("SITE_URL"), "/auth/definir-senha");
  const painel = linkDoApp(Deno.env.get("SITE_URL"), "/superadmin/equipe");

  const leitura = lerPedido(await req.json().catch(() => null));
  if (!leitura.ok) return jsonResponse({ error: leitura.erro }, 400);
  const pedido = leitura.pedido;

  const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await asUser.auth.getClaims(token);
  const claims = claimsData?.claims;
  const callerId = typeof claims?.sub === "string" ? claims.sub : null;
  if (claimsError || !callerId) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Quem chama: sócio (superadmin) com a sessão verificada em duas etapas. O
  // papel é lido do banco, e não do token.
  const { data: papeis, error: papeisError } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  if (papeisError) {
    console.error("equipe-arkefit-convidar: falha ao ler os papéis", resumoDoErro(papeisError));
    return jsonResponse({ error: "Erro ao validar permissões." }, 500);
  }
  const socio = verificada(claims) && (papeis ?? []).some((p) => p.role === "superadmin");
  if (!socio) return jsonResponse({ error: SO_SOCIO }, 403);
  try {
    if (await sessaoSimulada(admin, claims)) return jsonResponse({ error: MENSAGEM_PERFIL_SIMULADO }, 403);
  } catch (e) {
    console.error("equipe-arkefit-convidar: falha ao conferir a sessão", resumoDoErro(e));
    return jsonResponse({ error: "Erro ao validar a sessão." }, 500);
  }

  // Cada convite manda e-mail: o laço é o que se freia.
  if (!(await dentroDoFreio(admin, [{ chave: `equipe-arkefit:user:${callerId}`, limite: 30, janelaSeg: 60 * 60 }]))) {
    return jsonResponse({ error: MENSAGEM_FREIO }, 429);
  }

  // O nome vai só no texto dos e-mails: sem ele, o e-mail diz "um sócio".
  const nomeDe = async (userId: string): Promise<string> => {
    const { data, error } = await admin.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
    if (error) console.error("equipe-arkefit-convidar: falha ao ler o nome", resumoDoErro(error));
    return (data?.full_name as string | undefined)?.trim() ?? "";
  };

  if (pedido.acao === "convidar") {
    const { data: contas, error: contaError } = await admin.rpc("conta_por_email", { _email: pedido.email });
    if (contaError) {
      console.error("equipe-arkefit-convidar: conta_por_email", resumoDoErro(contaError));
      return jsonResponse({ error: "Erro ao conferir o e-mail." }, 500);
    }
    if (((contas ?? []) as unknown[]).length > 0) return jsonResponse({ error: JA_TEM_CONTA }, 409);

    // A conta nasce sem senha; a senha nasce no link do e-mail, e até lá
    // ninguém entra nela.
    const { data: convite, error: conviteError } = await admin.auth.admin.inviteUserByEmail(pedido.email, {
      data: { full_name: pedido.nome },
      redirectTo: linkDefinirSenha,
    });
    if (conviteError || !convite?.user) {
      console.error("equipe-arkefit-convidar: falha ao convidar", resumoDoErro(conviteError));
      // Entre a conferência e o convite, a conta pode ter nascido por outro caminho.
      if (emailJaCadastrado(conviteError)) return jsonResponse({ error: JA_TEM_CONTA }, 409);
      const r = respostaDoErroDoAuth(conviteError, "Não foi possível enviar o convite para esse e-mail.");
      return jsonResponse({ error: r.mensagem }, r.status);
    }
    const novoId = convite.user.id;

    const { error: gravarError } = await admin.rpc("gravar_convite_equipe_arkefit", {
      _ator: callerId,
      _user_id: novoId,
      _nome: pedido.nome,
      _papeis: [...pedido.acesso.papeis],
      _acesso: pedido.acesso.id,
    });
    if (gravarError) {
      console.error("equipe-arkefit-convidar: falha ao gravar o convite", resumoDoErro(gravarError));
      // Sem os papéis, a conta não serve para nada; o link do e-mail que já
      // saiu passa a dar "link inválido".
      const { error: desfazerError } = await admin.auth.admin.deleteUser(novoId);
      if (desfazerError) console.error("equipe-arkefit-convidar: falha ao desfazer a conta", resumoDoErro(desfazerError));
      return jsonResponse({ error: "Não foi possível concluir o convite. Tente de novo em instantes." }, 500);
    }

    const avisados = await avisarSocios(admin, {
      exceto: [callerId, novoId],
      evento: "convidada",
      ator: await nomeDe(callerId),
      pessoa: pedido.nome,
      acesso: pedido.acesso.nome,
      painel,
    });
    return jsonResponse({ user_id: novoId, convite_enviado: true, socios_avisados: avisados });
  }

  if (pedido.acao === "reenviar") {
    const { data: linhas, error: contaError } = await admin.rpc("conta_da_equipe_arkefit", { _user_id: pedido.userId });
    if (contaError) {
      console.error("equipe-arkefit-convidar: conta_da_equipe_arkefit", resumoDoErro(contaError));
      return jsonResponse({ error: "Erro ao conferir a conta." }, 500);
    }
    const conta = ((linhas ?? []) as { email: string; nome: string; estado: string }[])[0];
    if (!conta) return jsonResponse({ error: "Essa conta não é da equipe da ArkeFit." }, 404);
    if (conta.estado !== "convite_enviado") return jsonResponse({ error: JA_CRIOU_A_SENHA }, 409);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("equipe-arkefit-convidar: RESEND_API_KEY ausente");
      return jsonResponse({ error: "O envio de e-mail não está configurado." }, 500);
    }
    // O link de definir a senha serve também a quem nunca abriu o primeiro
    // e-mail: abrir o link confirma o e-mail.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: conta.email,
      options: { redirectTo: linkDefinirSenha },
    });
    if (linkError || !link?.properties?.action_link) {
      console.error("equipe-arkefit-convidar: falha ao gerar o link", resumoDoErro(linkError));
      const r = respostaDoErroDoAuth(linkError, "Não foi possível gerar o link agora.");
      return jsonResponse({ error: r.mensagem }, r.status);
    }
    const conteudo = emailDeNovoConvite({ nome: conta.nome, ator: await nomeDe(callerId), link: link.properties.action_link });
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: Deno.env.get("EMAIL_ACESSO_FROM") ?? "ArkeFit <acesso@arkefit.com.br>",
          to: [conta.email],
          subject: conteudo.assunto,
          html: conteudo.html,
          text: conteudo.texto,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      // Só o status vai para log: a resposta do Resend ecoa o endereço.
      if (!r.ok) {
        console.error("equipe-arkefit-convidar: Resend recusou o convite de novo", r.status);
        return jsonResponse({ error: "O e-mail não saiu. Tente de novo em instantes." }, 502);
      }
    } catch (e) {
      console.error("equipe-arkefit-convidar: o convite de novo não saiu", resumoDoErro(e));
      return jsonResponse({ error: "O e-mail não saiu. Tente de novo em instantes." }, 502);
    }
    return jsonResponse({ reenviado: true });
  }

  // Retirar: pelo banco, com a sessão de quem pede, para a regra valer lá.
  const pessoa = await nomeDe(pedido.userId);
  const { data: retirada, error: retirarError } = await asUser.rpc("retirar_acesso_equipe_arkefit", { _user_id: pedido.userId });
  if (retirarError) {
    if (retirarError.code === "P0001") return jsonResponse({ error: retirarError.message }, 409);
    if (retirarError.code === "42501") return jsonResponse({ error: SO_SOCIO }, 403);
    console.error("equipe-arkefit-convidar: falha ao tirar o acesso", resumoDoErro(retirarError));
    return jsonResponse({ error: "Não foi possível tirar o acesso agora." }, 500);
  }
  const papeisRetirados = ((retirada as { papeis?: string[] } | null)?.papeis ?? []).filter((p) => typeof p === "string");
  const avisados = await avisarSocios(admin, {
    exceto: [callerId, pedido.userId],
    evento: "acesso_retirado",
    ator: await nomeDe(callerId),
    pessoa,
    acesso: nomeDoAcesso(papeisRetirados),
    painel,
  });
  return jsonResponse({ retirado: true, socios_avisados: avisados });
});

/**
 * O aviso aos outros sócios, pelo canal dos alertas (o remetente de alertas,
 * como a troca da carteira de recebimento). A ação já está gravada e na
 * auditoria; o e-mail que falha fica no log só com o status, e não desfaz
 * nada. Devolve se saiu, para a tela dizer.
 */
async function avisarSocios(
  admin: SupabaseClient,
  a: {
    exceto: string[];
    evento: "convidada" | "acesso_retirado";
    ator: string;
    pessoa: string;
    acesso: string;
    painel: string;
  },
): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("equipe-arkefit-convidar: RESEND_API_KEY ausente, sócios sem aviso");
    return false;
  }
  const { data: destinatarios, error } = await admin.rpc("emails_socios_para_aviso", { _exceto: a.exceto });
  if (error) {
    console.error("equipe-arkefit-convidar: falha ao ler os sócios", resumoDoErro(error));
    return false;
  }
  const para = [...new Set(((destinatarios ?? []) as { email: string }[]).map((d) => d.email).filter(Boolean))];
  // Sem outro sócio ativo, não há a quem avisar: não é falha.
  if (!para.length) return true;
  const aviso = avisoAosSocios({
    evento: a.evento,
    ator: a.ator,
    pessoa: a.pessoa,
    acesso: a.acesso,
    quando: quandoEmBrasilia(new Date()),
    painel: a.painel,
  });
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_ALERTAS_FROM") ?? "ArkeFit Alertas <alertas@arkefit.com.br>",
        to: para,
        subject: aviso.assunto,
        html: aviso.html,
        text: aviso.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    // Só o status vai para log: a resposta do Resend ecoa os endereços.
    if (!r.ok) console.error("equipe-arkefit-convidar: Resend recusou o aviso aos sócios", r.status);
    return r.ok;
  } catch (e) {
    console.error("equipe-arkefit-convidar: o aviso aos sócios não saiu", resumoDoErro(e));
    return false;
  }
}
