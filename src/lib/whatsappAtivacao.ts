import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";

// Normaliza um telefone digitado em qualquer formato (com ou sem DDI/
// pontuação) para o formato exigido pelo wa.me: só dígitos, com DDI do
// Brasil (55) na frente. Não há normalização de telefone em nenhum outro
// lugar do projeto hoje — profiles.phone é gravado como o staff digitou.
export function normalizarTelefoneBr(telefone: string | null | undefined): string | null {
  if (!telefone) return null;
  const digitos = telefone.replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

export function montarMensagemAtivacao(params: {
  alunoNome: string;
  organizacaoNome: string;
  link: string;
}) {
  return (
    `Olá ${params.alunoNome}! Seja bem-vindo(a) à ${params.organizacaoNome}. ` +
    `Seu acesso ao aplicativo ArkeFit já está disponível! Clique no link para definir sua senha ` +
    `e iniciar sua Anamnese M.A.P.A.®: ${params.link}`
  );
}

// Nota: o tsconfig do projeto roda com `strict: false` (sem
// strictNullChecks), e sem strictNullChecks o TypeScript não estreita
// (narrow) uniões discriminadas como `{ok:true} | {ok:false; erro:string}`
// — por isso este tipo de retorno é um objeto único com `erro` sempre
// presente (opcional), acessível sem precisar de narrowing.
export type ResultadoWhatsAppAtivacao = { ok: boolean; erro?: string };

// Busca o link de ativação tokenizado (via edge function, que usa
// supabase.auth.admin.generateLink) e abre o WhatsApp Web/app com a
// mensagem pré-preenchida em uma nova aba.
export async function abrirWhatsAppAtivacao(params: {
  userId: string;
  telefone: string | null | undefined;
  alunoNome: string;
  organizacaoNome: string;
}): Promise<ResultadoWhatsAppAtivacao> {
  const telefoneNormalizado = normalizarTelefoneBr(params.telefone);
  if (!telefoneNormalizado) {
    return { ok: false, erro: "Este aluno não tem telefone cadastrado." };
  }

  const { data, error } = await supabase.functions.invoke<{ action_link: string }>("gerar-link-ativacao", {
    body: { user_id: params.userId },
  });
  if (error) {
    return { ok: false, erro: await mensagemDeErroEdge(error, "Erro ao gerar o link de ativação.") };
  }
  if (!data?.action_link) {
    return { ok: false, erro: "Erro ao gerar o link de ativação." };
  }

  const mensagem = montarMensagemAtivacao({
    alunoNome: params.alunoNome,
    organizacaoNome: params.organizacaoNome,
    link: data.action_link,
  });
  const url = `https://wa.me/${telefoneNormalizado}?text=${encodeURIComponent(mensagem)}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return { ok: true };
}
