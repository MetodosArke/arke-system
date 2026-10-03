-- A marca da academia no app do aluno (decisão do responsável de 03/10/2026:
-- logo, nome, cor e o app instalado com o nome e o ícone da academia; a
-- marca da academia também para o aluno do Método; "com tecnologia ArkeFit"
-- discreto).
--
-- O logo já existia (`organizations.logo_url`) e não aparecia em lugar
-- nenhum do app. Entram a cor e os dois ícones do app instalado. Os ícones
-- são gerados no navegador do gestor a partir do logo (quadrados, com a
-- margem que o Android exige para não cortar o desenho) e guardados no mesmo
-- bucket do logo.
--
-- A cor é a que a academia escolheu. Os tons de cada tema, com contraste,
-- saem dela no app (`src/lib/marcaAcademia.ts`): o banco guarda a escolha,
-- não o ajuste, para o ajuste poder melhorar sem migrar dado.
--
-- Quem altera: a mesma regra de alteração da organização (gestor dela ou a
-- ArkeFit). `trg_proteger_colunas_organizacao` não cobre estas colunas de
-- propósito: a marca é da academia.

alter table public.organizations
  add column if not exists cor_marca text,
  add column if not exists icone_app_192_url text,
  add column if not exists icone_app_512_url text;

alter table public.organizations
  drop constraint if exists organizations_cor_marca_hex,
  add constraint organizations_cor_marca_hex check (cor_marca is null or cor_marca ~ '^#[0-9a-f]{6}$'),
  drop constraint if exists organizations_icones_https,
  add constraint organizations_icones_https check (
    (icone_app_192_url is null or icone_app_192_url ~ '^https://')
    and (icone_app_512_url is null or icone_app_512_url ~ '^https://')
  );

comment on column public.organizations.cor_marca is
  'Cor da marca da academia no app do aluno, "#rrggbb". Os tons de cada tema saem dela no app, com contraste.';
comment on column public.organizations.icone_app_192_url is
  'Ícone 192x192 do app instalado com a marca da academia (PNG gerado do logo).';
comment on column public.organizations.icone_app_512_url is
  'Ícone 512x512 do app instalado com a marca da academia (PNG gerado do logo, com margem para o Android).';

-- A marca pública da academia, pelo endereço (slug): a tela de entrar da
-- academia, a matrícula, o primeiro acesso e o manifesto do app instalado.
-- É o que a própria academia mostra na porta: nome, logo, cor e ícones. Só
-- academia em funcionamento; a encerrada volta a ser ArkeFit.
create or replace function public.marca_academia(_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nome', o.nome,
    'slug', o.slug,
    'logo_url', o.logo_url,
    'cor_marca', o.cor_marca,
    'icone_192', o.icone_app_192_url,
    'icone_512', o.icone_app_512_url
  )
  from public.organizations o
  where o.slug = lower(trim(_slug))
    and o.status in ('ativo', 'trial', 'inadimplente');
$$;

revoke all on function public.marca_academia(text) from public;
grant execute on function public.marca_academia(text) to anon, authenticated, service_role;

-- A marca dos e-mails de acesso (convite, senha): a academia de quem é
-- aluno. Quem é da equipe de alguma academia recebe o e-mail da ArkeFit,
-- porque o acesso dele é ao painel, e não ao app de uma academia. Com mais de
-- uma matrícula, vale a mais recente. Só para o hook de e-mail, que roda com
-- a service role: o hook recebe o id de quem pediu e não tem sessão.
create or replace function public.marca_do_usuario(_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'nome', o.nome,
    'slug', o.slug,
    'logo_url', o.logo_url,
    'icone_192', o.icone_app_192_url
  )
  from public.alunos a
  join public.organizations o on o.id = a.organization_id
  where a.user_id = _user_id
    and o.status in ('ativo', 'trial', 'inadimplente')
    and not exists (
      select 1 from public.organization_members m
      where m.user_id = _user_id and m.role <> 'aluno' and m.status = 'active'
    )
  order by a.created_at desc
  limit 1;
$$;

revoke all on function public.marca_do_usuario(uuid) from public, anon, authenticated;
grant execute on function public.marca_do_usuario(uuid) to service_role;
