import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";

/**
 * Trava do treino publicado do zero, sem modelo (09/10/2026,
 * 20261440010000).
 *
 * `publicar_treino_do_zero` é um segundo caminho até `treinos`. As armadilhas
 * que ela não pode reabrir: dar a publicação a quem o RLS deixa incluir (toda
 * a equipe, inclusive a recepção), driblar a regra do aluno do Método (só o
 * mentor da ArkeFit com CREF), virar `security definer` e ler o acervo de
 * outra academia, ou gravar um snapshot diferente do de `publicar_treino`
 * (o app lê os dois do mesmo jeito, e o GIF vem pelo `exercicio_id`).
 *
 * Lê a versão VIGENTE das funções (as migrations em ordem).
 */
const textos = textosDaReconstrucao();

function definicaoVigente(nome: string): string {
  const re = new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${nome}\s*\([\s\S]*?\n\$(?:function)?\$;`, "gi");
  let ultima = "";
  for (const t of textos) for (const m of t.matchAll(re)) ultima = m[0];
  return ultima;
}

/** As chaves de cada item do snapshot, na ordem em que a função as escreve. */
function chavesDoSnapshot(definicao: string): string[] {
  const inicio = definicao.indexOf("jsonb_build_object(");
  const fim = definicao.indexOf(") order by", inicio);
  return [...definicao.slice(inicio, fim).matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
}

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").toLowerCase();

describe("o treino do zero não abre caminho novo até o aluno", () => {
  const doZero = definicaoVigente("publicar_treino_do_zero");
  const corpo = semComentarios(doZero);

  it("roda com a permissão de quem chama: o RLS de treinos e o gatilho do dono continuam valendo", () => {
    expect(doZero, "a definição foi achada").not.toBe("");
    expect(corpo).not.toMatch(/security definer/);
    expect(corpo).toMatch(/insert into public\.treinos/);
  });

  it("confere quem chama: sem sessão não publica; fora do Método, só gestor, professor ou a ArkeFit; no Método, quem prescreve treino do Método", () => {
    expect(corpo).toMatch(/if auth\.uid\(\) is null then raise exception [^;]*errcode = '42501'/);
    expect(corpo).toMatch(/if _metodo then if not public\.pode_prescrever_treino_metodo\(\) then raise exception [^;]*errcode = '42501'/);
    expect(corpo).toMatch(
      /elsif not \( public\.has_org_role\(auth\.uid\(\), _organization_id, 'gestor'\) or public\.has_org_role\(auth\.uid\(\), _organization_id, 'professor'\) or public\.has_role\(auth\.uid\(\), 'admin_arke'\) \) then raise exception [^;]*errcode = '42501'/,
    );
  });

  it("cada item vem do acervo global ou da academia do aluno", () => {
    expect(corpo).toMatch(/e\.organization_id is null or e\.organization_id = _organization_id/);
    expect(corpo).toMatch(/join public\.exercicios_biblioteca e on e\.id = x\.exercicio_id/);
    expect(corpo).toMatch(/'exercicio_id', e\.id/);
  });

  it("o snapshot tem as mesmas chaves, na mesma ordem, que o publicado pelo modelo", () => {
    const peloModelo = chavesDoSnapshot(definicaoVigente("publicar_treino"));
    expect(peloModelo.length, "o leitor achou as chaves de publicar_treino").toBeGreaterThan(10);
    expect(chavesDoSnapshot(doZero)).toEqual(peloModelo);
  });

  it("sem EXECUTE para o anon nem para o PUBLIC", () => {
    const revoga = textos.some((t) =>
      /revoke execute on function public\.publicar_treino_do_zero\(uuid, text, jsonb, date, date\) from public, anon;/i.test(t),
    );
    expect(revoga).toBe(true);
    const devolve = textos.some((t) => /grant execute on function public\.publicar_treino_do_zero\([^)]*\) to [^;]*\b(anon|public)\b/i.test(t));
    expect(devolve).toBe(false);
  });

  it("a tela publica pelos dois caminhos: o do modelo continua", () => {
    const tela = readFileSync(join(__dirname, "..", "components", "prescricao", "PrescricaoTreino.tsx"), "utf8");
    expect(tela).toMatch(/rpc\("publicar_treino", \{/);
    expect(tela).toMatch(/rpc\("publicar_treino_do_zero", \{/);
  });

  it("o leitor acha a função que virou security definer e a que perdeu a conferência (a trava trava)", () => {
    expect(semComentarios(doZero.replace("security invoker", "security definer"))).toMatch(/security definer/);
    const semConferir = semComentarios(doZero.replace("or public.has_org_role(auth.uid(), _organization_id, 'professor')", ""));
    expect(semConferir).not.toMatch(/has_org_role\(auth\.uid\(\), _organization_id, 'professor'\)/);
  });
});
