set lock_timeout = '5s';

-- Aluno menor de idade, parte 3: a trava (decisão do responsável, 06/10/2026).
--
-- Para o aluno menor de 18 anos, o consentimento de saúde, o de biometria
-- (digital e rosto) e o de IA (anamnese e chat) só são gravados com o aceite
-- vigente do responsável para aquele propósito. Idade desconhecida (sem data
-- de nascimento) também trava os três, até a data ser informada.
--
-- Por gatilho, e não nas funções, pelo mesmo motivo da trava da sessão
-- simulada: vale para a tela, para a RPC e para qualquer caminho novo. Os
-- caminhos de gravação que existem hoje, todos cobertos:
--   * saúde: `anamnese_acolhimento.consentimento_lgpd_*`, gravado pelo
--     onboarding e pela tela de consentimento (o aluno) — e a regra de
--     alteração da tabela deixa a equipe gravar também;
--   * biometria: `aluno_consentimento_biometrico`, por consentir_biometria (o
--     aluno, no app) e registrar_consentimento_biometria_termo (a recepção,
--     com o termo assinado). A foto do rosto pelo app (enviar_foto_rosto) e o
--     cadastro no equipamento exigem esse consentimento, então ficam travados
--     junto, sem gatilho próprio;
--   * IA: `aluno_consentimento_ia`, gravado direto pela tela do aluno.
--
-- Só a concessão é travada. Retirar a autorização (revogado_em, ou a versão do
-- termo de saúde saindo) passa sempre: a trava nunca prende ninguém dentro de
-- uma autorização.
--
-- Consentimento dado antes desta migration não é tocado: a trava é sobre o que
-- se grava daqui para a frente.

-- ── A regra ─────────────────────────────────────────────────────────────────
-- Adulto passa. Menor, só com o aceite vigente do responsável para o
-- propósito. Sem data de nascimento, não. A mesma decisão de
-- liberacaoConsentimento() em src/lib/menorDeIdade.ts, aqui com a mensagem que
-- a tela mostra. Aluno que não existe passa: a chave estrangeira recusa
-- adiante, com a mensagem dela.
create or replace function public.exigir_liberacao_consentimento(_aluno_id uuid, _proposito text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_situacao text;
begin
  select public.situacao_idade(a.data_nascimento) into v_situacao from public.alunos a where a.id = _aluno_id;
  if v_situacao is null or v_situacao = 'adulto' then
    return;
  end if;
  if v_situacao = 'desconhecida' then
    raise exception 'Data de nascimento não informada: sem ela não dá para saber se esta autorização depende do responsável legal. Informe a data antes de autorizar.'
      using errcode = 'P0001';
  end if;
  if not public.aceite_responsavel_vigente(_aluno_id, _proposito) then
    raise exception 'Aluno menor de 18 anos: esta autorização só vale depois do aceite do responsável legal (LGPD, art. 14), pelo link enviado ao e-mail dele.'
      using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.exigir_liberacao_consentimento(uuid, text) from public, anon, authenticated;

-- ── IA ──────────────────────────────────────────────────────────────────────
-- Concessão: linha nova sem revogação, ou linha que volta a valer, troca de
-- propósito, de versão, de data ou de aluno. A regra de alteração da tabela
-- deixa o aluno mexer na própria linha, então todas as colunas que fazem um
-- consentimento valer entram na conta.
create or replace function public.trava_menor_consentimento_ia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revogado_em is null
     and (tg_op = 'INSERT'
          or old.revogado_em is not null
          or new.proposito is distinct from old.proposito
          or new.versao_texto is distinct from old.versao_texto
          or new.aceito_em is distinct from old.aceito_em
          or new.aluno_id is distinct from old.aluno_id) then
    perform public.exigir_liberacao_consentimento(new.aluno_id, 'ia_' || new.proposito);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_menor_exige_responsavel on public.aluno_consentimento_ia;
create trigger trg_menor_exige_responsavel before insert or update on public.aluno_consentimento_ia
  for each row execute function public.trava_menor_consentimento_ia();

-- ── Biometria (digital e rosto) ─────────────────────────────────────────────
create or replace function public.trava_menor_consentimento_biometrico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.revogado_em is null
     and (tg_op = 'INSERT'
          or old.revogado_em is not null
          or new.versao_texto is distinct from old.versao_texto
          or new.aceito_em is distinct from old.aceito_em
          or new.aluno_id is distinct from old.aluno_id) then
    perform public.exigir_liberacao_consentimento(new.aluno_id, 'biometria');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_menor_exige_responsavel on public.aluno_consentimento_biometrico;
create trigger trg_menor_exige_responsavel before insert or update on public.aluno_consentimento_biometrico
  for each row execute function public.trava_menor_consentimento_biometrico();

-- ── Saúde ───────────────────────────────────────────────────────────────────
-- O consentimento mora na própria anamnese: a trava olha só as colunas dele,
-- como a da sessão simulada. Preencher a anamnese não é autorizar nada — mas o
-- onboarding grava a anamnese e o aceite juntos, então a anamnese do menor sem
-- o aceite do responsável não é gravada.
create or replace function public.trava_menor_consentimento_saude()
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
    perform public.exigir_liberacao_consentimento(new.aluno_id, 'saude');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_menor_exige_responsavel on public.anamnese_acolhimento;
create trigger trg_menor_exige_responsavel before insert or update on public.anamnese_acolhimento
  for each row execute function public.trava_menor_consentimento_saude();

-- ── Higiene: função de gatilho não é alcançável pela API ────────────────────
-- O bloco idempotente de 20261215010000, de novo, porque esta rodada criou
-- funções de gatilho (e as das duas migrations anteriores).
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
