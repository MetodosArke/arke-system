import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chaveDoAviso,
  chaveDoLote,
  emailAoAluno,
  emailDeAviso,
  loteDeEmails,
  pushAoAluno,
} from "../../supabase/functions/encerramento-organizacao/fluxo";
import { resumoRemocao } from "./encerramento";

/**
 * Encerramento de academia, achados da auditoria de 05/10/2026:
 *  - a eliminação apagava a conta de quem tinha vínculo inativo em outra
 *    academia (e, em cascata, o histórico dela lá);
 *  - o aviso não chegava aos alunos, nem aos do Método;
 *  - a remoção das digitais ficava sem prova depois da eliminação.
 */
const RAIZ = join(__dirname, "..", "..");
const MIGRATIONS = join(RAIZ, "supabase", "migrations");
const ler = (...p: string[]) => readFileSync(join(...p), "utf8").replace(/\r\n/g, "\n");
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => ler(MIGRATIONS, f).toLowerCase());

/** A última definição de uma função, entre todas as migrations. */
function ultimaDefinicao(funcao: string): string {
  const re = new RegExp(`create or replace function public\\.${funcao}\\s*\\([\\s\\S]*?\\n\\$\\$;`, "g");
  let ultima = "";
  for (const sql of migrations) for (const achado of sql.match(re) ?? []) ultima = achado;
  return ultima;
}

const AVISO = {
  organizacao_nome: "Academia Tietê",
  iniciativa: "academia",
  termino_em: "2026-11-05",
  eliminacao_em: "2026-12-05",
};
const SITE = "https://app.arkefit.com.br";

describe("eliminação: a conta só sai sem vínculo nenhum", () => {
  const corpo = ultimaDefinicao("preparar_eliminacao_organizacao");

  it("vínculo noutra organização segura a conta, ativo ou não", () => {
    expect(corpo, "a função existe").not.toBe("");
    const filtroDeVinculo = corpo.slice(corpo.indexOf("from public.organization_members m2"));
    expect(filtroDeVinculo).toMatch(/m2\.user_id = u\.uid and m2\.organization_id <> v_org\.id\)/);
    // A regra antiga: só vínculo ativo protegia a conta.
    expect(filtroDeVinculo.slice(0, 200)).not.toMatch(/m2\.status\s*=\s*'active'/);
  });

  it("matrícula noutra academia, papel global e equipe da ArkeFit seguram a conta", () => {
    expect(corpo).toMatch(/not exists \(select 1 from public\.alunos a2 where a2\.user_id = u\.uid and a2\.organization_id <> v_org\.id\)/);
    expect(corpo).toMatch(/not exists \(select 1 from public\.user_roles r where r\.user_id = u\.uid\)/);
    expect(corpo).toMatch(/not exists \(select 1 from public\.equipe_arkefit e where e\.user_id = u\.uid\)/);
  });
});

describe("aviso do encerramento aos alunos", () => {
  it("diz o prazo, o que acaba no término e o que acontece com os dados", () => {
    const m = emailAoAluno({ ...AVISO, etapa: "aviso" }, { nome: "Ana", metodo: false }, SITE);
    expect(m.assunto).toBe("Academia Tietê vai encerrar o uso do ARKE em 05/11/2026");
    expect(m.texto).toContain("Olá, Ana.");
    expect(m.texto).toContain("Até lá, tudo segue funcionando no app.");
    expect(m.texto).toContain("as cobranças pelo ARKE param");
    expect(m.texto).toContain("a sua digital, o seu rosto e o seu cartão são apagados das catracas");
    expect(m.texto).toContain("ficam guardados até 05/12/2026 e depois são eliminados");
    expect(m.texto).toContain("a sua conta de acesso também é apagada");
    expect(m.texto).toContain(`${SITE}/#/privacidade`);
    expect(m.texto).not.toContain("Método ARKE");
    expect(m.texto).not.toMatch(/whatsapp/i);
  });

  it("o aluno do Método ouve do acompanhamento e de quem pedir os dados dele", () => {
    const m = emailAoAluno({ ...AVISO, etapa: "aviso" }, { nome: "Bia", metodo: true }, SITE);
    expect(m.texto).toContain("O seu acompanhamento do Método ARKE nesta academia também termina nessa data");
    expect(m.texto).toContain("sobre os dados do Método ARKE, fale com a ArkeFit");
  });

  it("depois do término o texto fala no passado, com o prazo dos dados", () => {
    const m = emailAoAluno({ ...AVISO, etapa: "encerrada" }, { nome: "Caio", metodo: false }, SITE);
    expect(m.assunto).toBe("Academia Tietê encerrou o uso do ARKE: o que acontece com os seus dados");
    expect(m.texto).toContain("encerrou o uso do ARKE em 05/11/2026");
    expect(m.texto).toContain("Desde essa data:");
    expect(pushAoAluno({ ...AVISO, etapa: "encerrada" }).body).toContain("ficam até 05/12/2026");
  });

  it("o html não deixa nome de academia virar marcação", () => {
    const m = emailAoAluno({ ...AVISO, organizacao_nome: "<b>Fit</b>", etapa: "aviso" }, { nome: "Ana", metodo: false }, SITE);
    expect(m.html).not.toContain("<b>Fit</b>");
    expect(m.html).toContain("&lt;b&gt;Fit&lt;/b&gt;");
  });

  it("o aviso no celular abre o app, com a data", () => {
    const p = pushAoAluno({ ...AVISO, etapa: "aviso" });
    expect(p.url).toBe("/#/app");
    expect(p.body).toContain("funciona até 05/11/2026");
  });

  it("o lote vai um e-mail por aluno com endereço, e a chave é a do lote", () => {
    const corpo = loteDeEmails(
      { ...AVISO, etapa: "aviso" },
      [
        { user_id: "u1", email: "a@x.com", nome: "Ana", metodo: false },
        { user_id: "u2", email: null, nome: "Sem", metodo: false },
        { user_id: "u3", email: "c@x.com", nome: "Caio", metodo: true },
      ],
      "ArkeFit <acesso@arkefit.com.br>",
      SITE,
    );
    expect(corpo.map((c) => c.to)).toEqual([["a@x.com"], ["c@x.com"]]);
    expect(corpo[1].text).toContain("Método ARKE");
    // A mesma chave para o mesmo lote: a rodada que repete não entrega de novo.
    expect(chaveDoLote("enc-1", "lote-1")).toBe(chaveDoLote("enc-1", "lote-1"));
    expect(chaveDoLote("enc-1", "lote-1")).not.toBe(chaveDoLote("enc-1", "lote-2"));
    expect(chaveDoAviso("enc-1")).toBe("encerramento-aviso/enc-1");
  });

  it("o e-mail à gestão conta que os alunos também são avisados", () => {
    expect(emailDeAviso(AVISO, SITE).texto).toContain("Os alunos recebem um aviso por e-mail e no celular");
  });

  it("o banco reserva o lote antes do envio e só conta depois de confirmado", () => {
    const reservar = ultimaDefinicao("reservar_aviso_encerramento_alunos");
    expect(reservar).toMatch(/where a\.encerramento_id = _encerramento_id and a\.email_em is null/);
    expect(reservar).toMatch(/not public\.matricula_encerrada\(al\.id\) or al\.metodo_arke_status = 'ativo'/);
    expect(reservar).toMatch(/on conflict on constraint organizacao_encerramento_avisos_pkey do nothing/);
    const funcao = ler(RAIZ, "supabase", "functions", "encerramento-organizacao", "index.ts");
    const envio = funcao.indexOf("api.resend.com/emails/batch");
    const confirma = funcao.indexOf('_canal: "email"');
    expect(envio).toBeGreaterThan(-1);
    expect(funcao.indexOf("reservar_aviso_encerramento_alunos")).toBeLessThan(envio);
    expect(confirma).toBeGreaterThan(envio);
    expect(funcao).toContain('"Idempotency-Key": chaveDoLote(enc.id, lote)');
    expect(funcao).toContain('"Idempotency-Key": chaveDoAviso(a.id)');
  });
});

describe("prova da remoção das digitais", () => {
  it("o término conta os alunos com número e confere a remoção", () => {
    const termino = ultimaDefinicao("concluir_termino_organizacao");
    expect(termino).toContain("remocoes_alunos = v_alunos");
    expect(termino).toContain("perform public.conferir_remocoes_encerramento(_encerramento_id)");
  });

  it("a eliminação confere uma última vez antes de a cascata levar ordens e tarefas", () => {
    const eliminar = ultimaDefinicao("eliminar_organizacao");
    const conferir = eliminar.indexOf("perform public.conferir_remocoes_encerramento(_encerramento_id)");
    const apagar = eliminar.indexOf("delete from public.organizations");
    expect(conferir).toBeGreaterThan(-1);
    expect(conferir).toBeLessThan(apagar);
    expect(eliminar).toContain("'ordens_confirmadas', v_enc.remocoes_remotas_confirmadas");
  });

  it("a conferência guarda só contagens, sem dado pessoal", () => {
    const conferir = ultimaDefinicao("conferir_remocoes_encerramento");
    const atribuicoes = conferir.slice(conferir.indexOf("set remocoes_agendadas"), conferir.indexOf("from ("));
    expect(atribuicoes).not.toMatch(/user_id|identificador|nome|cpf/);
    expect(conferir).toMatch(/g\.tipo = 'apagar_usuario'/);
    expect(conferir).toMatch(/k\.tipo = 'equipamento'/);
  });

  it("o placar da tela", () => {
    expect(
      resumoRemocao({
        remocoes_alunos: 12,
        remocoes_agendadas: 10,
        remocoes_remotas_confirmadas: 8,
        remocoes_manuais: 4,
        remocoes_manuais_confirmadas: 1,
      }),
    ).toEqual({
      texto: "12 aluno(s) com número na catraca · 8 de 10 ordem(ns) ao Gateway confirmada(s) · 1 de 4 remoção(ões) à mão com desfecho",
      pendentes: 3,
    });
    expect(
      resumoRemocao({ remocoes_alunos: null, remocoes_agendadas: null, remocoes_remotas_confirmadas: null, remocoes_manuais: null, remocoes_manuais_confirmadas: null })
        .pendentes,
    ).toBe(0);
  });
});
