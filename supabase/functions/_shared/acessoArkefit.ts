import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "./verificacao.ts";

/**
 * As áreas da Visão Master: o espelho de `AreaArkefit` em
 * src/lib/acessosArkefit.ts e do `case` de `acesso_arkefit()` no banco.
 */
export type AreaArkefit = "carteira" | "cadastro" | "comercial" | "suporte" | "operacao" | "mentoria" | "financeiro" | "socio";

/**
 * Quem chama abre esta área da Visão Master? (08/10/2026, os níveis da
 * equipe ArkeFit.)
 *
 * A pergunta vai ao banco, `acesso_arkefit(área)`, com a sessão de quem chama
 * (o cliente com o token dele, não a service role): lá o Sócio passa em tudo,
 * e o nível da equipe contratada (`equipe_arkefit.niveis`) só com as duas
 * etapas, ativo e fora de sessão simulada. A sessão verificada é conferida
 * aqui também, antes, como em toda função que decide pelo acesso da ArkeFit
 * (`verificacao.guarda.test.ts`).
 *
 * Devolve `null` quando o banco não respondeu: quem chama responde com erro
 * nosso (500), e não com "sem permissão".
 */
export async function acessoArkefit(
  asUser: SupabaseClient,
  claims: { aal?: unknown } | null | undefined,
  area: AreaArkefit,
): Promise<boolean | null> {
  if (!verificada(claims)) return false;
  const { data, error } = await asUser.rpc("acesso_arkefit", { _area: area });
  if (error) return null;
  return data === true;
}
