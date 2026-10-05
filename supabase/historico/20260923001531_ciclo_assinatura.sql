-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

create or replace function public.aluno_inadimplente_b2c(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.aluno_assinaturas a
    join public.pagamentos p on p.aluno_assinatura_id = a.id
    where a.aluno_id = _aluno_id
      and a.status in ('ativa', 'atrasada')
      and p.status in ('pendente', 'atrasado')
      and (
        p.status = 'atrasado'
        or (p.vencimento is not null and p.vencimento < current_date)
      )
  );
$$;

comment on function public.aluno_inadimplente_b2c(uuid) is
  'Aluno com cobranca do Metodo emitida e vencida sem confirmacao. Usa lista de inclusao de status (pendente/atrasado): cobranca cancelada ou estornada nao e divida.';

alter table public.aluno_assinaturas
  add column if not exists cancelada_em timestamptz,
  add column if not exists cancelada_por uuid references auth.users(id) on delete set null,
  add column if not exists cancelamento_motivo text,
  add column if not exists pausada_em timestamptz,
  add column if not exists pausada_por uuid references auth.users(id) on delete set null;

comment on column public.aluno_assinaturas.cancelamento_motivo is
  'Por que a cobranca foi encerrada. Obrigatorio no cancelamento pela edge function.';

create or replace function public.impedir_exclusao_com_cobranca_viva()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _viva int;
begin
  select count(*) into _viva
    from public.aluno_assinaturas s
   where s.aluno_id = old.id
     and s.asaas_subscription_id is not null
     and s.status in ('ativa', 'atrasada', 'pausada');

  if _viva > 0 then
    raise exception
      'Este aluno tem assinatura ativa no gateway de pagamento. Cancele a cobranca antes de excluir, senao ela continua cobrando sem registro no ARKE.'
      using errcode = 'restrict_violation';
  end if;

  select count(*) into _viva
    from public.aluno_matriculas_academia m
   where m.aluno_id = old.id
     and m.asaas_subscription_id is not null
     and m.status in ('ativa', 'pausada');

  if _viva > 0 then
    raise exception
      'Este aluno tem mensalidade ativa no gateway de pagamento. Cancele a cobranca antes de excluir, senao ela continua cobrando sem registro no ARKE.'
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_impedir_exclusao_com_cobranca_viva on public.alunos;
create trigger trg_impedir_exclusao_com_cobranca_viva
  before delete on public.alunos
  for each row execute function public.impedir_exclusao_com_cobranca_viva();

revoke execute on function public.impedir_exclusao_com_cobranca_viva() from public;
