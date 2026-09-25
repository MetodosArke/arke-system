-- Verificação em duas etapas nas contas da ArkeFit (24/09/2026).
--
-- O Super Admin e o Admin ARKE atravessam todas as academias: leem a
-- operação de todas e podem entrar como qualquer perfil (impersonar-perfil).
-- Até aqui uma senha vazada abria tudo isso. Agora o papel da ArkeFit só vale
-- numa sessão verificada com o código do aplicativo autenticador (`aal2` no
-- token). É aqui, em `has_role`, porque é por ela que passam todas as regras
-- de acesso e funções do banco: conferido em 24/09/2026, nenhuma política lê
-- `user_roles` direto.
--
-- O que não muda:
--   * consultar o papel de OUTRA pessoa (quem é Super Admin, para mandar um
--     e-mail) e o contexto sem sessão (rotinas, service_role) seguem iguais —
--     a verificação é de quem está usando o papel, não de quem é consultado;
--   * os papéis da academia (gestor, recepção, professor, aluno) seguem com
--     senha, como hoje.
-- As edge functions que conferem o papel da ArkeFit exigem o mesmo
-- (`_shared/verificacao.ts`), e a tela pede o cadastro do código antes de
-- abrir a Visão Master.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
     and (
       _role not in ('superadmin', 'admin_arke')
       or _user_id is distinct from auth.uid()
       or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     )
$$;
