-- Convite de equipe (saas_invitations) precisa do nome do convidado para
-- personalizar o e-mail que agora é realmente enviado (antes o token era
-- gerado e devolvido na resposta da API, mas nunca chegava a ninguém — nem
-- por e-mail nem exibido na tela para o admin repassar). Tabela vazia em
-- produção (0 linhas) — seguro tornar a coluna obrigatória nesta mesma
-- migração. Ver server/db.ts (createOrganizationInvitation,
-- acceptOrganizationInvitationSignup).
alter table public.saas_invitations add column full_name text not null;
