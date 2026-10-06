import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { passoDoCheckin } from "./checkinParceiro";

/**
 * Achado da auditoria de 05/10/2026: o check-in de parceiro dizia "Catraca
 * liberada!" e não abria a catraca — a função só gravava o registro.
 */
const RAIZ = join(__dirname, "..", "..");
const migrations = () => {
  const pasta = join(RAIZ, "supabase", "migrations");
  return readdirSync(pasta)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(pasta, f), "utf8").replace(/\r\n/g, "\n"));
};

/** A última definição de uma função (corpo entre $$ ou $function$). */
function ultimaDefinicao(funcao: string): string {
  const re = new RegExp(`create or replace function public\\.${funcao}\\s*\\([\\s\\S]*?\\n\\$(function)?\\$;`, "gi");
  let ultima = "";
  for (const sql of migrations()) for (const achado of sql.match(re) ?? []) ultima = achado;
  return ultima;
}

describe("check-in de parceiro: a tela só diz que liberou quando o Gateway confirma", () => {
  it("com ordem ao Gateway, a tela acompanha a ordem", () => {
    expect(passoDoCheckin({ registrado: true, liberacao: "enviada", comando_id: "cmd-1", motivo: "x" })).toEqual({
      tipo: "acompanhar",
      comandoId: "cmd-1",
      aviso: "Check-in registrado. Liberando a catraca…",
    });
  });

  it("sem ordem remota, diz como liberar, sem prometer", () => {
    const passo = passoDoCheckin({
      registrado: true,
      liberacao: "manual",
      comando_id: null,
      motivo: "Check-in registrado. Esta catraca não abre pelo ARKE: libere o visitante pelo botão da recepção ou no próprio equipamento.",
    });
    expect(passo.tipo).toBe("avisar");
    expect(passo).toMatchObject({ aviso: expect.stringContaining("libere o visitante") });
    expect(JSON.stringify(passo)).not.toMatch(/liberada/i);
  });

  it("não registrado é recusa, com o motivo do banco", () => {
    expect(passoDoCheckin({ registrado: false, liberacao: "nenhuma", comando_id: null, motivo: "Dispositivo inativo." })).toEqual({
      tipo: "recusado",
      erro: "Dispositivo inativo.",
    });
    expect(passoDoCheckin(null)).toMatchObject({ tipo: "recusado" });
  });

  it("o banco manda a ordem pelo canal da liberação remota, e só quando a catraca a aceita", () => {
    const corpo = ultimaDefinicao("checkin_parceiro_externo");
    expect(corpo, "a função existe").not.toBe("");
    expect(corpo).toContain("'liberar_catraca' = any (v_tel.capacidades)");
    expect(corpo).toContain("v_tel.reportado_em < now() - interval '3 minutes'");
    expect(corpo).toMatch(/insert into public\.gateway_comandos[\s\S]*'liberar_catraca'/);
    expect(corpo).toContain("public.is_org_staff(v_uid, v_cat.organization_id)");
    // A mesma regra da liberação remota: só gestão e recepção mandam abrir.
    expect(corpo).toContain("public.has_org_role(v_uid, v_cat.organization_id, 'recepcao')");
  });

  it("a ordem concluída de um check-in não grava um segundo acesso", () => {
    const corpo = ultimaDefinicao("concluir_comando_gateway");
    expect(corpo).toContain("c.tipo = 'liberar_catraca' and _sucesso and not (c.parametros ? 'checkin')");
  });

  it("a edge function não responde 'liberado' por conta própria", () => {
    const funcao = readFileSync(join(RAIZ, "supabase", "functions", "catraca-checkin-parceiro-externo", "index.ts"), "utf8");
    expect(funcao).toContain('asUser.rpc("checkin_parceiro_externo"');
    expect(funcao).not.toMatch(/liberado:\s*true/);
    const tela = readFileSync(join(RAIZ, "src", "pages", "admin", "AdminCatracas.tsx"), "utf8");
    expect(tela).not.toContain("Catraca liberada!");
    expect(tela).toContain("passoDoCheckin(");
  });
});
