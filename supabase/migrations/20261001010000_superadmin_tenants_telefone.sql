-- asaas-emitir-cobranca-b2b precisa do telefone da organização para criar o
-- customer no Asaas (campo obrigatório junto de nome/cpfCnpj/email). O
-- SuperAdmin edita esse telefone na aba Informações, mas get_superadmin_tenants()
-- ainda não devolvia a coluna — sem ela a tela não consegue nem exibir nem
-- salvar o valor atual.
drop function if exists public.get_superadmin_tenants();

create or replace function public.get_superadmin_tenants()
returns table (
  organization_id       uuid,
  nome                   text,
  slug                   text,
  status                 public.org_status,
  plano_b2b              public.plano_b2b,
  tipo                   public.organization_tipo,
  created_at             timestamptz,
  alunos_total           bigint,
  mrr_organizacao        numeric,
  assinaturas_atrasadas  bigint,
  ultima_atividade       timestamptz,
  cnpj_cpf               text,
  telefone               text,
  trial_vencimento       date,
  gestor_email           text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.';
  end if;

  return query
  select
    o.id as organization_id,
    o.nome,
    o.slug,
    o.status,
    o.plano_b2b,
    o.tipo,
    o.created_at,
    (select count(*) from public.alunos a where a.organization_id = o.id) as alunos_total,
    coalesce((select sum(s.valor_cobrado) from public.aluno_assinaturas s
              where s.organization_id = o.id and s.status = 'ativa'), 0) as mrr_organizacao,
    (select count(*) from public.aluno_assinaturas s
      where s.organization_id = o.id and s.status = 'atrasada') as assinaturas_atrasadas,
    greatest(
      (select max(c.created_at) from public.checkins c where c.organization_id = o.id),
      (select max(t.created_at) from public.treinos t where t.organization_id = o.id)
    ) as ultima_atividade,
    o.cnpj_cpf,
    o.telefone,
    o.trial_vencimento,
    (
      select u.email::text
      from public.organization_members m
      join auth.users u on u.id = m.user_id
      where m.organization_id = o.id and m.role = 'gestor' and m.status = 'active'
      order by m.created_at asc
      limit 1
    ) as gestor_email
  from public.organizations o
  order by o.created_at desc;
end;
$$;
