-- Alerta de tamanho do banco (23/09/2026).
--
-- No plano gratuito do Supabase, o banco que passa de 500 MB entra em modo
-- somente leitura: nenhuma academia registra treino, nenhuma catraca grava
-- acesso, nenhum webhook do Asaas é gravado. E nada avisa antes — o primeiro
-- sinal é o erro. No plano pago o disco cresce sozinho, mas cobra por GB
-- acima do incluído, e ali o aviso é de custo, não de parada.
--
-- Por isso o limite é configuração, não constante: 500 hoje, o tamanho do
-- disco contratado depois do upgrade (Visão Master → Configurações). E o
-- alerta anda no mesmo trilho das rotinas agendadas — mesma faixa vermelha,
-- mesmo e-mail de hora em hora, mesmo registro de "já avisei" —, porque um
-- segundo mecanismo de aviso seria um segundo lugar para esquecer de olhar.

insert into public.plataforma_config (chave, valor, descricao)
values (
  'limite_banco_mb', 500,
  'Tamanho do banco (MB) contra o qual o alerta de capacidade mede: 500 no plano gratuito (acima disso o banco fica somente leitura); no plano pago, o disco contratado. Avisa em 70% e 85%.'
)
on conflict (chave) do nothing;

create or replace function public.avaliar_capacidade()
returns table(nome text, situacao text, usado_mb numeric, limite_mb numeric, percentual numeric, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
  with medida as (
    select round(pg_database_size(current_database()) / 1048576.0, 1) as usado,
           (select valor from public.plataforma_config where chave = 'limite_banco_mb') as limite
  ),
  pct as (
    select usado, limite, case when limite > 0 then round(100 * usado / limite, 1) end as p from medida
  )
  select 'capacidade:banco',
         case when p is null then 'ok'
              when p >= 85 then 'banco_85'
              when p >= 70 then 'banco_70'
              else 'ok' end,
         usado, limite, p,
         case when p is null then 'limite não configurado'
              -- Vírgula decimal escrita à mão: o lc_numeric do banco é en_US.
              else replace(usado::text, '.', ',') || ' MB de ' || round(limite)::text || ' MB (' || replace(p::text, '.', ',') || '%)' end
    from pct;
$$;

comment on function public.avaliar_capacidade() is
  'Tamanho do banco contra plataforma_config.limite_banco_mb: ok, banco_70 ou banco_85. Entra em rotinas_para_alertar() e na faixa da Visão Master.';

revoke execute on function public.avaliar_capacidade() from public, anon, authenticated;
grant execute on function public.avaliar_capacidade() to service_role;

create or replace function public.get_superadmin_capacidade()
returns table(nome text, situacao text, usado_mb numeric, limite_mb numeric, percentual numeric, detalhe text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Acesso restrito à ArkeFit.' using errcode = '42501';
  end if;
  return query select * from public.avaliar_capacidade();
end;
$$;

revoke execute on function public.get_superadmin_capacidade() from public, anon;
grant execute on function public.get_superadmin_capacidade() to authenticated;

-- Capacidade entra no mesmo conjunto que as rotinas. O detalhe ("412 MB de
-- 500 MB (82%)") vai em ultimo_erro, que é o campo que o e-mail já mostra.
--
-- Lembrete: 24 h a partir de 85% (a parada está perto) e 7 dias entre 70% e
-- 85% (é aviso de planejamento; lembrar todo dia por semanas viraria ruído e
-- o ruído ensina a ignorar o e-mail que importa). Mudar de faixa, para cima
-- ou para baixo, é "novo".
create or replace function public.rotinas_para_alertar()
returns table(nome text, tipo text, situacao text, ultima_execucao timestamptz, ultimo_erro text)
language sql
stable
security definer
set search_path = public
as $$
  with atual as (
    select r.nome, r.situacao, r.ultima_execucao, r.ultimo_erro from public.avaliar_rotinas() r
    union all
    select c.nome, c.situacao, null::timestamptz, c.detalhe from public.avaliar_capacidade() c
  ),
  problema as (
    select * from atual where situacao in ('falhou', 'atrasada', 'banco_70', 'banco_85')
  )
  select a.nome,
         case when al.nome is null or al.situacao <> a.situacao then 'novo' else 'lembrete' end,
         a.situacao, a.ultima_execucao, a.ultimo_erro
    from problema a
    left join public.alertas_rotinas al on al.nome = a.nome
   where al.nome is null
      or al.situacao <> a.situacao
      or al.avisado_em < now() - case when a.situacao = 'banco_70' then interval '7 days' else interval '24 hours' end
  union all
  select al.nome, 'recuperou', coalesce(a.situacao, 'removida'), a.ultima_execucao,
         case when al.nome like 'capacidade:%' then a.ultimo_erro end
    from public.alertas_rotinas al
    left join atual a on a.nome = al.nome
   where a.nome is null or a.situacao not in ('falhou', 'atrasada', 'banco_70', 'banco_85');
$$;
