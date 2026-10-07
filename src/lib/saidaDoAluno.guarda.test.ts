import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caminhoDaUrlPublica } from "../../supabase/functions/_shared/arquivosDoAluno";
import { regrasVigentes, textosDaReconstrucao, ultimaPermissao } from "../../scripts/migracao/regras.mjs";

/**
 * Trava da decisão de 06/10/2026 (auditoria de prontidão, D1): a saída do
 * aluno age sobre a academia que pede, e não sobre a pessoa.
 *
 * Antes, `excluir-aluno` apagava a conta de login, e a cascata levava a
 * matrícula e o histórico da pessoa em todas as academias; `anonimizar-aluno`
 * trocava o perfil e o login, que são da pessoa, e anonimizava só nome, CPF e
 * telefone. O trabalho do banco mora em `anonimizar_dados_do_aluno` e
 * `excluir_aluno_da_academia`.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");

const ler = (...partes: string[]) => readFileSync(join(...partes), "utf8");
const HISTORICO = join(RAIZ, "supabase", "historico");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ nome: f, sql: ler(MIGRATIONS, f).toLowerCase() }));
// Algumas tabelas nasceram por fora das migrations e só aparecem no retrato
// fiel de como o banco foi construído (`supabase/historico/`).
const historico = readdirSync(HISTORICO)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ({ nome: f, sql: ler(HISTORICO, f).toLowerCase() }));

/** A última definição de uma função, entre todas as migrations. */
function ultimaDefinicao(funcao: string): string {
  const re = new RegExp(`create or replace function public\\.${funcao}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "g");
  let ultima = "";
  for (const m of migrations) for (const achado of m.sql.match(re) ?? []) ultima = achado;
  return ultima;
}

/**
 * Os métodos encadeados depois de cada `.from("<tabela>")` do código: em
 * `.from("alunos").select("id").eq("id", x)`, `["select", "eq"]`. Segue a
 * corrente pelos parênteses equilibrados, e não até o `;`, que o código sem
 * ponto e vírgula não tem.
 */
function metodosDaCorrente(texto: string, tabela: string): string[][] {
  const correntes: string[][] = [];
  for (const m of texto.matchAll(new RegExp(String.raw`\.from\(\s*["'\`]${tabela}["'\`]\s*\)`, "g"))) {
    const metodos: string[] = [];
    let i = (m.index ?? 0) + m[0].length;
    for (;;) {
      const proximo = /^\s*\.\s*(\w+)\s*\(/.exec(texto.slice(i));
      if (!proximo) break;
      metodos.push(proximo[1]);
      i += proximo[0].length;
      for (let nivel = 1; i < texto.length && nivel > 0; i++) {
        if (texto[i] === "(") nivel++;
        else if (texto[i] === ")") nivel--;
      }
    }
    correntes.push(metodos);
  }
  return correntes;
}

/** Tabelas com coluna `aluno_id`, pelas migrations (criadas e não apagadas). */
function tabelasComAluno(): Set<string> {
  const tabelas = new Set<string>();
  for (const m of [...historico, ...migrations]) {
    for (const c of m.sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/g)) {
      if (/\baluno_id\b/.test(c[2])) tabelas.add(c[1]);
    }
    for (const c of m.sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)\s+add column (?:if not exists )?aluno_id\b/g)) {
      tabelas.add(c[1]);
    }
    for (const c of m.sql.matchAll(/drop table (?:if exists )?(?:public\.)?(\w+)/g)) tabelas.delete(c[1]);
  }
  return tabelas;
}

/**
 * O que fica depois da anonimização, e por quê. Tabela nova com `aluno_id`
 * entra aqui (com o motivo) ou na função `anonimizar_dados_do_aluno`.
 */
const FICAM: Record<string, string> = {
  aluno_assinaturas: "registro financeiro do Método, guardado pelo prazo legal",
  aluno_matriculas_academia: "registro financeiro do plano da academia",
  mensalidades: "registro financeiro",
  cobrancas_avulsas: "registro financeiro",
  notas_fiscais: "registro fiscal",
  staff_comissoes_lancamentos: "comissão da equipe, registro contábil",
  presencas: "com o aluno anonimizado, vira só contagem",
  tarefas: "registro do atendimento da equipe",
  gateway_comandos: "a ordem de tirar a digital do equipamento precisa rodar depois",
  remocoes_fim_de_matricula: "a remoção agendada confere o aluno antes de rodar, e a anonimização já agenda a dela",
  responsavel_aceites:
    "prova do aceite do responsável legal do aluno menor (nome, e-mail, versão e hash do texto), guardada como o termo da digital",
  responsavel_pedidos:
    "registro do pedido ao responsável e da resposta dele, que prova o caminho do consentimento; com o aluno anonimizado, o link para de valer",
  asaas_saida_pendente:
    "a pendência de anonimizar o cadastro no Asaas quando ele falhou na saída; sem dado pessoal, e sai quando a rotina conclui",
  asaas_clientes_academia:
    "só o id do cliente na conta Asaas da academia (cobrança na conta da academia), sem dado pessoal; liga as cobranças pagas a quem pagou, e o cadastro de lá é anonimizado pela saída no Asaas",
};

describe("saída do aluno", () => {
  it("a anonimização alcança toda tabela com dado do aluno, ou diz por que ela fica", () => {
    const corpo = ultimaDefinicao("anonimizar_dados_do_aluno");
    expect(corpo, "a função existe").not.toBe("");
    const tabelas = tabelasComAluno();
    expect(tabelas.size, "o detector detecta").toBeGreaterThan(30);
    const esquecidas = [...tabelas].filter((t) => !FICAM[t] && !new RegExp(`public\\.${t}\\b`).test(corpo)).sort();
    expect(esquecidas, "trate na função ou explique em FICAM").toEqual([]);
  });

  it("a anonimização mexe no perfil e no login só sem outro vínculo", () => {
    const corpo = ultimaDefinicao("anonimizar_dados_do_aluno");
    expect(corpo).toMatch(/if not v_outros then\s+update public\.profiles/);
    const funcao = ler(FUNCOES, "anonimizar-aluno", "index.ts");
    expect(funcao).not.toMatch(/from\("profiles"\)/);
    expect(funcao).toMatch(/rpc\("anonimizar_dados_do_aluno"/);
    expect(funcao).toMatch(/if \(!outrosVinculos\) \{\s+const \{ error: authUpdateError \} = await adminClient\.auth\.admin\.updateUserById/);
    expect(funcao.match(/updateUserById/g)?.length).toBe(1);
  });

  it("excluir de vez é só academia em teste, e a conta só sai sem outro vínculo", () => {
    const corpo = ultimaDefinicao("excluir_aluno_da_academia");
    expect(corpo).toMatch(/v_org_status is distinct from 'trial'/);
    const funcao = ler(FUNCOES, "excluir-aluno", "index.ts");
    expect(funcao).toMatch(/orgDoAluno\?\.status !== "trial"/);
    expect(funcao).toMatch(/if \(resultado\.apagar_conta\) \{\s+const \{ error: contaError \} = await adminClient\.auth\.admin\.deleteUser/);
    expect(funcao.match(/deleteUser/g)?.length).toBe(1);
    expect(funcao.indexOf('rpc("excluir_aluno_da_academia"')).toBeLessThan(funcao.indexOf("deleteUser"));
  });

  it("a saída anonimiza o cliente no Asaas antes do banco, e não trava se o Asaas falhar", () => {
    // Decisão de 06/10/2026: o CPF ainda está no perfil antes do banco, e o
    // direito da pessoa não espera o gateway — a pendência fica para a rotina.
    for (const [nome, rpcDoBanco] of [
      ["anonimizar-aluno", 'rpc("anonimizar_dados_do_aluno"'],
      ["excluir-aluno", 'rpc("excluir_aluno_da_academia"'],
    ]) {
      const funcao = ler(FUNCOES, nome, "index.ts");
      const chamada = funcao.indexOf("anonimizarClienteNaSaida(adminClient, aluno");
      expect(chamada, `${nome} chama a anonimização no Asaas`).toBeGreaterThan(0);
      expect(chamada, `${nome}: antes do banco`).toBeLessThan(funcao.indexOf(rpcDoBanco));
      // O desfecho vai na resposta, e nenhum `return` depende dele.
      expect(funcao, nome).not.toMatch(/if\s*\(\s*asaas[^)]*\)\s*\{?\s*return/);
      expect(funcao, nome).toMatch(/cadastro_no_asaas: asaas\.situacao === "anonimizado"/);
    }
    const anonimizar = ler(FUNCOES, "anonimizar-aluno", "index.ts");
    expect(anonimizar.indexOf("anonimizarClienteNaSaida(")).toBeLessThan(anonimizar.indexOf("updateUserById"));
    const saida = ler(FUNCOES, "_shared", "saidaAsaas.ts");
    expect(saida).toMatch(/rpc\("registrar_saida_asaas_pendente"/);
    const todas = migrations.map((m) => m.sql).join("\n");
    expect(todas, "a rotina que tenta de novo").toMatch(/cron\.schedule\(\s*'arke-saida-asaas'[\s\S]*?functions\/v1\/retentar-saida-asaas/);
  });

  it("a eliminação da academia anonimiza o cliente no Asaas antes das contas e da organização", () => {
    // Auditoria de prontidão, 06/10/2026 (20261396010000): eliminar a academia
    // apagava os alunos sem passar pelo Asaas.
    const funcao = ler(FUNCOES, "encerramento-organizacao", "index.ts");
    const eliminacao = funcao.slice(funcao.indexOf("async function executarEliminacao"), funcao.indexOf("type EmCurso"));
    const passo = eliminacao.indexOf("anonimizarClientesDaEliminacao(admin, enc");
    expect(passo, "o passo do Asaas está na eliminação").toBeGreaterThan(0);
    expect(passo, "antes de apagar as contas (o CPF está no perfil)").toBeLessThan(eliminacao.indexOf("auth.admin.deleteUser("));
    expect(passo, "antes de apagar a organização").toBeLessThan(eliminacao.indexOf('rpc("eliminar_organizacao"'));
    expect(eliminacao).toMatch(/if \(!asaas\.concluido\) throw new SemTempo\(/);
    // O banco recusa eliminar sem o passo, mesmo com uma versão antiga da função publicada.
    expect(ultimaDefinicao("eliminar_organizacao")).toMatch(/if v_enc\.asaas_concluido_em is null then\s+raise exception/);
    // Só a conta da ArkeFit: a conta Asaas da academia é dela.
    expect(ler(FUNCOES, "_shared", "saidaAsaas.ts")).toMatch(/contaDaAcademia: false, cpf: a\.cpf/);
  });

  it("a pendência do Asaas sobrevive à eliminação da academia", () => {
    const todas = [...historico, ...migrations].map((m) => m.sql).join("\n");
    const tabela = todas.match(/create table if not exists public\.asaas_saida_pendente \(([\s\S]*?)\n\);/)?.[1] ?? "";
    expect(tabela, "a tabela existe").not.toBe("");
    // Sem chave estrangeira: nem a organização nem o aluno levam a pendência na cascata.
    expect(tabela).not.toMatch(/references/);
    expect(todas).not.toMatch(/alter table (?:only )?public\.asaas_saida_pendente\s+add (?:constraint \w+ )?foreign key/);
    expect(todas).not.toMatch(/delete from public\.asaas_saida_pendente/);
    // O que a nova tentativa precisa quando a organização já não existe.
    expect(todas).toMatch(/add column if not exists ambiente text/);
    expect(todas).toMatch(/add column if not exists conta_da_academia boolean not null default true/);
  });

  it("nenhum usuário logado chama as funções de saída", () => {
    const todas = migrations.map((m) => m.sql).join("\n");
    for (const f of ["anonimizar_dados_do_aluno", "excluir_aluno_da_academia", "pessoa_tem_outro_vinculo"]) {
      expect(todas).toMatch(new RegExp(`revoke execute on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`));
      expect(todas).not.toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to [^;]*authenticated`));
    }
  });

  it("o aluno só sai pela saída: ninguém o exclui pela API (frente D, 07/10/2026)", () => {
    // 20261408010000: a regra de exclusão era `is_org_staff`, e a recepção
    // apagava o aluno com um DELETE; a cascata levava tudo sem o Asaas, os
    // arquivos e a auditoria da saída.
    const textos = textosDaReconstrucao();
    const excluem = [...regrasVigentes(textos, "public.alunos")].filter(
      ([, r]) => !r.restritiva && (r.comando === "delete" || r.comando === "all"),
    );
    expect(excluem.map(([nome]) => nome), "regra que deixa excluir o aluno").toEqual([]);
    // Sem a permissão, o pedido é recusado (42501), e não respondido com 200 e zero linhas.
    for (const papel of ["authenticated", "anon"]) {
      expect(ultimaPermissao(textos, "alunos", "delete", papel), papel).toMatch(new RegExp(`^revoke\\b.*\\bfrom\\b.*\\b${papel}\\b`));
    }
  });

  it("o leitor acha a exclusão do aluno devolvida (a trava trava)", () => {
    const textos = textosDaReconstrucao();
    expect(ultimaPermissao([...textos, "grant select, delete on public.alunos to authenticated;"], "alunos", "delete")).toMatch(/^grant\b/);
    expect(ultimaPermissao([...textos, "grant all on table alunos to anon, authenticated;"], "alunos", "delete", "anon")).toMatch(/^grant all\b/);
    // A tabela vizinha não conta.
    expect(ultimaPermissao([...textos, "grant delete on public.alunos_x to authenticated;"], "alunos", "delete")).toMatch(/^revoke\b/);
    const regra = regrasVigentes(
      [...textos, `create policy "exclusão" on public.alunos for delete to authenticated using (true);`],
      "public.alunos",
    );
    expect([...regra].filter(([, r]) => !r.restritiva && r.comando === "delete").map(([nome]) => nome)).toEqual(["exclusão"]);
  });

  it("nenhuma tela nem função apaga o aluno direto, fora da saída", () => {
    const codigo = (dir: string): { arquivo: string; texto: string }[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const caminho = join(dir, d.name);
        if (d.isDirectory()) return d.name === "node_modules" ? [] : codigo(caminho);
        return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [{ arquivo: caminho, texto: ler(caminho) }] : [];
      });
    const apagam = [...codigo(join(RAIZ, "src")), ...codigo(FUNCOES)]
      .filter(({ texto }) => metodosDaCorrente(texto, "alunos").some((metodos) => metodos.includes("delete")))
      .map(({ arquivo }) => arquivo.slice(RAIZ.length + 1).replace(/\\/g, "/"));
    expect(apagam).toEqual([]);
    // O detector detecta: a corrente em várias linhas, com filtro antes do delete.
    const plantado = `await supabase\n  .from("alunos")\n  .select("id")\n  .eq("id", x);\nawait db.from('alunos').eq("organization_id", o).delete().eq("id", a)\nconst y = 1`;
    expect(metodosDaCorrente(plantado, "alunos")).toEqual([["select", "eq"], ["eq", "delete", "eq"]]);
  });

  it("a URL pública do Storage vira bucket e caminho; o resto é ignorado", () => {
    expect(caminhoDaUrlPublica("https://x.supabase.co/storage/v1/object/public/feed-images/org/a%20b.jpg")).toEqual({
      bucket: "feed-images",
      caminho: "org/a b.jpg",
    });
    expect(caminhoDaUrlPublica("https://exemplo.com/foto.jpg")).toBeNull();
  });
});

describe("acesso da equipe", () => {
  it("editar a equipe recusa aluno como alvo", () => {
    const funcao = ler(FUNCOES, "editar-membro-equipe", "index.ts");
    expect(funcao).toMatch(/if \(!PAPEIS_VALIDOS\.has\(targetMembership\.role/);
    expect(funcao.indexOf("PAPEIS_VALIDOS.has(targetMembership.role")).toBeLessThan(funcao.indexOf("updateUserById"));
  });

  it("o resumo da anamnese segue a separação do Método, e a recepção fica de fora", () => {
    const funcao = ler(FUNCOES, "sentinela-anamnese", "index.ts");
    expect(funcao).toMatch(/const equipe = \["gestor", "professor", "nutricionista"\]\.includes/);
    expect(funcao).toMatch(/if \(noMetodo \? !arkefit : !equipe\)/);
  });
});
