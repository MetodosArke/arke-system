import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Trava de `supabase/functions/_shared/freio.ts`: função que gasta fora do
 * banco — chamada ao Asaas pela conta da ArkeFit, que é uma só para todas as
 * academias, ou ao modelo de IA, que se paga por uso — e que qualquer pessoa
 * logada pode chamar passa pelo freio. Sem ele, um laço numa academia (com
 * defeito ou de propósito) esgota a cota do Asaas de todas.
 *
 * Função nova que fala com o Asaas ou com a IA entra no freio, ou numa das
 * listas abaixo com o porquê.
 */
const FUNCOES = join(__dirname, "..", "..", "supabase", "functions");

const GASTA_FORA = /ambienteAsaas\(|conversarComIA\(|consultarAssistente\(|consultarVigia\(/;

const SEM_FREIO: Record<string, string> = {
  "agente-comercial": "rotina agendada, com token",
  "agente-implantacao": "rotina agendada, com token",
  "nfse-emitir": "rotina agendada, com token",
  vigia: "rotina agendada, com token",
  "asaas-assinatura-b2b": "só a ArkeFit, com as duas etapas",
  "asaas-emitir-cobranca-b2b": "só a ArkeFit, com as duas etapas",
  "asaas-taxa-implantacao": "só a ArkeFit, com as duas etapas",
  "vigia-aprovar": "só a ArkeFit, com as duas etapas",
  "mentor-sugerir-resposta": "só a ArkeFit, com as duas etapas",
  "sentinela-anamnese": "a equipe do Método, e o resumo é guardado por versão da anamnese",
  "assistente-academia": "freio próprio no banco (perguntas por pessoa e por academia)",
  "anonimizar-aluno": "só cancela cobranças de um aluno, uma vez",
  "excluir-aluno": "só cancela cobranças de um aluno, uma vez",
  "encerramento-organizacao": "só cancela cobranças da academia que se encerra",
};

describe("freio nas funções que gastam fora do banco", () => {
  const funcoes = readdirSync(FUNCOES).filter(
    (n) => !n.startsWith("_") && statSync(join(FUNCOES, n)).isDirectory()
  );
  const codigo = (n: string) => {
    try {
      return readFileSync(join(FUNCOES, n, "index.ts"), "utf8");
    } catch {
      return "";
    }
  };

  it("o detector detecta", () => {
    expect(funcoes.filter((n) => GASTA_FORA.test(codigo(n))).length).toBeGreaterThan(10);
  });

  it("toda função que gasta fora do banco passa pelo freio, ou está na lista com o porquê", () => {
    const sem = funcoes.filter((n) => GASTA_FORA.test(codigo(n)) && !/dentroDoFreio\(/.test(codigo(n)) && !SEM_FREIO[n]);
    expect(sem, "use dentroDoFreio de _shared/freio.ts").toEqual([]);
  });

  it("a lista de exceções não guarda função que já não existe", () => {
    expect(Object.keys(SEM_FREIO).filter((n) => !funcoes.includes(n))).toEqual([]);
  });
});

describe("quem matricula e quem mexe na conta de outra pessoa", () => {
  const ler = (n: string) => readFileSync(join(FUNCOES, n, "index.ts"), "utf8");

  it("matrícula e assinatura do Método conferem o papel de quem cobra", () => {
    for (const n of ["academia-criar-matricula", "asaas-create-subscription"]) {
      expect(ler(n), n).toMatch(/podeCobrarNaAcademia\(/);
    }
  });

  it("trocar e-mail e gerar link conferem se a pessoa está só nesta academia", () => {
    for (const n of ["editar-membro-equipe", "gerar-link-ativacao"]) {
      expect(ler(n), n).toMatch(/alvoSoNaAcademia\(/);
    }
  });

  it("só o Sócio simula perfil (o admin_arke sozinho, não), e recusa antes de olhar o perfil de destino", () => {
    const codigo = ler("impersonar-perfil");
    expect(codigo).not.toMatch(/role === "gestor"/);
    expect(codigo).not.toMatch(/role === "admin_arke"/);
    const recusa = codigo.indexOf("if (!callerIsSuperadmin)");
    expect(recusa).toBeGreaterThan(0);
    expect(recusa).toBeLessThan(codigo.indexOf(".eq(\"user_id\", targetUserId)"));
  });
});
