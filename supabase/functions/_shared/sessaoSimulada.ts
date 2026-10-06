import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// A sessão de quem chama é um perfil simulado pela ArkeFit?
//
// A mesma conta de `sessao_simulada()` no banco: `impersonar-perfil` grava o
// `session_id` da sessão que abre em `sessoes_simuladas`, antes de entregá-la.
// O banco recusa sozinho as autorizações da pessoa (gatilhos), mas a função que
// grava pela service role passa por cima do banco. Por isso a função que deixa
// o aluno agir por si mesmo (cadastrar o cartão, cancelar a própria assinatura)
// pergunta aqui antes: em perfil simulado, quem está do outro lado é a ArkeFit,
// e não o aluno.
//
// Falha da consulta lança: quem chama responde 500, e não "perfil simulado" nem
// "pode seguir".

export const MENSAGEM_PERFIL_SIMULADO =
  "Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.";

export async function sessaoSimulada(admin: SupabaseClient, claims: Record<string, unknown> | null | undefined): Promise<boolean> {
  const sessao = typeof claims?.session_id === "string" ? claims.session_id : "";
  if (!sessao) return false;
  const { data, error } = await admin.from("sessoes_simuladas").select("session_id").eq("session_id", sessao).maybeSingle();
  if (error) throw new Error(`sessoes_simuladas: ${error.code ?? "erro"}`);
  return !!data;
}
