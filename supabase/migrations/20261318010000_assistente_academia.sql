-- Lucas: o assistente da academia (semana 3 do plano dos agentes, 03/10/2026).
--
-- A equipe da academia pergunta no painel; o assistente acha a resposta na
-- Central de Ajuda, mostra a situação na hora do que a pergunta trata
-- (catraca, aluno, cobrança, configuração) com o botão da ação, e abre um
-- chamado para a ArkeFit quando não resolve. Não roda em rotina: responde
-- quando alguém pergunta.
--
-- Dois interruptores, como na Letícia: `assistente_ativo` liga o assistente
-- (busca, cartões e chamado, sem IA) e `assistente_ia` liga o texto escrito
-- pela IA em São Paulo. O segundo nasce desligado e é ligado pela migration da
-- Política que descrever esse uso.

insert into public.plataforma_config (chave, valor, descricao)
values ('assistente_ativo', 1, 'Assistente da academia (Lucas): 1 mostra a pergunta na Central de Ajuda do painel.'),
       ('assistente_ia', 0, 'Assistente da academia: 1 deixa a IA em São Paulo escrever a resposta a partir da Central de Ajuda.')
on conflict (chave) do nothing;

-- Sem acento e em minúsculas, para a busca de aluno pelo nome. Imutável: só
-- troca letras.
create or replace function public.texto_sem_acento(_t text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(translate(coalesce(_t, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'));
$$;

-- ── As perguntas: medem o assistente, sem guardar o texto ──────────────────
--
-- O texto da pergunta pode trazer nome de aluno e não é guardado: o que mede
-- se o assistente resolve é a intenção, os artigos sugeridos e a resposta
-- "resolveu?". O texto só fica quando vira chamado, porque aí a ArkeFit
-- precisa dele para responder.
create table if not exists public.assistente_perguntas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  intencoes text[] not null default '{}',
  artigos text[] not null default '{}',
  usou_ia boolean not null default false,
  resolveu boolean,
  created_at timestamptz not null default now()
);
create index if not exists assistente_perguntas_org_idx on public.assistente_perguntas (organization_id, created_at desc);
create index if not exists assistente_perguntas_user_idx on public.assistente_perguntas (user_id, created_at desc);
alter table public.assistente_perguntas enable row level security;
-- Só a ArkeFit lê; quem escreve é a edge function (service role) e, para o
-- "resolveu?", a função abaixo.
create policy "leitura" on public.assistente_perguntas
  for select to authenticated using (public.has_role((select auth.uid()), 'superadmin'));

create or replace function public.registrar_resultado_assistente(_pergunta_id uuid, _resolveu boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.assistente_perguntas
     set resolveu = _resolveu
   where id = _pergunta_id and user_id = auth.uid();
  if not found then
    raise exception 'Pergunta não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.registrar_resultado_assistente(uuid, boolean) from public, anon;
grant execute on function public.registrar_resultado_assistente(uuid, boolean) to authenticated;

-- ── Chamados: o ciclo completo de atendimento ─────────────────────────────
--
-- Motivo (a pergunta) → Responsável (quem da ArkeFit atende) → Prazo (8 horas
-- úteis, a régua do Mentor para prioridade média) → Ação → Desfecho → Próxima
-- checagem. O chamado só se encerra com desfecho.
create table if not exists public.chamados_suporte (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  papel text,
  pergunta text not null check (length(btrim(pergunta)) between 3 and 2000),
  resposta_assistente text check (resposta_assistente is null or length(resposta_assistente) <= 2000),
  artigos text[] not null default '{}',
  contexto jsonb not null default '{}'::jsonb,
  prazo timestamptz not null default public.prazo_util(now(), 8),
  responsavel_id uuid references auth.users(id) on delete set null,
  acao text,
  desfecho text,
  proxima_checagem date,
  concluido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((concluido_em is null) or (desfecho is not null and length(btrim(desfecho)) > 0))
);
create index if not exists chamados_suporte_abertos_idx on public.chamados_suporte (prazo) where concluido_em is null;
create index if not exists chamados_suporte_org_idx on public.chamados_suporte (organization_id, created_at desc);
alter table public.chamados_suporte enable row level security;
-- A equipe da academia acompanha os chamados dela; a ArkeFit, todos. Escrita
-- só pela edge function (abertura) e pela função de conclusão.
create policy "leitura" on public.chamados_suporte
  for select to authenticated
  using (public.is_org_staff((select auth.uid()), organization_id) or public.has_role((select auth.uid()), 'superadmin'));

create or replace function public.concluir_chamado_suporte(_id uuid, _acao text, _desfecho text, _proxima_checagem date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.has_role(v_uid, 'superadmin') then
    raise exception 'Só a ArkeFit encerra chamados de suporte.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(_desfecho, '')), '') is null then
    raise exception 'O chamado só se encerra com o desfecho registrado.' using errcode = '22023';
  end if;
  if _proxima_checagem is not null and _proxima_checagem < current_date then
    raise exception 'A próxima checagem não pode ficar no passado.' using errcode = '22023';
  end if;
  update public.chamados_suporte
     set acao = nullif(btrim(coalesce(_acao, '')), ''),
         desfecho = btrim(_desfecho),
         proxima_checagem = _proxima_checagem,
         responsavel_id = v_uid,
         concluido_em = now(),
         updated_at = now()
   where id = _id and concluido_em is null;
  if not found then
    raise exception 'Chamado não encontrado ou já encerrado.' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.concluir_chamado_suporte(uuid, text, text, date) from public, anon;
grant execute on function public.concluir_chamado_suporte(uuid, text, text, date) to authenticated;

-- A lista da Visão Master, com a academia e quem perguntou.
create or replace function public.get_superadmin_chamados_suporte()
returns table (
  id uuid, organization_id uuid, organizacao text, tipo_organizacao text,
  quem text, email text, papel text,
  pergunta text, resposta_assistente text, artigos text[], contexto jsonb,
  prazo timestamptz, created_at timestamptz,
  responsavel text, acao text, desfecho text, proxima_checagem date, concluido_em timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.' using errcode = '42501';
  end if;
  return query
  select c.id, c.organization_id, o.nome, o.tipo::text,
         p.full_name, u.email::text, c.papel,
         c.pergunta, c.resposta_assistente, c.artigos, c.contexto,
         c.prazo, c.created_at,
         pr.full_name, c.acao, c.desfecho, c.proxima_checagem, c.concluido_em
    from public.chamados_suporte c
    join public.organizations o on o.id = c.organization_id
    left join public.profiles p on p.user_id = c.user_id
    left join auth.users u on u.id = c.user_id
    left join public.profiles pr on pr.user_id = c.responsavel_id
   order by (c.concluido_em is null) desc, c.prazo, c.created_at desc
   limit 300;
end;
$$;
revoke execute on function public.get_superadmin_chamados_suporte() from public, anon;
grant execute on function public.get_superadmin_chamados_suporte() to authenticated;

-- Os números do assistente, para a Visão Master: quanto ele resolve sozinho.
create or replace function public.get_superadmin_assistente_numeros(_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'superadmin') then
    raise exception 'Acesso restrito ao Super Admin ArkeFit.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'perguntas', (select count(*) from public.assistente_perguntas where created_at > now() - make_interval(days => _dias)),
    'resolveu', (select count(*) from public.assistente_perguntas where resolveu and created_at > now() - make_interval(days => _dias)),
    'nao_resolveu', (select count(*) from public.assistente_perguntas where resolveu = false and created_at > now() - make_interval(days => _dias)),
    'chamados', (select count(*) from public.chamados_suporte where created_at > now() - make_interval(days => _dias)),
    'abertos', (select count(*) from public.chamados_suporte where concluido_em is null),
    'atrasados', (select count(*) from public.chamados_suporte where concluido_em is null and prazo < now()),
    'academias', (select count(distinct organization_id) from public.assistente_perguntas where created_at > now() - make_interval(days => _dias))
  );
end;
$$;
revoke execute on function public.get_superadmin_assistente_numeros(integer) from public, anon;
grant execute on function public.get_superadmin_assistente_numeros(integer) to authenticated;

-- ── A situação na hora: os cartões ─────────────────────────────────────────
--
-- Roda com a identidade de quem pergunta e confere que é da equipe da
-- academia. Devolve o que os cartões mostram, e as permissões que decidem os
-- botões: o botão chama a mesma rota da tela, que confere de novo.
create or replace function public.assistente_contexto(
  _organization_id uuid,
  _intencoes text[] default '{}',
  _aluno text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
  v_gestao boolean;
  v_busca text := public.texto_sem_acento(regexp_replace(btrim(coalesce(_aluno, '')), '\s+', ' ', 'g'));
  v_res jsonb := '{}'::jsonb;
begin
  select m.role::text into v_papel
    from public.organization_members m
   where m.organization_id = _organization_id and m.user_id = v_uid and m.status = 'active'
     and m.role in ('gestor', 'recepcao', 'professor', 'nutricionista')
   order by case m.role when 'gestor' then 0 when 'recepcao' then 1 else 2 end
   limit 1;
  if v_papel is null then
    raise exception 'O assistente é da equipe da academia.' using errcode = '42501';
  end if;
  v_gestao := v_papel in ('gestor', 'recepcao');

  v_res := jsonb_build_object(
    'papel', v_papel,
    'pode_comandar_catraca', v_gestao,
    'pode_ver_cobranca', v_gestao
  );

  if 'catraca' = any(_intencoes) then
    v_res := v_res || jsonb_build_object('catracas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'nome', c.nome,
               'status', c.status,
               'situacao', case when c.status <> 'ativo' then 'desativada'
                                else public.situacao_gateway(c.ultimo_heartbeat_em, t.reportado_em, t.estado) end,
               'ultima_sincronizacao', t.ultima_sincronizacao,
               'fila_offline', coalesce(t.fila_offline, 0),
               'versao', t.versao,
               'capacidades', coalesce(to_jsonb(t.capacidades), '[]'::jsonb),
               'ultimo_erro_em', t.ultimo_erro_em
             ) order by c.created_at)
        from public.organizacao_catracas c
        left join public.gateway_telemetria t on t.catraca_id = c.id
       where c.organization_id = _organization_id
    ), '[]'::jsonb));
  end if;

  if length(v_busca) >= 3 then
    v_res := v_res || jsonb_build_object('alunos', coalesce((
      select jsonb_agg(x order by x->>'nome')
        from (
          select jsonb_build_object(
                   'id', a.id,
                   'user_id', a.user_id,
                   'nome', p.full_name,
                   'situacao', a.situacao_academia,
                   'situacao_desde', a.situacao_academia_em,
                   'situacao_motivo', a.situacao_academia_motivo,
                   'entra_no_app', public.situacao_permite_app(a.situacao_academia, a.situacao_academia_em),
                   'primeiro_acesso_em', a.primeiro_acesso_em,
                   'ultima_atividade_em', a.ultima_atividade_em,
                   'tem_numero_catraca', a.identificador_catraca is not null,
                   'no_metodo', a.metodo_arke_status = 'ativo',
                   'cobranca', case when v_gestao then (
                      select jsonb_build_object('tipo', q.tipo, 'descricao', q.descricao, 'valor', q.valor,
                                                'vencimento', q.vencimento, 'status', q.status, 'invoice_url', q.invoice_url)
                        from (
                          select 'mensalidade' tipo, 'Mensalidade' descricao, ms.valor, ms.vencimento, ms.status::text status, ms.invoice_url
                            from public.mensalidades ms
                           where ms.aluno_id = a.id and ms.status in ('pendente', 'atrasado')
                          union all
                          select 'avulsa', ca.descricao, ca.valor, ca.vencimento, ca.status::text, ca.invoice_url
                            from public.cobrancas_avulsas ca
                           where ca.aluno_id = a.id and ca.status in ('pendente', 'atrasado')
                        ) q
                       order by q.vencimento
                       limit 1
                   ) end
                 ) x
            from public.alunos a
            join public.profiles p on p.user_id = a.user_id
           where a.organization_id = _organization_id
             and a.anonimizado_em is null
             -- Cada palavra digitada aparece no nome, em qualquer ordem:
             -- "bruna lucas" acha "Bruna Teste Lucas".
             and not exists (
               select 1 from unnest(string_to_array(v_busca, ' ')) w
                where w <> '' and public.texto_sem_acento(p.full_name) not like '%' || w || '%'
             )
           order by p.full_name
           limit 5
        ) s
    ), '[]'::jsonb));
  end if;

  if 'configuracao' = any(_intencoes) and v_papel = 'gestor' then
    v_res := v_res || jsonb_build_object('implantacao', (
      select jsonb_build_object(
               'liberado', o.onboarding_completed,
               'proxima', (select jsonb_build_object('etapa', e.etapa, 'detalhe', e.detalhe)
                             from public.implantacao_etapas(_organization_id) e
                            where e.principal and not e.concluida
                            order by e.ordem limit 1)
             )
        from public.organizations o where o.id = _organization_id
    ));
  end if;

  return v_res;
end;
$$;
revoke execute on function public.assistente_contexto(uuid, text[], text) from public, anon;
grant execute on function public.assistente_contexto(uuid, text[], text) to authenticated;
