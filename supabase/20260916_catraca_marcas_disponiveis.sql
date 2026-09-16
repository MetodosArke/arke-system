-- CLAUDE.md §8.4: mapeia as marcas de catraca/controle de acesso mais
-- usadas pelas academias clientes, além das 4 já cobertas em
-- 20260915_integracoes_beneficios_catraca.sql (Control iD, Topdata,
-- Henry, Dimep). `brand` continua sendo só metadado (ver server/access.ts
-- — nenhuma marca tem lógica de protocolo própria neste backend hoje);
-- ampliar a lista não muda nenhuma decisão de acesso, só o que a
-- organização pode selecionar no onboarding/configuração da unidade.
alter table public.saas_turnstile_integrations drop constraint saas_turnstile_integrations_brand_check;

alter table public.saas_turnstile_integrations add constraint saas_turnstile_integrations_brand_check
  check (brand in ('control_id', 'topdata', 'henry', 'dimep', 'intelbras', 'zkteco', 'nitgen', 'hikvision', 'madis', 'primme', 'nedap', 'suprema', 'outra'));
