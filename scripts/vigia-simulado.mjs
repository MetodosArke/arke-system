// Simulado do Vigia: cenários de falha montados no banco de verdade, cada um
// numa transação desfeita no fim, e o quadro de cada um mandado ao modelo
// real pelo mesmo código de produção (_shared/ia.ts e _shared/vigiaAnalise.ts).
//
// Serve para avaliar o Vigia sem esperar incidente de verdade — antes do
// primeiro cliente, a produção quase não tem o que ver — e para refazer a
// avaliação sempre que o modelo, o roteiro ou o catálogo mudarem.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... BEDROCK_ACCESS_KEY_ID=... BEDROCK_SECRET_ACCESS_KEY=... \
//     npm run simulado:vigia -- [--rodadas 3] [--cenario internet-academia] [--saida resultado.json]
//
// Não deixa rastro: cada cenário roda entre `begin` e `rollback`, sem e-mail
// e sem linha nova. Como fui eu que montei cada falha, a causa certa e as
// ações esperadas são conhecidas — é isso que permite dar nota ao modelo. O
// simulado mede se o Vigia acerta, não com que frequência cada caso acontece:
// isso só a operação real diz.
import { writeFileSync } from "node:fs";
import { consultarVigia, MODELO_VIGIA } from "../supabase/functions/_shared/ia.ts";
import { FERRAMENTAS, interpretarResposta, validarQuadro } from "../supabase/functions/_shared/vigiaAnalise.ts";

const PROJETO = "lzyxqjibkfblrrjboylp";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const env = (n) => process.env[n];
if (!TOKEN || !env("BEDROCK_ACCESS_KEY_ID") || !env("BEDROCK_SECRET_ACCESS_KEY")) {
  console.error("Defina SUPABASE_ACCESS_TOKEN, BEDROCK_ACCESS_KEY_ID e BEDROCK_SECRET_ACCESS_KEY.");
  process.exit(2);
}
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 ? process.argv[i + 1] : padrao;
};
const RODADAS = Number(arg("rodadas", "3"));
const SO = arg("cenario", null);
const SAIDA = arg("saida", null);

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJETO}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 600));
  return t.trim() ? JSON.parse(t) : null;
}

// ── Montagem dos cenários ─────────────────────────────────────────────────

const PRELUDIO = `
create function pg_temp.org(_nome text) returns uuid language sql as $f$
  insert into public.organizations (nome, slug)
  values (_nome, 'sim-' || substr(md5(_nome || clock_timestamp()::text), 1, 12)) returning id $f$;
create function pg_temp.gw(_org uuid, _nome text, _estado text, _sem_sinal int, _sync int, _fila int)
returns uuid language plpgsql as $f$
declare c uuid;
begin
  insert into public.organizacao_catracas (organization_id, nome, status, ultimo_heartbeat_em)
  values (_org, _nome, 'ativo', now() - make_interval(mins => _sem_sinal)) returning id into c;
  insert into public.gateway_telemetria (catraca_id, organization_id, versao, estado, fila_offline,
    ultima_sincronizacao, capacidades, reportado_em)
  values (c, _org, '1.0.0', _estado, _fila, now() - make_interval(mins => _sync),
    array['sincronizar_completo','enviar_logs','diagnostico','liberar_catraca','cadastrar_usuario',
          'cadastrar_digital','cadastrar_cartao','apagar_usuario'],
    now() - make_interval(mins => _sem_sinal));
  return c;
end $f$;
create function pg_temp.evento(_c uuid, _tipo text, _min int, _detalhe text) returns void language sql as $f$
  insert into public.gateway_eventos (catraca_id, organization_id, tipo, detalhe, ocorrido_em)
  select _c, organization_id, _tipo, _detalhe, now() - make_interval(mins => _min)
    from public.organizacao_catracas where id = _c $f$;
create function pg_temp.ordem_falhou(_c uuid, _tipo text, _min int, _erro text) returns void language sql as $f$
  insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, status, solicitado_em,
    expira_em, entregue_em, concluido_em, erro)
  select organization_id, _c, _tipo, '{"user_id":"12"}', 'falhou', now() - make_interval(mins => _min + 2),
         now() + interval '1 hour', now() - make_interval(mins => _min + 1), now() - make_interval(mins => _min), _erro
    from public.organizacao_catracas where id = _c $f$;
create function pg_temp.funcao_falhou(_nome text, _erro text) returns void language sql as $f$
  update public.execucoes_agendadas set ultimo_erro = _erro, ultimo_erro_em = now() where nome = _nome $f$;
create function pg_temp.conferencia(_min int, _erro text, _orfas int, _div int, _corr int) returns void language sql as $f$
  insert into public.reconciliacoes_asaas (modo, executada_em, erro, assinaturas_orfas, divergencias, corrigidas,
    cobrancas_verificadas, detalhes)
  values ('varredura', now() - make_interval(mins => _min), _erro, _orfas, _div, _corr, 40,
    jsonb_build_object('orfas', (select coalesce(jsonb_agg(jsonb_build_object('id', 'sub_sim_' || g, 'referencia', 'metodo:sim')), '[]'::jsonb)
                                   from generate_series(1, _orfas) g))) $f$;
create function pg_temp.aviso_asaas(_tipo text, _min int, _erro text) returns void language sql as $f$
  insert into public.asaas_webhook_events (asaas_event_id, tipo_evento, payload, processado, erro, created_at)
  values ('sim-' || md5(random()::text), _tipo, '{}', false, _erro, now() - make_interval(mins => _min)) $f$;
`;

// Um passo de tempo simulado: as regras veem o problema, 20 minutos depois
// (passou a espera) e mais 35 (nova tentativa). O fuso da sessão define a
// hora local que o quadro mostra ao modelo.
function transacao(horaLocal, preparo) {
  const utc = new Date().getUTCHours();
  let deslocamento = (((horaLocal - utc) % 24) + 24) % 24;
  if (deslocamento > 14) deslocamento -= 24;
  const fuso = deslocamento >= 0 ? `Etc/GMT-${deslocamento}` : `Etc/GMT+${-deslocamento}`;
  return `begin;
set local timezone = '${fuso}';
${PRELUDIO}
do $sim$ declare a uuid; b uuid; c uuid; g1 uuid; g2 uuid; g3 uuid; begin
${preparo}
end $sim$;
select public.vigia_varrer();
update public.vigia_ocorrencias set aberta_em = aberta_em - interval '20 minutes' where fechada_em is null;
select public.vigia_varrer();
update public.vigia_ocorrencias set ultima_tentativa_em = ultima_tentativa_em - interval '35 minutes'
 where fechada_em is null and ultima_tentativa_em is not null;
select public.vigia_varrer();
select jsonb_build_object(
  'regras', coalesce((select jsonb_agg(jsonb_build_object('regra', o.regra, 'nivel', r.nivel, 'descricao', o.descricao,
      'agiria', o.acao_prevista_em is not null, 'tentativas', o.tentativas_previstas, 'freio', o.freio_em is not null)
      order by o.regra, o.descricao)
    from public.vigia_ocorrencias o join public.vigia_regras r on r.codigo = o.regra where o.fechada_em is null), '[]'::jsonb),
  'quadro', public.vigia_quadro()) as r;
rollback;`;
}

const GATEWAY = Object.entries(FERRAMENTAS).filter(([, f]) => f.alvo === "gateway").map(([n]) => n);

// `exige`: cada grupo precisa de pelo menos uma das ferramentas (não recusada).
// `erradas`: ação que não serve para o caso — em Gateway sem sinal, ordem
// nenhuma chega; em falha da nuvem, a academia não tem culpa.
const CENARIOS = [
  {
    id: "internet-academia",
    titulo: "Internet da academia caiu (2 catracas sem sinal, horário comercial)",
    hora: 14,
    preparo: `a := pg_temp.org('Simulado Centro'); b := pg_temp.org('Simulado Bairro');
      perform pg_temp.gw(a, 'Entrada', 'online', 25, 30, 12); perform pg_temp.gw(a, 'Saída', 'online', 24, 30, 8);
      perform pg_temp.gw(b, 'Recepção', 'online', 0, 2, 0);`,
    esperado: {
      causas: ["internet_da_academia", "computador_da_catraca"],
      exige: [["acionar_academia"]],
      erradas: [{ ferramentas: GATEWAY, emGatewaySemSinal: true }, { ferramentas: ["acionar_suporte_arkefit"] }],
    },
  },
  {
    id: "computador-recepcao",
    titulo: "Computador de uma catraca desligado (a outra, da mesma academia, no ar)",
    hora: 10,
    preparo: `a := pg_temp.org('Simulado Centro');
      perform pg_temp.gw(a, 'Entrada', 'online', 40, 45, 5); perform pg_temp.gw(a, 'Saída', 'online', 0, 2, 0);`,
    esperado: {
      causas: ["computador_da_catraca", "equipamento_da_catraca"],
      exige: [["acionar_academia"]],
      erradas: [{ ferramentas: GATEWAY, emGatewaySemSinal: true }],
    },
  },
  {
    id: "madrugada",
    titulo: "Academia fechada de madrugada (catracas sem sinal há 3 h)",
    hora: 3,
    preparo: `a := pg_temp.org('Simulado Centro');
      perform pg_temp.gw(a, 'Entrada', 'online', 180, 185, 0); perform pg_temp.gw(a, 'Saída', 'online', 178, 185, 0);`,
    esperado: {
      causas: ["internet_da_academia", "computador_da_catraca", "indeterminada"],
      exige: [],
      gravidade: ["baixa", "media"],
      erradas: [{ ferramentas: GATEWAY, emGatewaySemSinal: true }],
    },
  },
  {
    id: "nuvem-lenta",
    titulo: "Nuvem lenta: 3 academias em contingência ao mesmo tempo e rotina com tempo esgotado",
    hora: 18,
    preparo: `a := pg_temp.org('Simulado Centro'); b := pg_temp.org('Simulado Bairro'); c := pg_temp.org('Simulado Shopping');
      g1 := pg_temp.gw(a, 'Entrada', 'contingencia', 0, 3, 6); perform pg_temp.evento(g1, 'contingencia', 16, 'x');
      g2 := pg_temp.gw(b, 'Recepção', 'contingencia', 0, 3, 4); perform pg_temp.evento(g2, 'contingencia', 15, 'x');
      g3 := pg_temp.gw(c, 'Catraca 1', 'contingencia', 0, 3, 9); perform pg_temp.evento(g3, 'contingencia', 17, 'x');
      perform pg_temp.funcao_falhou('alertar-catracas', 'canceling statement due to statement timeout');`,
    esperado: {
      causas: ["nuvem_arke"],
      // Ordem a cada Gateway não resolve nuvem lenta — e o freio a segura.
      exige: [["acionar_suporte_arkefit"]],
      erradas: [{ ferramentas: ["acionar_academia"] }],
    },
  },
  {
    id: "lista-atrasada",
    titulo: "Lista de alunos atrasada com o Gateway no ar",
    hora: 11,
    preparo: `a := pg_temp.org('Simulado Centro'); perform pg_temp.gw(a, 'Entrada', 'online', 0, 45, 0);`,
    esperado: {
      causas: ["nuvem_arke", "computador_da_catraca", "configuracao", "indeterminada"],
      exige: [["sincronizar_gateway", "pedir_diagnostico_gateway"]],
      erradas: [{ ferramentas: ["acionar_academia"], sozinha: true }],
    },
  },
  {
    id: "fila-parada",
    titulo: "Acessos guardados no Gateway sem subir, com a nuvem respondendo",
    hora: 16,
    preparo: `a := pg_temp.org('Simulado Centro'); perform pg_temp.gw(a, 'Entrada', 'online', 0, 2, 37);`,
    esperado: {
      causas: ["computador_da_catraca", "nuvem_arke", "configuracao", "indeterminada"],
      exige: [["reenviar_acessos_gateway", "pedir_diagnostico_gateway"]],
      erradas: [{ ferramentas: ["acionar_academia"], sozinha: true }],
    },
  },
  {
    id: "asaas-fora",
    titulo: "Asaas fora do ar: conferência com erro e avisos de pagamento sem processar",
    hora: 9,
    preparo: `perform pg_temp.conferencia(60, 'HTTP 503 Service Unavailable consultando o Asaas', 0, 0, 0);
      perform pg_temp.aviso_asaas('PAYMENT_CONFIRMED', 40, 'Error: 503'); perform pg_temp.aviso_asaas('PAYMENT_CONFIRMED', 35, 'Error: 503');
      perform pg_temp.aviso_asaas('PAYMENT_OVERDUE', 30, 'Error: 503');`,
    esperado: {
      causas: ["servico_externo"],
      exige: [["reconferir_asaas", "reprocessar_evento_asaas"]],
      erradas: [{ ferramentas: ["acionar_academia", "cancelar_assinatura_orfa"] }],
    },
  },
  {
    id: "email-fora",
    titulo: "Serviço de e-mail fora: três funções que mandam e-mail falhando",
    hora: 12,
    preparo: `perform pg_temp.funcao_falhou('alertar-rotinas', 'Resend recusou HTTP 503');
      perform pg_temp.funcao_falhou('alertar-catracas', 'Resend recusou HTTP 503');
      perform pg_temp.funcao_falhou('lembrete-onboarding', 'Resend recusou HTTP 503');`,
    esperado: {
      causas: ["servico_externo"],
      exige: [["reexecutar_rotina", "acionar_suporte_arkefit"]],
      erradas: [{ ferramentas: ["acionar_academia"] }],
    },
  },
  {
    id: "assinatura-orfa",
    titulo: "Assinatura cobrando no Asaas sem registro no banco",
    hora: 10,
    preparo: `perform pg_temp.conferencia(30, null, 1, 0, 0);`,
    esperado: {
      causas: ["nuvem_arke", "configuracao", "servico_externo", "indeterminada"],
      exige: [["cancelar_assinatura_orfa", "acionar_suporte_arkefit"]],
      erradas: [{ ferramentas: ["acionar_academia"] }],
    },
  },
  {
    id: "banco-cheio",
    titulo: "Banco perto do limite do plano (88%)",
    hora: 10,
    preparo: `update public.plataforma_config set valor = round(pg_database_size(current_database()) / 1048576.0 / 0.88, 1)
       where chave = 'limite_banco_mb';`,
    esperado: {
      causas: ["configuracao", "nuvem_arke"],
      exige: [["acionar_suporte_arkefit"]],
      erradas: [{ ferramentas: [...GATEWAY, "acionar_academia", "reexecutar_rotina"] }],
    },
  },
  {
    id: "falha-isolada",
    titulo: "Uma falha isolada de conexão numa rotina repetível",
    hora: 14,
    preparo: `perform pg_temp.funcao_falhou('alertar-catracas', 'TypeError: fetch failed');`,
    esperado: {
      causas: ["nuvem_arke", "servico_externo", "indeterminada"],
      exige: [["reexecutar_rotina"]],
      gravidade: ["baixa", "media"],
      erradas: [{ ferramentas: ["acionar_academia"] }],
    },
  },
  {
    id: "equipamento",
    titulo: "Catraca no ar, mas cadastros de digital falhando no equipamento",
    hora: 17,
    preparo: `a := pg_temp.org('Simulado Centro'); g1 := pg_temp.gw(a, 'Entrada', 'online', 0, 2, 0);
      perform pg_temp.ordem_falhou(g1, 'cadastrar_digital', 30, 'Equipamento não respondeu (timeout)');
      perform pg_temp.ordem_falhou(g1, 'cadastrar_digital', 20, 'Equipamento não respondeu (timeout)');
      perform pg_temp.ordem_falhou(g1, 'cadastrar_digital', 10, 'Equipamento não respondeu (timeout)');
      perform pg_temp.evento(g1, 'erro', 10, 'controlid: timeout');`,
    esperado: {
      causas: ["equipamento_da_catraca", "computador_da_catraca"],
      exige: [["pedir_diagnostico_gateway", "acionar_academia"]],
      erradas: [{ ferramentas: ["sincronizar_gateway", "reenviar_acessos_gateway"] }],
    },
  },
  {
    id: "misto",
    titulo: "Dois problemas independentes: internet de uma academia e Asaas fora",
    hora: 19,
    preparo: `a := pg_temp.org('Simulado Centro'); b := pg_temp.org('Simulado Bairro');
      perform pg_temp.gw(a, 'Entrada', 'online', 30, 35, 15); perform pg_temp.gw(a, 'Saída', 'online', 29, 35, 9);
      perform pg_temp.gw(b, 'Recepção', 'online', 0, 2, 0);
      perform pg_temp.conferencia(50, 'HTTP 503 Service Unavailable consultando o Asaas', 0, 0, 0);
      perform pg_temp.aviso_asaas('PAYMENT_CONFIRMED', 40, 'Error: 503');`,
    esperado: {
      causas: ["internet_da_academia", "servico_externo", "computador_da_catraca"],
      exige: [["acionar_academia"], ["reconferir_asaas", "reprocessar_evento_asaas"]],
      erradas: [{ ferramentas: GATEWAY, emGatewaySemSinal: true }],
    },
  },
];

// ── Nota de uma resposta ──────────────────────────────────────────────────

// O roteiro manda o modelo complementar as regras, não repeti-las: ação que
// uma regra aberta já cobre conta como atendida.
const REGRA_COBRE = {
  assinatura_orfa: "cancelar_assinatura_orfa",
  rotina_repetivel_falhou: "reexecutar_rotina",
  rotina_sensivel_falhou: "reexecutar_rotina",
  gateway_sincronizacao_atrasada: "sincronizar_gateway",
  gateway_fila_parada: "reenviar_acessos_gateway",
  gateway_contingencia_prolongada: "pedir_diagnostico_gateway",
  reconciliacao_com_erro: "reconferir_asaas",
  webhook_nao_processado: "reprocessar_evento_asaas",
  remocao_biometrica_parada: "reenviar_remocao_digital",
};

function avaliar(cenario, quadro, analise) {
  const e = cenario.esperado;
  const cobertas = new Set(quadro.vigia.map((v) => REGRA_COBRE[v.regra]).filter(Boolean));
  const validas = analise.acoes.filter((a) => !a.recusada);
  const semSinal = new Set(quadro.anomalias.filter((x) => x.tipo === "gateway_sem_sinal").map((x) => x.gateway));
  const erradas = validas.filter((a) =>
    e.erradas.some(
      (r) =>
        r.ferramentas.includes(a.ferramenta) &&
        (!r.emGatewaySemSinal || semSinal.has(a.alvo)) &&
        (!r.sozinha || validas.length === 1),
    ),
  );
  return {
    causa_ok: e.causas.includes(analise.causa_provavel),
    acao_ok: e.exige.every((grupo) => validas.some((a) => grupo.includes(a.ferramenta)) || grupo.some((f) => cobertas.has(f))),
    pela_regra: e.exige.some((grupo) => !validas.some((a) => grupo.includes(a.ferramenta)) && grupo.some((f) => cobertas.has(f))),
    gravidade_ok: !e.gravidade || e.gravidade.includes(analise.gravidade),
    erradas: erradas.map((a) => `${a.ferramenta}→${a.alvo}`),
    recusadas: analise.acoes.filter((a) => a.recusada).map((a) => `${a.ferramenta}→${a.alvo} (${a.recusada})`),
  };
}

// ── Execução ──────────────────────────────────────────────────────────────

// Uma chamada por vez, e espera quando a AWS limita (429): a cota da conta
// para o modelo é baixa, e em paralelo o simulado a esgota em segundos. Em
// produção isso não pesa — o Vigia chama no máximo 4 vezes por hora e, se a
// AWS recusar, registra "indisponível" e tenta de novo depois.
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function consultar(quadro) {
  for (let tentativa = 0; ; tentativa++) {
    const resp = await consultarVigia(env, quadro);
    if (resp.ok || !/429/.test(resp.detalhe) || tentativa >= 5) return resp;
    await dormir(20_000 * (tentativa + 1));
  }
}

const lista = SO ? CENARIOS.filter((c) => c.id === SO) : CENARIOS;
const resultados = [];
for (const c of lista) {
  const [{ r }] = await sql(transacao(c.hora, c.preparo));
  const v = validarQuadro(r.quadro.enviar);
  if (!v.ok) throw new Error(`${c.id}: o banco gerou um quadro que a validação recusa (${v.motivo})`);
  const nomes = r.quadro.mapa;
  const trocar = (t) => (t ?? "").replace(/\b([AG]\d{1,3})\b/g, (m) => nomes[m]?.nome ?? m);
  const rodadas = [];
  for (let n = 0; n < RODADAS; n++) {
    const resp = await consultar(r.quadro.enviar);
    if (!resp.ok) {
      rodadas.push({ falhou: `${resp.motivo}: ${resp.detalhe}` });
      continue;
    }
    const i = interpretarResposta(resp.resposta, v.quadro);
    if (!i.ok) {
      rodadas.push({ falhou: `resposta_invalida: ${i.motivo}` });
      continue;
    }
    rodadas.push({
      ...avaliar(c, v.quadro, i.analise),
      causa: i.analise.causa_provavel,
      gravidade: i.analise.gravidade,
      confianca: i.analise.confianca,
      diagnostico: trocar(i.analise.diagnostico),
      acoes: i.analise.acoes.map((a) => ({ ...a, alvo_nome: nomes[a.alvo]?.nome ?? a.alvo, justificativa: trocar(a.justificativa) })),
      latencia_ms: resp.latenciaMs,
      tokens: [resp.tokensEntrada, resp.tokensSaida],
    });
    await dormir(3_000);
  }
  resultados.push({ id: c.id, titulo: c.titulo, regras: r.regras, anomalias: v.quadro.anomalias.length, rodadas });

  const ok = rodadas.filter((x) => !x.falhou);
  const conta = (f) => ok.filter(f).length;
  console.log(`\n■ ${c.titulo}`);
  console.log(
    `  regras: ${r.regras.length ? r.regras.map((g) => `${g.regra}${g.freio ? " (freio)" : g.agiria ? ` (agiria, ${g.tentativas}ª)` : ""}`).join("; ") : "nenhuma"}`,
  );
  console.log(
    `  IA: causa ${conta((x) => x.causa_ok)}/${ok.length} · ação ${conta((x) => x.acao_ok)}/${ok.length}` +
      (conta((x) => x.pela_regra) ? ` (${conta((x) => x.pela_regra)} deixada à regra)` : "") +
      " · " +
      `sem ação errada ${conta((x) => !x.erradas.length)}/${ok.length}` +
      (c.esperado.gravidade ? ` · gravidade ${conta((x) => x.gravidade_ok)}/${ok.length}` : "") +
      ` · causas ${ok.map((x) => x.causa).join(", ")} · confiança ${ok.map((x) => x.confianca).join("/")}`,
  );
  for (const x of rodadas.filter((x) => x.falhou)) console.log(`  rodada falhou: ${x.falhou}`);
  for (const x of ok.filter((x) => x.erradas.length || x.recusadas.length))
    console.log(`  ! erradas: ${x.erradas.join(", ") || "—"} · recusadas: ${x.recusadas.join(", ") || "—"}`);
}

// ── Totais ────────────────────────────────────────────────────────────────
const todas = resultados.flatMap((c) => c.rodadas.filter((x) => !x.falhou));
const pct = (n) => `${Math.round((100 * n) / Math.max(1, todas.length))}%`;
const certas = todas.filter((x) => x.causa_ok);
const media = (l) => (l.length ? Math.round(l.reduce((s, x) => s + (x.confianca ?? 0), 0) / l.length) : null);
console.log(`\n══ ${todas.length} análises (${RODADAS} por cenário, modelo ${MODELO_VIGIA})`);
console.log(`causa certa ${pct(certas.length)} · ação esperada ${pct(todas.filter((x) => x.acao_ok).length)} · ` +
  `sem ação errada ${pct(todas.filter((x) => !x.erradas.length).length)}`);
const barradas = {};
for (const x of todas) for (const r of x.recusadas) {
  const motivo = r.match(/\(([a-z_]+)\)$/)?.[1] ?? "?";
  barradas[motivo] = (barradas[motivo] ?? 0) + 1;
}
console.log(`barradas pelas travas do catálogo: ${Object.entries(barradas).map(([m, n]) => `${n} ${m}`).join(", ") || "nenhuma"}`);
console.log(`confiança média: ${media(certas)} quando acertou a causa, ${media(todas.filter((x) => !x.causa_ok))} quando errou`);
console.log(`latência média ${Math.round(todas.reduce((s, x) => s + x.latencia_ms, 0) / Math.max(1, todas.length))} ms`);

const porFerramenta = {};
for (const x of todas)
  for (const a of x.acoes.filter((a) => !a.recusada)) {
    const f = (porFerramenta[a.ferramenta] ??= { propostas: 0, erradas: 0, classe: a.classe });
    f.propostas++;
    if (x.erradas.includes(`${a.ferramenta}→${a.alvo}`)) f.erradas++;
  }
console.log("\npor ferramenta (propostas / fora de lugar):");
for (const [n, f] of Object.entries(porFerramenta).sort((p, q) => q[1].propostas - p[1].propostas))
  console.log(`  ${n.padEnd(28)} ${String(f.propostas).padStart(3)} / ${f.erradas}  (${f.classe})`);

if (SAIDA) writeFileSync(SAIDA, JSON.stringify({ modelo: MODELO_VIGIA, rodadas: RODADAS, resultados }, null, 1));
