-- Contato pelo site: guarda de 12 meses sem andamento (25/09/2026).
--
-- A Política 2026-09-25 promete que o contato recebido pela página de vendas
-- que não virou cliente é apagado depois de 12 meses sem andamento. Promessa
-- de Política só vale se o sistema cumpre sozinho — então esta rotina entra
-- ANTES da Política. "Sem andamento" conta da última atualização (situação ou
-- anotação), e não da chegada, para não apagar uma negociação em curso; quem
-- fechou ("fechado") fica, porque aí o contato virou relação com o cliente.

create or replace function public.limpar_leads_site_antigos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  apagados integer;
begin
  delete from public.leads_site
   where status <> 'fechado'
     and coalesce(atualizado_em, created_at) < now() - interval '12 months';
  get diagnostics apagados = row_count;
  return apagados;
end;
$$;

revoke all on function public.limpar_leads_site_antigos() from public, anon, authenticated;

-- Todo dia às 03:50 UTC (00:50 em Brasília), longe das rotinas da manhã.
select cron.schedule('arke-retencao-contatos-site', '50 3 * * *', $cmd$select public.limpar_leads_site_antigos()$cmd$);
