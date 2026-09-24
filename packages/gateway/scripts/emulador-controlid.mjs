#!/usr/bin/env node
/**
 * Emulador de catraca Control iD — faz o papel do equipamento contra um
 * Gateway rodando, sem hardware.
 *
 * A Control iD não tem emulador oficial, e não precisa: o equipamento fala
 * HTTP documentado. Este script envia exatamente o que a catraca envia —
 * a identificação do modo online e, depois da liberação, o aviso de giro do
 * Monitor — e mostra o que o Gateway respondeu. Serve para o ensaio de
 * instalação: confirmar que o Gateway está alcançável, que o aluno cadastrado
 * é liberado e que a presença aparece no ARKE, antes de haver catraca na
 * parede.
 *
 * O que ele NÃO substitui: sentido de giro da borboleta montada, tempo real
 * de acionamento, leitura de digital e variação de firmware. Isso é bancada.
 *
 * Uso:
 *   node scripts/emulador-controlid.mjs --usuario 12
 *   node scripts/emulador-controlid.mjs --usuario 12 --giro desiste
 *   node scripts/emulador-controlid.mjs --usuario 12 --giro nada        (sem Monitor)
 *   node scripts/emulador-controlid.mjs --vivo                           (heartbeat de contingência)
 *   node scripts/emulador-controlid.mjs --servir 8081 [--dedo 2000]      (API de gestão do equipamento)
 *
 * Opções: --gateway http://IP:4571 (padrão 127.0.0.1:4571), --device 935107,
 *         --giro esquerda|direita|desiste|nada (padrão esquerda), --espera 1500
 *
 * Payloads conforme a documentação oficial:
 *   https://www.controlid.com.br/docs/access-api-pt/modos-de-operacao/eventos-de-identificacao-online/
 *   https://www.controlid.com.br/docs/access-api-pt/monitor/introducao-ao-monitor/
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : "1"]);
    return acc;
  }, [])
);
const gateway = (args.gateway ?? "http://127.0.0.1:4571").replace(/\/$/, "");
const deviceId = Number(args.device ?? 935107);
const agora = () => Math.floor(Date.now() / 1000);
const uuid = Math.random().toString(16).slice(2, 10);

// Nomes e código do Monitor. Só o TURN LEFT = 7 está no exemplo oficial; o
// Gateway casa pelo nome, então os outros códigos aqui são ilustrativos.
const GIROS = {
  esquerda: { type: 7, name: "TURN LEFT" },
  direita: { type: 8, name: "TURN RIGHT" },
  desiste: { type: 9, name: "GIVE UP" },
};

async function postar(rota, corpo, tipo = "form") {
  const r = await fetch(`${gateway}${rota}`, {
    method: "POST",
    headers: { "content-type": tipo === "form" ? "application/x-www-form-urlencoded" : "application/json" },
    body: tipo === "form" ? new URLSearchParams(corpo).toString() : JSON.stringify(corpo),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch {}
  return { status: r.status, json, texto };
}

/**
 * --servir PORTA: o outro lado. Em vez de discar para o Gateway, o emulador
 * faz o papel da API de gestão do equipamento — login, usuários, digitais,
 * cartões, cadastro remoto e liberação — para o Gateway 1.0 administrar.
 * Aponte um item de `controlid_equipamentos` do config.json para
 * 127.0.0.1:PORTA (usuário admin, senha admin) e peça pelo ARKE "cadastrar
 * no equipamento", "cadastrar digital", "liberar catraca" ou revogue a
 * biometria: cada chamada aparece aqui, e o estado do "equipamento" é
 * mostrado depois de cada mudança. O dedo é simulado: o cadastro remoto
 * leva --dedo ms (padrão 2000) e grava um template fictício.
 */
async function servirEquipamento(porta) {
  const { createServer } = await import("node:http");
  const tabelas = { users: [], templates: [], cards: [] };
  const sessoes = new Set();
  let proximoId = 1;
  const filtrar = (obj, where) => {
    const cond = where?.[obj] ?? {};
    return tabelas[obj].filter((o) => Object.entries(cond).every(([k, v]) => o[k] === v));
  };
  const resumo = () =>
    `usuários ${JSON.stringify(tabelas.users.map((u) => `${u.id}:${u.name}`))} · digitais ${tabelas.templates.length} · cartões ${tabelas.cards.length}`;

  const rotas = {
    "/login.fcgi": (c) => {
      if (c.login !== "admin" || c.password !== (args.senha ?? "admin")) return [401, { error: "Invalid login or password" }];
      const s = Math.random().toString(36).slice(2);
      sessoes.add(s);
      return [200, { session: s }];
    },
    "/session_is_valid.fcgi": () => [200, { session_is_valid: true }],
    "/load_objects.fcgi": (c) => [200, { [c.object]: filtrar(c.object, c.where).map((o) => (c.fields ? Object.fromEntries(c.fields.map((f) => [f, o[f]])) : o)) }],
    "/create_objects.fcgi": (c) => {
      const ids = c.values.map((v) => {
        const id = typeof v.id === "number" ? v.id : 1000 + proximoId++;
        tabelas[c.object].push({ ...v, id });
        return id;
      });
      return [200, { ids }];
    },
    "/modify_objects.fcgi": (c) => {
      const alvo = filtrar(c.object, c.where);
      alvo.forEach((o) => Object.assign(o, c.values));
      return [200, { changes: alvo.length }];
    },
    "/destroy_objects.fcgi": (c) => {
      const alvo = new Set(filtrar(c.object, c.where));
      tabelas[c.object] = tabelas[c.object].filter((o) => !alvo.has(o));
      return [200, { changes: alvo.size }];
    },
    "/remote_enroll.fcgi": async (c) => {
      console.log(`  (simulando o aluno ${c.user_id} no leitor por ${args.dedo ?? 2000} ms — "${c.msg ?? ""}")`);
      await new Promise((r) => setTimeout(r, Number(args.dedo ?? 2000)));
      if (c.type === "card") {
        const valor = 4294967296 + c.user_id;
        tabelas.cards.push({ id: 1000 + proximoId++, user_id: c.user_id, value: valor });
        return [200, { success: true, user_id: c.user_id, device_id: deviceId, card_value: valor }];
      }
      tabelas.templates.push({ id: 1000 + proximoId++, user_id: c.user_id, finger_position: 0, finger_type: 0, template: "TEMPLATE-FICTICIO" });
      return [200, { success: true, user_id: c.user_id, device_id: deviceId, finger_type: 0, fingerprints: [{ width: 1, height: 1, image: "IMAGEM-FICTICIA" }] }];
    },
    "/cancel_remote_enroll.fcgi": () => [200, {}],
    "/execute_actions.fcgi": (c) => {
      console.log(`  CATRACA LIBERADA REMOTAMENTE: ${JSON.stringify(c.actions)}`);
      return [200, {}];
    },
  };

  createServer(async (req, res) => {
    const [rota, qs] = req.url.split("?");
    let corpo = "";
    for await (const parte of req) corpo += parte;
    let c = {};
    try { c = corpo ? JSON.parse(corpo) : {}; } catch {}
    const sessao = new URLSearchParams(qs ?? "").get("session");
    let status = 404;
    let saida = { error: "rota desconhecida" };
    const antes = resumo();
    if (rota !== "/login.fcgi" && !sessoes.has(sessao)) {
      [status, saida] = [401, { error: "Invalid session" }];
    } else if (rotas[rota]) {
      [status, saida] = await rotas[rota](c);
    }
    console.log(`${new Date().toLocaleTimeString()} ${rota} → ${status}${c.object ? ` (${c.object})` : ""}`);
    if (resumo() !== antes) console.log(`  equipamento: ${resumo()}`);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(saida));
  }).listen(porta, "127.0.0.1", () =>
    console.log(`Equipamento Control iD emulado em http://127.0.0.1:${porta} (login admin / ${args.senha ?? "admin"}). Ctrl+C para sair.`)
  );
}

if (args.servir) {
  await servirEquipamento(Number(args.servir === "1" ? 8081 : args.servir));
} else try {
  if (args.vivo) {
    const r = await postar("/device_is_alive.fcgi", { access_logs: "0" });
    console.log(`device_is_alive → HTTP ${r.status} ${r.status === 200 ? "(a catraca sairia da contingência)" : ""}`);
    process.exit(r.status === 200 ? 0 : 1);
  }

  if (!args.usuario) {
    console.error("Informe --usuario N (o número do aluno no equipamento = identificador_catraca no ARKE).");
    process.exit(2);
  }

  console.log(`Catraca ${deviceId} identificou o usuário ${args.usuario} (uuid ${uuid})…`);
  const t0 = Date.now();
  const id = await postar("/new_user_identified.fcgi", {
    device_id: String(deviceId), identifier_id: "0", event: "7", user_id: String(args.usuario),
    portal_id: "1", uuid, time: String(agora()), duress: "0",
  });
  const ms = Date.now() - t0;
  const res = id.json?.result;
  if (!res) {
    console.error(`Resposta inesperada do Gateway (HTTP ${id.status}): ${id.texto.slice(0, 200)}`);
    process.exit(1);
  }
  const liberado = res.event === 7 && (res.actions ?? []).some((a) => a.action === "catra");
  console.log(`  → ${liberado ? "LIBERADO" : "NEGADO"} em ${ms} ms  (event ${res.event}${res.user_name ? `, ${res.user_name}` : ""})`);
  if (liberado) console.log(`    ação: ${res.actions.map((a) => `${a.action} ${a.parameters}`).join("; ")}`);
  if (ms > 1000) console.log("    atenção: acima de 1 s, a fila na catraca em horário de pico sente.");

  const giro = args.giro ?? "esquerda";
  if (!liberado || giro === "nada") process.exit(0);
  if (!GIROS[giro]) { console.error(`--giro inválido: ${giro}`); process.exit(2); }

  await new Promise((r) => setTimeout(r, Number(args.espera ?? 1500)));
  const ev = await postar("/api/notifications/catra_event",
    { event: { ...GIROS[giro], time: agora(), uuid }, device_id: deviceId, time: agora() }, "json");
  console.log(`Monitor avisou ${GIROS[giro].name} → HTTP ${ev.status}`);
} catch (e) {
  console.error(`Não foi possível falar com o Gateway em ${gateway}: ${e.message}`);
  console.error("Confira se ele está rodando e se a porta (escuta_porta) está aberta na rede.");
  process.exit(1);
}
