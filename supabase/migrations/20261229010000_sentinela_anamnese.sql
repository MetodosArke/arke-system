-- Fase 5a do Ecossistema: auditoria preventiva da anamnese (23/09/2026).
--
-- É a parte do Sentinela que mexe com **dado pessoal sensível de saúde**
-- (LGPD art. 5º, II): cirurgias, lesões prévias, condições crônicas. O projeto
-- foi construído com postura oposta — o Session Replay do Sentry está
-- desligado justamente porque gravaria dobras e queixas —, então mandar
-- anamnese para um modelo exige o que o resto do sistema não exigiu.
--
-- **A base legal é o consentimento específico e destacado** (art. 11, I), no
-- mesmo desenho do consentimento biométrico: finalidade declarada, retenção
-- declarada, revogável, registrado com data. O termo de saúde da anamnese não
-- cobre isto, pela mesma razão que não cobria a digital — são finalidades
-- diferentes, e consentimento genérico não é consentimento.
--
-- **A trava mora no banco, não na edge function.** Uma checagem só na função
-- seria contornável por qualquer caminho novo que alguém escrevesse depois; a
-- função de leitura aqui recusa sem consentimento, e é ela que a edge function
-- tem de chamar para obter o texto.

create table if not exists public.aluno_consentimento_ia (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  aceito_em timestamptz not null default now(),
  -- Declarados na tabela, e não só na tela, para o registro se explicar
  -- sozinho daqui a dois anos numa auditoria.
  finalidade text not null default
    'Resumir a anamnese para a equipe de acompanhamento da ArkeFit, destacando histórico que exija cuidado.',
  retencao_descricao text not null default
    'O resumo fica no ARKE enquanto durar a matrícula. O provedor de IA processa sem reter, e o texto não é usado para treinar modelo.',
  provedor text,
  revogado_em timestamptz,
  revogado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.aluno_consentimento_ia enable row level security;

-- O aluno vê e dá o próprio consentimento; a equipe da academia e a ArkeFit
-- veem que existe. Uma regra por operação.
drop policy if exists "leitura" on public.aluno_consentimento_ia;
create policy "leitura" on public.aluno_consentimento_ia
  for select to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = (select auth.uid()))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

-- **Só o próprio aluno consente.** Não a academia, não a ArkeFit: consentimento
-- dado por terceiro não é consentimento, e é exatamente o vício que anularia a
-- base legal inteira.
drop policy if exists "inclusão" on public.aluno_consentimento_ia;
create policy "inclusão" on public.aluno_consentimento_ia
  for insert to authenticated
  with check (
    exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = (select auth.uid()))
  );

drop policy if exists "alteração" on public.aluno_consentimento_ia;
create policy "alteração" on public.aluno_consentimento_ia
  for update to authenticated
  using (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = (select auth.uid())));

grant select, insert, update on public.aluno_consentimento_ia to authenticated;
grant all on public.aluno_consentimento_ia to service_role;

create unique index if not exists idx_consentimento_ia_vigente
  on public.aluno_consentimento_ia (aluno_id) where revogado_em is null;

create or replace function public.aluno_consentiu_ia(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.aluno_consentimento_ia c
     where c.aluno_id = _aluno_id and c.revogado_em is null
  );
$$;

comment on function public.aluno_consentiu_ia(uuid) is
  'Consentimento especifico e destacado para a IA processar a anamnese (LGPD art. 11, I). Revogavel.';

-- ── O texto da anamnese só sai com consentimento ───────────────────────────
--
-- Esta é a trava de verdade. A edge function **precisa** desta função para
-- obter o texto; não há caminho em que ela leia a anamnese direto e esqueça de
-- conferir, porque conferir e obter são a mesma operação.
create or replace function public.anamnese_para_auditoria(_aluno_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _t text;
begin
  if not public.aluno_consentiu_ia(_aluno_id) then
    raise exception 'Este aluno não autorizou a análise da anamnese por inteligência artificial.'
      using errcode = '42501';
  end if;

  -- **Minimização**: só os campos que servem à finalidade declarada — risco de
  -- saúde no treino. Preferências alimentares, expectativas e sono ficam de
  -- fora porque não ajudam a responder "este aluno exige cuidado?", e cada
  -- campo a mais é dado sensível viajando para um terceiro sem motivo.
  select concat_ws(E'\n',
           nullif('Objetivo: ' || nullif(btrim(an.objetivo_principal), ''), 'Objetivo: '),
           nullif('Histórico de dores ou lesões: ' || nullif(btrim(an.dores_lesoes), ''), 'Histórico de dores ou lesões: '),
           nullif('Medicamentos: ' || nullif(btrim(an.medicamentos), ''), 'Medicamentos: '),
           nullif('Experiência com exercício: ' || nullif(btrim(an.experiencias_exercicio), ''), 'Experiência com exercício: ')
         )
    into _t
    from public.anamnese_acolhimento an
   where an.aluno_id = _aluno_id and an.concluida_em is not null;

  return _t;
end;
$$;

comment on function public.anamnese_para_auditoria(uuid) is
  'Texto da anamnese para o Sentinela. RECUSA sem consentimento: conferir e obter sao a mesma operacao, entao nao ha caminho que esqueca de checar.';

revoke execute on function public.anamnese_para_auditoria(uuid) from public;
revoke execute on function public.aluno_consentiu_ia(uuid) from public;
grant execute on function public.anamnese_para_auditoria(uuid) to service_role;
grant execute on function public.aluno_consentiu_ia(uuid) to authenticated, service_role;

-- ── O resumo produzido ─────────────────────────────────────────────────────
--
-- Guardado, e não gerado a cada visualização: uma chamada por versão da
-- anamnese em vez de uma por abertura de tela custa menos e **expõe menos** —
-- cada chamada é um envio de dado de saúde a um terceiro.
--
-- O `hash_anamnese` é o que faz o resumo se regenerar quando a anamnese muda,
-- em vez de mostrar para sempre a análise de um texto que já não existe.
create table if not exists public.sentinela_anamnese (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aluno_id uuid not null references public.alunos(id) on delete cascade,
  hash_anamnese text not null,
  resumo text not null,
  exige_atencao boolean not null default false,
  fornecedor text,
  created_at timestamptz not null default now(),
  unique (aluno_id, hash_anamnese)
);

alter table public.sentinela_anamnese enable row level security;

-- Dado sensível derivado: só quem precisa dele para atender. **A ArkeFit e a
-- equipe da academia; o próprio aluno também**, porque é a saúde dele e
-- esconder o que o sistema concluiu sobre ele seria o oposto de transparência.
drop policy if exists "leitura" on public.sentinela_anamnese;
create policy "leitura" on public.sentinela_anamnese
  for select to authenticated
  using (
    exists (select 1 from public.alunos a where a.id = aluno_id and a.user_id = (select auth.uid()))
    or is_org_staff((select auth.uid()), organization_id)
    or has_role((select auth.uid()), 'admin_arke'::app_role)
    or has_role((select auth.uid()), 'superadmin'::app_role)
  );

grant select on public.sentinela_anamnese to authenticated;
grant all on public.sentinela_anamnese to service_role;

-- Revogar o consentimento apaga o resumo: manter um derivado de dado sensível
-- depois de o titular retirar a autorização é descumprimento, não conveniência.
create or replace function public.apagar_resumo_ao_revogar_ia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.revogado_em is not null and old.revogado_em is null then
    delete from public.sentinela_anamnese where aluno_id = new.aluno_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apagar_resumo_ao_revogar_ia on public.aluno_consentimento_ia;
create trigger trg_apagar_resumo_ao_revogar_ia
  after update on public.aluno_consentimento_ia
  for each row execute function public.apagar_resumo_ao_revogar_ia();

revoke execute on function public.apagar_resumo_ao_revogar_ia() from public;
