-- Higiene de superfície: tira do REST o que nunca deveria ser chamável por lá.
--
-- Os advisors do Supabase apontaram três coisas, todas de superfície e não
-- de vazamento — mas superfície desnecessária é dívida que cobra juros no
-- dia em que uma checagem interna falhar.

-- 1) Funções de trigger expostas como RPC -------------------------------
--
-- Toda função `returns trigger` ganha EXECUTE para anon/authenticated por
-- herança do PUBLIC, e aparece em /rest/v1/rpc/<nome>. Chamá-las fora do
-- contexto de trigger só produz erro — elas dependem de NEW/OLD — mas não
-- há razão para deixá-las alcançáveis. Fecha 14 endpoints de uma vez, e
-- segue fechando os próximos automaticamente se alguém esquecer.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.assinatura);
  end loop;
end $$;

-- 2) RPCs de Super Admin alcançáveis por anônimo -----------------------
--
-- As 13 checam o papel por dentro, então não havia vazamento — mas 9 delas
-- aceitavam chamada sem login e 4 não, defesa em profundidade desigual sem
-- motivo. Quem não está autenticado não tem o que fazer aqui, e deixar o
-- endpoint aberto convida sondagem.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'get_superadmin%'
  loop
    execute format('revoke all on function %s from public, anon', r.assinatura);
    execute format('grant execute on function %s to authenticated', r.assinatura);
  end loop;
end $$;

-- 3) search_path mutável ------------------------------------------------
--
-- `limite_padrao_plano` saiu sem `set search_path`. É `immutable` e não
-- toca em tabela, então o risco concreto é baixo — mas função sem
-- search_path fixo é exatamente o tipo de coisa que passa despercebida até
-- alguém criar um schema no caminho de busca.
create or replace function public.limite_padrao_plano(_plano public.plano_b2b)
returns integer
language sql
immutable
set search_path = public
as $$
  select case _plano
    when 'starter'    then 150
    when 'growth'     then 500
    when 'enterprise' then 1000
    else null
  end;
$$;

comment on function public.limite_padrao_plano(public.plano_b2b) is
  'Teto de alunos previsto em contrato para cada plano B2B. NULL para custom/autonomo, negociados caso a caso.';
