import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ambienteAsaas } from "../_shared/asaas.ts";
import { descreverErro, registrarExecucao } from "../_shared/execucao.ts";
import {
  cancelarNota,
  chaveCombinaComAmbiente,
  consultarNota,
  emitirNota,
  enderecoCompleto,
  FalhaIndefinida,
  garantirCliente,
  situacaoDaNota,
  type NotaAsaas,
} from "./fluxo.ts";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const NOME = "nfse-emitir";
// Lote grande e orçamento de tempo, no desenho da conferência com o Asaas.
// Com lote fixo de 40, e cada nota passando duas vezes pela fila (emitir e
// acompanhar), saíam no máximo 240 por hora: 20 mil mensalidades concentradas
// no dia de vencimento levariam dias. A linha só é reservada na hora de ser
// tratada, então o que o orçamento não alcança fica para a rodada seguinte.
const LOTE = 300;
const ORCAMENTO_MS = 100_000;
const MAX_TENTATIVAS = 5;

// Nota fiscal automática da academia (cron `arke-emitir-notas`, de 10 em 10
// minutos). Ver a migration 20261278010000 para o desenho. Cada rodada:
//   pendente   → cliente na conta da academia, nota agendada e emitida;
//   agendada   → pergunta ao Asaas se a prefeitura já autorizou;
//   cancelar   → pede o cancelamento (pagamento estornado);
//   cancelando → pergunta se a prefeitura já cancelou.
// Tudo com a chave da conta da academia: a nota sai no CNPJ dela.

type Linha = {
  id: string;
  organization_id: string;
  aluno_id: string | null;
  valor: number;
  descricao: string;
  competencia: string;
  status: string;
  asaas_invoice_id: string | null;
  tentativas: number;
  proxima_tentativa_em: string;
};

type Contexto = {
  api: string;
  chave: string;
  /** Por que não dá para emitir nota nova agora; acompanhar e cancelar seguem. */
  impedimentoEmissao: string | null;
  config: {
    servico_municipal_id: string | null;
    servico_municipal_codigo: string | null;
    servico_municipal_nome: string | null;
    aliquota_iss: number | null;
    observacoes: string | null;
  };
};

const emMinutos = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function contextoDaAcademia(admin: SupabaseClient, orgId: string): Promise<Contexto | { motivo: string }> {
  const [{ data: org }, { data: config }, { data: chave }] = await Promise.all([
    admin.from("organizations").select("status").eq("id", orgId).maybeSingle(),
    admin
      .from("organizacao_fiscal")
      .select("emissao_ativa, cadastro_enviado, autenticacao_enviada, servico_municipal_id, servico_municipal_codigo, servico_municipal_nome, aliquota_iss, observacoes")
      .eq("organization_id", orgId)
      .maybeSingle(),
    admin.rpc("ler_chave_subconta_asaas", { _organization_id: orgId }),
  ]);
  if (!org) return { motivo: "organização não encontrada" };
  if (!chave) return { motivo: "conta Asaas da academia não conectada" };
  const ambiente = ambienteAsaas(org.status as string, (n) => Deno.env.get(n));
  if ("erro" in ambiente) return { motivo: ambiente.erro };
  if (!chaveCombinaComAmbiente(chave as string, ambiente.nome)) return { motivo: "chave da academia de outro ambiente" };
  // Desligar a emissão ou deixar o cadastro pela metade segura só as notas
  // novas: as já agendadas continuam sendo acompanhadas até a prefeitura
  // responder, e o estorno ainda cancela o que saiu.
  const impedimentoEmissao = !config?.emissao_ativa
    ? "emissão desligada"
    : !config.cadastro_enviado || !config.autenticacao_enviada
      ? "cadastro fiscal incompleto"
      : !(config.servico_municipal_id || config.servico_municipal_codigo) || config.aliquota_iss === null
        ? "serviço ou ISS não configurado"
        : null;
  return {
    api: ambiente.api,
    chave: chave as string,
    impedimentoEmissao,
    config: {
      servico_municipal_id: config?.servico_municipal_id ?? null,
      servico_municipal_codigo: config?.servico_municipal_codigo ?? null,
      servico_municipal_nome: config?.servico_municipal_nome ?? null,
      aliquota_iss: config?.aliquota_iss ?? null,
      observacoes: config?.observacoes ?? null,
    },
  };
}

async function tomador(admin: SupabaseClient, alunoId: string) {
  const { data: aluno } = await admin.from("alunos").select("id, user_id").eq("id", alunoId).maybeSingle();
  if (!aluno) return null;
  const { data: p } = await admin
    .from("profiles")
    .select("full_name, cpf, cep, logradouro, endereco_numero, complemento, bairro")
    .eq("user_id", aluno.user_id)
    .maybeSingle();
  const { data: usuario } = await admin.auth.admin.getUserById(aluno.user_id as string);
  return {
    alunoId,
    nome: (p?.full_name as string | undefined) || "Aluno",
    cpf: String(p?.cpf ?? "").replace(/\D/g, ""),
    email: usuario?.user?.email ?? null,
    endereco: {
      cep: String(p?.cep ?? ""),
      logradouro: String(p?.logradouro ?? ""),
      numero: String(p?.endereco_numero ?? ""),
      complemento: (p?.complemento as string | null) ?? null,
      bairro: String(p?.bairro ?? ""),
    },
  };
}

function dadosDaNota(n: NotaAsaas) {
  return {
    asaas_invoice_id: n.id,
    numero: n.number ?? null,
    pdf_url: n.pdfUrl ?? null,
    xml_url: n.xmlUrl ?? null,
  };
}

async function atualizar(admin: SupabaseClient, id: string, campos: Record<string, unknown>) {
  await admin.from("notas_fiscais").update(campos).eq("id", id);
}

/**
 * Duas rodadas ao mesmo tempo — a do cron e uma chamada à mão, ou uma rodada
 * lenta — não podem emitir a mesma nota duas vezes. A linha é reservada por
 * uma troca condicional do horário da próxima tentativa: só uma das rodadas
 * encontra o horário que leu, e a outra pula a linha.
 */
async function reservar(admin: SupabaseClient, l: Linha): Promise<boolean> {
  const { data } = await admin
    .from("notas_fiscais")
    .update({ proxima_tentativa_em: emMinutos(5) })
    .eq("id", l.id)
    .eq("status", l.status)
    .eq("proxima_tentativa_em", l.proxima_tentativa_em)
    .select("id");
  return !!data?.length;
}

/** Falha que pode passar sozinha: tenta de novo mais tarde, até desistir e mostrar o erro. */
async function adiar(admin: SupabaseClient, l: Linha, erro: string) {
  const tentativas = l.tentativas + 1;
  await atualizar(admin, l.id, tentativas >= MAX_TENTATIVAS
    ? { status: "erro", erro, tentativas }
    : { tentativas, erro, proxima_tentativa_em: emMinutos(tentativas * 10) });
}

async function emitir(admin: SupabaseClient, ctx: Contexto, l: Linha): Promise<string> {
  if (!l.aluno_id) {
    await atualizar(admin, l.id, { status: "erro", erro: "O aluno foi excluído antes de a nota sair." });
    return "erro";
  }
  const t = await tomador(admin, l.aluno_id);
  if (!t) {
    await atualizar(admin, l.id, { status: "erro", erro: "Aluno não encontrado." });
    return "erro";
  }
  if (!enderecoCompleto(t.endereco)) {
    await atualizar(admin, l.id, { status: "sem_endereco", erro: "Falta o endereço do aluno — a prefeitura exige." });
    return "sem_endereco";
  }
  const cliente = await garantirCliente(ctx.api, ctx.chave, t);
  if ("erro" in cliente) {
    await atualizar(admin, l.id, { status: "erro", erro: cliente.erro, tentativas: l.tentativas + 1 });
    return "erro";
  }
  const r = await emitirNota(ctx.api, ctx.chave, {
    referencia: `nfse:${l.id}`,
    cliente: cliente.id,
    descricao: l.descricao,
    observacoes: ctx.config.observacoes ?? "",
    valor: Number(l.valor),
    data: l.competencia,
    servico: {
      id: ctx.config.servico_municipal_id,
      codigo: ctx.config.servico_municipal_codigo,
      nome: ctx.config.servico_municipal_nome ?? l.descricao,
    },
    iss: Number(ctx.config.aliquota_iss),
  });
  if (!r.ok) {
    if (!r.definitivo) {
      await adiar(admin, l, r.erro);
      return "adiada";
    }
    await atualizar(admin, l.id, {
      status: "erro",
      erro: r.erro,
      tentativas: l.tentativas + 1,
      ...(r.nota ? { asaas_invoice_id: r.nota.id } : {}),
    });
    return "erro";
  }
  const situacao = situacaoDaNota(r.nota.status);
  await atualizar(admin, l.id, {
    ...dadosDaNota(r.nota),
    status: situacao === "emitida" ? "emitida" : "agendada",
    erro: null,
    tentativas: l.tentativas + 1,
    proxima_tentativa_em: emMinutos(1),
    ...(situacao === "emitida" ? { emitida_em: new Date().toISOString() } : {}),
  });
  return situacao === "emitida" ? "emitida" : "agendada";
}

async function acompanhar(admin: SupabaseClient, ctx: Contexto, l: Linha): Promise<string> {
  if (!l.asaas_invoice_id) {
    await atualizar(admin, l.id, { status: "pendente", proxima_tentativa_em: emMinutos(0) });
    return "pendente";
  }
  const n = await consultarNota(ctx.api, ctx.chave, l.asaas_invoice_id);
  if (!n) {
    await atualizar(admin, l.id, { status: "erro", erro: "A nota não foi encontrada no Asaas." });
    return "erro";
  }
  const situacao = situacaoDaNota(n.status);
  if (situacao === "emitida") {
    await atualizar(admin, l.id, { ...dadosDaNota(n), status: "emitida", erro: null, emitida_em: new Date().toISOString() });
  } else if (situacao === "erro") {
    await atualizar(admin, l.id, { status: "erro", erro: n.statusDescription || "A prefeitura recusou a nota." });
  } else if (situacao === "cancelada") {
    await atualizar(admin, l.id, { status: "cancelada", cancelada_em: new Date().toISOString() });
  } else if (situacao === "cancelamento_negado") {
    await atualizar(admin, l.id, { status: "emitida", erro: `Cancelamento negado: ${n.statusDescription ?? "a prefeitura não permitiu"}. Cancele no portal da prefeitura.` });
  } else {
    // Ainda na prefeitura: pergunta de novo daqui a pouco.
    await atualizar(admin, l.id, { proxima_tentativa_em: emMinutos(5) });
    return "aguardando";
  }
  return situacao;
}

async function cancelar(admin: SupabaseClient, ctx: Contexto, l: Linha): Promise<string> {
  if (!l.asaas_invoice_id) {
    await atualizar(admin, l.id, { status: "cancelada", cancelada_em: new Date().toISOString() });
    return "cancelada";
  }
  const r = await cancelarNota(ctx.api, ctx.chave, l.asaas_invoice_id);
  if (!r.ok) {
    // A nota continua valendo; quem cancela, então, é a academia no portal.
    await atualizar(admin, l.id, { status: "emitida", erro: `Pagamento estornado, mas o cancelamento da nota foi recusado: ${r.erro}` });
    return "cancelamento_recusado";
  }
  const situacao = situacaoDaNota(r.nota.status);
  await atualizar(admin, l.id, situacao === "cancelada"
    ? { status: "cancelada", cancelada_em: new Date().toISOString() }
    : { status: "cancelando", proxima_tentativa_em: emMinutos(1) });
  return situacao ?? "cancelando";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("nfse-emitir: configuração incompleta");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const token = req.headers.get("x-alerta-token");
  const { data: valido } = token ? await admin.rpc("conferir_token_alerta_rotinas", { _token: token }) : { data: false };
  if (!valido) return jsonResponse({ error: "Não autorizado." }, 401);

  const inicio = Date.now();
  try {
    const { data: fila, error } = await admin
      .from("notas_fiscais")
      .select("id, organization_id, aluno_id, valor, descricao, competencia, status, asaas_invoice_id, tentativas, proxima_tentativa_em")
      .in("status", ["pendente", "agendada", "cancelar", "cancelando"])
      .lte("proxima_tentativa_em", new Date().toISOString())
      .order("proxima_tentativa_em")
      .limit(LOTE);
    if (error) throw new Error(`fila: ${error.code}`);

    const contagem: Record<string, number> = {};
    const conta = (k: string) => (contagem[k] = (contagem[k] ?? 0) + 1);
    const porAcademia = new Map<string, Linha[]>();
    for (const l of (fila ?? []) as Linha[]) porAcademia.set(l.organization_id, [...(porAcademia.get(l.organization_id) ?? []), l]);

    for (const [orgId, linhas] of porAcademia) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        linhas.forEach(() => conta("para_a_proxima_rodada"));
        continue;
      }
      const ctx = await contextoDaAcademia(admin, orgId);
      if ("motivo" in ctx) {
        // Configuração pela metade não é erro da nota: ela espera, e a
        // academia vê o motivo na tela. Pergunta de novo em uma hora.
        for (const l of linhas) {
          await atualizar(admin, l.id, { erro: `Aguardando: ${ctx.motivo}.`, proxima_tentativa_em: emMinutos(60) });
          conta("aguardando_configuracao");
        }
        continue;
      }
      for (const l of linhas) {
        if (Date.now() - inicio > ORCAMENTO_MS) {
          conta("para_a_proxima_rodada");
          continue;
        }
        if (!(await reservar(admin, l))) {
          conta("com_outra_rodada");
          continue;
        }
        try {
          if (l.status === "pendente" && ctx.impedimentoEmissao) {
            await atualizar(admin, l.id, { erro: `Aguardando: ${ctx.impedimentoEmissao}.`, proxima_tentativa_em: emMinutos(60) });
            conta("aguardando_configuracao");
          } else if (l.status === "pendente") conta(await emitir(admin, ctx, l));
          else if (l.status === "agendada" || l.status === "cancelando") conta(await acompanhar(admin, ctx, l));
          else if (l.status === "cancelar") conta(await cancelar(admin, ctx, l));
        } catch (e) {
          if (e instanceof FalhaIndefinida) {
            await adiar(admin, l, "Não foi possível falar com o Asaas agora.");
            conta("adiada");
          } else {
            throw e;
          }
        }
      }
    }

    await registrarExecucao(admin, NOME, true);
    return jsonResponse({ ok: true, processadas: fila?.length ?? 0, contagem });
  } catch (erro) {
    console.error("nfse-emitir: erro inesperado", erro instanceof Error ? erro.message : typeof erro);
    await registrarExecucao(admin, NOME, false, descreverErro(erro));
    return jsonResponse({ error: "Erro inesperado." }, 500);
  }
});
