-- A troca do e-mail de login de alguém da equipe pela gestão vai para a
-- auditoria, sem o e-mail (auditoria de prontidão, 06/10/2026).
--
-- O que estava errado: `editar-membro-equipe` troca o e-mail de login de um
-- professor, nutricionista, recepcionista ou gestor (a gestão da academia,
-- com as duas etapas, ou a ArkeFit), e não deixava registro nenhum. Trocar o
-- e-mail de login entrega a conta a quem tem o e-mail novo: é o mesmo peso da
-- troca do e-mail do gestor pela ArkeFit (`gestor.email_alterado`), que já
-- fica na trilha.
--
-- A função passa a registrar `equipe.email_alterado` (no mesmo PR): quem
-- trocou (`ator_user_id`), de quem (`entidade_id`), o papel da pessoa e se
-- foi a ArkeFit. O e-mail fica fora pelo mesmo motivo de 20261397010000: a
-- trilha não tem prazo, e o e-mail já mora na conta.
--
-- Aqui, o gatilho de 20261397010000 passa a valer para toda ação de troca de
-- e-mail de login (as que terminam em `.email_alterado`): tira do registro
-- toda chave com e-mail e deixa `{"mudou": "e-mail de login"}`, por qualquer
-- caminho que volte a mandar.

set lock_timeout = '5s';

create or replace function public.auditoria_troca_de_email_sem_email()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.acao like '%.email\_alterado' then
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

-- Função de gatilho nasce com EXECUTE para o PUBLIC (20261215010000); o
-- `create or replace` mantém o que já foi revogado, e revogar de novo não
-- custa.
revoke execute on function public.auditoria_troca_de_email_sem_email() from public, anon, authenticated;
