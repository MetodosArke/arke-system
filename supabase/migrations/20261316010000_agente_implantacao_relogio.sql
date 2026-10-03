-- O agente de implantação grava as datas com o relógio dele (03/10/2026).
--
-- O início da etapa, a reserva e o envio de cada mensagem eram gravados com o
-- now() do banco, e as decisões (o teto do dia, o lembrete, o "1 dia útil
-- parado") eram tomadas com o relógio da função. Em produção os dois são o
-- mesmo instante; na corrente de teste, que simula a semana pelo corpo
-- `agora`, eles divergiam, e o teto e o chamado eram medidos contra datas
-- trocadas. Um relógio só: a função passa o dela, e o padrão continua now().

drop function if exists public.registrar_etapa_implantacao(uuid, text);
create function public.registrar_etapa_implantacao(_organization_id uuid, _etapa text, _agora timestamptz default now())
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.implantacao as i (organization_id, etapa_atual, etapa_atual_desde)
  values (_organization_id, _etapa, _agora)
  on conflict (organization_id) do update
    set etapa_atual = excluded.etapa_atual,
        etapa_atual_desde = case when i.etapa_atual is distinct from excluded.etapa_atual or i.etapa_atual_desde is null
                                 then _agora else i.etapa_atual_desde end,
        updated_at = now()
  returning etapa_atual_desde;
$$;
revoke execute on function public.registrar_etapa_implantacao(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_etapa_implantacao(uuid, text, timestamptz) to service_role;

drop function if exists public.reservar_mensagem_implantacao(uuid, text, text, text, text);
create function public.reservar_mensagem_implantacao(
  _organization_id uuid, _tipo text, _chave text, _etapa text, _motivo text, _agora timestamptz default now())
returns boolean
language sql
security definer
set search_path = public
as $$
  with r as (
    insert into public.implantacao_mensagens as m (organization_id, tipo, chave, etapa, motivo, criado_em)
    values (_organization_id, _tipo, _chave, _etapa, _motivo, _agora)
    on conflict (organization_id, tipo, chave) do update
      set status = 'reservada', criado_em = _agora, erro = null, motivo = excluded.motivo
      where m.status = 'falhou' or (m.status = 'reservada' and m.criado_em < _agora - interval '15 minutes')
    returning 1
  )
  select exists (select 1 from r);
$$;
revoke execute on function public.reservar_mensagem_implantacao(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.reservar_mensagem_implantacao(uuid, text, text, text, text, timestamptz) to service_role;

drop function if exists public.concluir_mensagem_implantacao(uuid, text, text, boolean, text, text, integer);
create function public.concluir_mensagem_implantacao(
  _organization_id uuid, _tipo text, _chave text, _ok boolean, _resend_id text, _erro text, _destinatarios integer,
  _agora timestamptz default now())
returns void
language sql
security definer
set search_path = public
as $$
  update public.implantacao_mensagens
     set status = case when _ok then 'enviada' else 'falhou' end,
         enviado_em = case when _ok then _agora end,
         resend_id = _resend_id,
         erro = case when _ok then null else left(coalesce(_erro, 'Falhou sem detalhe.'), 300) end,
         destinatarios = _destinatarios
   where organization_id = _organization_id and tipo = _tipo and chave = _chave;
$$;
revoke execute on function public.concluir_mensagem_implantacao(uuid, text, text, boolean, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.concluir_mensagem_implantacao(uuid, text, text, boolean, text, text, integer, timestamptz) to service_role;
