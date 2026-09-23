-- Rede de segurança da confirmação de giro (23/09/2026).
--
-- Um acesso liberado com giro 'pendente' só vira presença quando o gateway
-- fecha o giro. Se esse aviso se perder — internet caiu depois da
-- liberação, gateway reiniciou durante a espera, Monitor desconfigurado —,
-- o registro ficaria pendente para sempre e o aluno que entrou perderia a
-- presença. Isso é exatamente a inércia falsa que ligar a catraca à
-- presença existe para evitar.
--
-- Então a nuvem fecha sozinha o que ficou pendente por mais de 10 minutos,
-- como 'sem_confirmacao', que conta presença. O custo é assimétrico e foi
-- escolhido assim: no pior caso, um aviso de desistência perdido vira uma
-- presença a mais; nunca a presença de quem entrou some.
--
-- O dia da presença continua sendo o do acesso (created_at), então fechar
-- depois da meia-noite não muda o dia.

create or replace function public.fechar_giros_pendentes()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with fechados as (
    update public.acessos_catraca_logs
       set giro = 'sem_confirmacao'
     where giro = 'pendente'
       and created_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::integer from fechados;
$$;

comment on function public.fechar_giros_pendentes() is
  'Fecha como sem_confirmacao (conta presenca) o giro que ficou pendente por mais de 10 min. Rede de seguranca do aviso de giro perdido.';

revoke execute on function public.fechar_giros_pendentes() from public;
grant execute on function public.fechar_giros_pendentes() to service_role;

-- De hora em hora, no formato que avaliar_rotinas() sabe vigiar ("parou de
-- rodar" é detectado para `m * * * *`).
select cron.unschedule(jobid) from cron.job where jobname = 'arke-fechar-giros-pendentes';
select cron.schedule('arke-fechar-giros-pendentes', '7 * * * *', 'select public.fechar_giros_pendentes()');
