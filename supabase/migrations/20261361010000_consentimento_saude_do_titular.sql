-- Auditoria de prontidão, rodada 3: o consentimento de saúde é do titular
-- (06/10/2026).
--
-- O consentimento de saúde (LGPD, art. 11, I) mora na própria anamnese
-- (`consentimento_lgpd_aceito_em` e `consentimento_lgpd_versao`). A regra de
-- alteração da tabela deixa a equipe que atende o aluno do Free gravar a
-- anamnese, e com ela as colunas do consentimento: a equipe podia dar o
-- consentimento em nome do aluno. A trava existia só na sessão simulada
-- (20261323) e, para o menor, a do responsável (20261352).
--
-- Duas mudanças:
--
-- 1. Só o titular concede. Mesmo desenho da IA e da biometria, em que a regra
--    de inclusão já é só do aluno; aqui a anamnese é escrita por mais gente,
--    então a trava é um gatilho que compara as colunas do consentimento.
--    Retirar o consentimento passa por quem já pode escrever a linha, como na
--    trava do menor: a retirada do aceite do responsável é feita pela equipe
--    (`revogar_aceite_responsavel`), quando o responsável pede à academia. A
--    trava nunca prende ninguém dentro de uma autorização.
-- 2. O aluno retira pelo app. A Política promete que ele pode revogar a
--    qualquer momento, e não havia como. `revogar_consentimento_saude` apaga as
--    respostas da anamnese e o resumo da IA feito a partir delas; ficam a data
--    do aceite (prova de quando foi dado) e a data da retirada.

set lock_timeout = '5s';

alter table public.anamnese_acolhimento
  add column if not exists consentimento_lgpd_revogado_em timestamptz;

comment on column public.anamnese_acolhimento.consentimento_lgpd_revogado_em is
  'Quando o próprio aluno retirou o consentimento de saúde pelo app. As respostas da anamnese foram apagadas nessa hora. Volta a nulo quando ele autoriza de novo.';

-- ── 1. Só o titular concede ────────────────────────────────────────────────
-- Concessão: linha nova com o aceite, ou aceite com data nova, versão nova
-- (não nula) ou aluno trocado. Sem pessoa (a service role) também não concede:
-- nenhuma rotina dá consentimento por ninguém.
create or replace function public.consentimento_saude_so_do_titular()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.consentimento_lgpd_aceito_em is not null
     and (tg_op = 'INSERT'
          or new.consentimento_lgpd_aceito_em is distinct from old.consentimento_lgpd_aceito_em
          or (new.consentimento_lgpd_versao is not null
              and new.consentimento_lgpd_versao is distinct from old.consentimento_lgpd_versao)
          or new.aluno_id is distinct from old.aluno_id) then
    if not exists (
      select 1 from public.alunos a where a.id = new.aluno_id and a.user_id = auth.uid()
    ) then
      raise exception 'Só o próprio aluno dá o consentimento de saúde, pelo app dele.'
        using errcode = '42501';
    end if;
    -- Autorizou de novo: a retirada anterior deixa de valer.
    new.consentimento_lgpd_revogado_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_consentimento_saude_so_do_titular on public.anamnese_acolhimento;
create trigger trg_consentimento_saude_so_do_titular before insert or update on public.anamnese_acolhimento
  for each row execute function public.consentimento_saude_so_do_titular();

-- ── 2. A retirada pelo app ─────────────────────────────────────────────────
-- O aluno retira o consentimento da anamnese dele (de uma matrícula; quem é
-- aluno em duas academias tem uma anamnese em cada). Apaga as respostas e o
-- resumo da IA; ficam a data do aceite e a da retirada. A avaliação física, o
-- PAR-Q e o atestado não são desta autorização: são da academia, que precisa
-- deles para o aluno treinar com segurança, e saem pelo pedido de exclusão.
-- Em perfil simulado, o gatilho de 20261323 recusa, com a frase de sempre.
create or replace function public.revogar_consentimento_saude(_aluno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.alunos a where a.id = _aluno_id and a.user_id = auth.uid()
  ) then
    raise exception 'Só o próprio aluno retira o consentimento de saúde dele.' using errcode = '42501';
  end if;
  if public.sessao_simulada() then
    raise exception 'Em perfil simulado, só a própria pessoa autoriza, retira a autorização, aceita ou assina. Peça a ela para fazer isso no app dela.'
      using errcode = 'P0001';
  end if;

  update public.anamnese_acolhimento
     set consentimento_lgpd_versao = null,
         consentimento_lgpd_revogado_em = now(),
         concluida_em = null,
         objetivo_principal = null,
         expectativas = null,
         experiencias_exercicio = null,
         estilo_treino = null,
         frequencia_semanal_desejada = null,
         tempo_disponivel = null,
         rotina_diaria = null,
         qualidade_sono = null,
         nivel_estresse = null,
         dores_lesoes = null,
         medicamentos = null,
         alimentacao_rotina = null,
         alimentos_gosta = null,
         alimentos_nao_gosta = null
   where aluno_id = _aluno_id
     and consentimento_lgpd_revogado_em is null;
  if not found then
    raise exception 'Não há consentimento de saúde para retirar.' using errcode = 'P0001';
  end if;

  -- O resumo da IA saiu das respostas que acabaram de ser apagadas.
  delete from public.sentinela_anamnese where aluno_id = _aluno_id;
end;
$$;

revoke execute on function public.revogar_consentimento_saude(uuid) from public, anon;
grant execute on function public.revogar_consentimento_saude(uuid) to authenticated;

-- ── Higiene: função de gatilho não é alcançável pela API ────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.assinatura);
  end loop;
end $$;
