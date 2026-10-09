import type { TelemetriaGateway } from "../types";

/**
 * O que o Gateway sabe dos equipamentos que falam com ele, para a
 * telemetria. Só memória: é "quem deu sinal desde que o Gateway subiu", e
 * é exatamente a pergunta do suporte — "a catraca está chegando até o
 * Gateway?" é diferente de "o Gateway está chegando até a nuvem?", e as
 * duas pedem providências diferentes.
 *
 * Control iD: o equipamento se identifica pelo `device_id` em cada
 * chamada. Topdata: quem fala é a ponte, que conta quais Inners estão
 * conectados. Toletus: quem disca é o Gateway, então o estado de cada
 * placa vem do próprio conector, na hora da telemetria. Hikvision: o
 * conector confere cada aparelho a cada minuto, e o receptor marca cada evento.
 */

/** O que a telemetria precisa saber de uma placa Toletus. */
export interface EstadoPlacaToletus {
  nome: string;
  conectada: boolean;
  firmware: string | null;
  vistaEm: Date | null;
  desconectadaEm: Date | null;
}

/** O que a telemetria precisa saber de um aparelho Hikvision. */
export interface EstadoAparelhoHikvision {
  nome: string;
  alcancavel: boolean;
  modelo: string | null;
  firmware: string | null;
  verificacaoRemota: boolean;
  vistoEm: Date | null;
  erro: string | null;
}

/** O que a telemetria precisa saber de um leitor facial da Topdata. */
export interface EstadoLeitorFacial {
  nome: string;
  conectado: boolean;
  modelo: string | null;
  firmware: string | null;
  vistoEm: Date | null;
  desconectadoEm: Date | null;
}

export class RegistroEquipamentos {
  private readonly controlid = new Map<string, { visto_em: Date; contingencia_em: Date | null }>();
  private ponte: { inners: number[]; conectados: number[]; vista_em: Date } | null = null;
  private placasToletus: () => EstadoPlacaToletus[] = () => [];
  private leitoresFaciais: () => EstadoLeitorFacial[] = () => [];
  /** Terminais Intelbras: quem chamou (keepalive ou acesso), pelo nome do config ou pelo IP. */
  private readonly intelbras = new Map<string, Date>();
  /** Aparelhos Hikvision: quem mandou evento, pelo nome do config ou pelo IP. */
  private readonly hikvision = new Map<string, Date>();
  private aparelhosHikvision: () => EstadoAparelhoHikvision[] = () => [];

  constructor(private readonly agora: () => Date = () => new Date()) {}

  /** Uma leitura ou evento de uma Control iD. */
  controlIdVisto(deviceId: string | number | undefined): void {
    const id = String(deviceId ?? "").trim() || "sem-id";
    const atual = this.controlid.get(id);
    this.controlid.set(id, { visto_em: this.agora(), contingencia_em: atual?.contingencia_em ?? null });
  }

  /**
   * A Control iD chama device_is_alive quando está em contingência: ela
   * deixou de nos alcançar e está pedindo o servidor de volta. Chegar aqui
   * já é a volta, mas o registro fica para o suporte ver que houve queda.
   */
  controlIdEmContingencia(deviceId: string | number | undefined): void {
    const id = String(deviceId ?? "").trim() || "sem-id";
    this.controlid.set(id, { visto_em: this.agora(), contingencia_em: this.agora() });
  }

  /** Keepalive ou acesso de um terminal Intelbras. */
  intelbrasVisto(nome: string): void {
    this.intelbras.set(nome, this.agora());
  }

  /** Um evento de um aparelho Hikvision. */
  hikvisionVisto(nome: string): void {
    this.hikvision.set(nome, this.agora());
  }

  /** O conector Hikvision se apresenta aqui ao subir: ele confere cada aparelho a cada minuto. */
  fonteHikvision(estados: () => EstadoAparelhoHikvision[]): void {
    this.aparelhosHikvision = estados;
  }

  ponteViva(inners: number[], conectados: number[]): void {
    this.ponte = { inners: [...inners], conectados: [...conectados], vista_em: this.agora() };
  }

  /** O conector Toletus se apresenta aqui ao subir. */
  fonteToletus(estados: () => EstadoPlacaToletus[]): void {
    this.placasToletus = estados;
  }

  /** O conector dos leitores faciais Topdata, idem. */
  fonteFacial(estados: () => EstadoLeitorFacial[]): void {
    this.leitoresFaciais = estados;
  }

  paraTelemetria(): Pick<TelemetriaGateway, "equipamentos" | "ponte"> {
    const equipamentos: TelemetriaGateway["equipamentos"] = [];
    for (const [id, e] of this.controlid) {
      equipamentos.push({
        nome: `Control iD ${id}`,
        tipo: "controlid",
        visto_em: e.visto_em.toISOString(),
        ...(e.contingencia_em ? { detalhe: `pediu o servidor de volta em ${e.contingencia_em.toISOString()}` } : {}),
      });
    }
    if (this.ponte) {
      for (const inner of this.ponte.inners) {
        const conectado = this.ponte.conectados.includes(inner);
        equipamentos.push({
          nome: `Topdata Inner ${inner}`,
          tipo: "topdata",
          visto_em: conectado ? this.ponte.vista_em.toISOString() : null,
          detalhe: conectado ? "conectado à ponte" : "sem conexão com a ponte",
        });
      }
    }
    for (const placa of this.placasToletus()) {
      equipamentos.push({
        nome: `Toletus ${placa.nome}`,
        tipo: "toletus",
        visto_em: placa.conectada && placa.vistaEm ? placa.vistaEm.toISOString() : null,
        detalhe: placa.conectada
          ? `conectada${placa.firmware ? `, firmware ${placa.firmware}` : ""}`
          : `sem conexão com o Gateway${placa.desconectadaEm ? ` desde ${placa.desconectadaEm.toISOString()}` : ""}`,
      });
    }
    for (const leitor of this.leitoresFaciais()) {
      const sobre = [leitor.modelo, leitor.firmware ? `firmware ${leitor.firmware}` : null].filter(Boolean).join(", ");
      equipamentos.push({
        nome: `Topdata facial ${leitor.nome}`,
        tipo: "topdata_facial",
        visto_em: leitor.conectado && leitor.vistoEm ? leitor.vistoEm.toISOString() : null,
        detalhe: leitor.conectado
          ? `conectado${sobre ? `, ${sobre}` : ""}`
          : `sem conexão com o Gateway${leitor.desconectadoEm ? ` desde ${leitor.desconectadoEm.toISOString()}` : ""}`,
      });
    }
    // O terminal chama o keepalive a cada 10 s: o "visto em" é a prova de
    // que ele está chegando ao Gateway.
    for (const [nome, visto] of this.intelbras) {
      equipamentos.push({ nome, tipo: "intelbras", visto_em: visto.toISOString() });
    }
    // Hikvision: o Gateway confere cada aparelho a cada minuto (no servidor de
    // escuta o aparelho não manda batimento), e cada evento também vale como sinal.
    const conhecidos = new Set<string>();
    for (const a of this.aparelhosHikvision()) {
      conhecidos.add(a.nome);
      const evento = this.hikvision.get(a.nome) ?? null;
      const visto = [evento, a.vistoEm].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
      const sobre = [a.modelo, a.firmware ? `firmware ${a.firmware}` : null].filter(Boolean).join(", ");
      equipamentos.push({
        nome: `Hikvision ${a.nome}`,
        tipo: "hikvision",
        visto_em: a.alcancavel && visto ? visto.toISOString() : null,
        detalhe: a.alcancavel
          ? `${sobre ? `${sobre}, ` : ""}${a.verificacaoRemota ? "pergunta ao Gateway a cada acesso" : "decide pela lista do Gateway"}`
          : `sem resposta do aparelho${a.erro ? `: ${a.erro}` : ""}`,
      });
    }
    for (const [nome, visto] of this.hikvision) {
      if (!conhecidos.has(nome)) equipamentos.push({ nome, tipo: "hikvision", visto_em: visto.toISOString() });
    }
    return {
      equipamentos,
      ponte: this.ponte
        ? { inners: this.ponte.inners, conectados: this.ponte.conectados, vista_em: this.ponte.vista_em.toISOString() }
        : null,
    };
  }
}
