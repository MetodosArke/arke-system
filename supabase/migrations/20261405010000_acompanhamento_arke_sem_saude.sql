-- O Acompanhamento ARKE sem o motivo de saúde para a academia (sobras da
-- frente B, 07/10/2026).
--
-- O que estava errado: `get_atendimentos_mentor_organizacao` (20261230010000)
-- entrega à equipe da academia os atendimentos que o mentor da ArkeFit
-- encerrou com os alunos do Método, com o tipo, o motivo e o desfecho de cada
-- um. No Método, a anamnese e a saúde do aluno são do mentor: a academia vê o
-- treino, mas não a dieta nem a anamnese. A função entregava, a quem é da
-- equipe e pela API também à recepção, a tarefa de dor ("Relatou dor no
-- joelho", tipo `dor`, com o desfecho que o mentor escreveu) e a de anamnese.
--
-- A escolha: a academia continua vendo a linha, com o tipo, o motivo e o
-- desfecho trocados. O tipo vira `outro` (o selo da tela diz "Atendimento", e
-- não "Relato de dor"), o motivo vira "Atendimento de saúde com o mentor" e o
-- desfecho sai. Esconder a linha faria a lista desmentir o cartão
-- "Atendimentos feitos" (`get_valor_mentor_organizacao` conta todos) e
-- apagaria justamente a prova de serviço que a tela existe para dar: que o
-- aluno foi atendido, e quando.
--
-- A recepção, que não atende a saúde, não recebe a linha de saúde nem com o
-- texto neutro: a mesma regra do RLS de `tarefas` (20261398010000), em que a
-- recepção não lê nem que a tarefa de saúde existe. A tela é só da gestão
-- (`acompanhamento: GESTAO`); a recepção chegaria aqui só pela API. A ArkeFit
-- (Super Admin e mentor) recebe o mesmo que a gestão: a função é a janela da
-- academia, e o conteúdo inteiro ela lê no console do Mentor.
--
-- Os tipos de saúde vêm de `tarefa_de_saude()`, a mesma lista da ficha e do
-- RLS (`dor` e `anamnese`), e não de uma lista nova.
-- `tarefasPorDono.guarda.test.ts` falha se o tipo, o motivo ou o desfecho
-- voltarem a sair sem passar por ela.

set lock_timeout = '5s';

create or replace function public.get_atendimentos_mentor_organizacao(
  _organization_id uuid,
  _dias integer default 30,
  _limite integer default 50
)
returns table(
  aluno_id uuid,
  aluno_nome text,
  tipo public.tarefa_tipo,
  motivo text,
  desfecho text,
  concluida_em timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _ve_atendimento_de_saude boolean;
begin
  if not (public.is_org_staff(auth.uid(), _organization_id)
          or public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Sem acesso a esta organizacao.' using errcode = '42501';
  end if;

  -- Quem atende a saúde (a gestão, o professor e a nutricionista) e a ArkeFit
  -- veem que houve um atendimento de saúde; a recepção, não.
  _ve_atendimento_de_saude := public.atende_saude(_organization_id)
                              or public.has_role(auth.uid(), 'superadmin')
                              or public.has_role(auth.uid(), 'admin_arke');

  return query
  select t.aluno_id,
         coalesce(p.full_name, 'Aluno'),
         case when public.tarefa_de_saude(t.tipo::text) then 'outro'::public.tarefa_tipo else t.tipo end,
         case when public.tarefa_de_saude(t.tipo::text) then 'Atendimento de saúde com o mentor' else t.motivo end,
         case when public.tarefa_de_saude(t.tipo::text) then null else t.desfecho_acao end,
         t.concluida_em
    from public.tarefas t
    join public.alunos a on a.id = t.aluno_id
    left join public.profiles p on p.user_id = a.user_id
   where t.organization_id = _organization_id
     and t.dono = 'arkefit'
     and t.concluida_em is not null
     and t.concluida_em >= now() - make_interval(days => greatest(_dias, 1))
     and (not public.tarefa_de_saude(t.tipo::text) or _ve_atendimento_de_saude)
   order by t.concluida_em desc
   limit greatest(least(_limite, 200), 1);
end;
$$;

comment on function public.get_atendimentos_mentor_organizacao(uuid, integer, integer) is
  'Desfechos dos atendimentos do Mentor, para a academia. O atendimento de saúde (tarefa_de_saude) sai sem o motivo e sem o desfecho, e não sai para a recepção.';

-- O `create or replace` mantém as permissões; repetir não custa.
revoke execute on function public.get_atendimentos_mentor_organizacao(uuid, integer, integer) from public, anon;
grant execute on function public.get_atendimentos_mentor_organizacao(uuid, integer, integer) to authenticated;
