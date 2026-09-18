-- Selamento e Expansão Comercial — habilita Supabase Realtime para o
-- painel /admin/catracas monitorar status de dispositivo e novos
-- acessos em tempo real, sem depender de polling.
alter publication supabase_realtime add table public.organizacao_catracas;
alter publication supabase_realtime add table public.acessos_catraca_logs;
