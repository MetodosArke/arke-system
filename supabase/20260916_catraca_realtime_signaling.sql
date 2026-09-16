-- Sessão B, fatia B2 (D-B1): sinalização nuvem → agente local via Supabase
-- Realtime para o comando "testar conexão", e um heartbeat HTTP simples
-- (mesmo contrato de autenticação por CATRACA_API_KEY do check-in já
-- existente) para o agente reportar status e resultado de volta — sem
-- exigir um servidor próprio com conexão persistente (a Vercel roda como
-- função serverless).
--
-- last_test_requested_at marca quando a nuvem pediu o teste (permite a UI
-- mostrar "aguardando resposta" e detectar timeout, já que a nuvem nunca
-- fica esperando uma conexão WebSocket aberta dentro da própria função).
-- last_test_at/result/message são preenchidos quando o agente responde via
-- POST /api/v1/access/test-result. `status`/`last_ping_at` já existiam
-- (fatia B1) e continuam vindo do heartbeat — server/integrations.ts passa
-- a recalcular o status exibido a partir de last_ping_at (heartbeat velho
-- não prova que o equipamento está online agora).
alter table public.turnstile_devices
  add column last_test_requested_at timestamptz,
  add column last_test_at timestamptz,
  add column last_test_result text check (last_test_result in ('success', 'failed')),
  add column last_test_message text;
