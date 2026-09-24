-- Limpeza da versão 1.0 que depende do app novo estar no ar.
--
-- APLICAR SÓ DEPOIS DO DEPLOY DO APP 1.0: as duas coisas que saem aqui ainda
-- são usadas pelo app anterior, e tirá-las antes quebraria a tela publicada.
--
-- 1. Credenciais de parceiro em texto puro. A tela de Integrações anterior lê
--    estas colunas; a nova grava pelo salvar_credencial_parceiro(), no Vault
--    (20261246010000). Desde aquela migration uma restrição impede gravar
--    segredo nelas, então não há o que migrar: estão vazias por construção.
-- 2. get_superadmin_gateways(): a regra antiga de "online" (só o sinal de 5
--    em 5 minutos). A Visão Master passou a usar get_superadmin_equipamentos(),
--    com a mesma regra da tela da academia; manter a antiga alcançável
--    deixaria duas respostas para a mesma pergunta.
alter table public.organizacao_credenciais_parceiro
  drop constraint if exists credencial_parceiro_sem_texto_puro;

alter table public.organizacao_credenciais_parceiro
  drop column if exists api_key,
  drop column if exists client_secret,
  drop column if exists webhook_secret;

drop function if exists public.get_superadmin_gateways();
