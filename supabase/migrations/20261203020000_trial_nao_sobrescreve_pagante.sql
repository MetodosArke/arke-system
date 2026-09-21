-- iniciar_trial_metodo_arke sobrescreve a linha de aluno_assinaturas (é
-- 1 por aluno) e zera asaas_subscription_id. Num aluno pagante, a assinatura
-- continuaria cobrando no Asaas e o banco perderia a referência a ela — uma
-- órfã criada pelo próprio produto. A Visão Master já esconde o botão nesse
-- caso; a trava mora aqui porque a tela não é fronteira.
create or replace function public.iniciar_trial_metodo_arke(_aluno_id uuid, _nivel nivel_atacado)
returns aluno_assinaturas
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_assinatura public.aluno_assinaturas;
begin
  select a.organization_id into v_org from public.alunos a where a.id = _aluno_id;
  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Apenas o Super Admin ArkeFit pode iniciar um trial.';
  end if;

  if exists (
    select 1 from public.aluno_assinaturas s
     where s.aluno_id = _aluno_id
       and s.asaas_subscription_id is not null
       and s.status in ('ativa', 'atrasada')
  ) then
    raise exception 'Este aluno tem assinatura paga do Método ARKE. Cancele-a antes de iniciar um trial.';
  end if;

  update public.alunos
     set metodo_arke_status = 'ativo',
         nivel_atacado = _nivel
   where id = _aluno_id;

  insert into public.aluno_assinaturas
    (organization_id, aluno_id, nivel_atacado, valor_cobrado, status, trial_fim)
  values
    (v_org, _aluno_id, _nivel, 0, 'trial', current_date + public.arke_trial_dias())
  on conflict (aluno_id) do update
    set nivel_atacado = excluded.nivel_atacado,
        valor_cobrado = 0,
        status = 'trial',
        trial_fim = excluded.trial_fim,
        fatura_pendente_url = null,
        asaas_subscription_id = null,
        proxima_cobranca = null
  returning * into v_assinatura;

  return v_assinatura;
end;
$function$;
