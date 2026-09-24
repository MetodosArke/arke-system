-- Biometria de ponta a ponta (versão 1.0, 23/09/2026).
--
-- Três defeitos que a auditoria 360° encontrou, os três na mesma direção —
-- o ciclo do dado biométrico dependia de passos manuais sem registro:
--
-- 1. O consentimento era registrado pela EQUIPE, com um clique. É o vício
--    que o consentimento de IA já tinha corrigido: consentimento dado por
--    terceiro não é consentimento (LGPD art. 11, I exige o do titular). Agora
--    só o próprio aluno consente, no app, e o texto é versionado — aceite
--    dado sob texto antigo deixa de valer.
-- 2. Revogar só mostrava um aviso ("apague a digital no equipamento") e nada
--    registrava que foi apagado. Agora a revogação agenda a remoção pelo
--    Gateway (Control iD com gestão remota) ou abre tarefa com desfecho
--    obrigatório — e o consentimento só ganha a data de exclusão quando a
--    remoção se completa.
-- 3. Excluir ou anonimizar o aluno deixava o usuário, a digital e o cartão
--    dele no equipamento. Agora os dois caminhos agendam a remoção, por
--    gatilho — vale para qualquer código que exclua ou anonimize, não só para
--    as edge functions de hoje.

-- ── Consentimento versionado, só do titular ────────────────────────────────

alter table public.aluno_consentimento_biometrico add column if not exists versao_texto text;

create or replace function public.versao_consentimento_biometrico()
returns text
language sql
immutable
as $$ select '2026-09-23'::text $$;

create or replace function public.aluno_consentiu_biometria(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Só responde a quem pode ver o aluno (ele mesmo, a equipe da academia,
  -- a ArkeFit) ou a contexto sem usuário (service_role). Para os demais é
  -- sempre "não": saber se alguém cadastrou digital é dado sobre dado
  -- sensível.
  select exists (
    select 1
      from public.aluno_consentimento_biometrico c
      join public.alunos a on a.id = c.aluno_id
     where c.aluno_id = _aluno_id
       and c.revogado_em is null
       and c.versao_texto = public.versao_consentimento_biometrico()
       and (auth.uid() is null
            or a.user_id = auth.uid()
            or public.is_org_staff(auth.uid(), a.organization_id)
            or public.has_role(auth.uid(), 'superadmin')
            or public.has_role(auth.uid(), 'admin_arke'))
  );
$$;

-- Inclusão: só o aluno, para si mesmo, na organização da própria matrícula
-- e com o texto vigente. Alteração e exclusão diretas deixam de existir: a
-- revogação passa pela função, que registra quem revogou e agenda a remoção
-- no equipamento. Deixar a equipe alterar a linha seria deixar desfazer uma
-- revogação sem rastro.
drop policy if exists "inclusão" on public.aluno_consentimento_biometrico;
create policy "inclusão" on public.aluno_consentimento_biometrico for insert to authenticated with check (
  exists (
    select 1 from public.alunos a
     where a.id = aluno_consentimento_biometrico.aluno_id
       and a.user_id = (select auth.uid())
       and a.organization_id = aluno_consentimento_biometrico.organization_id
  )
  and versao_texto = public.versao_consentimento_biometrico()
  and revogado_em is null
);
drop policy if exists "alteração" on public.aluno_consentimento_biometrico;
drop policy if exists "exclusão" on public.aluno_consentimento_biometrico;

alter table public.aluno_consentimento_biometrico
  alter column versao_texto set default public.versao_consentimento_biometrico();

-- O caminho da tela: o aluno consente pela versão vigente. Quem já tinha
-- consentido sob texto antigo tem aquela linha encerrada (não reescrita — ela
-- prova o que foi aceito naquela data) e ganha uma nova, na mesma operação,
-- porque o índice só admite um consentimento ativo por aluno.
create or replace function public.consentir_biometria(_aluno_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos;
  v_id uuid;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null or v_aluno.user_id is distinct from auth.uid() then
    raise exception 'Só o próprio aluno autoriza o uso da digital.' using errcode = '42501';
  end if;
  if public.aluno_consentiu_biometria(_aluno_id) then
    select id into v_id from public.aluno_consentimento_biometrico
     where aluno_id = _aluno_id and revogado_em is null;
    return v_id;
  end if;

  update public.aluno_consentimento_biometrico
     set revogado_em = now(), revogado_por = auth.uid()
   where aluno_id = _aluno_id and revogado_em is null;

  insert into public.aluno_consentimento_biometrico (organization_id, aluno_id, versao_texto)
  values (v_aluno.organization_id, _aluno_id, public.versao_consentimento_biometrico())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.consentir_biometria(uuid) from public, anon;
grant execute on function public.consentir_biometria(uuid) to authenticated;

-- ── Remoção do equipamento ─────────────────────────────────────────────────

-- Agenda a remoção de um usuário do equipamento em todo Gateway da academia
-- que tenha gestão remota; onde não houver, e o aluno tinha biometria, abre
-- tarefa manual. Um lote por remoção: é por ele que se sabe quando TODOS os
-- equipamentos apagaram.
create or replace function public.agendar_remocao_equipamento(
  _org uuid, _aluno_id uuid, _identificador text, _tinha_biometria boolean, _motivo text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote uuid := gen_random_uuid();
  v_com integer := 0;
  v_sem integer := 0;
  r record;
begin
  if _identificador is null or btrim(_identificador) = '' then
    return 0;
  end if;

  for r in
    select c.id, ('apagar_usuario' = any (coalesce(t.capacidades, '{}'))) as remoto
      from public.organizacao_catracas c
      left join public.gateway_telemetria t on t.catraca_id = c.id
     where c.organization_id = _org
  loop
    if r.remoto then
      insert into public.gateway_comandos (organization_id, catraca_id, tipo, parametros, aluno_id, lote, motivo, expira_em)
      values (_org, r.id, 'apagar_usuario', jsonb_build_object('user_id', _identificador),
              case when exists (select 1 from public.alunos where id = _aluno_id) then _aluno_id end,
              v_lote, _motivo, now() + interval '24 hours');
      v_com := v_com + 1;
    else
      v_sem := v_sem + 1;
    end if;
  end loop;

  -- Equipamento sem gestão remota (Topdata, Control iD sem credencial
  -- configurada) só guarda dado do aluno se ele tinha digital cadastrada;
  -- cartão, no modo online, fica só no ARKE. Por isso a tarefa manual só
  -- nasce quando havia biometria.
  if v_sem > 0 and _tinha_biometria then
    perform public.abrir_tarefa_remocao_equipamento(
      _org, _aluno_id, _identificador, 'equipamento-manual:' || v_lote::text, _motivo);
  end if;

  return v_com;
end;
$$;

create or replace function public.revogar_consentimento_biometrico(_aluno_id uuid)
returns table(identificador_catraca text, organization_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_identificador text;
begin
  select a.organization_id, a.identificador_catraca
    into v_org, v_identificador
    from public.alunos a where a.id = _aluno_id;

  if v_org is null then
    raise exception 'Aluno não encontrado.';
  end if;

  if not (public.has_role(auth.uid(), 'superadmin')
          or public.has_role(auth.uid(), 'admin_arke')
          or public.is_org_staff(auth.uid(), v_org)
          or exists (select 1 from public.alunos a
                      where a.id = _aluno_id and a.user_id = auth.uid())) then
    raise exception 'Só a equipe da academia, a ArkeFit ou o próprio aluno podem revogar o consentimento biométrico.';
  end if;

  update public.aluno_consentimento_biometrico c
     set revogado_em = now(), revogado_por = auth.uid()
   where c.aluno_id = _aluno_id and c.revogado_em is null;

  -- O identificador sai junto: sem ele o ARKE não reconhece mais o aluno
  -- pela catraca, nem pela digital que ainda esteja no equipamento enquanto
  -- a remoção não acontece.
  update public.alunos a
     set identificador_catraca = null
   where a.id = _aluno_id;

  if v_identificador is not null then
    perform public.agendar_remocao_equipamento(
      v_org, _aluno_id, v_identificador, true, 'consentimento biométrico revogado');
  end if;

  return query select v_identificador, v_org;
end;
$$;

-- Exclusão e anonimização do aluno: o equipamento também esquece.
create or replace function public.remover_aluno_do_equipamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tinha_bio boolean;
begin
  if old.identificador_catraca is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  v_tinha_bio := exists (select 1 from public.aluno_consentimento_biometrico where aluno_id = old.id);

  if tg_op = 'DELETE' then
    perform public.agendar_remocao_equipamento(
      old.organization_id, null, old.identificador_catraca, v_tinha_bio, 'aluno excluído');
    return old;
  end if;

  if new.anonimizado_em is not null and old.anonimizado_em is null then
    perform public.agendar_remocao_equipamento(
      old.organization_id, old.id, old.identificador_catraca, v_tinha_bio, 'aluno anonimizado (LGPD)');
    new.identificador_catraca := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_remover_do_equipamento_ao_excluir on public.alunos;
create trigger trg_remover_do_equipamento_ao_excluir
  before delete on public.alunos
  for each row execute function public.remover_aluno_do_equipamento();

drop trigger if exists trg_remover_do_equipamento_ao_anonimizar on public.alunos;
create trigger trg_remover_do_equipamento_ao_anonimizar
  before update of anonimizado_em on public.alunos
  for each row execute function public.remover_aluno_do_equipamento();

-- Apagar do equipamento é trabalho físico, na catraca da academia — fica com
-- ela mesmo para aluno do Método, como cobrança e atestado.
create or replace function public.dono_da_tarefa(_aluno_id uuid, _tipo tarefa_tipo)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when _tipo in ('cobranca', 'atestado', 'instrucao_presencial', 'equipamento') then 'academia'
           when exists (
             select 1 from public.alunos a
              where a.id = _aluno_id and a.metodo_arke_status = 'ativo'
           ) then 'arkefit'
           else 'academia'
         end;
$$;

-- ── Permissões ─────────────────────────────────────────────────────────────
revoke execute on function public.agendar_remocao_equipamento(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.agendar_remocao_equipamento(uuid, uuid, text, boolean, text) to service_role;
revoke execute on function public.remover_aluno_do_equipamento() from public, anon, authenticated;
grant execute on function public.aluno_consentiu_biometria(uuid) to authenticated, service_role;
grant execute on function public.versao_consentimento_biometrico() to authenticated, service_role;
