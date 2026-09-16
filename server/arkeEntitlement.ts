import { getAlunoArkeLicenca, getProfileByUserId } from "./supabaseAdmin";

// Módulo Arke (CLAUDE.md §3/§8): conteúdo do arke-app é opt-in por aluno,
// nunca liberado só porque a organização assina o SaaS. Uma licença só
// pode estar ativa se a organização também tiver o módulo habilitado —
// isso é reforçado no toggle (arkeModule.toggle), não checado de novo
// aqui para não duplicar uma ida ao banco em todo request do aluno.
export async function alunoTemArke(userId: string) {
  const profile = await getProfileByUserId(userId);
  if (!profile?.organization_id) return false;
  const licenca = await getAlunoArkeLicenca(userId, profile.organization_id);
  return licenca?.ativo ?? false;
}

export async function assertAlunoTemArke(userId: string) {
  if (!(await alunoTemArke(userId))) throw new Error("Este conteúdo faz parte do método Arke, que ainda não está ativo para você. Fale com seu profissional.");
}
