-- Higiene de superfície, segunda passada: o que a primeira não conseguiu manter.
--
-- A migration `higiene_execute_rpc` revogou, em bloco, o EXECUTE que toda
-- função `returns trigger` herda do PUBLIC — e o CLAUDE.md registrou que ela
-- "segue pegando as próximas automaticamente". **Isso não é verdade.** Aquele
-- `revoke` rodou uma vez, sobre as funções que existiam naquele dia. Função
-- criada depois nasce com o ACL padrão do Postgres, que dá EXECUTE ao PUBLIC,
-- e volta a aparecer em `/rest/v1/rpc/<nome>`.
--
-- A auditoria de 22/09/2026 encontrou **sete** funções de gatilho nessa
-- situação, todas criadas depois daquela migration:
--
--   encerrar_automacoes_situacao, exigir_nivel_disponivel  (rodada 3)
--   proteger_colunas_organizacao, seed_planos_academia_modelo,
--   proteger_situacao_aluno                                 (rodada 4)
--   proteger_validade_atestado                              (rodada 5)
--   exigir_atestado_para_treinar                            (rodada final)
--
-- Chamar qualquer uma delas fora do contexto de gatilho só produz erro — não
-- há escalada aqui. Mas esse já era o caso quando o projeto decidiu fechar a
-- superfície, e o argumento de então vale igual agora: não há razão para
-- deixá-las alcançáveis.
--
-- Como não dá para tornar isto automático sem privilégio de superusuário
-- (event trigger), a regra passa a ser explícita: **esta revogação é de rodar
-- de novo depois de cada rodada que crie funções de gatilho.** O comando é
-- idempotente e o bloco abaixo pode ser reexecutado à vontade.

-- 1) Revoga EXECUTE do PUBLIC em toda função `returns trigger` do schema.
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

-- 2) Duas funções `security definer` que não são de gatilho e estavam
-- alcançáveis sem login.
--
-- `valor_mensal_b2b` devolve a mensalidade negociada de uma organização. Com o
-- uuid em mãos — que aparece em respostas públicas, como a da matrícula —
-- qualquer um lia quanto aquela academia paga à ArkeFit. É pouco, mas é
-- informação comercial de terceiro exposta sem login.
revoke execute on function public.valor_mensal_b2b(uuid) from public, anon;
grant execute on function public.valor_mensal_b2b(uuid) to authenticated, service_role;

-- `get_bloqueio_organizacao` serve o gate de inadimplência à tela da equipe.
-- Sem sessão ela não devolve nada de útil, mas também não tem por que atender.
revoke execute on function public.get_bloqueio_organizacao() from public, anon;
grant execute on function public.get_bloqueio_organizacao() to authenticated, service_role;

-- `abrir_tarefa_mensalidade_atrasada` **escreve**: abre tarefa de cobrança. Ela
-- já era revogada do PUBLIC por `planos_academia_matriculas_mensalidades`, mas
-- a revogação se perdeu na replicação do schema para o projeto brasileiro — o
-- banco antigo tem `{postgres=X}` e o novo nasceu com o ACL padrão. Quem chama
-- é só o `asaas-webhook`, com a service role.
--
-- Foi a única regressão de privilégio da migração, e só apareceu depois de
-- corrigir a consulta de comparação: ela filtrava os papéis por nome e a
-- concessão ao PUBLIC vem com `grantee = 0`, que `pg_get_userbyid` não devolve
-- como 'public'. A comparação ignorava, em silêncio, exatamente a categoria
-- que o projeto revoga de propósito.
revoke execute on function public.abrir_tarefa_mensalidade_atrasada(uuid) from public, anon, authenticated;
grant execute on function public.abrir_tarefa_mensalidade_atrasada(uuid) to service_role;

-- 3) `search_path` fixo nas duas funções que ficaram sem.
--
-- Nenhuma das duas é `security definer`, então o risco é menor que o do padrão
-- clássico — mas o projeto fixa `search_path` em tudo justamente para não
-- precisar avaliar caso a caso, e essas duas passaram batido.
alter function public.plano_do_aluno(public.metodo_arke_status, public.nivel_atacado)
  set search_path to 'public';
alter function public.situacao_permite_app(public.situacao_aluno_academia, timestamptz)
  set search_path to 'public';

-- 4) Conferência: as três consultas abaixo precisam devolver zero.
select count(*) as gatilhos_ainda_publicos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and p.proacl is null;

select count(*) as secdef_sem_search_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');

select count(*) as funcoes_sem_search_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'
   and p.proname in ('plano_do_aluno','situacao_permite_app')
   and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%');
