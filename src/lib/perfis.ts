import { supabase } from "@/integrations/supabase/client";
import { porLotes } from "@/lib/paginar";

/**
 * Nome e telefone de cada usuário, em lotes: a lista de ids de uma academia
 * inteira não cabe numa consulta só (ver `paginar.ts`). Falha de leitura vira
 * erro na tela, não "—" no lugar de todos os nomes.
 */
export async function perfisDosUsuarios(userIds: string[]) {
  const perfis = await porLotes(userIds, (lote) => supabase.from("profiles").select("user_id, full_name, phone").in("user_id", lote));
  return new Map(perfis.map((p) => [p.user_id, p]));
}

/**
 * Só o nome de cada usuário, em lotes, pelo RLS de quem pede: quem não pode
 * ler o perfil simplesmente não volta no mapa. É o que a conversa com o aluno
 * usa para dizer qual pessoa da equipe escreveu (`remetenteDoChat.ts`), sem
 * levar telefone junto.
 */
export async function nomesDosUsuarios(userIds: string[]): Promise<Map<string, string>> {
  const perfis = await porLotes(userIds, (lote) => supabase.from("profiles").select("user_id, full_name").in("user_id", lote));
  return new Map(perfis.map((p) => [p.user_id, p.full_name]));
}
