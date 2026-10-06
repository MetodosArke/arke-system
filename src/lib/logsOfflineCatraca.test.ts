import { describe, expect, it } from "vitest";
import {
  alunosCitados,
  conferirLogs,
  credencialDoLog,
  emLotes,
  erroDaLinha,
  idLocal,
  JANELA_PASSADO_MS,
} from "../../supabase/functions/catraca-sincronizar-logs-offline/fluxo";

const ORG = "00000000-0000-0000-0000-0000000000a1";
const CATRACA = "00000000-0000-0000-0000-00000000c001";
const ALUNO = "00000000-0000-0000-0000-0000000a0001";
const DE_OUTRA = "00000000-0000-0000-0000-0000000b0001";
const AGORA = new Date("2026-10-06T12:00:00Z");

const log = (extra: Record<string, unknown> = {}) => ({
  id_local: "l1",
  aluno_id: ALUNO,
  cpf_consultado: "id:7",
  resultado: "liberado",
  ocorrido_em: "2026-10-06T11:00:00Z",
  giro: "confirmado",
  ...extra,
});

const conferir = (logs: unknown[]) =>
  conferirLogs(logs, { organizationId: ORG, catracaId: CATRACA, agora: AGORA, alunosDaAcademia: new Set([ALUNO]) });

describe("acessos offline: cada registro é conferido, e a fila anda", () => {
  it("registro bom vira linha com a academia da catraca e a hora do acesso", () => {
    const { linhas, descartados } = conferir([log()]);
    expect(descartados).toEqual([]);
    expect(linhas).toEqual([
      {
        id_local: "l1",
        linha: {
          organization_id: ORG,
          catraca_id: CATRACA,
          aluno_id: ALUNO,
          cpf_consultado: "id:7",
          resultado: "liberado",
          validado_offline: true,
          created_at: "2026-10-06T11:00:00.000Z",
          giro: "confirmado",
        },
      },
    ]);
  });

  it("um registro com problema não derruba os outros: cada um tem o seu desfecho", () => {
    // O defeito de antes: o lote ia numa instrução só, e o aluno excluído
    // durante a queda derrubava todos, para sempre.
    const { linhas, descartados } = conferir([
      log({ id_local: "bom" }),
      log({ id_local: "excluido", aluno_id: "00000000-0000-0000-0000-00000000dead" }),
      log({ id_local: "outra", aluno_id: DE_OUTRA }),
      log({ id_local: "cpf-numero", cpf_consultado: 12345678909 }),
      log({ id_local: "data-torta", ocorrido_em: "ontem" }),
      log({ id_local: "velho", ocorrido_em: new Date(AGORA.getTime() - JANELA_PASSADO_MS - 60_000).toISOString() }),
      log({ id_local: "futuro", ocorrido_em: "2026-10-07T12:00:00Z" }),
      log({ id_local: "resultado", resultado: "liberado_remoto" }),
      log({ id_local: "aluno-torto", aluno_id: 42 }),
      "não é objeto",
    ]);
    expect(linhas.map((l) => l.id_local)).toEqual(["bom"]);
    expect(descartados).toEqual([
      { id_local: "excluido", motivo: "aluno não é desta academia" },
      { id_local: "outra", motivo: "aluno não é desta academia" },
      { id_local: "cpf-numero", motivo: "credencial inválida" },
      { id_local: "data-torta", motivo: "data inválida" },
      { id_local: "velho", motivo: "data fora da janela" },
      { id_local: "futuro", motivo: "data fora da janela" },
      { id_local: "resultado", motivo: "resultado desconhecido" },
      { id_local: "aluno-torto", motivo: "aluno inválido" },
      { id_local: null, motivo: "registro inválido" },
    ]);
  });

  it("sem aluno (não encontrado no cache) o registro sobe, sem presença de ninguém", () => {
    const { linhas } = conferir([log({ aluno_id: null, resultado: "negado_nao_encontrado", cpf_consultado: "529.982.247-25" })]);
    expect(linhas[0].linha).toMatchObject({ aluno_id: null, cpf_consultado: "52998224725" });
  });

  it("o relógio do computador um pouco adiantado passa", () => {
    const { linhas } = conferir([log({ ocorrido_em: "2026-10-06T12:05:00Z" })]);
    expect(linhas).toHaveLength(1);
  });

  it("giro pendente ou desconhecido vira nulo, como sempre foi", () => {
    const { linhas } = conferir([log({ giro: "pendente" }), log({ id_local: "l2", giro: 3 })]);
    expect(linhas.map((l) => l.linha.giro)).toEqual([null, null]);
  });

  it("matrícula encerrada é um resultado que sobe", () => {
    const { linhas } = conferir([log({ resultado: "negado_matricula_encerrada" })]);
    expect(linhas).toHaveLength(1);
  });
});

describe("acessos offline: a credencial no formato do caminho online", () => {
  it("o id: do número no equipamento fica (antes virava 'CPF' na Visão Master)", () => {
    expect(credencialDoLog("id:777")).toBe("id:777");
    expect(credencialDoLog(" id: 0042 ")).toBe("id:0042");
    expect(credencialDoLog("529.982.247-25")).toBe("52998224725");
  });

  it("vazio, não texto ou torto não passa", () => {
    expect(credencialDoLog("")).toBeNull();
    expect(credencialDoLog("id:")).toBeNull();
    expect(credencialDoLog("id:a b")).toBeNull();
    expect(credencialDoLog(null)).toBeNull();
    expect(credencialDoLog({})).toBeNull();
    expect(credencialDoLog("abc")).toBeNull();
  });
});

describe("acessos offline: apoio", () => {
  it("o id local vem do Gateway 1.9; o antigo não manda", () => {
    expect(idLocal(log())).toBe("l1");
    expect(idLocal({ resultado: "liberado" })).toBeNull();
    expect(idLocal({ id_local: "x".repeat(65) })).toBeNull();
  });

  it("os alunos citados vão em lotes, sem repetir", () => {
    expect(alunosCitados([log(), log(), log({ aluno_id: DE_OUTRA }), log({ aluno_id: "torto" }), null])).toEqual([ALUNO, DE_OUTRA]);
    expect(emLotes(Array.from({ length: 450 }, (_, i) => i)).map((l) => l.length)).toEqual([200, 200, 50]);
  });

  it("erro do banco que é da linha sai da fila; o de conexão, não", () => {
    expect(erroDaLinha("23503")).toBe(true); // chave estrangeira
    expect(erroDaLinha("23514")).toBe(true); // regra (check)
    expect(erroDaLinha("22007")).toBe(true); // data torta
    expect(erroDaLinha("08006")).toBe(false); // conexão
    expect(erroDaLinha("57014")).toBe(false); // tempo esgotado
    expect(erroDaLinha(undefined)).toBe(false);
  });
});
