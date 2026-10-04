import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verificada } from "./verificacao.ts";

// Quem cria cobrança recorrente para um aluno: a gestão e a recepção da
// academia dele, ou a ArkeFit com as duas etapas. É a mesma regra da cobrança
// avulsa e da situação do aluno.
//
// Matrícula e assinatura do Método conferiam o acesso só pela regra de leitura
// das tabelas, e essa regra deixa o próprio aluno ler o cadastro dele, o plano
// e a academia: sem esta trava, o aluno se matricularia sozinho, escolhendo o
// valor da própria mensalidade.

export const PAPEIS_QUE_COBRAM = ["gestor", "recepcao"];

export async function podeCobrarNaAcademia(
  admin: SupabaseClient,
  userId: string,
  organizationId: string,
  claims: { aal?: unknown } | null | undefined
): Promise<boolean> {
  // Organização fixada: quem tem vínculo em duas academias não cai na
  // armadilha do vínculo duplo (`unique(organization_id, user_id)`).
  const { data: vinculo } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (vinculo && PAPEIS_QUE_COBRAM.includes(vinculo.role)) return true;
  if (!verificada(claims)) return false;
  const { data: papeis } = await admin.from("user_roles").select("role").eq("user_id", userId);
  return (papeis ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke");
}

export const MENSAGEM_SO_QUEM_COBRA = "Só a gestão e a recepção da academia matriculam e cobram alunos.";
