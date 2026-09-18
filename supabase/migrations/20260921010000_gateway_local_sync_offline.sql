-- ARKE® Gateway Local (middleware Node.js) — suporte a contingência
-- offline: marca quais acessos foram validados localmente (sem consultar
-- a nuvem em tempo real) para diferenciar de validações online no
-- histórico/auditoria.
alter table public.acessos_catraca_logs
  add column if not exists validado_offline boolean not null default false;

comment on column public.acessos_catraca_logs.validado_offline is
  'true quando a liberação/bloqueio foi decidida pelo cache local do ARKE Gateway (sem contato com a nuvem em tempo real) e sincronizada depois que a conexão voltou.';
