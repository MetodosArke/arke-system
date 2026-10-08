import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { regrasVigentes, textosDaReconstrucao, ultimaPermissao } from "../../scripts/migracao/regras.mjs";

/**
 * A equipe da ArkeFit entra por convite de um sócio verificado, a conta nasce
 * sem senha, e tirar o acesso nunca tira o último sócio (08/10/2026,
 * migration 20261421010000 e `equipe-arkefit-convidar`).
 *
 * Até aqui as contas da ArkeFit nasciam direto no banco, e as regras de
 * `user_roles` deixavam o Admin ARKE com as duas etapas se dar `superadmin`
 * pela API (e tirar o papel dos sócios). O convite passou a ser o único
 * caminho, e esta guarda cobra as peças que o fazem seguro:
 *   - quem chama a função é sócio (`superadmin`, lido do banco) com a sessão
 *     verificada, antes de qualquer conta nascer;
 *   - e-mail que já tem conta é recusado (o pré-sequestro), e a conta nova
 *     nasce pelo convite do Auth, sem senha;
 *   - o convite e a retirada vão para a auditoria sem e-mail, e os outros
 *     sócios recebem o aviso;
 *   - o banco recusa tirar o próprio acesso e o do último sócio, e nunca
 *     fica sem `superadmin`;
 *   - ninguém escreve em `user_roles` pela API.
 */
const RAIZ = join(__dirname, "..", "..");
// Sem o \r do Windows (o checkout com autocrlf): os marcos abaixo são de uma linha só.
const FUNCAO = readFileSync(join(RAIZ, "supabase", "functions", "equipe-arkefit-convidar", "index.ts"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const textos = textosDaReconstrucao().map((t) => t.replace(/\r\n/g, "\n"));

function definicaoVigente(sqls: string[], nome: string): string {
  const re = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of sqls) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima.replace(/--[^\n]*/g, "");
}

/** O trecho da função entre dois marcos do código (o ramo de uma ação). */
function ramo(de: string, ate: string): string {
  const i = FUNCAO.indexOf(de);
  const j = ate ? FUNCAO.indexOf(ate, i + de.length) : FUNCAO.length;
  return i < 0 ? "" : FUNCAO.slice(i, j < 0 ? FUNCAO.length : j);
}

// ── Detectores, usados contra o código de verdade e contra os defeitos plantados ──

/** A função decide pelo sócio verificado, e recusa antes da primeira conta, link ou retirada. */
function exigeSocioVerificado(codigo: string): boolean {
  const decide = /const socio = verificada\(claims\) && \(papeis \?\? \[\]\)\.some\(\(p\) => p\.role === "superadmin"\);/.exec(codigo);
  const recusa = codigo.indexOf("if (!socio) return jsonResponse({ error: SO_SOCIO }, 403);");
  const primeiraAcao = Math.min(
    ...["inviteUserByEmail(", "generateLink(", '"retirar_acesso_equipe_arkefit"', '"gravar_convite_equipe_arkefit"'].map((m) => {
      const i = codigo.indexOf(m);
      return i < 0 ? Infinity : i;
    }),
  );
  const papelDoBanco = /admin\.from\("user_roles"\)\.select\("role"\)\.eq\("user_id", callerId\)/.test(codigo);
  return !!decide && papelDoBanco && recusa > decide.index && recusa < primeiraAcao;
}

/** O ramo do convite recusa a conta que existe antes do convite, e nunca cria conta com senha. */
function convidaSoContaNova(codigo: string): string[] {
  const problemas: string[] = [];
  const conferencia = codigo.indexOf('admin.rpc("conta_por_email"');
  const recusa = codigo.indexOf("return jsonResponse({ error: JA_TEM_CONTA }, 409);", conferencia);
  const convite = codigo.indexOf("inviteUserByEmail(");
  if (conferencia < 0 || recusa < 0 || convite < 0 || !(conferencia < recusa && recusa < convite)) {
    problemas.push("a conta que existe não é recusada antes do convite");
  }
  if (!/if \(emailJaCadastrado\(conviteError\)\) return jsonResponse\(\{ error: JA_TEM_CONTA \}, 409\);/.test(codigo)) {
    problemas.push("o convite que acha a conta no meio do caminho não é recusado");
  }
  if (/createUser\(|\bpassword\b|email_confirm/.test(codigo)) problemas.push("a conta pode nascer com senha ou com o e-mail confirmado");
  if (/from\("user_roles"\)\s*\.(insert|upsert|update|delete)\(/.test(codigo)) problemas.push("a função grava papel direto, fora do convite gravado no banco");
  return problemas;
}

/** As duas regras da retirada, no banco: nunca o próprio acesso, nunca o último sócio ativo. */
function retiradaSegura(definicao: string): string[] {
  const d = definicao.toLowerCase().replace(/\s+/g, " ");
  const problemas: string[] = [];
  if (!/security definer/.test(d)) problemas.push("não é security definer");
  if (!/if not public\.has_role\(v_ator, 'superadmin'\)/.test(d)) problemas.push("não confere o sócio verificado (has_role)");
  if (!/if _user_id is null or _user_id = v_ator then raise exception/.test(d)) problemas.push("tira o próprio acesso");
  if (!/r\.role = 'superadmin' and r\.user_id <> _user_id and public\.estado_conta_arkefit\(r\.user_id\) = 'ativo'/.test(d)) {
    problemas.push("tira o último sócio ativo");
  }
  if (!/delete from auth\.sessions where user_id = _user_id/.test(d)) problemas.push("não encerra as sessões");
  if (!/'equipe_arkefit\.acesso_retirado'/.test(d)) problemas.push("não vai para a auditoria");
  return problemas;
}

/** As regras e as permissões que deixam alguém escrever em user_roles pela API. */
function escritaPelaApi(sqls: string[]): string[] {
  const regras = [...regrasVigentes(sqls, "public.user_roles")].filter(([, r]) => !r.restritiva && r.comando !== "select");
  const achados = regras.map(([nome, r]) => `regra "${nome}" (${r.comando})`);
  for (const privilegio of ["insert", "update", "delete"]) {
    for (const papel of ["authenticated", "anon"]) {
      const ultima = ultimaPermissao(sqls, "user_roles", privilegio, papel);
      if (!/^revoke\b/.test(ultima)) achados.push(`${papel} com ${privilegio} (${ultima || "o padrão do Supabase"})`);
    }
  }
  return achados;
}

describe("a equipe ArkeFit entra por convite de um sócio verificado", () => {
  it("a função confere o sócio (superadmin, do banco) com as duas etapas, antes de tudo", () => {
    expect(exigeSocioVerificado(FUNCAO)).toBe(true);
  });

  it("a conta que já existe é recusada, e a nova nasce pelo convite do Auth, sem senha", () => {
    expect(convidaSoContaNova(FUNCAO)).toEqual([]);
    expect(ramo('if (pedido.acao === "convidar")', 'if (pedido.acao === "reenviar")')).toMatch(
      /inviteUserByEmail\(pedido\.email, \{\s*data: \{ full_name: pedido\.nome \},\s*redirectTo: linkDefinirSenha,?\s*\}\)/,
    );
  });

  it("se a gravação falha depois do convite, a conta é apagada", () => {
    const convidar = ramo('if (pedido.acao === "convidar")', 'if (pedido.acao === "reenviar")');
    const gravar = convidar.indexOf('"gravar_convite_equipe_arkefit"');
    const desfazer = convidar.indexOf("admin.auth.admin.deleteUser(novoId)");
    expect(gravar).toBeGreaterThan(0);
    expect(desfazer).toBeGreaterThan(gravar);
  });

  it("o reenvio só vale para quem ainda não criou a senha", () => {
    const reenviar = ramo('if (pedido.acao === "reenviar")', "// Retirar:");
    expect(reenviar).toMatch(/if \(conta\.estado !== "convite_enviado"\) return jsonResponse\(\{ error: JA_CRIOU_A_SENHA \}, 409\);/);
    expect(reenviar.indexOf('estado !== "convite_enviado"')).toBeLessThan(reenviar.indexOf("generateLink("));
  });

  it("o convite e a retirada avisam os outros sócios, sem quem pediu e sem a pessoa", () => {
    const convidar = ramo('if (pedido.acao === "convidar")', 'if (pedido.acao === "reenviar")');
    const retirar = ramo("// Retirar:", "async function avisarSocios");
    expect(convidar).toMatch(/avisarSocios\(admin, \{\s*exceto: \[callerId, novoId\],\s*evento: "convidada"/);
    expect(retirar).toMatch(/avisarSocios\(admin, \{\s*exceto: \[callerId, pedido\.userId\],\s*evento: "acesso_retirado"/);
    const aviso = ramo("async function avisarSocios", "");
    expect(aviso).toMatch(/admin\.rpc\("emails_socios_para_aviso", \{ _exceto: a\.exceto \}\)/);
    expect(aviso).toMatch(/EMAIL_ALERTAS_FROM/);
  });

  it("a retirada passa pelo banco com a sessão de quem pede", () => {
    expect(ramo("// Retirar:", "async function avisarSocios")).toMatch(/asUser\.rpc\("retirar_acesso_equipe_arkefit"/);
  });

  it("o convite gravado vai para a auditoria só com ids e o nível, e só a service role grava", () => {
    const gravar = definicaoVigente(textos, "gravar_convite_equipe_arkefit");
    expect(gravar, "a definição foi achada").not.toBe("");
    const registro = gravar.slice(gravar.indexOf("registrar_auditoria("));
    expect(registro).toMatch(/'equipe_arkefit\.convidada', 'auth\.users', _user_id, null,\s*jsonb_build_object\('acesso', _acesso, 'papeis', to_jsonb\(_papeis\)\)/);
    expect(registro).not.toMatch(/email|_nome|full_name/i);
    expect(gravar).toMatch(/_papeis <@ public\.papeis_da_arkefit\(\)/);
    expect(gravar).toMatch(/estado_conta_arkefit\(_user_id\) is distinct from 'convite_enviado'/);
    const revogada = textos.some((t) =>
      /revoke execute on function public\.gravar_convite_equipe_arkefit\([^)]*\) from public, anon, authenticated;/.test(t),
    );
    expect(revogada, "authenticated não chama a gravação do convite").toBe(true);
  });

  it("o banco recusa tirar o próprio acesso e o do último sócio", () => {
    const retirar = definicaoVigente(textos, "retirar_acesso_equipe_arkefit");
    expect(retirar, "a definição foi achada").not.toBe("");
    expect(retiradaSegura(retirar)).toEqual([]);
  });

  it("a ArkeFit nunca fica sem superadmin, por qualquer caminho", () => {
    const tudo = textos.join("\n").replace(/\s+/g, " ");
    expect(tudo).toMatch(
      /create trigger trg_user_roles_sempre_um_socio after delete or update of role on public\.user_roles for each row when \(old\.role = 'superadmin'\) execute function public\.impedir_arkefit_sem_socio\(\);/,
    );
    const piso = definicaoVigente(textos, "impedir_arkefit_sem_socio").replace(/\s+/g, " ");
    expect(piso).toMatch(/if not exists \(select 1 from public\.user_roles where role = 'superadmin'\) then raise exception/);
  });

  it("ninguém escreve em user_roles pela API", () => {
    expect(escritaPelaApi(textos)).toEqual([]);
    // A leitura fica: o app decide a rota pelos papéis de quem entra.
    const leitura = [...regrasVigentes(textos, "public.user_roles")].filter(([, r]) => r.comando === "select");
    expect(leitura.length).toBe(1);
  });
});

describe("os detectores pegam o defeito plantado (a trava trava)", () => {
  it("a função sem a sessão verificada, ou que convida antes de conferir", () => {
    expect(exigeSocioVerificado(FUNCAO.replace("verificada(claims) && ", ""))).toBe(false);
    expect(exigeSocioVerificado(FUNCAO.replace('p.role === "superadmin"', 'p.role === "admin_arke"'))).toBe(false);
    const depois = FUNCAO.replace("  if (!socio) return jsonResponse({ error: SO_SOCIO }, 403);\n", "").replace(
      "    const novoId = convite.user.id;",
      "    const novoId = convite.user.id;\n    if (!socio) return jsonResponse({ error: SO_SOCIO }, 403);",
    );
    expect(exigeSocioVerificado(depois)).toBe(false);
  });

  it("a conta que existe ligada, ou a conta com senha", () => {
    const semRecusa = FUNCAO.replace(
      "if (((contas ?? []) as unknown[]).length > 0) return jsonResponse({ error: JA_TEM_CONTA }, 409);",
      "",
    );
    expect(convidaSoContaNova(semRecusa)).toContain("a conta que existe não é recusada antes do convite");
    const comSenha = FUNCAO.replace("inviteUserByEmail(pedido.email, {", "createUser({ email: pedido.email, password: senha,");
    expect(convidaSoContaNova(comSenha)).toContain("a conta pode nascer com senha ou com o e-mail confirmado");
    const papelDireto = FUNCAO.replace(
      "const novoId = convite.user.id;",
      'const novoId = convite.user.id;\n    await admin.from("user_roles").insert({ user_id: novoId, role: "superadmin" });',
    );
    expect(convidaSoContaNova(papelDireto)).toContain("a função grava papel direto, fora do convite gravado no banco");
  });

  it("a retirada sem as duas regras", () => {
    const retirar = definicaoVigente(textos, "retirar_acesso_equipe_arkefit");
    expect(retiradaSegura(retirar.replace("or _user_id = v_ator", ""))).toContain("tira o próprio acesso");
    expect(retiradaSegura(retirar.replace("and r.user_id <> _user_id", ""))).toContain("tira o último sócio ativo");
  });

  it("a regra de inclusão de volta, ou a permissão devolvida", () => {
    const regraDeVolta = [
      ...textos,
      `create policy "inclusão" on public.user_roles for insert to authenticated with check (has_role((select auth.uid()), 'admin_arke'::app_role));`,
    ];
    expect(escritaPelaApi(regraDeVolta)).toContain('regra "inclusão" (insert)');
    const permissaoDeVolta = [...textos, "grant insert on public.user_roles to authenticated;"];
    expect(escritaPelaApi(permissaoDeVolta).some((a) => a.startsWith("authenticated com insert"))).toBe(true);
  });
});
