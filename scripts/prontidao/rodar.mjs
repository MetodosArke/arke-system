// Teste de volume: semeia academias fictícias, cronometra rotinas e telas, e
// desfaz tudo. Ver "Prontidão para 50 academias" no CLAUDE.md.
//
//   ARKE_CHAVES=... node scripts/prontidao/rodar.mjs testes-telas.json 50 400
//   ARKE_CHAVES=... node scripts/prontidao/limpar.mjs
//
// Argumentos: arquivo de testes (ou "so-semente"), academias, alunos por academia.
//
// Tudo roda numa transação que termina sempre numa exceção: nada fica no
// banco, nenhum e-mail sai (os pedidos HTTP do pg_net também são desfeitos).
// A exceção carrega os números, em formato compacto, porque a API corta a
// mensagem perto de mil caracteres. Limites que decidem o tamanho do teste:
//   - a API de gerenciamento corta a chamada em ~125 s, e a semente de 20 mil
//     alunos leva de 60 a 114 s: com 50 × 400, rodar poucos testes por vez;
//   - as linhas desfeitas incham o banco até o vacuum (cada rodada de 50 × 400
//     soma ~170 MB). Por isso o teste recusa começar com o banco acima de
//     150 MB, e `limpar.mjs` roda depois de cada rodada.
import { readFileSync } from "node:fs";
import { sql, tamanhoDoBanco } from "./banco.mjs";

const [modo = "so-semente", orgs = "50", alunos = "400"] = process.argv.slice(2);
const aqui = (arquivo) => new URL(`./${arquivo}`, import.meta.url);
const semente = readFileSync(aqui("semear.sql"), "utf8").replaceAll("{ORGS}", orgs).replaceAll("{ALUNOS}", alunos);
const testes = modo === "so-semente" ? [] : JSON.parse(readFileSync(aqui(modo), "utf8"));

const LIMITE_MB = 150;
const antes = Number(await tamanhoDoBanco()) / 1024 / 1024;
if (antes > LIMITE_MB) {
  console.log(`O banco está com ${Math.round(antes)} MB. Rode limpar.mjs antes: acima de 500 MB o plano gratuito trava em somente leitura.`);
  process.exit(1);
}

// Cada teste: [nome, contexto, sql]. Contexto: cron (sem usuário), sa (Super
// Admin verificado em duas etapas), gestor ou aluno. No sql, %1$L é a
// academia de teste e %2$L um aluno ativo dela.
const casos = testes
  .map(([, ctx, q]) => `
    begin
      perform set_config('request.jwt.claims', case '${ctx}' when 'sa' then v_c_sa when 'gestor' then v_c_gestor when 'aluno' then v_c_aluno else '{}' end, true);
      perform set_config('request.jwt.claim.sub', case '${ctx}' when 'sa' then v_sa::text when 'gestor' then v_gestor::text when 'aluno' then v_aluno_user::text else '' end, true);
      if '${ctx}' <> 'cron' then execute 'set local role authenticated'; end if;
      t0 := clock_timestamp();
      execute format($tq$select count(*) from (${q}) x$tq$, v_org, v_aluno) into n;
      ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
      execute 'reset role';
      res := res || ';' || ms || ':' || n;
    exception when others then
      execute 'reset role';
      res := res || ';E:' || left(replace(sqlerrm, ';', ','), 70);
    end;`)
  .join("\n");

const bloco = `set statement_timeout = '15min';
do $sim$
declare
  res text := '';
  t0 timestamptz; t_semente timestamptz := clock_timestamp();
  n bigint; ms numeric;
  v_sa uuid; v_org uuid; v_gestor uuid; v_aluno uuid; v_aluno_user uuid;
  v_c_sa text; v_c_gestor text; v_c_aluno text;
begin
${semente}
  select id, gestor into v_org, v_gestor from sim_orgs where i = 1;
  select aid, uid into v_aluno, v_aluno_user from sim_alunos where org = v_org and p < 0.7 limit 1;
  v_c_sa := json_build_object('sub', v_sa, 'role', 'authenticated', 'aal', 'aal2')::text;
  v_c_gestor := json_build_object('sub', v_gestor, 'role', 'authenticated', 'aal', 'aal1')::text;
  v_c_aluno := json_build_object('sub', v_aluno_user, 'role', 'authenticated', 'aal', 'aal1')::text;
  res := 'semente ' || round(extract(epoch from clock_timestamp() - t_semente)) || ' s'
      || ', alunos ' || (select count(*) from sim_alunos)
      || ', presencas ' || (select count(*) from public.presencas where organization_id in (select id from sim_orgs))
      || ', treinos ' || (select count(*) from public.registro_treino where organization_id in (select id from sim_orgs))
      || ', acessos ' || (select count(*) from public.acessos_catraca_logs where organization_id in (select id from sim_orgs))
      || ', mensalidades ' || (select count(*) from public.mensalidades where organization_id in (select id from sim_orgs))
      || ', tarefas ' || (select count(*) from public.tarefas where organization_id in (select id from sim_orgs))
      || ', banco ' || pg_size_pretty(pg_database_size(current_database()));
${casos}
  raise exception 'RESULTADO%FIM', res;
end
$sim$;`;

const inicio = Date.now();
try {
  await sql(bloco);
  console.log("Inesperado: o bloco terminou sem a exceção final.");
} catch (e) {
  const m = String(e.message);
  const i = m.indexOf("RESULTADO");
  const f = m.indexOf("FIM", i);
  if (i < 0 || f < 0) {
    console.log(m.includes("524") ? "A API cortou a chamada (~125 s). Rode menos testes por vez ou menos alunos." : m.slice(0, 1500));
  } else {
    const [cabecalho, ...itens] = m.slice(i + 9, f).split(";");
    console.log(cabecalho);
    itens.forEach((it, k) => {
      const nome = testes[k]?.[0] ?? `teste ${k + 1}`;
      if (it.startsWith("E:")) console.log(`   ERRO  ${nome}: ${it.slice(2)}`);
      else {
        const [tempo, linhas] = it.split(":");
        console.log(`${tempo.padStart(7)} ms  ${nome}  (${linhas} linhas)`);
      }
    });
  }
}
console.log(`\n(chamada: ${Math.round((Date.now() - inicio) / 1000)} s). Agora rode limpar.mjs.`);
