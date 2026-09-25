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
