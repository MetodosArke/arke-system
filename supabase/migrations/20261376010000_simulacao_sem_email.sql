-- A simulação de perfil guarda o id da pessoa, e não o e-mail (auditoria de
-- prontidão, 06/10/2026).
--
-- O que estava errado: `impersonar-perfil` registrava em
-- `auditoria_acoes_sensiveis` (ação `perfil.simulado`) o e-mail da pessoa
-- simulada, em `detalhes.email_alvo`. A trilha não tem prazo, e a
-- anonimização troca o e-mail de login da pessoa justamente para desligar a
-- conta do endereço dela: o registro da simulação religava as duas coisas. A
-- pessoa já fica identificada pelo id (`entidade_id`), que a anonimização
-- desliga do nome e do e-mail.
--
-- O que muda:
--   1. a função deixa de mandar o e-mail (no mesmo PR);
--   2. um gatilho tira o `email_alvo` de todo registro novo de simulação —
--      vale já, mesmo antes de a função nova ser publicada, e para qualquer
--      caminho que volte a mandar;
--   3. os registros que já existem perdem o e-mail.

set lock_timeout = '5s';

create or replace function public.auditoria_simulacao_sem_email()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.acao = 'perfil.simulado' and new.detalhes ? 'email_alvo' then
    new.detalhes := new.detalhes - 'email_alvo';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auditoria_simulacao_sem_email on public.auditoria_acoes_sensiveis;
create trigger trg_auditoria_simulacao_sem_email
  before insert or update of detalhes on public.auditoria_acoes_sensiveis
  for each row execute function public.auditoria_simulacao_sem_email();

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000).
revoke execute on function public.auditoria_simulacao_sem_email() from public, anon, authenticated;

update public.auditoria_acoes_sensiveis
   set detalhes = detalhes - 'email_alvo'
 where acao = 'perfil.simulado'
   and detalhes ? 'email_alvo';
