/**
 * O check-in de visitante de parceiro (Wellhub, TotalPass), como a tela de
 * Catracas o lê. A regra mora em `checkin_parceiro_externo()`
 * (20261373010000): o banco registra o check-in e, se a catraca abre pelo
 * ARKE, manda a ordem de liberar ao Gateway.
 *
 * Até 06/10/2026 a tela dizia "Catraca liberada!" sem que nenhuma ordem
 * saísse. Agora ela só diz que liberou quando o Gateway confirma a ordem; sem
 * ordem remota, diz como liberar.
 */
export type RespostaCheckin = {
  registrado: boolean;
  liberacao: "enviada" | "manual" | "nenhuma";
  comando_id: string | null;
  motivo: string;
};

export type PassoDoCheckin =
  | { tipo: "acompanhar"; comandoId: string; aviso: string }
  | { tipo: "avisar"; aviso: string }
  | { tipo: "recusado"; erro: string };

export function passoDoCheckin(r: Partial<RespostaCheckin> | null | undefined): PassoDoCheckin {
  if (!r || !r.registrado) return { tipo: "recusado", erro: r?.motivo || "O check-in não foi registrado." };
  if (r.liberacao === "enviada" && r.comando_id) {
    return { tipo: "acompanhar", comandoId: r.comando_id, aviso: "Check-in registrado. Liberando a catraca…" };
  }
  return {
    tipo: "avisar",
    aviso: r.motivo || "Check-in registrado. Libere o visitante pelo botão da recepção ou no próprio equipamento.",
  };
}
