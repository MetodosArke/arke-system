import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTA_JA_EXISTE,
  ORIGEM_MATRICULA_PUBLICA,
  ROTA_DEFINIR_SENHA,
  contaJaExiste,
  veioDaTelaAntiga,
} from "../../supabase/functions/matricula-publica/fluxo";
import { MATRICULA_ONLINE_NAO_CONFIRMADA, recusaDaMatriculaOnline } from "../../supabase/functions/convidar-membro/fluxo";

/**
 * Trava da auditoria de 05/10/2026 (achados médios de identidade):
 *
 * - **Pré-sequestro de conta.** A matrícula pública cria a conta com o e-mail
 *   já confirmado, sem prova de posse (superado em 07/10/2026: a conta nasce
 *   sem senha e só fica usável pelo link do e-mail; ver o último bloco
 *   deste arquivo). Criar a academia na Visão Master e
 *   convidar um profissional autônomo ligavam a conta existente como gestora só
 *   pelo e-mail. Agora a conta que já existia entra pendente, e só vira gestão
 *   quando o dono do e-mail define a senha pelo link (que encerra as outras
 *   sessões antes).
 * - **Cadastro aberto.** O "Cadastre-se" do login criava conta sem academia, e
 *   nenhum fluxo do produto o usa.
 * - **Link de acesso pela ArkeFit.** Gerava o link de qualquer pessoa, sem
 *   trava e sem registro, e o link abre uma sessão de verdade como ela.
 * - **Cobrança no perfil simulado.** As funções que deixam o aluno agir por si
 *   gravam pela service role, que o banco não confere.
 */
const RAIZ = join(__dirname, "..", "..");
const FUNCOES = join(RAIZ, "supabase", "functions");
const ler = (...partes: string[]) => readFileSync(join(...partes), "utf8").replace(/\r\n/g, "\n");

function arquivos(dir: string, achados: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) arquivos(caminho, achados);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

describe("a gestão só com o e-mail provado", () => {
  it("criar a academia liga a conta que já existia como gestão pendente, com o link de definir a senha", () => {
    const f = ler(FUNCOES, "criar-organizacao-superadmin", "index.ts");
    expect(f).toMatch(/status: gestorJaExistia \? "pending" : "active"/);
    expect(f).toMatch(/resetPasswordForEmail\(gestorEmail, \{\s+redirectTo: `\$\{siteUrl\}\/#\/auth\/definir-senha`/);
    expect(f).not.toMatch(/signInWithOtp/);
  });

  it("o profissional autônomo com conta existente entra pendente e recebe o link de definir a senha", () => {
    const f = ler(FUNCOES, "convidar-profissional-autonomo", "index.ts");
    const ligar = f.slice(f.indexOf("async function ligarResponsavel"), f.indexOf("async function enviarAviso"));
    const existente = ligar.slice(0, ligar.indexOf("inviteUserByEmail"));
    expect(existente).toMatch(/role: "gestor", status: "pending"/);
    // O perfil da pessoa nasce "active"; o vínculo de gestão, não.
    expect(existente).not.toMatch(/role: "gestor", status: "active"/);
    expect(existente).toMatch(/criarSenha: true/);
  });

  it("a ativação pede a sessão aberta pelo link do e-mail e recusa o perfil simulado", () => {
    const sql = readdirSync(join(RAIZ, "supabase", "migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .map((n) => ler(RAIZ, "supabase", "migrations", n))
      .join("\n");
    const corpo = sql.match(/create or replace function public\.ativar_gestao_pendente\(\)[\s\S]*?\$\$;/g)?.at(-1) ?? "";
    expect(corpo, "a função existe").not.toBe("");
    expect(corpo).toMatch(/public\.sessao_simulada\(\)/);
    expect(corpo).toMatch(/-> 'amr'/);
    expect(corpo).not.toMatch(/'password'/);
    // A gestão e, desde 20261395010000, a equipe: o vínculo pendente de cada uma.
    expect(corpo).toMatch(
      /where m\.user_id = v_uid\s+and m\.role in \('gestor', 'professor', 'nutricionista', 'recepcao'\)\s+and m\.status = 'pending'/,
    );
    expect(corpo).toMatch(/registrar_auditoria/);
  });

  it("as duas telas de senha encerram as outras sessões e ativam, nessa ordem", () => {
    for (const tela of ["DefinirSenha.tsx", "ResetPassword.tsx"]) {
      const t = ler(RAIZ, "src", "pages", "auth", tela);
      expect(t, tela).toMatch(/await depoisDeDefinirASenha\(supabase\)/);
    }
    const lib = ler(RAIZ, "src", "lib", "senhaDefinida.ts");
    expect(lib.indexOf('signOut({ scope: "others" })')).toBeLessThan(lib.indexOf('rpc("ativar_gestao_pendente")'));
  });

  it("a gestão pendente conta como outra academia para a equipe que mexe na conta", () => {
    const f = ler(FUNCOES, "_shared", "alvoNaAcademia.ts");
    expect(f).toMatch(/\.in\("status", \["active", "pending"\]\)/);
  });
});

describe("a equipe só com o e-mail provado (pré-sequestro de conta)", () => {
  const sqlDasMigrations = () =>
    readdirSync(join(RAIZ, "supabase", "migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()
      .map((n) => ler(RAIZ, "supabase", "migrations", n))
      .join("\n");
  const ultima = (sql: string, funcao: string) =>
    sql.match(new RegExp(String.raw`create or replace function public\.${funcao}\([\s\S]*?\$\$;`, "g"))?.at(-1) ?? "";

  it("o cadastro da equipe não escolhe a senha de ninguém nem confirma o e-mail por conta própria", () => {
    const f = ler(FUNCOES, "cadastrar-membro-equipe", "index.ts");
    expect(f).not.toMatch(/\bpassword\s*:/);
    expect(f).not.toMatch(/email_confirm\s*:\s*true/);
    expect(f).not.toMatch(/senha_temporaria|gerarSenhaTemporaria/);
    expect(f).not.toMatch(/auth\.admin\.createUser\(/);
    // E-mail novo: o convite do Auth, com o link de definir a senha.
    expect(f).toMatch(/auth\.admin\.inviteUserByEmail\(email, \{[\s\S]*?redirectTo: linkDefinirSenha/);
    expect(f).toMatch(/linkDoApp\(Deno\.env\.get\("SITE_URL"\), "\/auth\/definir-senha"\)/);
  });

  it("a conta que já existia entra pendente e recebe o link de definir a senha", () => {
    const f = ler(FUNCOES, "cadastrar-membro-equipe", "index.ts");
    const pendente = f.slice(f.indexOf('if (decisao.acao === "pendente")'), f.indexOf("// Sem conta: o convite do Auth."));
    expect(pendente).toMatch(/role: papel, status: "pending"/);
    expect(pendente).not.toMatch(/status: "active"/);
    expect(f).toMatch(/generateLink\(\{\s+type: "recovery"/);
  });

  it("a parceria do autônomo não liga conta existente como ativa", () => {
    const corpo = ultima(sqlDasMigrations(), "convidar_parceiro_autonomo");
    expect(corpo, "a função existe").not.toBe("");
    expect(corpo).toMatch(/v_status := case when v_atual\.status = 'active' then 'active' else 'pending' end;/);
    expect(corpo).not.toMatch(/values \(_organization_id, v_user, v_papel, 'active'\)/);
    expect(corpo).not.toMatch(/status = 'active';/);
  });

  it("o pendente não vira ativo pela API: só pela ativação do link", () => {
    const sql = sqlDasMigrations();
    const gatilho = ultima(sql, "vinculo_pendente_so_pelo_email");
    expect(gatilho).toMatch(/old\.status = 'pending' and new\.status = 'active' and current_user in \('authenticated', 'anon'\)/);
    expect(gatilho, "não é security definer: senão current_user seria o dono dela").not.toMatch(/security definer/);
    expect(sql).toMatch(/create trigger trg_vinculo_pendente_so_pelo_email\s+before update of status on public\.organization_members/);
  });

  it("nenhuma tela mostra nem copia senha de outra pessoa, e o pendente não tem botão de ativar", () => {
    for (const tela of [
      ["src", "pages", "admin", "AdminEquipe.tsx"],
      ["src", "components", "admin", "onboarding", "EtapaEquipe.tsx"],
      ["src", "components", "admin", "ParceriaAutonomo.tsx"],
    ]) {
      const t = ler(RAIZ, ...tela);
      expect(t, tela.at(-1)).not.toMatch(/senha_temporaria|[Ss]enha temporária/);
    }
    expect(ler(RAIZ, "src", "pages", "admin", "AdminEquipe.tsx")).toMatch(/membro\.status === "pending" \|\|/);
    expect(ler(RAIZ, "src", "components", "admin", "FuncionarioPerfilSheet.tsx")).toMatch(/disabled=\{ehVoceMesmo \|\| membro\.status === "pending"\}/);
    // A parceria passa pelo mesmo cadastro, que manda o link; o RPC que ligava na hora sai da tela.
    expect(ler(RAIZ, "src", "components", "admin", "ParceriaAutonomo.tsx")).not.toMatch(/convidar_parceiro_autonomo/);
  });
});

describe("sem cadastro aberto", () => {
  it("nenhuma tela chama o cadastro aberto do Auth, e o login não o oferece", () => {
    const usam = arquivos(join(RAIZ, "src"))
      .filter((c) => /auth\.signUp\(/.test(readFileSync(c, "utf8")))
      .map((c) => relative(RAIZ, c));
    expect(usam).toEqual([]);
    const login = ler(RAIZ, "src", "pages", "auth", "Login.tsx");
    expect(login).not.toMatch(/navigate\("\/auth\/register"\)/);
    expect(ler(RAIZ, "src", "App.tsx")).toMatch(/path="\/auth\/register" element=\{<Navigate to="\/auth\/login" replace \/>\}/);
    // Lê o src inteiro: com a máquina ocupada, passa do prazo padrão de 5 s.
  }, 30_000);
});

describe("link de acesso", () => {
  const f = ler(FUNCOES, "gerar-link-ativacao", "index.ts");
  it("a ArkeFit é só o Super Admin verificado, e as travas valem para ela também", () => {
    expect(f).toMatch(/const callerArkefit = verificada\(claimsData\?\.claims\) && \(callerRoles \?\? \[\]\)\.some\(\(r\) => r\.role === "superadmin"\)/);
    expect(f).not.toMatch(/r\.role === "admin_arke"/);
    // A trava de "nunca entrou" não está dentro de um `if` que a ArkeFit pula.
    expect(f).toMatch(/\n {4}if \(targetUser\.user\.last_sign_in_at\) \{/);
    expect(f).toMatch(/alvoSoNaAcademia\(adminClient, targetUserId, orgDoAlvo\)/);
  });
  it("todo link gerado fica na auditoria antes de sair", () => {
    expect(f).toMatch(/rpc\("registrar_auditoria"/);
    expect(f.indexOf('rpc("registrar_auditoria"')).toBeLessThan(f.lastIndexOf("action_link: `${siteUrl}/cadastro/${code}`"));
  });
});

describe("cobrança no perfil simulado", () => {
  it("toda função em que o aluno age por si confere a sessão simulada", () => {
    const funcoes = readdirSync(FUNCOES).filter((d) => !d.startsWith("_") && statSync(join(FUNCOES, d)).isDirectory());
    const doAluno = funcoes.filter((d) => /\.user_id (===|!==) callerId/.test(ler(FUNCOES, d, "index.ts")));
    expect(doAluno.sort(), "o detector detecta").toEqual(["asaas-assinatura-ciclo", "asaas-cartao-assinatura"]);
    for (const d of doAluno) {
      const f = ler(FUNCOES, d, "index.ts");
      expect(f, d).toMatch(/await sessaoSimulada\(admin, claims\?\.claims\)/);
      expect(f, d).toMatch(/return jsonResponse\(\{ error: MENSAGEM_PERFIL_SIMULADO \}, 403\)/);
    }
  });

  it("a frase é a mesma das outras autorizações", () => {
    const funcao = ler(FUNCOES, "_shared", "sessaoSimulada.ts").match(/MENSAGEM_PERFIL_SIMULADO =\s+"([^"]+)"/)?.[1];
    const tela = ler(RAIZ, "src", "lib", "impersonation.ts").match(/MENSAGEM_PERFIL_SIMULADO =\s+"([^"]+)"/)?.[1];
    expect(funcao).toBeTruthy();
    expect(funcao).toBe(tela);
  });
});

// Decisão de 07/10/2026 ("matrícula pública confirmada"): o último caminho de
// pré-sequestro. A matrícula pública criava a conta com a senha que o
// visitante digitava e o e-mail já confirmado; quem usasse o e-mail e o CPF de
// outra pessoa ficava com a conta, e a matrícula que outra academia fizesse
// depois para a pessoa de verdade se ligava a ela pelo CPF.
describe("a matrícula pública só com o e-mail provado (pré-sequestro de conta)", () => {
  const f = ler(FUNCOES, "matricula-publica", "index.ts");
  const criar = f.slice(f.indexOf("auth.admin.createUser("), f.indexOf("if (createError || !created.user)"));

  it("a conta nasce sem senha, sem o e-mail confirmado e marcada como da matrícula pública", () => {
    expect(criar, "a criação da conta foi achada").toMatch(/auth\.admin\.createUser\(\{/);
    expect(criar).not.toMatch(/\bpassword\b/);
    expect(criar).not.toMatch(/email_confirm/);
    expect(criar).toMatch(/app_metadata: \{ origem: ORIGEM_MATRICULA_PUBLICA \}/);
    expect(ORIGEM_MATRICULA_PUBLICA).toBe("matricula_publica");
    // Nenhum outro jeito de dar senha ou confirmar o e-mail por conta própria.
    expect(f).not.toMatch(/email_confirm\s*:\s*true/);
    expect(f).not.toMatch(/updateUserById\(/);
    expect(f).not.toMatch(/senhaEstaVazada|pwnedpasswords/);
  });

  it("o link de criar a senha sai pelo caminho do primeiro acesso, depois da matrícula gravada", () => {
    expect(f).toMatch(
      /auth\.resetPasswordForEmail\(email, \{\s+redirectTo: linkDoApp\(Deno\.env\.get\("SITE_URL"\), ROTA_DEFINIR_SENHA\),?\s+\}\)/,
    );
    expect(ROTA_DEFINIR_SENHA).toBe("/auth/definir-senha");
    expect(f.indexOf('from("alunos").insert(')).toBeLessThan(f.indexOf("auth.resetPasswordForEmail("));
    expect(f).toMatch(/return jsonResponse\(\{ ok: true, email_enviado: !envioError \}\)/);
  });

  it("a tela antiga, que manda a senha, é recusada antes de criar a conta", () => {
    expect(f.indexOf("if (veioDaTelaAntiga(payload)) return jsonResponse({ error: TELA_ANTIGA }, 400);")).toBeGreaterThan(-1);
    expect(f.indexOf("veioDaTelaAntiga(payload)")).toBeLessThan(f.indexOf("auth.admin.createUser("));
    expect(veioDaTelaAntiga({ email: "a@b.c", password: "123456" })).toBe(true);
    expect(veioDaTelaAntiga({ email: "a@b.c" })).toBe(false);
    expect(veioDaTelaAntiga({ email: "a@b.c", password: "" })).toBe(false);
    expect(veioDaTelaAntiga(null)).toBe(false);
  });

  it("o e-mail que já tem conta continua recusado com 409", () => {
    expect(f).toMatch(/if \(contaJaExiste\(createError\)\) return jsonResponse\(\{ error: CONTA_JA_EXISTE \}, 409\);/);
    expect(contaJaExiste({ code: "email_exists", message: "x" })).toBe(true);
    expect(contaJaExiste({ message: "A user with this email address has already been registered" })).toBe(true);
    expect(contaJaExiste({ code: "unexpected_failure", message: "Database error" })).toBe(false);
    expect(contaJaExiste(null)).toBe(false);
    expect(CONTA_JA_EXISTE).toMatch(/Faça login/);
  });

  it("a tela não pede senha nem entra com ela", () => {
    const t = ler(RAIZ, "src", "pages", "public", "PublicMatricula.tsx");
    expect(t).not.toMatch(/type="password"/);
    expect(t).not.toMatch(/\bsignIn\(/);
    expect(t).not.toMatch(/\bpassword\b/);
    expect(t).toMatch(/Enviamos para o seu e-mail um link para criar a sua senha\./);
  });

  // A conta que nunca confirma: não é usável, mas fica ligada à academia do
  // link com o CPF que alguém digitou (migration 20261403010000).
  const sql = readdirSync(join(RAIZ, "supabase", "migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => ler(RAIZ, "supabase", "migrations", n))
    .join("\n");
  const ultimaFuncao = (nome: string) =>
    sql.match(new RegExp(String.raw`create or replace function public\.${nome}\([\s\S]*?\$\$;`, "g"))?.at(-1) ?? "";

  it("a regra lê a marca que a função grava e a confirmação do e-mail", () => {
    const regra = ultimaFuncao("conta_da_matricula_publica_nao_confirmada");
    expect(regra, "a função existe").not.toBe("");
    expect(regra).toContain(`u.raw_app_meta_data ->> 'origem' = '${ORIGEM_MATRICULA_PUBLICA}'`);
    expect(regra).toMatch(/and u\.email_confirmed_at is null/);
    expect(sql).toMatch(
      /revoke execute on function public\.conta_da_matricula_publica_nao_confirmada\(uuid\) from public, anon, authenticated;/,
    );
  });

  it("a conta não confirmada não recebe aluno de outra academia, por nenhum caminho", () => {
    const gatilho = ultimaFuncao("matricula_publica_sem_outra_academia");
    expect(gatilho).toMatch(/public\.conta_da_matricula_publica_nao_confirmada\(new\.user_id\)/);
    expect(gatilho).toMatch(/a\.organization_id <> new\.organization_id/);
    expect(sql).toMatch(
      /create trigger trg_matricula_publica_sem_outra_academia\s+before insert or update of user_id on public\.alunos/,
    );
    expect(sql).toMatch(/revoke execute on function public\.matricula_publica_sem_outra_academia\(\) from public, anon, authenticated;/);
    // A recusa do banco é reconhecida pela função, que diz o caminho.
    const mensagemDoBanco = gatilho.match(/raise exception '([^']+)'/)?.[1] ?? "";
    expect(recusaDaMatriculaOnline(mensagemDoBanco)).toBe(true);
  });

  it("a matrícula pela academia pergunta antes de ligar pelo CPF", () => {
    const c = ler(FUNCOES, "convidar-membro", "index.ts");
    const conferirCpf = c.indexOf("cpfDigitado !== cpfDaConta");
    const perguntar = c.indexOf('"conta_da_matricula_publica_nao_confirmada"');
    const ligar = c.indexOf(".from(\"organization_members\")", perguntar);
    expect(conferirCpf).toBeGreaterThan(-1);
    expect(perguntar).toBeGreaterThan(conferirCpf);
    expect(ligar).toBeGreaterThan(perguntar);
    expect(c).toMatch(/if \(naoConfirmada === true\) \{\s+return jsonResponse\(\{ error: MATRICULA_ONLINE_NAO_CONFIRMADA \}, 409\);/);
    expect(c).toMatch(/if \(recusaDaMatriculaOnline\(alunoError\.message\)\) \{/);
  });

  it("a rotina apaga só a matrícula que ficou como nasceu, depois de 7 dias", () => {
    const rotina = ultimaFuncao("apagar_matriculas_publicas_nao_confirmadas");
    expect(rotina, "a função existe").not.toBe("");
    for (const condicao of [
      `u.raw_app_meta_data ->> 'origem' = 'matricula_publica'`,
      "u.email_confirmed_at is null",
      "u.last_sign_in_at is null",
      "u.created_at < now() - interval '7 days'",
      "a.identificador_catraca is null",
      "from storage.objects so",
      "and public.aluno_como_nasceu(a.id)",
    ]) {
      expect(rotina, condicao).toContain(condicao);
    }
    // O Auth grava o hash de uma senha aleatória na conta criada sem senha: a
    // senha vazia nunca casa, e a rotina não apagaria nenhuma (20261404).
    expect(rotina).not.toContain("encrypted_password");
    // Falta de permissão aparece como falha da rotina, e não como zero apagadas.
    expect(rotina).toMatch(/when insufficient_privilege then\s+raise;/);
    // O que aponta para o aluno vem do catálogo, e não de uma lista à mão.
    expect(ultimaFuncao("aluno_como_nasceu")).toMatch(/c\.confrelid = 'public\.alunos'::regclass/);
    // A tarefa de ativação que a rotina abre em todo aluno sem primeiro acesso
    // não segura a matrícula enquanto ninguém agiu nela: sem essa exceção, a
    // matrícula não confirmada chega ao sétimo dia com ela e nunca sai.
    const nasceu = ultimaFuncao("aluno_como_nasceu");
    expect(nasceu).toContain("t.origem_evento = 'ativacao_pendente:' || _aluno_id::text");
    expect(nasceu).toMatch(/t\.status = 'aberta'\s+and t\.acao is null\s+and t\.desfecho_acao is null/);
    expect(sql).toMatch(
      /select cron\.schedule\('arke-matriculas-nao-confirmadas', '35 7 \* \* \*', 'select public\.apagar_matriculas_publicas_nao_confirmadas\(\)'\);/,
    );
  });

  it("os 7 dias da rotina são os mesmos que a tela e a mensagem prometem", () => {
    expect(ler(RAIZ, "src", "pages", "public", "PublicMatricula.tsx")).toMatch(/não for criada em 7 dias/);
    expect(MATRICULA_ONLINE_NAO_CONFIRMADA).toMatch(/depois de 7 dias/);
  });
});
