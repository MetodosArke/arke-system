-- Método ARKE, fase 6: a passagem de bastão (28/09/2026).
--
-- Entrar ou sair do Método muda quem cuida do aluno, e até aqui a mudança não
-- avisava ninguém. Os gatilhos abaixo valem para qualquer caminho que mude
-- `metodo_arke_status`: a adesão registrada pela academia, o cancelamento da
-- assinatura, o fim do trial de homologação.
--
-- Na entrada, o mentor recebe a tarefa de receber o aluno. A academia não
-- recebe tarefa: é ela quem registra a adesão, e a ficha já diz o que passa a
-- ser da ArkeFit — uma tarefa só para avisar viraria ruído na fila dela.
--
-- Na saída (decisão 5 do plano), o aluno volta para a academia com uma tarefa
-- para assumir. O último treino e a última dieta do mentor seguem valendo até
-- ela publicar os dela: nada é apagado nem desativado, e o aluno não fica sem
-- ficha no meio do caminho.

-- Antes de gravar: sai do Método, sai da carteira. Aqui, e não no gatilho de
-- depois, porque a academia que cancela o Método não pode mexer no mentor
-- (`trg_proteger_mentor_do_aluno`), e mudar a linha dentro do próprio UPDATE
-- não passa por aquela trava.
create or replace function public.limpar_mentor_ao_sair_do_metodo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.metodo_arke_status = 'ativo' and new.metodo_arke_status <> 'ativo' then
    new.mentor_id := null;
    new.mentor_desde := null;
  end if;
  return new;
end;
$$;

create trigger trg_metodo_saida_limpa_mentor
  before update of metodo_arke_status on public.alunos
  for each row execute function public.limpar_mentor_ao_sair_do_metodo();

-- Depois de gravar: as tarefas. Depois, porque o dono da tarefa sai do plano
-- do aluno (`dono_da_tarefa`), e ele precisa enxergar o plano novo.
create or replace function public.passar_bastao_do_metodo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_instante text := to_char(now(), 'YYYYMMDDHH24MI');
begin
  if new.metodo_arke_status = old.metodo_arke_status then
    return null;
  end if;

  if new.metodo_arke_status = 'ativo' then
    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono)
    values (
      new.organization_id, new.id,
      'Novo aluno no Método ARKE: dar as boas-vindas pelo chat e acompanhar o acolhimento M.A.P.A.®.',
      'alta', now() + interval '24 hours',
      'metodo_entrada:' || new.id::text || ':' || v_instante,
      'outro', 'arkefit'
    )
    on conflict (organization_id, origem_evento) do nothing;
    return null;
  end if;

  if old.metodo_arke_status = 'ativo' then
    -- Os chamados da ArkeFit se encerram com desfecho: o aluno não é mais dela.
    update public.tarefas
       set status = 'cancelada',
           desfecho_acao = 'Encerrada automaticamente: o aluno saiu do Método ARKE e voltou para a academia.'
     where aluno_id = new.id
       and dono = 'arkefit'
       and status in ('aberta', 'em_andamento', 'aguardando');

    insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono)
    values (
      new.organization_id, new.id,
      'Aluno saiu do Método ARKE e voltou para a academia: assumir o acompanhamento. O último treino e a última dieta do mentor seguem valendo até a academia publicar os dela.',
      'alta', now() + interval '48 hours',
      'metodo_saida:' || new.id::text || ':' || v_instante,
      'outro', 'academia'
    )
    on conflict (organization_id, origem_evento) do nothing;
  end if;
  return null;
end;
$$;

create trigger trg_metodo_passagem
  after update of metodo_arke_status on public.alunos
  for each row execute function public.passar_bastao_do_metodo();

revoke execute on function public.limpar_mentor_ao_sair_do_metodo() from public, anon, authenticated;
revoke execute on function public.passar_bastao_do_metodo() from public, anon, authenticated;
