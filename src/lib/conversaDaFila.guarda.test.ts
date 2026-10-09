import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { textosDaReconstrucao } from "../../scripts/migracao/regras.mjs";

/**
 * Trava do botão "Mensagem" da fila de atendimento (09/10/2026): abrir a
 * conversa direto do cartão não pode virar acesso novo.
 *
 * A conversa com o aluno se abre, do lado da equipe, em poucos lugares, e
 * cada um aplica a regra de quem fala com quem: a ficha e a caixa de
 * Mensagens (o canal pelo papel, a nutrição só para quem atende a saúde, o
 * aluno do Método com o mentor) e, do lado da ArkeFit, a Mentoria. Uma tela
 * nova que monte o chat sem passar por essa regra mostraria o botão a quem a
 * ficha não mostra. Por isso a lista é fechada: tela nova que abre o chat
 * entra aqui, com o motivo.
 */
const SRC = join(__dirname, "..");

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

const ler = (caminho: string) => readFileSync(join(SRC, caminho), "utf8");

/** Onde a equipe abre o chat do aluno, e por que pode. */
const TELAS_DO_CHAT_DA_EQUIPE: Record<string, string> = {
  "components/admin/AlunoPerfilSheet.tsx": "a ficha: desativa os chats do Método e a nutrição de quem não atende a saúde",
  "pages/admin/AdminMensagens.tsx": "a caixa: get_caixa_mensagens pelo RLS e o canal pelo papel",
  "components/admin/ConversaDaFila.tsx": "a fila: só com os canais de canaisDaConversaComAluno()",
  "pages/superadmin/SuperAdminMentoria.tsx": "a Mentoria: a conversa do Método, pelo RLS de mensagens_mentor",
  "pages/superadmin/SuperAdminFichaAluno.tsx": "a ficha do Método, pelo get_ficha_mentor",
  "components/superadmin/FilaChamadosMentor.tsx": "os chamados do Mentor, pelo get_fila_mentor",
};

describe("o botão Mensagem da fila não dá acesso novo", () => {
  it("só as telas da lista abrem o chat do aluno do lado da equipe", () => {
    const abrem = arquivos(SRC)
      .filter((f) => /viewerType="(staff|mentor)"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).replace(/\\/g, "/"))
      .sort();
    expect(abrem).toEqual(Object.keys(TELAS_DO_CHAT_DA_EQUIPE).sort());
  });

  it("a fila da academia decide o botão pela regra única dos canais", () => {
    const fila = ler("pages/admin/AdminDashboard.tsx");
    expect(fila).toMatch(/canaisDaConversaComAluno\(/);
    // O plano do aluno vem do mesmo cálculo da ficha (o Método fica sem botão).
    expect(fila).toMatch(/planoDoAluno\(/);
    // O botão só nasce de uma conversa que a regra autorizou.
    expect(fila).toMatch(/\{conversaDoCartao && \(\s*<BotaoMensagem/);
    expect(fila).not.toMatch(/<ChatPanel/);
  });

  it("a caixa de Mensagens e a fila leem a mesma regra de canal por papel", () => {
    expect(ler("hooks/useCaixaMensagens.ts")).toMatch(/import \{ canaisDoPapel \} from "@\/lib\/conversaComAluno"/);
  });

  it("a fila do Mentor contratado só traz aluno do Método (get_fila_mentor vigente)", () => {
    const re = /create\s+or\s+replace\s+function\s+public\.get_fila_mentor\s*\([\s\S]*?\n\$function\$;/gi;
    let vigente = "";
    for (const t of textosDaReconstrucao()) for (const m of t.matchAll(re)) vigente = m[0];
    expect(vigente, "a definição foi achada").not.toBe("");
    expect(vigente).toMatch(/acesso_arkefit\('mentoria'\)/);
    expect(vigente).toMatch(/v_socio\s+or\s+exists\s*\(select 1 from public\.alunos am where am\.id = t\.aluno_id and am\.metodo_arke_status = 'ativo'\)/);
  });
});
