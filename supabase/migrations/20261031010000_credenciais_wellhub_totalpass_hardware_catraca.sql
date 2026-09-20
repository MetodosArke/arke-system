-- Painel /admin/configuracoes/integracoes: campos completos de credenciais
-- Wellhub (Gympass) e TotalPass, e mapeamento do hardware físico da
-- catraca (driver/IP/porta/delay), a pedido do usuário. Estrutura fica
-- pronta para quando a integração automática com as APIs dos parceiros
-- for implementada (documentação/credenciais reais ainda pendentes) — a
-- liberação por enquanto continua manual (catraca-checkin-parceiro-externo).

-- organizacao_credenciais_parceiro já guardava identificador (Gym ID /
-- Gym Unit ID) e api_key (Partner Token / Client ID). Faltam:
-- client_secret (TotalPass) e webhook_secret (Wellhub, opcional).
alter table public.organizacao_credenciais_parceiro
  add column client_secret text,
  add column webhook_secret text;

-- Mapeamento de hardware por catraca: qual driver/fabricante falar, IP e
-- porta na rede local (ou nuvem) do dispositivo, e por quantos segundos o
-- relé fica liberado. Consumido pelo ARKE® Gateway Local (packages/gateway)
-- para saber como comandar o dispositivo físico correspondente.
alter table public.organizacao_catracas
  add column driver text check (driver in ('henry', 'control_id', 'topdata', 'intelbras', 'mock')),
  add column ip_address text,
  add column porta integer,
  add column delay_liberacao_seg integer not null default 4 check (delay_liberacao_seg between 1 and 30);
