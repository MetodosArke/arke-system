-- O encerramento da academia anonimiza o cliente dos alunos no Asaas
-- (auditoria de prontidão, 06/10/2026).
--
-- A saída de um aluno anonimiza o cadastro dele no Asaas (20261377010000,
-- `_shared/clienteAsaas.ts`). A eliminação da academia apagava os alunos sem
-- passar por ela: na conta da ArkeFit ficavam o nome e o celular de cada um,
-- das matrículas, do Método e das avulsas.
--
-- O que muda:
--   1. a etapa de eliminação (`encerramento-organizacao`) anonimiza, antes de
--      apagar contas e organização, o cliente de cada aluno na conta da
--      ArkeFit, em lotes e com cursor (`asaas_cursor`), porque uma academia
--      grande não cabe numa rodada. Quem falha vira pendência e a eliminação
--      segue: o direito de eliminação não espera o gateway, como na saída;
--   2. a regra de "outro vínculo" é a da saída, olhada para fora desta
--      academia: quem tem matrícula viva ou vínculo ativo noutra academia fica
--      intocado na conta da ArkeFit (o cliente dali é um só por CPF, e pode
--      ser o da cobrança viva da outra academia). O vínculo de equipe nesta
--      mesma academia não conta: ele também está saindo;
--   3. só a conta da ArkeFit. A conta Asaas da academia é dela (a subconta
--      aberta pela ArkeFit ou a conta própria que ela conectou): as cobranças,
--      as notas fiscais e os clientes de lá são o registro dela, que continua
--      depois do contrato, e a responsabilidade fiscal segue o split. A
--      ArkeFit só apaga do cofre a chave que guardava. A saída de um aluno
--      enquanto a academia está no ArkeFit continua tratando as duas contas;
--   4. a pendência sobrevive à eliminação. `asaas_saida_pendente` não tem
--      chave estrangeira (conferido: só `aluno_id` como chave primária), e a
--      eliminação não a apaga. Com a organização apagada, a nova tentativa
--      não sabe mais o ambiente (trial vai ao sandbox) nem tem a chave da
--      academia (sai do cofre junto). Por isso a pendência passa a guardar o
--      ambiente e se deve tocar a conta da academia, e as outras matrículas da
--      pessoa (só ids), que depois da exclusão das contas o banco não acha
--      mais. Sem dado pessoal, como antes;
--   5. `eliminar_organizacao` recusa enquanto o passo do Asaas não terminou:
--      uma versão antiga da função publicada não elimina sem ele.

set lock_timeout = '5s';

-- ── A pendência guarda o que a nova tentativa precisa depois da eliminação ─
alter table public.asaas_saida_pendente
  add column if not exists ambiente text,
  add column if not exists conta_da_academia boolean not null default true,
  add column if not exists outras_matriculas uuid[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asaas_saida_pendente_ambiente_valido') then
    alter table public.asaas_saida_pendente
      add constraint asaas_saida_pendente_ambiente_valido check (ambiente is null or ambiente in ('sandbox', 'producao'));
  end if;
end $$;

comment on column public.asaas_saida_pendente.ambiente is
  'sandbox ou producao, decidido pelo status da organização na hora da saída. Depois da eliminação da academia, é o que diz em qual Asaas tentar de novo.';
comment on column public.asaas_saida_pendente.conta_da_academia is
  'Se a nova tentativa também anonimiza na conta Asaas da academia. Falso no encerramento: a conta da academia é dela.';
comment on column public.asaas_saida_pendente.outras_matriculas is
  'Ids das outras matrículas da pessoa na hora da saída: as referências com que o cliente pode ter sido criado. Sem dado pessoal.';

-- A assinatura nova, com padrões: a função publicada antes desta migration
-- chama com os cinco parâmetros de antes e continua funcionando. A antiga sai
-- para não haver duas candidatas à mesma chamada.
drop function if exists public.registrar_saida_asaas_pendente(uuid, uuid, uuid, boolean, text);

create or replace function public.registrar_saida_asaas_pendente(
  _aluno_id uuid,
  _organization_id uuid,
  _user_id uuid,
  _outros_vinculos boolean,
  _erro text,
  _ambiente text default null,
  _conta_da_academia boolean default true,
  _outras_matriculas uuid[] default '{}'
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.asaas_saida_pendente as p
    (aluno_id, organization_id, user_id, outros_vinculos, ultimo_erro, ambiente, conta_da_academia, outras_matriculas)
  values
    (_aluno_id, _organization_id, _user_id, _outros_vinculos, left(_erro, 500), _ambiente,
     coalesce(_conta_da_academia, true), coalesce(_outras_matriculas, '{}'))
  on conflict (aluno_id) do update
     set tentativas = p.tentativas + 1,
         ultimo_erro = left(_erro, 500),
         ambiente = coalesce(excluded.ambiente, p.ambiente),
         conta_da_academia = p.conta_da_academia and excluded.conta_da_academia,
         outras_matriculas = array(select distinct unnest(p.outras_matriculas || excluded.outras_matriculas)),
         atualizado_em = now();
$$;

revoke execute on function public.registrar_saida_asaas_pendente(uuid, uuid, uuid, boolean, text, text, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.registrar_saida_asaas_pendente(uuid, uuid, uuid, boolean, text, text, boolean, uuid[]) to service_role;

-- ── O progresso do passo do Asaas na eliminação ────────────────────────────
alter table public.organizacao_encerramentos
  add column if not exists asaas_cursor uuid,
  add column if not exists asaas_concluido_em timestamptz,
  add column if not exists asaas_anonimizados integer not null default 0,
  add column if not exists asaas_pendentes integer not null default 0;

comment on column public.organizacao_encerramentos.asaas_cursor is
  'O último aluno (por id) cujo cliente no Asaas a eliminação já tratou. A rodada seguinte continua dele.';
comment on column public.organizacao_encerramentos.asaas_concluido_em is
  'Quando a eliminação terminou de anonimizar os clientes dos alunos na conta Asaas da ArkeFit. Sem isto, eliminar_organizacao recusa.';

-- ── Os alunos a tratar, em lotes ───────────────────────────────────────────
-- O CPF sai daqui para a busca no Asaas, antes de as contas serem apagadas, e
-- não fica gravado em lugar nenhum. Aluno já anonimizado fica de fora: a
-- saída dele já tratou o Asaas (ou deixou a pendência).
create or replace function public.alunos_para_anonimizar_no_asaas(_encerramento_id uuid, _depois_de uuid, _limite integer default 50)
returns table (aluno_id uuid, user_id uuid, cpf text, outros_vinculos boolean, outras_matriculas uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select e.organization_id into v_org
    from public.organizacao_encerramentos e
   where e.id = _encerramento_id and e.etapa = 'encerrada';
  if v_org is null then
    raise exception 'Encerramento não está encerrado.' using errcode = 'P0002';
  end if;

  return query
  select a.id,
         a.user_id,
         p.cpf,
         -- Outro vínculo, fora desta academia: matrícula viva noutra, ou
         -- vínculo ativo noutra organização (a mesma regra da saída).
         exists (
           select 1 from public.alunos x
            where x.user_id = a.user_id and x.organization_id <> v_org and x.anonimizado_em is null
         )
         or exists (
           select 1 from public.organization_members m
            where m.user_id = a.user_id and m.organization_id <> v_org and m.status = 'active'
         ),
         coalesce(array(select x.id from public.alunos x where x.user_id = a.user_id and x.id <> a.id order by x.id), '{}')
    from public.alunos a
    left join public.profiles p on p.user_id = a.user_id
   where a.organization_id = v_org
     and a.anonimizado_em is null
     and (_depois_de is null or a.id > _depois_de)
   order by a.id
   limit least(greatest(coalesce(_limite, 50), 1), 200);
end;
$$;

revoke execute on function public.alunos_para_anonimizar_no_asaas(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.alunos_para_anonimizar_no_asaas(uuid, uuid, integer) to service_role;

-- ── A eliminação espera o passo do Asaas ───────────────────────────────────
-- Igual a 20261371010000, mais a recusa sem o passo do Asaas e o placar dele
-- na Auditoria.
create or replace function public.eliminar_organizacao(_encerramento_id uuid, _arquivos integer, _contas integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'encerrada';
  if v_enc.id is null then
    raise exception 'Encerramento não está encerrado.' using errcode = 'P0002';
  end if;
  if v_enc.asaas_concluido_em is null then
    raise exception 'O cadastro dos alunos no Asaas ainda não foi tratado: a eliminação continua na próxima rodada.'
      using errcode = 'P0001';
  end if;

  perform public.conferir_remocoes_encerramento(_encerramento_id);
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id;

  delete from vault.secrets where name = 'asaas_subconta:' || v_enc.organization_id::text;
  delete from public.organizations where id = v_enc.organization_id;

  update public.organizacao_encerramentos
     set etapa = 'eliminada', eliminada_em = now(), arquivos_apagados = _arquivos, contas_apagadas = _contas, erro = null
   where id = _encerramento_id;

  insert into public.auditoria_acoes_sensiveis (acao, entidade, entidade_id, organizacao_nome, detalhes)
  values ('organizacao.eliminada', 'organizacao_encerramentos', _encerramento_id, v_enc.organizacao_nome,
          jsonb_build_object('arquivos_apagados', _arquivos, 'contas_apagadas', _contas,
                             'registros_fiscais', v_enc.registros_fiscais,
                             'alunos_avisados', v_enc.alunos_avisados,
                             'asaas', jsonb_build_object(
                               'clientes_anonimizados', v_enc.asaas_anonimizados,
                               'pendentes', v_enc.asaas_pendentes),
                             'remocoes', jsonb_build_object(
                               'alunos', v_enc.remocoes_alunos,
                               'ordens_agendadas', v_enc.remocoes_agendadas,
                               'ordens_confirmadas', v_enc.remocoes_remotas_confirmadas,
                               'tarefas_abertas', v_enc.remocoes_manuais,
                               'tarefas_confirmadas', v_enc.remocoes_manuais_confirmadas)));
end;
$$;

revoke execute on function public.eliminar_organizacao(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.eliminar_organizacao(uuid, integer, integer) to service_role;
