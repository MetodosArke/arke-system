-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A venda do Método ARKE pela Visão Master (pedido do Jean, decidido em 11/11/2026).
-- Os dois caminhos: o aluno de academia parceira, com o repasse negociado com ela,
-- e o aluno direto, sem vínculo com academia (treina onde quiser), sem repasse.
-- O preço não tem tabela por enquanto: o valor mensal é digitado na venda.

-- ── 1. A organização do Método direto ──────────────────────────────────────
-- Todo aluno mora numa organização (multitenancy). O aluno direto mora numa da
-- própria ArkeFit, marcada aqui: sem mensalidade B2B (valor 0, como quem a ArkeFit
-- não cobra), sem catraca, e a assinatura dele fica inteira com a ArkeFit, sem split.
alter table public.organizations add column if not exists metodo_direto boolean not null default false;
comment on column public.organizations.metodo_direto is
  'A organização da ArkeFit para o aluno do Método sem academia: repasse = valor inteiro, assinatura sem split.';
create unique index if not exists idx_organizations_um_metodo_direto on public.organizations (metodo_direto) where metodo_direto;

insert into public.organizations (nome, slug, tipo, status, onboarding_completed, valor_mensal_b2b, metodo_direto)
values ('ArkeFit — Método online', 'arkefit-metodo-online', 'academia', 'ativo', true, 0, true)
on conflict (slug) do nothing;

-- ── 2. O repasse do Método direto ──────────────────────────────────────────
-- Três lugares mudam juntos: esta função, src/lib/repasse.ts e
-- asaas-create-subscription. Na organização do Método direto, o repasse é o valor
-- cobrado inteiro (a ArkeFit fica com tudo, e a taxa do Asaas sai da parte dela);
-- no resto, o mesmo de antes.
create or replace function public.repasse_arke(_organization_id uuid, _valor_cobrado numeric, _nivel_atacado text default null::text)
returns numeric
language sql
stable security definer
set search_path to 'public'
as $function$
  with escolhido as (
    select o.metodo_direto as direto,
           coalesce(pp.repasse_tipo, o.repasse_tipo) as tipo,
           coalesce(pp.repasse_valor, o.repasse_valor) as valor
      from public.organizations o
      left join public.organization_planos_precificacao pp
        on pp.organization_id = o.id
       and _nivel_atacado is not null
       and pp.nivel_atacado::text = _nivel_atacado
       and pp.repasse_valor is not null
     where o.id = _organization_id
  )
  select case
           when e.direto then round(coalesce(_valor_cobrado, 0), 2)
           when e.valor is null then null
           when e.tipo = 'percentual'
             then round(coalesce(_valor_cobrado, 0) * e.valor / 100, 2)
                  + public.arke_taxa_processamento(_valor_cobrado)
           else round(e.valor, 2) + public.arke_taxa_processamento(_valor_cobrado)
         end
    from escolhido e;
$function$;

-- ── 3. A adesão pela Visão Master ──────────────────────────────────────────
-- A área Comercial da ArkeFit (o Sócio, ou o nível Comercial com as duas etapas)
-- registra a adesão do aluno ao Método, achando-o pelo CPF na organização escolhida:
-- a academia parceira ou a do Método direto. Na parceira, só com o repasse
-- negociado (a mesma regra da cobrança). Devolve o id do aluno, que a tela usa
-- para criar a assinatura; aluno que já está no Método volta igual (a tela pode
-- tentar a cobrança de novo).
create or replace function public.aderir_metodo_pela_arkefit(_organization_id uuid, _cpf text, _nivel public.nivel_atacado)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_direto boolean;
  v_aluno uuid;
  v_cpf text := coalesce(public.cpf_sem_mascara(_cpf), '');
begin
  if not public.acesso_arkefit('comercial') then
    raise exception 'Só a área Comercial da ArkeFit vende o Método pela Visão Master.' using errcode = '42501';
  end if;
  select o.metodo_direto into v_direto from public.organizations o where o.id = _organization_id;
  if v_direto is null then
    raise exception 'Academia não encontrada.' using errcode = 'no_data_found';
  end if;
  if _nivel not in ('integrado', 'elite') then
    raise exception 'Escolha o Integrado ou o Elite.' using errcode = '22023';
  end if;
  if not v_direto and public.repasse_arke(_organization_id, 100, _nivel::text) is null then
    raise exception 'Esta academia ainda não tem o repasse do Método negociado. Configure na ficha da organização.' using errcode = '22023';
  end if;
  if length(v_cpf) <> 11 then
    raise exception 'Informe o CPF do aluno.' using errcode = '22023';
  end if;

  select a.id into v_aluno
    from public.alunos a
    join public.profiles p on p.user_id = a.user_id
   where a.organization_id = _organization_id
     and p.cpf = public.cpf_sem_mascara(_cpf)
     and a.anonimizado_em is null
   limit 1;
  if v_aluno is null then
    raise exception 'Aluno não encontrado nesta academia.' using errcode = 'no_data_found';
  end if;

  update public.alunos
     set metodo_arke_status = 'ativo',
         metodo_arke_ativado_em = now(),
         metodo_arke_ativado_por = auth.uid(),
         nivel_atacado = _nivel
   where id = v_aluno
     and metodo_arke_status is distinct from 'ativo';
  return v_aluno;
end;
$function$;
revoke execute on function public.aderir_metodo_pela_arkefit(uuid, text, public.nivel_atacado) from public, anon;
grant execute on function public.aderir_metodo_pela_arkefit(uuid, text, public.nivel_atacado) to authenticated;

-- ── 4. As academias para a venda ───────────────────────────────────────────
-- A área Comercial não lê `organizations` pelo RLS (é do Financeiro). Para o
-- formulário da venda, só o necessário: o nome, se é a organização do Método
-- direto e se tem o repasse negociado (sem ele, a academia não cobra o Método).
create or replace function public.organizacoes_para_venda_metodo()
returns table (id uuid, nome text, metodo_direto boolean, repasse_negociado boolean, ficticia boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.acesso_arkefit('comercial') then
    raise exception 'Só a área Comercial da ArkeFit vende o Método pela Visão Master.' using errcode = '42501';
  end if;
  return query
    select o.id, o.nome, o.metodo_direto,
           o.metodo_direto or public.repasse_arke(o.id, 100, 'integrado') is not null,
           coalesce(o.ficticia, false)
      from public.organizations o
     where o.tipo in ('academia', 'studio', 'profissional_autonomo')
     order by o.metodo_direto desc, o.nome;
end;
$function$;
revoke execute on function public.organizacoes_para_venda_metodo() from public, anon;
grant execute on function public.organizacoes_para_venda_metodo() to authenticated;
