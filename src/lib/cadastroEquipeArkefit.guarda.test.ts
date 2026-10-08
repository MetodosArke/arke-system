import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizar, regrasVigentes, textosDaReconstrucao, ultimaPermissao } from "../../scripts/migracao/regras.mjs";
import { bucketsDoRepositorio } from "../../scripts/migracao/buckets.mjs";
import { CAMPOS_DO_SOCIO, CAMPOS_PESSOAIS, dadosParaSalvar, formDoCadastro } from "./cadastroEquipeArkefit";

/**
 * O cadastro da equipe ArkeFit (dados pessoais, documentos e pagamento) só é
 * visto pelos sócios e pela própria pessoa, grava por RPC e audita só os
 * campos (08/10/2026, migration 20261430010000).
 *
 * São os dados que o contrato social, a contabilidade e a folha pedem: CPF,
 * RG, filiação, endereço, PIS, a conta onde a pessoa recebe e quanto ela
 * recebe. Quem lê a mais, ou muda a conta de outra pessoa, desvia o
 * pagamento. Esta guarda cobra as peças que fecham isso:
 *   - nenhuma escrita direta pela API (nem regra, nem permissão);
 *   - a gravação confere o sócio verificado ou a própria pessoa com as duas
 *     etapas, e recusa o perfil simulado antes de tudo;
 *   - a pessoa não muda o vínculo, a remuneração nem a participação (as
 *     listas do banco e da tela são as mesmas);
 *   - a auditoria guarda os nomes dos campos e quem exportou de quem, nunca
 *     os valores;
 *   - as regras do bucket dos documentos são só do sócio e da própria pessoa;
 *   - a planilha só sai pela função que registra a exportação, e a biblioteca
 *     dela não entra no pacote inicial.
 */
const RAIZ = join(__dirname, "..", "..");
const ler = (...p: string[]) => readFileSync(join(RAIZ, ...p), "utf8").replace(/\r\n/g, "\n");
const TELA = ler("src", "components", "superadmin", "CadastroEquipeArkefit.tsx");
const LOGICA = ler("src", "lib", "cadastroEquipeArkefit.ts");
const PLANILHA = ler("src", "lib", "exportarPlanilha.ts");
const APP = ler("src", "App.tsx");
const textos = textosDaReconstrucao().map((t) => t.replace(/\r\n/g, "\n"));
const BUCKET = "equipe-arkefit-documentos";
const TABELA = "equipe_arkefit_cadastro";

/** A definição vigente (a última) de uma função, sem os comentários e numa linha só. */
function definicaoVigente(sqls: string[], nome: string): string {
  const re = new RegExp(String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${nome}\s*\([\s\S]*?\n\$\$;`, "gi");
  let ultima = "";
  for (const t of sqls) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();
}

/** O texto da chamada `registrar_auditoria(...)` de uma ação, dentro de uma definição. */
function registroDaAcao(definicao: string, acao: string): string {
  const i = definicao.indexOf(`'${acao}'`);
  if (i < 0) return "";
  const inicio = definicao.lastIndexOf("registrar_auditoria(", i);
  return inicio < 0 ? "" : definicao.slice(inicio, definicao.indexOf(");", i) + 2);
}

/** A lista de campos de uma das funções de lista (`array['a', 'b']`). */
function camposDaFuncao(sqls: string[], nome: string): string[] {
  const d = definicaoVigente(sqls, nome);
  const lista = /array\[([^\]]*)\]::text\[\]/.exec(d)?.[1] ?? "";
  return [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// ── Detectores, usados contra o código de verdade e contra os defeitos plantados ──

/** As regras e as permissões que deixam alguém escrever na tabela pela API. */
function escritaPelaApi(sqls: string[]): string[] {
  const achados = [...regrasVigentes(sqls, `public.${TABELA}`)]
    .filter(([, r]) => !r.restritiva && r.comando !== "select")
    .map(([nome, r]) => `regra "${nome}" (${r.comando})`);
  for (const privilegio of ["insert", "update", "delete"]) {
    for (const papel of ["authenticated", "anon"]) {
      const ultima = ultimaPermissao(sqls, TABELA, privilegio, papel);
      if (!/^revoke\b/.test(ultima)) achados.push(`${papel} com ${privilegio} (${ultima || "o padrão do Supabase"})`);
    }
  }
  return achados;
}

/** A gravação: quem chama, o perfil simulado antes de tudo, e a pessoa fora do vínculo. */
function gravacaoSegura(d: string): string[] {
  const problemas: string[] = [];
  if (!/security definer/.test(d)) problemas.push("não é security definer");
  const simulada = d.indexOf("if v_ator is null or public.sessao_simulada() then raise exception");
  const primeiraEscrita = Math.min(
    ...["insert into public.equipe_arkefit_cadastro", "update public.equipe_arkefit_cadastro", "registrar_auditoria("].map((m) => {
      const i = d.indexOf(m);
      return i < 0 ? Infinity : i;
    }),
  );
  if (simulada < 0 || simulada > primeiraEscrita) problemas.push("não recusa o perfil simulado antes de gravar");
  if (!/v_socio := public\.has_role\(v_ator, 'superadmin'\);/.test(d)) problemas.push("não confere o sócio verificado (has_role)");
  if (!/v_propria := _user_id = v_ator and coalesce\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2' and public\.equipe_arkefit_atual\(v_ator\);/.test(d)) {
    problemas.push("a própria pessoa sem as duas etapas, ou sem ser da equipe hoje");
  }
  if (!/if not \(v_socio or v_propria\) then raise exception '[^']*' using errcode = '42501';/.test(d)) problemas.push("não recusa quem não é sócio nem a própria pessoa");
  if (!/if not public\.equipe_arkefit_alguma_vez\(_user_id\) then raise exception/.test(d)) problemas.push("grava cadastro de quem não é da equipe");
  if (!/if not v_socio then select array_agg\(k order by k\) into v_fora from jsonb_object_keys\(_dados\) k where k = any \(public\.campos_cadastro_equipe_do_socio\(\)\); if v_fora is not null then raise exception '[^']*'(?:, [^;]*?)? using errcode = '42501';/.test(d)) {
    problemas.push("a pessoa muda o vínculo, a remuneração ou a participação");
  }
  if (!/where k <> all \(public\.campos_cadastro_equipe_pessoais\(\) \|\| public\.campos_cadastro_equipe_do_socio\(\)\)/.test(d)) {
    problemas.push("aceita campo fora das duas listas (o dono da linha, quem gravou)");
  }
  return problemas;
}

/** A trilha guarda os nomes dos campos, e nada do que foi gravado. */
function auditoriaSoComCampos(d: string): string[] {
  const r = registroDaAcao(d, "equipe_arkefit.cadastro_alterado");
  if (!r) return ["a gravação não vai para a trilha"];
  const problemas: string[] = [];
  if (!/'campos', to_jsonb\(v_campos\)/.test(r)) problemas.push("a trilha não guarda os campos");
  if (/v_novo|v_limpo|_dados|to_jsonb\(v_atual\)|v_valor/.test(r)) problemas.push("a trilha guarda valores");
  return problemas;
}

/** A exportação: só o sócio leva a equipe toda, cada ficha passa pela regra de quem vê, e a trilha vem antes dos dados. */
function exportacaoAuditada(d: string): string[] {
  const problemas: string[] = [];
  if (!/if v_ator is null or public\.sessao_simulada\(\) then raise exception/.test(d)) problemas.push("exporta em perfil simulado");
  if (!/if _user_ids is null then if not public\.has_role\(v_ator, 'superadmin'\) then raise exception/.test(d)) problemas.push("a equipe toda sem ser sócio");
  if (!/not public\.pode_ver_cadastro_equipe_arkefit\(u\)\) then raise exception '[^']*' using errcode = '42501';/.test(d)) problemas.push("a ficha de outro sem conferir quem vê");
  const r = registroDaAcao(d, "equipe_arkefit.cadastro_exportado");
  if (!r) problemas.push("a exportação não vai para a trilha");
  else {
    if (d.indexOf(r) > d.indexOf("return query")) problemas.push("a trilha depois dos dados");
    if (!/jsonb_build_object\('de', to_jsonb\(v_ids\), 'quantidade', cardinality\(v_ids\), 'equipe_toda', _user_ids is null\)/.test(r)) {
      problemas.push("a trilha da exportação guarda outra coisa que os ids");
    }
  }
  return problemas;
}

/**
 * Toda menção ao bucket nas regras de storage.objects vem amarrada à função
 * de quem vê (leitura, inclusão) ou à de quem apaga (exclusão); a alteração e
 * a leitura pública não o citam.
 */
function regrasDoBucket(sqls: string[]): string[] {
  const problemas: string[] = [];
  const PERMITIDO: Record<string, RegExp> = {
    select: /bucket_id = 'equipe-arkefit-documentos'\)? and pode_ver_documento_equipe_arkefit\(name\)/g,
    insert: /bucket_id = 'equipe-arkefit-documentos'\)? and pode_ver_documento_equipe_arkefit\(name\)/g,
    delete: /bucket_id = 'equipe-arkefit-documentos'\)? and pode_apagar_documento_equipe_arkefit\(name\)/g,
  };
  const vistas = new Set<string>();
  for (const [nome, r] of regrasVigentes(sqls, "storage.objects")) {
    const texto = normalizar(`${r.using ?? ""} ${r.withCheck ?? ""}`);
    const mencoes = texto.split(`'${BUCKET}'`).length - 1;
    if (!mencoes) continue;
    const permitido = PERMITIDO[r.comando ?? ""];
    const amarradas = permitido ? (texto.match(permitido) ?? []).length : 0;
    if (!permitido || amarradas !== mencoes) problemas.push(`regra "${nome}" (${r.comando}) cita o bucket sem a função de quem pode`);
    vistas.add(r.comando ?? "");
  }
  for (const comando of ["select", "insert", "delete"]) if (!vistas.has(comando)) problemas.push(`nenhuma regra de ${comando} para o bucket`);
  return problemas;
}

/** As funções das regras: a leitura segue quem vê o cadastro; apagar é só do sócio. */
function funcoesDoBucket(sqls: string[]): string[] {
  const problemas: string[] = [];
  const ver = definicaoVigente(sqls, "pode_ver_documento_equipe_arkefit");
  if (!/return public\.pode_ver_cadastro_equipe_arkefit\(split_part\(_caminho, '\/', 1\)::uuid\);/.test(ver)) problemas.push("a leitura do documento não segue quem vê o cadastro");
  const apagar = definicaoVigente(sqls, "pode_apagar_documento_equipe_arkefit");
  if (!/return public\.has_role\(auth\.uid\(\), 'superadmin'\) and not public\.sessao_simulada\(\) and /.test(apagar)) problemas.push("apagar o documento não é só do sócio verificado");
  const quem = definicaoVigente(sqls, "pode_ver_cadastro_equipe_arkefit");
  if (!/and not public\.sessao_simulada\(\)/.test(quem)) problemas.push("quem vê o cadastro inclui o perfil simulado");
  if (!/public\.has_role\(auth\.uid\(\), 'superadmin'\) or \(_user_id = auth\.uid\(\) and coalesce\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2' and public\.equipe_arkefit_atual\(_user_id\)\)/.test(quem)) {
    problemas.push("quem vê o cadastro não é só o sócio e a própria pessoa com as duas etapas");
  }
  return problemas;
}

/** A planilha da tela sai da função que registra (cada download vem depois da chamada dela). */
function planilhaPelaFuncao(codigo: string): string[] {
  const problemas: string[] = [];
  const downloads = [...codigo.matchAll(/baixarPlanilha\(/g)].map((m) => m.index ?? 0);
  if (!downloads.length) problemas.push("a tela não baixa a planilha");
  for (const i of downloads) {
    const antes = codigo.slice(0, i);
    const rpc = antes.lastIndexOf('rpc("exportar_cadastros_equipe_arkefit"');
    const fimDaFuncao = antes.lastIndexOf("mutationFn:");
    if (rpc < 0 || rpc < fimDaFuncao) problemas.push("um download não passa pela exportação registrada");
  }
  if (/from\("equipe_arkefit_cadastro"\)\s*\.\s*(insert|update|upsert|delete)\(/.test(codigo)) problemas.push("a tela grava direto na tabela");
  return problemas;
}

describe("o cadastro da equipe ArkeFit só é visto pelos sócios e pela própria pessoa", () => {
  it("nenhuma escrita direta pela API, e uma regra só, de leitura", () => {
    expect(escritaPelaApi(textos)).toEqual([]);
    const regras = [...regrasVigentes(textos, `public.${TABELA}`)];
    expect(regras.map(([, r]) => r.comando)).toEqual(["select"]);
    expect(normalizar(regras[0][1].using)).toBe("pode_ver_cadastro_equipe_arkefit(user_id)");
    expect(textos.join("\n")).toMatch(/alter table public\.equipe_arkefit_cadastro enable row level security;/);
  });

  it("a gravação confere o sócio ou a própria pessoa, com as duas etapas, e recusa o perfil simulado", () => {
    const d = definicaoVigente(textos, "salvar_cadastro_equipe_arkefit");
    expect(d, "a definição foi achada").not.toBe("");
    expect(gravacaoSegura(d)).toEqual([]);
    const renomear = definicaoVigente(textos, "renomear_equipe_arkefit");
    expect(renomear).toMatch(/if not public\.has_role\(v_ator, 'superadmin'\) or public\.sessao_simulada\(\) then raise exception/);
  });

  it("a pessoa não muda o vínculo, a remuneração nem a participação: as listas do banco e da tela são as mesmas", () => {
    expect(camposDaFuncao(textos, "campos_cadastro_equipe_do_socio").sort()).toEqual([...CAMPOS_DO_SOCIO].sort());
    expect(camposDaFuncao(textos, "campos_cadastro_equipe_pessoais").sort()).toEqual([...CAMPOS_PESSOAIS].sort());
    for (const c of ["vinculo_tipo", "remuneracao_mensal", "participacao_capital"]) expect(CAMPOS_DO_SOCIO as readonly string[]).toContain(c);
    // A tela da própria pessoa nem manda o que o banco recusaria.
    const enviado = Object.keys(dadosParaSalvar(formDoCadastro(null, "Pessoa Inventada"), { socio: false }));
    expect(enviado.filter((c) => (CAMPOS_DO_SOCIO as readonly string[]).includes(c))).toEqual([]);
  });

  it("a auditoria guarda os campos e nunca os valores", () => {
    expect(auditoriaSoComCampos(definicaoVigente(textos, "salvar_cadastro_equipe_arkefit"))).toEqual([]);
    const nome = registroDaAcao(definicaoVigente(textos, "renomear_equipe_arkefit"), "equipe_arkefit.nome_alterado");
    expect(nome).toMatch(/jsonb_build_object\('mudou', 'nome'\)/);
    expect(nome).not.toMatch(/v_nome|_nome|full_name/);
  });

  it("as regras do bucket são só do sócio e da própria pessoa, e o bucket é privado", () => {
    expect(regrasDoBucket(textos)).toEqual([]);
    expect(funcoesDoBucket(textos)).toEqual([]);
    expect(bucketsDoRepositorio(RAIZ).get(BUCKET)?.campos.public).toBe(false);
  });

  it("a exportação registra a auditoria, e a tela só baixa por ela", () => {
    expect(exportacaoAuditada(definicaoVigente(textos, "exportar_cadastros_equipe_arkefit"))).toEqual([]);
    expect(planilhaPelaFuncao(TELA)).toEqual([]);
  });

  it("a tela não leva a biblioteca de planilha para o pacote inicial", () => {
    for (const [nome, codigo] of [["a tela", TELA], ["a lógica", LOGICA], ["o exportador", PLANILHA]] as const) {
      expect(codigo, nome).not.toMatch(/^\s*import[^;]*from\s+["']xlsx["']/m);
      expect(codigo, nome).not.toMatch(/require\(\s*["']xlsx["']\s*\)/);
    }
    expect(PLANILHA).toMatch(/await import\("xlsx"\)/);
    // E a página que a abre é carregada sob demanda.
    expect(APP).toMatch(/const SuperAdminEquipe = paginaPreguicosa\(\(\) => import\("@\/pages\/superadmin\/SuperAdminEquipe"\)\);/);
  });
});

describe("os detectores pegam o defeito plantado (a trava trava)", () => {
  it("a regra de alteração de volta, ou a permissão devolvida", () => {
    const comRegra = [...textos, `create policy "alteração" on public.${TABELA} for update to authenticated using (true);`];
    expect(escritaPelaApi(comRegra)).toContain('regra "alteração" (update)');
    const comPermissao = [...textos, `grant update on public.${TABELA} to authenticated;`];
    expect(escritaPelaApi(comPermissao).some((a) => a.startsWith("authenticated com update"))).toBe(true);
  });

  it("a gravação sem o perfil simulado, sem as duas etapas da pessoa, ou com a pessoa no vínculo", () => {
    const d = definicaoVigente(textos, "salvar_cadastro_equipe_arkefit");
    expect(gravacaoSegura(d.replace("if v_ator is null or public.sessao_simulada() then", "if v_ator is null then"))).toContain(
      "não recusa o perfil simulado antes de gravar",
    );
    expect(gravacaoSegura(d.replace(" and coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and public.equipe_arkefit_atual(v_ator);", " ;"))).toContain(
      "a própria pessoa sem as duas etapas, ou sem ser da equipe hoje",
    );
    expect(gravacaoSegura(d.replace("if not v_socio then", "if false then"))).toContain("a pessoa muda o vínculo, a remuneração ou a participação");
  });

  it("a trilha com os valores", () => {
    const d = definicaoVigente(textos, "salvar_cadastro_equipe_arkefit");
    expect(auditoriaSoComCampos(d.replace("'campos', to_jsonb(v_campos)", "'campos', to_jsonb(v_novo)"))).toContain("a trilha guarda valores");
    expect(auditoriaSoComCampos(d.replace("'equipe_arkefit.cadastro_alterado'", "'outra'"))).toContain("a gravação não vai para a trilha");
  });

  it("o bucket aberto a qualquer um, ou a exclusão para quem vê", () => {
    const aberto = [
      ...textos,
      `alter policy "objetos: leitura" on storage.objects using ((bucket_id = any (array['avatars', '${BUCKET}'])));`,
    ];
    expect(regrasDoBucket(aberto).some((p) => p.includes('"objetos: leitura"'))).toBe(true);
    const exclusao = textos.map((t) => t.replace(/pode_apagar_documento_equipe_arkefit\(name\)\)\n\);/, "pode_ver_documento_equipe_arkefit(name))\n);"));
    expect(regrasDoBucket(exclusao).some((p) => p.includes('"objetos: exclusão"'))).toBe(true);
    const apagar = textos.map((t) => t.replace("return public.has_role(auth.uid(), 'superadmin')\n     and not public.sessao_simulada()", "return true"));
    expect(funcoesDoBucket(apagar)).toContain("apagar o documento não é só do sócio verificado");
  });

  it("a exportação sem a trilha, ou a planilha lida direto da tabela", () => {
    const d = definicaoVigente(textos, "exportar_cadastros_equipe_arkefit");
    expect(exportacaoAuditada(d.replace("'equipe_arkefit.cadastro_exportado'", "'outra'"))).toContain("a exportação não vai para a trilha");
    expect(exportacaoAuditada(d.replace("if _user_ids is null then if not public.has_role(v_ator, 'superadmin') then", "if _user_ids is null then if false then"))).toContain(
      "a equipe toda sem ser sócio",
    );
    const direto = TELA.replace(
      'const { data, error } = await supabase.rpc("exportar_cadastros_equipe_arkefit", { _user_ids: [userId] });',
      'const { data, error } = await supabase.from("equipe_arkefit_cadastro").select("*").eq("user_id", userId);',
    );
    expect(direto).not.toBe(TELA);
    expect(planilhaPelaFuncao(direto)).toContain("um download não passa pela exportação registrada");
  });
});
