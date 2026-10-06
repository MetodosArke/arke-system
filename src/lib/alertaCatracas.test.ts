import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  chaveDoEnvio,
  montarEmailArkeFit,
  montarEmailGestor,
  separarEnvios,
  type AvisoCatraca,
  type ItemCatraca,
} from "../../supabase/functions/alertar-catracas/email";

const SITE = "https://www.arkefit.com.br";

const item = (parcial: Partial<ItemCatraca>): ItemCatraca => ({
  catraca_id: "c1",
  organization_id: "o1",
  academia: "Tietê Fitness",
  catraca: "Entrada",
  tipo: "novo",
  situacao: "catraca_offline",
  sem_sinal_desde: "2026-09-23T17:32:00Z",
  ...parcial,
});

describe("aviso de catraca fora do ar", () => {
  it("gestor: diz qual catraca, desde quando e o que conferir na recepção — sem jargão", () => {
    const { assunto, texto, html } = montarEmailGestor("Tietê Fitness", [item({})], SITE);
    expect(assunto).toBe("A catraca da Tietê Fitness está sem sinal");
    // 17:32 UTC = 14:32 em Brasília.
    expect(texto).toContain("Entrada: desde 23/09, 14:32");
    expect(texto).toContain("O computador da recepção, onde o programa da ArkeFit roda, está ligado?");
    expect(texto).toContain("/#/admin/catracas");
    expect(texto).not.toMatch(/telemetria|Gateway Local 1\.0|catraca:/);
    expect(html).toContain("A ArkeFit também foi avisada.");
  });

  it("gestor: lembrete e volta", () => {
    expect(montarEmailGestor("Tietê Fitness", [item({ tipo: "lembrete" })], SITE).texto).toContain("(ainda sem sinal)");
    const volta = montarEmailGestor("Tietê Fitness", [item({ tipo: "recuperou", situacao: "ok", sem_sinal_desde: null })], SITE);
    expect(volta.assunto).toBe("A catraca da Tietê Fitness voltou a funcionar");
    expect(volta.texto).toContain("Voltou a funcionar: Entrada.");
  });

  it("ArkeFit: todas as academias num e-mail, com o link de Equipamentos", () => {
    const { assunto, texto } = montarEmailArkeFit(
      [item({}), item({ catraca_id: "c2", organization_id: "o2", academia: "Academia Dois", catraca: "Saída", tipo: "lembrete" })],
      SITE
    );
    expect(assunto).toBe("[ArkeFit] 2 catraca(s) sem sinal");
    expect(texto).toContain("Tietê Fitness · Entrada sem sinal desde 23/09, 14:32");
    expect(texto).toContain("Ainda: Academia Dois · Saída");
    expect(texto).toContain("/#/superadmin/equipamentos");
    expect(texto).toContain("O gestor de cada academia também foi avisado.");
  });

  it("ArkeFit: só volta, e catraca desativada no meio do caminho", () => {
    const { assunto, texto } = montarEmailArkeFit(
      [item({ tipo: "recuperou", situacao: "ok" }), item({ catraca_id: "c2", catraca: "Saída", tipo: "recuperou", situacao: "desativada" })],
      SITE
    );
    expect(assunto).toBe("[ArkeFit] 2 catraca(s) de volta");
    expect(texto).toContain("Entrada voltou a falar com a nuvem");
    expect(texto).toContain("Saída foi desativada");
  });

  it("nome com HTML não vira HTML no e-mail", () => {
    const { html } = montarEmailGestor("<b>X</b>", [item({ catraca: "<i>Y</i>" })], SITE);
    expect(html).not.toContain("<i>Y</i>");
    expect(html).toContain("&lt;i&gt;Y&lt;/i&gt;");
    expect(montarEmailArkeFit([item({ academia: "<b>X</b>" })], SITE).html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});

/**
 * Achado da auditoria de 05/10/2026: o "já avisei" era um só, gravado pelo
 * e-mail da ArkeFit. O gestor cujo e-mail falhou ficava como avisado, e a
 * falha do da ArkeFit fazia os gestores receberem o mesmo aviso a cada 2
 * minutos. Agora cada destinatário tem o seu, e o envio tem chave de
 * idempotência.
 */
describe("aviso de catraca: um 'já avisei' por destinatário", () => {
  const aviso = (parcial: Partial<AvisoCatraca>): AvisoCatraca => ({ ...item({}), destinatario: "arkefit", referencia: "c1:catraca_offline:100", ...parcial });

  it("separa um envio para a ArkeFit e um por academia para o gestor", () => {
    const envios = separarEnvios([
      aviso({}),
      aviso({ destinatario: "gestor" }),
      aviso({ catraca_id: "c2", organization_id: "o2", destinatario: "gestor", referencia: "c2:catraca_offline:200" }),
      aviso({ catraca_id: "c2", organization_id: "o2", referencia: "c2:catraca_offline:200" }),
    ]);
    expect(envios.map((e) => [e.destinatario, e.organization_id, e.itens.length])).toEqual([
      ["arkefit", null, 2],
      ["gestor", "o1", 1],
      ["gestor", "o2", 1],
    ]);
  });

  it("a chave do envio é a mesma até o aviso ser registrado, e muda por destinatário e por aviso", async () => {
    const a = separarEnvios([aviso({ destinatario: "gestor" })])[0];
    const deNovo = separarEnvios([aviso({ destinatario: "gestor" })])[0];
    expect(await chaveDoEnvio(a)).toBe(await chaveDoEnvio(deNovo));
    expect(await chaveDoEnvio(a)).toMatch(/^alerta-catracas\/gestor\/o1\/[0-9a-f]{40}$/);
    const daArkeFit = separarEnvios([aviso({})])[0];
    expect(await chaveDoEnvio(daArkeFit)).not.toBe(await chaveDoEnvio(a));
    // O lembrete de 24 h tem outra referência (o "já avisei" anterior): sai de novo.
    const lembrete = separarEnvios([aviso({ destinatario: "gestor", tipo: "lembrete", referencia: "c1:catraca_offline:999" })])[0];
    expect(await chaveDoEnvio(lembrete)).not.toBe(await chaveDoEnvio(a));
  });

  it("a edge function registra cada destinatário depois do e-mail dele, com a chave", () => {
    const funcao = readFileSync(join(__dirname, "..", "..", "supabase", "functions", "alertar-catracas", "index.ts"), "utf8");
    expect(funcao).toContain('"Idempotency-Key": chave');
    expect(funcao).toContain("registrar_aviso_catracas");
    expect(funcao).toContain("_destinatario: envio.destinatario");
    expect(funcao).not.toContain("registrar_alerta_catracas");
    const envio = funcao.indexOf("await enviar(emails");
    expect(envio).toBeGreaterThan(-1);
    expect(funcao.indexOf('rpc("registrar_aviso_catracas"')).toBeGreaterThan(envio);
  });
});
