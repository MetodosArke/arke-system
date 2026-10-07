-- A troca do e-mail de login fica na auditoria sem o e-mail (auditoria de
-- prontidão, 06/10/2026).
--
-- O que estava errado: quando a ArkeFit troca o e-mail de login do gestor
-- (`superadmin-suporte-tenant`, ação `alterar_email_gestor`), o registro
-- `gestor.email_alterado` guardava o e-mail novo em claro, em
-- `detalhes.novo_email`. A trilha não tem prazo, e o e-mail é dado pessoal
-- que já mora no lugar dele (a conta). Quem trocou e de quem foi a troca ficam
-- no registro pelo id (`ator_user_id` e `entidade_id`); que o e-mail mudou é o
-- fato a auditar, e não para qual endereço.
--
-- No molde de 20261376010000 (a simulação sem e-mail):
--   1. a função passa a mandar só que mudou (no mesmo PR);
--   2. um gatilho tira do registro dessa ação toda chave com e-mail e deixa
--      `{"mudou": "e-mail de login"}` — vale já, antes de a função nova ser
--      publicada, e para qualquer caminho que volte a mandar;
--   3. os registros que já existem perdem o e-mail (hoje não há nenhum).

set lock_timeout = '5s';

create or replace function public.auditoria_troca_de_email_sem_email()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.acao = 'gestor.email_alterado' then
    new.detalhes := coalesce(
      (select jsonb_object_agg(d.chave, d.valor)
         from jsonb_each(coalesce(new.detalhes, '{}'::jsonb)) as d(chave, valor)
        where d.chave not ilike '%email%'),
      '{}'::jsonb
    ) || jsonb_build_object('mudou', 'e-mail de login');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auditoria_troca_de_email_sem_email on public.auditoria_acoes_sensiveis;
create trigger trg_auditoria_troca_de_email_sem_email
  before insert or update of detalhes on public.auditoria_acoes_sensiveis
  for each row execute function public.auditoria_troca_de_email_sem_email();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.auditoria_troca_de_email_sem_email() from public, anon, authenticated;

-- Os registros que já existem: o gatilho acima refaz o `detalhes` de cada um.
update public.auditoria_acoes_sensiveis
   set detalhes = detalhes
 where acao = 'gestor.email_alterado'
   and exists (select 1 from jsonb_object_keys(detalhes) k where k ilike '%email%');
