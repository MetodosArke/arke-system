-- Prontidão para 50 academias (25/09/2026).
--
-- Saída do teste de volume: 50 academias fictícias com 20 mil alunos e um mês
-- de uso, semeadas numa transação desfeita. As telas ficaram abaixo de 0,4 s,
-- menos a fila do Mentor; as rotinas cresceram de forma linear, menos a de
-- inércia. Junto, o que os alertas do Supabase apontaram e o crescimento de
-- dois registros que não tinham limpeza.

-- 1. A consulta de biometria respondia sem login. A exceção "auth.uid() is
--    null" existe para a service_role, e o anon também não tem usuário: quem
--    tivesse a chave pública e o id de um aluno sabia se ele cadastrou digital.
revoke execute on function public.aluno_consentiu_biometria(uuid) from public, anon;
grant execute on function public.aluno_consentiu_biometria(uuid) to authenticated, service_role;

-- 2. Inércia: "dias sem sinal" era calculado três vezes por aluno (no select e
--    duas vezes no where), quatro consultas cada. Com o dobro de alunos a
--    rotina levava cinco vezes mais. Agora é uma vez só.
create or replace function public.gerar_tarefas_inercia()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _a record;
  _n integer := 0;
begin
  for _a in
    select al.id, al.organization_id, d.dias
      from public.alunos al
      join public.organizations o on o.id = al.organization_id
      -- offset 0 impede o Postgres de expandir a função de novo no where.
      cross join lateral (select public.aluno_dias_inativo(al.id) as dias offset 0) d
     where al.metodo_arke_status = 'ativo'
       and al.situacao_academia = 'em_dia'
       and (o.onboarding_completed or o.status = 'trial')
       and d.dias >= 5
  loop
    insert into public.tarefas
      (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo)
    values
      (_a.organization_id, _a.id,
       'Risco de evasão — sem sinal de vida há ' || _a.dias || ' dias',
       (case when _a.dias >= 10 then 'critica' else 'alta' end)::public.tarefa_prioridade,
       now() + interval '24 hours',
       'inercia:' || _a.id::text || ':' || ((_a.dias / 5) * 5)::text,
       'inercia')
    on conflict (organization_id, origem_evento) do nothing;
    if found then
      _n := _n + 1;
    end if;
  end loop;
  return _n;
end;
$function$;

-- 3. Fila do Mentor: calculava constância e dias sem sinal de todo chamado
--    aberto, e o console refaz a consulta a cada minuto. Com 3 mil chamados
--    levou 2,7 s; e a API entrega no máximo mil linhas, então acima disso a
--    tela mostraria uma parte e contaria errado. Agora ordena primeiro, calcula
--    o contexto só dos mais urgentes e devolve o total verdadeiro da fila.
drop function if exists public.get_fila_mentor();
create function public.get_fila_mentor(_limite integer default 200)
 returns table(tarefa_id uuid, aluno_id uuid, aluno_nome text, organizacao_id uuid, organizacao_nome text, tipo tarefa_tipo, motivo text,
               prioridade tarefa_prioridade, status tarefa_status, sla_prazo timestamp with time zone, atrasada boolean, fase fase_jornada,
               dias_inativo integer, constancia numeric, nivel text, nao_lidas bigint, total_fila bigint, total_atrasadas bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Apenas a equipe da ArkeFit acessa a fila do Mentor.' using errcode = '42501';
  end if;

  return query
  with fila as (
    select t.id, t.aluno_id, t.organization_id, t.tipo, t.motivo, t.prioridade, t.status, t.sla_prazo,
           (t.sla_prazo is not null and t.sla_prazo < now()) as atrasada,
           count(*) over () as total_fila,
           count(*) filter (where t.sla_prazo is not null and t.sla_prazo < now()) over () as total_atrasadas
      from public.tarefas t
     where t.dono = 'arkefit'
       and t.status in ('aberta', 'em_andamento', 'aguardando')
       and t.aluno_id is not null
     -- Vencida primeiro, depois prioridade, depois o prazo mais apertado: é a
     -- ordem em que a célula deve pegar, não a ordem de chegada.
     order by (t.sla_prazo is not null and t.sla_prazo < now()) desc, t.prioridade desc, t.sla_prazo nulls last
     limit greatest(1, least(coalesce(_limite, 200), 1000))
  )
  select f.id,
         a.id,
         coalesce(p.full_name, 'Aluno'),
         o.id,
         o.nome,
         f.tipo,
         f.motivo,
         f.prioridade,
         f.status,
         f.sla_prazo,
         f.atrasada,
         a.fase_jornada,
         public.aluno_dias_inativo(a.id),
         public.aluno_constancia(a.id, 4),
         a.nivel_atacado::text,
         (select count(*) from public.mensagens_mentor m
           where m.aluno_id = a.id and m.remetente_tipo = 'aluno' and not m.lida),
         f.total_fila,
         f.total_atrasadas
    from fila f
    join public.alunos a on a.id = f.aluno_id
    join public.organizations o on o.id = f.organization_id
    left join public.profiles p on p.user_id = a.user_id
   order by f.atrasada desc, f.prioridade desc, f.sla_prazo nulls last;
end;
$function$;
revoke execute on function public.get_fila_mentor(integer) from public, anon;
grant execute on function public.get_fila_mentor(integer) to authenticated, service_role;

-- 4. Chaves estrangeiras sem índice (alerta do Supabase). Pesam na exclusão:
--    eliminar uma academia percorre essas tabelas inteiras sem eles.
create index if not exists idx_alertas_catracas_org on public.alertas_catracas (organization_id);
create index if not exists idx_aluno_assinaturas_cancelada_por on public.aluno_assinaturas (cancelada_por);
create index if not exists idx_aluno_assinaturas_pausada_por on public.aluno_assinaturas (pausada_por);
create index if not exists idx_aluno_consentimento_ia_org on public.aluno_consentimento_ia (organization_id);
create index if not exists idx_aluno_consentimento_ia_revogado_por on public.aluno_consentimento_ia (revogado_por);
create index if not exists idx_sentinela_anamnese_org on public.sentinela_anamnese (organization_id);
create index if not exists idx_sentinela_sugestoes_mentor on public.sentinela_sugestoes (mentor_id);
create index if not exists idx_sentinela_sugestoes_org on public.sentinela_sugestoes (organization_id);
create index if not exists idx_vigia_acoes_comando on public.vigia_acoes (comando_id);
create index if not exists idx_vigia_acoes_ocorrencia on public.vigia_acoes (ocorrencia_id);
create index if not exists idx_vigia_acoes_org on public.vigia_acoes (organization_id);

-- 5. Regras que recalculavam a sessão linha a linha (alerta do Supabase):
--    "(select auth.uid())" é avaliado uma vez por consulta.
alter policy "arquivo_fiscal_arkefit leitura" on public.arquivo_fiscal_arkefit
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke'));
alter policy "organizacao_encerramentos leitura" on public.organizacao_encerramentos
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke')
         or (organization_id is not null and public.has_org_role((select auth.uid()), organization_id, 'gestor')));
alter policy "taxas_implantacao leitura" on public.taxas_implantacao
  using (public.has_role((select auth.uid()), 'superadmin') or public.has_role((select auth.uid()), 'admin_arke')
         or public.has_org_role((select auth.uid()), organization_id, 'gestor'));

-- 6. Dois registros que cresciam sem limite.
--    - cron.job_run_details: uma linha por execução de rotina, perto de 700
--      por dia, e ninguém lê além do último mês (a saúde das rotinas olha 7
--      dias).
--    - asaas_webhook_events: a mensagem inteira de cada aviso, uns 2 KB. Com
--      20 mil alunos, perto de 60 mil avisos por mês, seria a maior tabela do
--      banco. Depois de 90 dias o aviso processado fica só com os campos que
--      explicam o que aconteceu; depois de 13 meses sai. O aviso não
--      processado fica inteiro, porque é dele que o reprocessamento precisa.
--      O dinheiro não mora aqui: pagamentos, mensalidades e cobranças guardam
--      cada cobrança com o próprio histórico.
create or replace function public.limpar_historicos_antigos()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  _cron integer;
  _resumidos integer;
  _apagados integer;
begin
  delete from cron.job_run_details where end_time < now() - interval '30 days';
  get diagnostics _cron = row_count;

  update public.asaas_webhook_events
     set payload = jsonb_strip_nulls(jsonb_build_object(
           'event', payload->'event',
           'resumido_em', now(),
           'payment', jsonb_strip_nulls(jsonb_build_object(
             'id', payload->'payment'->'id',
             'status', payload->'payment'->'status',
             'value', payload->'payment'->'value',
             'netValue', payload->'payment'->'netValue',
             'dueDate', payload->'payment'->'dueDate',
             'externalReference', payload->'payment'->'externalReference',
             'subscription', payload->'payment'->'subscription'))))
   where processado
     and created_at < now() - interval '90 days'
     and not (payload ? 'resumido_em');
  get diagnostics _resumidos = row_count;

  delete from public.asaas_webhook_events where created_at < now() - interval '13 months';
  get diagnostics _apagados = row_count;

  return jsonb_build_object('cron', _cron, 'avisos_resumidos', _resumidos, 'avisos_apagados', _apagados);
end;
$function$;
revoke execute on function public.limpar_historicos_antigos() from public, anon, authenticated;

select cron.schedule('arke-retencao-historicos', '55 3 * * *', $$select public.limpar_historicos_antigos()$$);
