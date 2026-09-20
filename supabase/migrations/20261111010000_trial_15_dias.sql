-- Trial padrão de 15 dias, igual para todo mundo: planos B2B (academia
-- assinando a plataforma) e planos ARKE do aluno (nível de atacado).
--
-- Hoje `organizations.trial_vencimento` é uma data solta que ninguém
-- preenche — as duas organizações em trial do ambiente estão com o campo
-- nulo, e get_superadmin_funil_sinais() já apontava isso como
-- `trials_sem_prazo`. Trial sem prazo não é trial: nunca vence, nunca vira
-- cobrança e nunca aparece como perdido no funil.

-- ---------------------------------------------------------------------
-- Fonte única do prazo
-- ---------------------------------------------------------------------
-- Uma função em vez de literais espalhados: o trigger abaixo, o default de
-- aluno_assinaturas e a Edge Function asaas-create-subscription (que lê
-- isto por RPC antes de montar a assinatura no Asaas) passam todos por
-- aqui. Mudar o prazo é mexer num lugar só.
create or replace function public.arke_trial_dias()
returns integer
language sql
immutable
set search_path = public
as $$ select 15 $$;

comment on function public.arke_trial_dias() is
  'Duração padrão do período de testes, em dias, para planos B2B e planos ARKE do aluno.';

-- ---------------------------------------------------------------------
-- B2B: organizations
-- ---------------------------------------------------------------------
create or replace function public.definir_trial_vencimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só preenche o que está vazio: uma data definida na mão pelo Super Admin
  -- (trial estendido numa negociação, por exemplo) nunca é sobrescrita.
  if new.status = 'trial' and new.trial_vencimento is null then
    new.trial_vencimento := current_date + public.arke_trial_dias();
  end if;

  -- Saiu do trial (virou ativo, cancelado...): a data deixa de valer e
  -- ficaria mentindo no painel. Zera para o funil não contar como
  -- "trial vencido" quem já converteu.
  if tg_op = 'UPDATE' and old.status = 'trial' and new.status <> 'trial' then
    new.trial_vencimento := null;
  end if;

  return new;
end;
$$;

-- Nem endpoint nem RPC: só o trigger chama.
revoke all on function public.definir_trial_vencimento() from public, anon, authenticated;

drop trigger if exists trg_definir_trial_vencimento on public.organizations;
create trigger trg_definir_trial_vencimento
  before insert or update of status, trial_vencimento on public.organizations
  for each row execute function public.definir_trial_vencimento();

-- Backfill: as organizações que já estão em trial ganham o prazo contado a
-- partir da data em que foram criadas — é quando o teste delas começou de
-- fato, não hoje.
update public.organizations
   set trial_vencimento = (created_at at time zone 'UTC')::date + public.arke_trial_dias()
 where status = 'trial'
   and trial_vencimento is null;

-- ---------------------------------------------------------------------
-- B2C: aluno_assinaturas (planos ARKE do aluno)
-- ---------------------------------------------------------------------
-- Durante o trial a assinatura fica 'ativa' de propósito: o aluno precisa
-- do acesso liberado justamente para testar. O que muda é a cobrança — a
-- primeira fatura no Asaas vence em trial_fim, não na criação.
alter table public.aluno_assinaturas
  add column if not exists trial_fim date default (current_date + public.arke_trial_dias());

comment on column public.aluno_assinaturas.trial_fim is
  'Fim do período de testes. Enquanto current_date <= trial_fim o aluno tem acesso sem nenhuma cobrança emitida; é a data de vencimento da primeira fatura no Asaas.';
