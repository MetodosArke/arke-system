import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A regra do único gestor libera a academia em eliminação (20261402,
 * 06/10/2026).
 *
 * `encerramento-organizacao` apaga as contas sem outro vínculo antes de
 * `eliminar_organizacao` apagar a academia. A conta do gestor leva o vínculo
 * em cascata, e `prevent_remover_ultimo_gestor` recusava remover o único
 * gestor enquanto a academia existe: a eliminação de quase toda academia
 * parava em "Database error deleting user" (achado na prova de ponta a ponta
 * pela função publicada). A regra continua protegendo a academia que funciona;
 * só a janela de eliminação (encerrada e passada a data) fica de fora.
 */
const PASTA = join(__dirname, "..", "..", "supabase", "migrations");

function definicaoVigente(funcao: string): string {
  const arquivos = readdirSync(PASTA).filter((f) => f.endsWith(".sql")).sort();
  let ultima = "";
  for (const f of arquivos) {
    const texto = readFileSync(join(PASTA, f), "utf8");
    const i = texto.toLowerCase().indexOf(`create or replace function public.${funcao}(`);
    if (i < 0) continue;
    const fim = texto.indexOf("$function$;", i);
    ultima = fim < 0 ? texto.slice(i) : texto.slice(i, fim + "$function$;".length);
  }
  return ultima;
}

describe("regra do único gestor", () => {
  const corpo = definicaoVigente("prevent_remover_ultimo_gestor");

  it("a definição vigente foi achada", () => {
    expect(corpo).toMatch(/raise exception 'Não é possível remover ou inativar o único gestor/);
  });

  it("continua protegendo a academia que funciona", () => {
    expect(corpo).toMatch(/exists \(select 1 from public\.organizations where id = v_org_id\)/);
  });

  it("libera a academia encerrada e passada a data de eliminação", () => {
    expect(corpo).toMatch(/not exists \(select 1 from public\.organizacao_encerramentos e/);
    expect(corpo).toMatch(/e\.etapa = 'encerrada'/);
    expect(corpo).toMatch(/e\.eliminacao_em <= now\(\)/);
  });
});
