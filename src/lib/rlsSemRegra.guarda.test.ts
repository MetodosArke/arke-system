import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tabelasDoRepositorio, tabelasDosTextos } from "../../scripts/migracao/tabelas.mjs";
import { arquivosDaReconstrucao, lerTexto } from "../../scripts/migracao/rotinas.mjs";

/**
 * Tabela com o RLS ligado e sem regra nenhuma (frente D, 07/10/2026).
 *
 * O RLS ligado sem regra recusa tudo a quem usa a API (`anon` e
 * `authenticated`): só a service role (as edge functions) e as funções
 * `security definer` leem e gravam. É o desenho certo para tabela que é só do
 * servidor (o token do webhook, o freio, a numeração da catraca, o segredo do
 * QR). E é o defeito silencioso de uma tabela que a tela precisa ler: a
 * consulta não dá erro, volta vazia. O advisor do Supabase acusa as duas do
 * mesmo jeito (`rls_enabled_no_policy`).
 *
 * Por isso cada uma está aqui com o motivo, conferido no texto da migration
 * que a criou. Tabela nova com o RLS ligado e sem regra entra na lista (com o
 * motivo) ou ganha a regra que a tela precisa.
 */
const SEM_REGRA: Record<string, string> = {
  alertas_catracas: "o \"já avisei\" do alerta de catraca fora do ar; só as funções do alerta leem e gravam (20261251)",
  alertas_rotinas: "o \"já avisei\" do alerta de rotinas, tabela da plataforma; só a service role da edge function (20261204)",
  asaas_webhook_academia: "o hash do token do webhook da conta da academia; só a service role (20261391)",
  asaas_webhook_events: "o registro e a idempotência dos avisos do Asaas; só a service role do webhook (fase 5)",
  execucoes_agendadas: "o desfecho de cada função agendada; só as funções security definer do alerta (20261248)",
  fotos_rosto_pendentes: "a foto do rosto até o Gateway cadastrar; ninguém lê pela API, a ordem vai pela service role (20261310)",
  freio_chamadas: "o freio por chamada; só a service role, depois de a edge function conferir quem chama (20261321)",
  ia_chamadas: "o uso da IA, sem texto; a edge function grava e a Visão Master lê por get_superadmin_uso_ia() (20261333)",
  ia_precos: "a tabela de preços da IA; lida por get_superadmin_uso_ia() (20261333)",
  links_ativacao: "o link curto de ativação; só as edge functions gerar-link-ativacao e ativar-cadastro, com a service role (20261009)",
  matricula_publica_tentativas: "o limite de tentativas da matrícula pública; só a edge function, pelas funções do limite (20261127)",
  organizacao_encerramento_avisos: "a reserva do aviso a cada aluno no encerramento; só a service role (20261371)",
  organizacao_numeracao_catraca: "o contador do número do aluno nos equipamentos; só proximo_identificador_catraca (20261314)",
  organizacao_segredo_checkin: "o segredo do QR do check-in; se o aluno lesse, calcularia o código de casa (20261212)",
  registros_acesso_aplicacao: "os registros de acesso do Marco Civil; só o gatilho do login e a limpeza (20261380)",
  registros_acesso_preservacoes: "a ordem judicial de preservação, registrada pela ArkeFit por SQL (20261381)",
  sessoes_simuladas: "o id da sessão do perfil simulado; impersonar-perfil grava, e sessao_simulada() lê (20261323)",
  vigia_varreduras_dia: "a contagem diária de varreduras do Vigia; só as funções dele (20261272)",
};

const semRegraQueLibere = (tabelas: ReturnType<typeof tabelasDoRepositorio>["tabelas"]) =>
  [...tabelas]
    .filter(([, t]) => t.rls && ![...t.regras.values()].some((r) => !r.restritiva))
    .map(([nome]) => nome)
    .sort();

const RAIZ = join(__dirname, "..", "..");

/** Os arquivos .ts e .tsx da tela, sem os testes. */
function codigoDaTela(dir: string): { arquivo: string; texto: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const caminho = join(dir, d.name);
    if (d.isDirectory()) return codigoDaTela(caminho);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [{ arquivo: caminho, texto: readFileSync(caminho, "utf8") }] : [];
  });
}

describe("tabela com RLS ligado e sem regra", () => {
  const { tabelas } = tabelasDoRepositorio();

  it("as tabelas foram achadas", () => {
    expect(tabelas.size).toBeGreaterThan(120);
  });

  it("toda tabela do public nasce com o RLS ligado", () => {
    expect([...tabelas].filter(([, t]) => !t.rls).map(([nome]) => nome)).toEqual([]);
  });

  it("toda tabela com o RLS ligado e sem regra está na lista, com o motivo", () => {
    expect(semRegraQueLibere(tabelas)).toEqual(Object.keys(SEM_REGRA).sort());
    for (const [tabela, motivo] of Object.entries(SEM_REGRA)) expect(motivo.length, tabela).toBeGreaterThan(20);
  });

  it("nenhuma tela lê uma tabela da lista: a consulta voltaria vazia", () => {
    const lidas = codigoDaTela(join(RAIZ, "src")).flatMap(({ arquivo, texto }) =>
      Object.keys(SEM_REGRA)
        .filter((t) => new RegExp(String.raw`\.from\(\s*["'\`]${t}["'\`]\s*\)`).test(texto))
        .map((t) => `${arquivo.slice(RAIZ.length + 1).replace(/\\/g, "/")}: ${t}`),
    );
    expect(lidas).toEqual([]);
  });

  it("o leitor acha a tabela nova sem regra, e a regra segue a troca de nome (a trava trava)", () => {
    const textos = arquivosDaReconstrucao().map((a) => lerTexto(join(RAIZ, a)));
    const nova = tabelasDosTextos([
      ...textos,
      `create table public.tabela_nova (id uuid primary key);
       alter table public.tabela_nova enable row level security;
       create table if not exists public.outra_nova (id uuid primary key);
       alter table public.outra_nova enable row level security;
       create policy "duas etapas" on public.outra_nova as restrictive for all to authenticated using (true);
       create table public.antes (id uuid primary key);
       alter table public.antes enable row level security;
       create policy leitura on public.antes for select to authenticated using (true);
       alter table public.antes rename to depois;
       create table public.sem_rls (id uuid primary key);`,
    ]).tabelas;
    // A regra restritiva sozinha não libera nada.
    expect(semRegraQueLibere(nova)).toEqual([...Object.keys(SEM_REGRA), "outra_nova", "tabela_nova"].sort());
    expect([...nova.get("depois")!.regras.keys()]).toEqual(["leitura"]);
    expect([...nova].filter(([, t]) => !t.rls).map(([nome]) => nome)).toEqual(["sem_rls"]);
    // A regra apagada volta a deixar a tabela sem regra.
    const apagada = tabelasDosTextos([...textos, `drop policy if exists "leitura" on public.leads_comerciais_mensagens;`]).tabelas;
    expect(semRegraQueLibere(apagada)).toContain("leads_comerciais_mensagens");
  });
});
