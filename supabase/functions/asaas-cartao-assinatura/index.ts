import { createClient } from "npm:@supabase/supabase-js@2";
import { ligarCartaoNaAssinatura } from "./fluxo.ts";
import { ambienteAsaas } from "../_shared/asaas.ts";

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

// Cadastra (ou troca) o cartão da assinatura do Método ARKE — ou, com
// `tipo: "plano"`, da mensalidade do plano próprio da academia — e liga a
// cobrança automática. A partir daí o Asaas cobra o cartão a cada ciclo, sem o aluno
// precisar lembrar de pagar — que é onde nasce a evasão involuntária.
//
// ## O cartão é só de passagem
//
// A API do Asaas exige a chave secreta, então o número atravessa esta função
// a caminho do gateway — e isso põe o ARKE no escopo do PCI DSS. A resposta é
// não reter nada: o corpo da requisição nunca vai para log (nem em erro), o
// banco recebe só os 4 últimos dígitos e a bandeira, e a resposta não devolve
// número, validade nem código de segurança. Os logs de erro trazem apenas o
// status HTTP e os códigos de erro do Asaas.
//
// ## Ordem das chamadas
//
// Tipo de cobrança primeiro, cartão depois, e a recusa desfaz a troca de tipo
// só quando ela foi nossa. O porquê — e o que o sandbox mostrou — está em
// fluxo.ts, que concentra as chamadas ao Asaas.
//
// ## Desligada por padrão
//
// Só responde com CARTAO_RECORRENTE_ATIVO = "true" nos secrets — é o
// interruptor para desligar sem deploy se algo der errado com cartão real.

// --- Validação. Duplicada de src/lib/cartao.ts e src/lib/cpf.ts de propósito:
// edge function roda em Deno e não importa do bundle do app.

function digitos(texto: unknown): string {
  return String(texto ?? "").replace(/\D/g, "");
}

function luhnValido(numero: string): boolean {
  if (numero.length < 13 || numero.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < numero.length; i++) {
    let n = Number(numero[numero.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
  }
  return soma % 10 === 0;
}

function cpfValido(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function validade(mes: string, ano: string): { mes: string; ano: string } | null {
  const m = Number(mes);
  let a = Number(ano);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  if (a < 100) a += 2000;
  if (a < 2000 || a > 2100) return null;
  if (new Date(a, m, 0, 23, 59, 59) < new Date()) return null;
  return { mes: String(m).padStart(2, "0"), ano: String(a) };
}

function bandeira(numero: string): string {
  const elo = ["401178", "401179", "431274", "438935", "451416", "457393", "457631", "457632", "504175",
    "506699", "5067", "509", "627780", "636297", "636368", "650", "6516", "6550"];
  if (elo.some((p) => numero.startsWith(p))) return "elo";
  if (numero.startsWith("606282") || numero.startsWith("3841")) return "hipercard";
  if (/^3[47]/.test(numero)) return "amex";
  if (/^3(0[0-5]|[68])/.test(numero)) return "diners";
  if (/^4/.test(numero)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(numero)) return "mastercard";
  if (/^6(011|5)/.test(numero)) return "discover";
  return "outra";
}

function ipDoCliente(req: Request): string | null {
  const encaminhado = req.headers.get("x-forwarded-for");
  if (encaminhado) return encaminhado.split(",")[0].trim() || null;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
}

type CorpoRequisicao = {
  aluno_id?: unknown;
  /** "metodo" (padrão) ou "plano" — qual assinatura do aluno recebe o cartão. */
  tipo?: unknown;
  cartao?: { titular?: unknown; numero?: unknown; mes?: unknown; ano?: unknown; cvv?: unknown };
  titular?: {
    nome?: unknown;
    email?: unknown;
    cpf?: unknown;
    cep?: unknown;
    numero_endereco?: unknown;
    telefone?: unknown;
    complemento?: unknown;
  };
};

const PAPEIS_EQUIPE = ["gestor", "recepcao"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (Deno.env.get("CARTAO_RECORRENTE_ATIVO") !== "true") {
    return jsonResponse(
      { error: "O pagamento automático por cartão ainda não está disponível. Continue pagando pela fatura." },
      503
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Configuração incompleta para cartão recorrente");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const remoteIp = ipDoCliente(req);
  if (!remoteIp) {
    // O Asaas exige o IP de quem está pagando para a análise antifraude.
    return jsonResponse({ error: "Não foi possível identificar a conexão. Tente de novo." }, 400);
  }

  try {
    const corpo: CorpoRequisicao = await req.json();
    const alunoId = String(corpo?.aluno_id ?? "");
    const tipo = corpo?.tipo === "plano" ? "plano" : "metodo";
    const numero = digitos(corpo?.cartao?.numero);
    const cvv = digitos(corpo?.cartao?.cvv);
    const val = validade(digitos(corpo?.cartao?.mes), digitos(corpo?.cartao?.ano));
    const titularCartao = String(corpo?.cartao?.titular ?? "").trim();
    const t = corpo?.titular ?? {};
    const cpf = digitos(t.cpf);
    const cep = digitos(t.cep);
    const telefone = digitos(t.telefone);
    const email = String(t.email ?? "").trim();
    const nome = String(t.nome ?? "").trim();
    const numeroEndereco = String(t.numero_endereco ?? "").trim();

    if (!alunoId) return jsonResponse({ error: "Aluno não informado." }, 400);
    if (titularCartao.length < 3) return jsonResponse({ error: "Informe o nome como está impresso no cartão." }, 400);
    if (!luhnValido(numero)) return jsonResponse({ error: "Número do cartão inválido." }, 400);
    if (!val) return jsonResponse({ error: "Validade inválida ou vencida." }, 400);
    const band = bandeira(numero);
    if (band === "amex" ? cvv.length !== 4 : cvv.length < 3 || cvv.length > 4) {
      return jsonResponse({ error: "Código de segurança inválido." }, 400);
    }
    if (nome.length < 3) return jsonResponse({ error: "Informe o nome do titular." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse({ error: "E-mail do titular inválido." }, 400);
    if (!cpfValido(cpf)) return jsonResponse({ error: "CPF do titular inválido." }, 400);
    if (cep.length !== 8) return jsonResponse({ error: "CEP inválido." }, 400);
    if (!numeroEndereco) return jsonResponse({ error: "Informe o número do endereço." }, 400);
    if (telefone.length < 10 || telefone.length > 11) return jsonResponse({ error: "Telefone com DDD inválido." }, 400);

    // Quem pode: o próprio aluno, ou gestor/recepção da academia dele. O RLS de
    // `alunos` já filtra quem enxerga o registro; o papel é conferido com a
    // organização fixada, o que é seguro contra o vínculo duplo
    // (organization_members tem unique(organization_id, user_id)).
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await asUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
    if (!callerId) return jsonResponse({ error: "Sessão inválida. Faça login novamente." }, 401);

    const { data: aluno } = await asUser
      .from("alunos")
      .select("id, organization_id, user_id")
      .eq("id", alunoId)
      .maybeSingle();
    if (!aluno) return jsonResponse({ error: "Aluno não encontrado ou sem permissão de acesso." }, 404);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // A organização do aluno decide o ambiente: em trial é homologação e
    // fala com o sandbox do Asaas.
    const { data: orgDoAluno } = await admin
      .from("organizations")
      .select("status")
      .eq("id", aluno.organization_id)
      .maybeSingle();
    const ambiente = ambienteAsaas(orgDoAluno?.status, (n) => Deno.env.get(n));
    if ("erro" in ambiente) {
      return jsonResponse({ error: ambiente.erro }, 500);
    }
    const asaasApiUrl = ambiente.api;
    const asaasApiKey = ambiente.chave;
    if (aluno.user_id !== callerId) {
      const { data: vinculo } = await admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", aluno.organization_id)
        .eq("user_id", callerId)
        .eq("status", "active")
        .maybeSingle();
      if (!vinculo || !PAPEIS_EQUIPE.includes(vinculo.role)) {
        return jsonResponse({ error: "Só o próprio aluno, a gestão ou a recepção podem cadastrar o cartão." }, 403);
      }
    }

    // As duas assinaturas guardam o resumo do cartão nas mesmas colunas.
    const tabela = tipo === "plano" ? "aluno_matriculas_academia" : "aluno_assinaturas";
    const { data: assinatura } = await admin
      .from(tabela)
      .select("id, status, asaas_subscription_id")
      .eq("aluno_id", aluno.id)
      .in("status", tipo === "plano" ? ["ativa"] : ["ativa", "atrasada"])
      .not("asaas_subscription_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!assinatura?.asaas_subscription_id) {
      return jsonResponse(
        {
          error:
            tipo === "plano"
              ? "A mensalidade da academia ainda não é cobrada pelo ARKE. Matricule o aluno no plano antes de cadastrar o cartão."
              : "A assinatura do Método ARKE ainda não foi emitida. Gere a cobrança antes de cadastrar o cartão.",
        },
        409
      );
    }

    const resultado = await ligarCartaoNaAssinatura(asaasApiUrl, asaasApiKey, assinatura.asaas_subscription_id, {
      creditCard: {
        holderName: titularCartao,
        number: numero,
        expiryMonth: val.mes,
        expiryYear: val.ano,
        ccv: cvv,
      },
      creditCardHolderInfo: {
        name: nome,
        email,
        cpfCnpj: cpf,
        postalCode: cep,
        addressNumber: numeroEndereco,
        addressComplement: t.complemento ? String(t.complemento) : undefined,
        phone: telefone,
        mobilePhone: telefone,
      },
      remoteIp,
    });
    if (!resultado.ok) return jsonResponse({ error: resultado.erro }, resultado.status);

    const final = numero.slice(-4);
    const { error: gravacaoError } = await admin
      .from(tabela)
      .update({
        forma_pagamento: "cartao",
        cartao_final: final,
        cartao_bandeira: resultado.bandeira ?? band,
        cartao_atualizado_em: new Date().toISOString(),
        cartao_atualizado_por: callerId,
        cartao_recusado_em: null,
      })
      .eq("id", assinatura.id);
    if (gravacaoError) {
      // O Asaas já está cobrando no cartão; só a exibição aqui fica defasada.
      console.error("Cartão ativo no Asaas, mas falhou ao gravar o resumo", gravacaoError.code);
    }

    return jsonResponse({ cartao_final: final, cartao_bandeira: resultado.bandeira ?? band });
  } catch (erro) {
    // Só a classe do erro: a mensagem de uma exceção pode carregar trecho do corpo.
    console.error("asaas-cartao-assinatura: erro inesperado", erro instanceof Error ? erro.name : typeof erro);
    return jsonResponse({ error: "Erro inesperado ao cadastrar o cartão." }, 500);
  }
});
