-- LGPD: consentimento versionado, log de acesso a dado sensível e direito
-- de exclusão granular (diagnóstico pedido pelo usuário — nenhuma dessas
-- peças existia antes desta migração).
--
-- Escopo:
-- 1. privacy_policy_versions + user_consents: versiona a política de
--    privacidade/termos de uso e registra, de forma imutável, quando e
--    para qual versão cada usuário deu consentimento. Dois tipos de
--    consentimento são tratados separadamente, porque a LGPD (art. 11)
--    exige consentimento ESPECÍFICO E DESTACADO para dado sensível (aqui,
--    dado de saúde — dores/lesões/medicamentos do acolhimento) — não pode
--    ser o mesmo "aceito os termos" genérico usado para o resto.
-- 2. data_deletion_requests: direito de exclusão (art. 18, VI). O aluno
--    solicita; a organização (staff) aprova e a exclusão de fato acontece
--    via a função delete_member_data — o registro da solicitação e de
--    quem a atendeu permanece mesmo depois do dado pessoal ser apagado,
--    porque a própria LGPD exige poder comprovar que o pedido foi
--    atendido.
-- 3. delete_member_data: função que remove os dados pessoais de UM único
--    aluno (treino, dieta, check-ins, frequência, acolhimento, reservas,
--    perfil e a conta de autenticação), sem afetar o resto da organização.
--    Hoje isso não existe: a única exclusão do sistema apaga a
--    organização inteira.
-- 4. saas_audit_logs ganha um novo valor de "action" ('viewed'), sem
--    mudança de schema — usado para logar quando um profissional lê o
--    acolhimento (dado de saúde) de um aluno que não é ele mesmo.

create table if not exists public.privacy_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  content text not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.privacy_policy_versions enable row level security;

drop policy if exists "Qualquer pessoa lê a política vigente" on public.privacy_policy_versions;
create policy "Qualquer pessoa lê a política vigente"
  on public.privacy_policy_versions for select
  to authenticated, anon
  using (true);

-- Rascunho inicial — precisa de revisão jurídica antes do lançamento
-- oficial (mesma lógica de dívida técnica já registrada no CLAUDE.md §8.5
-- para outras pendências: aqui fica explícito em vez de fingir que já é
-- texto jurídico validado).
insert into public.privacy_policy_versions (version, title, content)
values (
  '0.1-rascunho',
  'Termos de Uso e Política de Privacidade (rascunho — revisão jurídica pendente)',
  'Este é um texto provisório gerado para permitir o funcionamento técnico do fluxo de consentimento. NÃO foi revisado por um advogado e não deve ser considerado juridicamente válido até substituição por texto definitivo. Descreve, em linhas gerais: quais dados a Arke coleta (cadastro, avaliação física, rotina de treino/alimentação, uso do aplicativo e, quando aplicável, dados de pagamento), para qual finalidade (prestar o serviço de acompanhamento contratado), por quanto tempo são mantidos, e que o titular pode solicitar acesso, correção ou exclusão dos próprios dados a qualquer momento pelo aplicativo.'
)
on conflict (version) do nothing;

-- user_id é nullable de propósito, com ON DELETE SET NULL: se a conta for
-- excluída depois (inclusive pelo próprio delete_member_data abaixo), o
-- registro de QUANDO a pessoa consentiu precisa continuar existindo como
-- prova, mesmo sem o usuário mais existir (só perde a referência, não a
-- linha).
create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  consent_type text not null check (consent_type in ('termos_uso_privacidade', 'dados_saude')),
  policy_version_id uuid references public.privacy_policy_versions(id),
  granted boolean not null default true,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_consents_user on public.user_consents(user_id, consent_type);

alter table public.user_consents enable row level security;

drop policy if exists "Usuário lê os próprios consentimentos" on public.user_consents;
create policy "Usuário lê os próprios consentimentos"
  on public.user_consents for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Usuário registra o próprio consentimento" on public.user_consents;
create policy "Usuário registra o próprio consentimento"
  on public.user_consents for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Staff lê consentimentos de alunos da própria organização" on public.user_consents;
create policy "Staff lê consentimentos de alunos da própria organização"
  on public.user_consents for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = user_consents.user_id
        and p.organization_id is not null
        and public.saas_is_org_staff(p.organization_id)
    )
  );

-- Sem policy de UPDATE/DELETE: consentimento é trilha de auditoria,
-- imutável por desenho (revogação é um novo registro com granted=false,
-- nunca uma edição do registro original).

-- user_id também é nullable com ON DELETE SET NULL: o próprio propósito
-- desta tabela é comprovar que um pedido de exclusão foi atendido — a
-- linha (com resolved_at/resolved_by/resolution_note) precisa sobreviver
-- à exclusão da conta que ela documenta.
create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  organization_id uuid references public.saas_organizations(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  reason text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text
);

create index if not exists idx_data_deletion_requests_org on public.data_deletion_requests(organization_id, status);

alter table public.data_deletion_requests enable row level security;

drop policy if exists "Usuário lê a própria solicitação de exclusão" on public.data_deletion_requests;
create policy "Usuário lê a própria solicitação de exclusão"
  on public.data_deletion_requests for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Usuário cria a própria solicitação de exclusão" on public.data_deletion_requests;
create policy "Usuário cria a própria solicitação de exclusão"
  on public.data_deletion_requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

drop policy if exists "Staff da organização gerencia solicitações de exclusão" on public.data_deletion_requests;
create policy "Staff da organização gerencia solicitações de exclusão"
  on public.data_deletion_requests for all to authenticated
  using (organization_id is not null and public.saas_is_org_admin(organization_id))
  with check (organization_id is not null and public.saas_is_org_admin(organization_id));

-- Purga granular de UM aluno: usada quando o staff aprova uma solicitação
-- de exclusão. Nunca apaga a organização nem outros membros. security
-- definer porque precisa apagar em tabelas onde o próprio aluno não tem
-- (e não deve ter) permissão de DELETE.
create or replace function public.delete_member_data(
  p_aluno_id uuid,
  p_resolved_by uuid,
  p_request_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.turma_reservas where aluno_id = p_aluno_id;
  delete from public.check_ins where aluno_id = p_aluno_id;
  delete from public.frequencia_registros where aluno_id = p_aluno_id;
  delete from public.reuniao_acolhimento where aluno_id = p_aluno_id;
  delete from public.treino_exercicios where treino_id in (select id from public.treinos where aluno_id = p_aluno_id);
  delete from public.treinos where aluno_id = p_aluno_id;
  delete from public.dietas where aluno_id = p_aluno_id;
  delete from public.atendimentos where aluno_id = p_aluno_id;
  delete from public.profiles where user_id = p_aluno_id;

  update public.data_deletion_requests
    set status = 'completed', resolved_at = now(), resolved_by = p_resolved_by, resolution_note = p_note
    where id = p_request_id;

  -- Por último: remove a conta de autenticação (login) do titular. Feito
  -- ao final para que, se algo acima falhar, a transação inteira seja
  -- desfeita e a conta não fique "fantasma" (sem login mas com resíduo
  -- de dado, ou vice-versa).
  delete from auth.users where id = p_aluno_id;
end;
$$;

revoke execute on function public.delete_member_data(uuid, uuid, uuid, text) from public, anon, authenticated;
