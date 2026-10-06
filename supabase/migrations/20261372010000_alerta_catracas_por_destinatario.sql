-- Aviso de catraca parada: "já avisei" por destinatário (06/10/2026).
--
-- Auditoria de prontidão, achado médio. O aviso vai ao gestor de cada
-- academia e à ArkeFit, mas o "já avisei" (`alertas_catracas`) era um só por
-- catraca, gravado quando o e-mail da ArkeFit saía:
--   - o e-mail do gestor falhava e ele ficava marcado como avisado — o
--     lembrete só voltava 24 horas depois;
--   - o da ArkeFit falhava e nada era marcado, e os gestores recebiam o mesmo
--     e-mail de novo a cada 2 minutos, até a ArkeFit receber o dela.
--
-- Agora cada destinatário (`arkefit` ou `gestor`) tem o próprio "já avisei",
-- gravado só quando o e-mail dele saiu, e o envio vai ao Resend com chave de
-- idempotência (`referencia`): se o registro falhar depois do envio, a
-- passada seguinte manda com a mesma chave e o Resend não entrega de novo.
--
-- As funções antigas (`catracas_para_alertar`, `registrar_alerta_catracas`)
-- ficam, olhando só a ArkeFit e marcando os dois, para a edge function
-- publicada continuar funcionando até a nova entrar. Saem numa migration
-- depois do deploy.

set lock_timeout = '5s';

alter table public.alertas_catracas
  add column if not exists destinatario text not null default 'arkefit';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alertas_catracas_destinatario_check') then
    alter table public.alertas_catracas
      add constraint alertas_catracas_destinatario_check check (destinatario in ('arkefit', 'gestor'));
  end if;
end $$;

-- A chave passa a ser a catraca e o destinatário. Antes da cópia abaixo, que
-- repete a catraca.
alter table public.alertas_catracas drop constraint if exists alertas_catracas_pkey;

-- O que já foi avisado até hoje valeu para os dois: sem esta cópia, todo
-- gestor receberia de novo, de uma vez, o aviso de catraca já avisada.
insert into public.alertas_catracas (catraca_id, organization_id, situacao, avisado_em, destinatario)
select a.catraca_id, a.organization_id, a.situacao, a.avisado_em, 'gestor'
  from public.alertas_catracas a
 where a.destinatario = 'arkefit'
   and not exists (select 1 from public.alertas_catracas g where g.catraca_id = a.catraca_id and g.destinatario = 'gestor');

alter table public.alertas_catracas add constraint alertas_catracas_pkey primary key (catraca_id, destinatario);

-- O que avisar, por destinatário. A `referencia` identifica o aviso (catraca,
-- tipo e o último "já avisei" ou o início da queda) e compõe a chave de
-- idempotência do e-mail: o mesmo aviso tem sempre a mesma referência até
-- ser registrado.
create or replace function public.catracas_a_avisar()
returns table(destinatario text, catraca_id uuid, organization_id uuid, academia text, catraca text, tipo text, situacao text,
              sem_sinal_desde timestamptz, detalhe text, referencia text)
language sql
stable
security definer
set search_path = public
as $$
  with atual as (
    select k.catraca_id, k.organization_id, k.situacao, k.sem_sinal_desde, k.detalhe
      from public.avaliar_catracas() k
  ),
  destinos as (
    select unnest(array['arkefit', 'gestor']) as destinatario
  )
  select d.destinatario, a.catraca_id, a.organization_id, o.nome, c.nome,
         case when al.catraca_id is null or al.situacao <> a.situacao then 'novo' else 'lembrete' end,
         a.situacao, a.sem_sinal_desde, a.detalhe,
         a.catraca_id::text || ':' || a.situacao || ':'
           || coalesce(extract(epoch from al.avisado_em)::bigint::text, extract(epoch from a.sem_sinal_desde)::bigint::text, current_date::text)
    from atual a
    cross join destinos d
    join public.organizacao_catracas c on c.id = a.catraca_id
    join public.organizations o on o.id = a.organization_id
    left join public.alertas_catracas al on al.catraca_id = a.catraca_id and al.destinatario = d.destinatario
   where a.situacao = 'catraca_offline'
     and (al.catraca_id is null or al.situacao <> a.situacao or al.avisado_em < now() - interval '24 hours')
  union all
  -- Voltou: só quando está de fato no ar. Fora do horário não é volta — é a
  -- janela de silêncio —, e catraca desativada no meio do caminho encerra o
  -- aviso como "desativada".
  select al.destinatario, al.catraca_id, al.organization_id, o.nome, c.nome, 'recuperou',
         case when a.catraca_id is null then 'desativada' else a.situacao end,
         null::timestamptz, coalesce(a.detalhe, o.nome || ' · ' || c.nome),
         al.catraca_id::text || ':recuperou:' || extract(epoch from al.avisado_em)::bigint::text
    from public.alertas_catracas al
    join public.organizacao_catracas c on c.id = al.catraca_id
    join public.organizations o on o.id = al.organization_id
    left join atual a on a.catraca_id = al.catraca_id
   where a.catraca_id is null or a.situacao = 'ok';
$$;
revoke execute on function public.catracas_a_avisar() from public, anon, authenticated;
grant execute on function public.catracas_a_avisar() to service_role;

-- "Já avisei" de um destinatário, depois que o e-mail dele saiu.
create or replace function public.registrar_aviso_catracas(_destinatario text, _itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if _destinatario not in ('arkefit', 'gestor') then
    raise exception 'Destinatário inválido: %', _destinatario using errcode = '22023';
  end if;
  for v in select * from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) loop
    if v->>'tipo' = 'recuperou' then
      delete from public.alertas_catracas
       where catraca_id = (v->>'catraca_id')::uuid and destinatario = _destinatario;
    else
      insert into public.alertas_catracas (catraca_id, organization_id, situacao, avisado_em, destinatario)
      values ((v->>'catraca_id')::uuid, (v->>'organization_id')::uuid, v->>'situacao', now(), _destinatario)
      on conflict on constraint alertas_catracas_pkey
      do update set situacao = excluded.situacao, avisado_em = excluded.avisado_em;
    end if;
  end loop;
end;
$$;
revoke execute on function public.registrar_aviso_catracas(text, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_aviso_catracas(text, jsonb) to service_role;

-- ── Compatibilidade até o deploy da edge function ──────────────────────────
-- A versão publicada lê esta e marca com a de baixo. Olhando só a linha da
-- ArkeFit e marcando as duas, ela faz o que fazia antes desta migration.
create or replace function public.catracas_para_alertar()
returns table(catraca_id uuid, organization_id uuid, academia text, catraca text, tipo text, situacao text,
              sem_sinal_desde timestamptz, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
  select x.catraca_id, x.organization_id, x.academia, x.catraca, x.tipo, x.situacao, x.sem_sinal_desde, x.detalhe
    from public.catracas_a_avisar() x
   where x.destinatario = 'arkefit';
$$;

create or replace function public.registrar_alerta_catracas(_itens jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.registrar_aviso_catracas('arkefit', _itens);
  perform public.registrar_aviso_catracas('gestor', _itens);
end;
$$;
revoke execute on function public.catracas_para_alertar() from public, anon, authenticated;
revoke execute on function public.registrar_alerta_catracas(jsonb) from public, anon, authenticated;
grant execute on function public.catracas_para_alertar() to service_role;
grant execute on function public.registrar_alerta_catracas(jsonb) to service_role;
