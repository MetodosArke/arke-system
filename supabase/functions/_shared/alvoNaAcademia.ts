import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Até onde a equipe de uma academia alcança a conta de outra pessoa.
//
// Simular o perfil, trocar o e-mail de login e gerar link de ativação mexem na
// CONTA da pessoa, e não só no vínculo dela com a academia. Uma conta pode ter
// vínculo em mais de uma academia (aluno aqui e gestor de outra, professor em
// duas unidades), então a equipe de uma academia que alcança a conta alcança
// também a outra academia — e tudo o que a pessoa vê lá.
//
// Por isso a equipe só age sobre quem está apenas na academia dela. Quem
// também tem vínculo em outra academia, ou é da ArkeFit, fica com a ArkeFit
// (com as duas etapas) ou com a própria pessoa.
//
// Falha da consulta conta como "não": aqui o erro é deixar passar.

export async function alvoSoNaAcademia(admin: SupabaseClient, alvoId: string, organizationId: string): Promise<boolean> {
  try {
    const [vinculos, matriculas, papeis] = await Promise.all([
      admin.from("organization_members").select("organization_id").eq("user_id", alvoId).eq("status", "active"),
      admin.from("alunos").select("organization_id").eq("user_id", alvoId),
      admin.from("user_roles").select("role").eq("user_id", alvoId),
    ]);
    if (vinculos.error || matriculas.error || papeis.error) return false;
    if ((papeis.data ?? []).some((p) => p.role === "superadmin" || p.role === "admin_arke")) return false;
    const orgs = [...(vinculos.data ?? []), ...(matriculas.data ?? [])].map((v) => v.organization_id as string);
    return orgs.every((o) => o === organizationId);
  } catch {
    return false;
  }
}

export const MENSAGEM_OUTRA_ACADEMIA =
  "Esta pessoa também tem acesso a outra academia (ou à ArkeFit). Para proteger a outra conta, isso fica com a ArkeFit ou com a própria pessoa.";
