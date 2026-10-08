-- A recepção em modo essencial no bloqueio B2B (decisão do responsável, 08/10/2026).
--
-- Até aqui, `get_bloqueio_organizacao()` (20261113010000) olhava só gestor,
-- professor e nutricionista: a recepção nasceu depois (20260924010000) e
-- seguia com o painel inteiro na academia bloqueada. A decisão: a recepção
-- entra no bloqueio, mas em modo essencial. O atendimento individual do aluno
-- no balcão continua; a gestão e a operação em massa pausam. Quem desenha o
-- modo é a tela (`src/lib/modoEssencial.ts`); aqui a função só diz o modo de
-- quem chama, numa coluna nova:
--   * 'bloqueio'  — gestor, professor e nutricionista da academia bloqueada:
--                   a tela de suspensão, como antes;
--   * 'essencial' — a recepção da academia bloqueada;
--   * 'normal'    — o resto (academia em dia, na tolerância ou em trial).
--
-- Compatível com a tela publicada, porque a migration entra antes do app:
--   * nenhuma coluna sai, e `modo` entra no fim;
--   * a linha da recepção vem com `bloqueada = false`, sem contagem, sem valor,
--     sem vencimento e sem link. A tela publicada lê a primeira linha e não
--     conhece `modo`: para ela, a recepção segue como hoje (painel inteiro,
--     sem faixa). E a recepção não vê o valor nem a fatura da ArkeFit pela
--     API: quem paga é o gestor;
--   * a função devolve uma linha por academia em que a pessoa é equipe (antes,
--     `limit 1`), na mesma ordem de antes: a bloqueada primeiro, depois o
--     vencimento mais antigo. A primeira linha diz à tela publicada o mesmo
--     que ela já recebia. A tela nova lê o modo da linha da academia ativa.
--
-- Mesmo vínculo, um papel só: `organization_members` tem `unique
-- (organization_id, user_id)`, então ninguém é recepção e professor na mesma
-- academia. Quem tem dois vínculos os tem em academias diferentes, e a tela
-- usa o vínculo ativo (`escolherVinculo`, o seletor de unidade). Por isso:
--   * o bloqueio total continua valendo em qualquer academia ("a bloqueada
--     manda", 20261113010000), como antes, para não abrir o painel a quem é
--     gestor de uma unidade bloqueada;
--   * o modo essencial vale só na academia ativa, onde o papel ativo é a
--     recepção. A gestora de uma academia em dia que também é recepção de
--     outra, bloqueada, segue com o painel inteiro na dela.
--
-- E um defeito do caminho: os números da tela (`detalhe`) contavam toda
-- cobrança vencida que não estivesse `confirmado`, inclusive `cancelado`,
-- `estornado` e `erro`. A dívida é só `pendente` e `atrasado` (lista de
-- inclusão, CLAUDE.md), como em `organizacao_inadimplente_b2b`: uma cobrança
-- cancelada pelo Asaas deixava a faixa "Mensalidade do ARKE em aberto" no ar,
-- somava no valor da tela de suspensão e, sendo a vencida mais antiga, virava
-- o link do "Regularizar pagamento".
--
-- O bloqueio no servidor fica para depois do primeiro cliente pagante
-- (docs/DECISOES_PENDENTES.md). Nenhuma regra de acesso muda aqui: este é um
-- gate de experiência, e o que protege os dados continua sendo o RLS.

set lock_timeout = '5s';

-- O retorno ganha a coluna `modo`, e `create or replace` não muda o tipo de
-- retorno de uma função: ela sai e volta na mesma transação.
drop function if exists public.get_bloqueio_organizacao();

create function public.get_bloqueio_organizacao()
returns table (
  organization_id uuid,
  organizacao_nome text,
  bloqueada boolean,
  cobrancas_vencidas bigint,
  valor_em_aberto numeric,
  vencimento_mais_antigo date,
  invoice_url text,
  modo text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Super Admin e Admin ARKE nunca são bloqueados: são eles que resolvem a
  -- cobrança. Trancá-los junto tornaria o problema insolúvel pelo produto.
  if public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke') then
    return;
  end if;

  return query
  with vinculos as (
    -- Só os vínculos de quem chama: a função não recebe academia nem pessoa.
    select o.id, o.nome, o.status, om.role
    from public.organization_members om
    join public.organizations o on o.id = om.organization_id
    where om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('gestor', 'professor', 'nutricionista', 'recepcao')
  ),
  detalhe as (
    -- Só para os números da tela de suspensão e da faixa da tolerância, e só
    -- para quem vê esses números (a recepção não). A decisão de bloquear vem
    -- de `organizacao_inadimplente_b2b`; se este predicado divergir dela, o
    -- pior que acontece é um número impreciso, não alguém bloqueado ou
    -- liberado por engano.
    select c.organization_id,
           count(*) as qtd,
           sum(c.valor) as valor,
           min(c.vencimento) as venc,
           (array_agg(c.invoice_url order by c.vencimento nulls last, c.created_at))[1] as link
    from public.cobrancas_b2b c
    join vinculos v on v.id = c.organization_id and v.role <> 'recepcao'
    where c.status in ('pendente', 'atrasado')
      and (c.status = 'atrasado' or c.vencimento < current_date)
    group by c.organization_id
  ),
  avaliadas as (
    select v.id, v.nome, v.role,
      -- Trial é ferramenta de homologação do Super Admin, não cliente
      -- comercial: não entra no gate mesmo com cobrança vencida.
      (v.status <> 'trial' and public.organizacao_inadimplente_b2b(v.id)) as inadimplente
    from vinculos v
  )
  select a.id,
         a.nome,
         (a.inadimplente and a.role <> 'recepcao'),
         coalesce(d.qtd, 0),
         coalesce(d.valor, 0),
         d.venc,
         d.link,
         case
           when not a.inadimplente then 'normal'
           when a.role = 'recepcao' then 'essencial'
           else 'bloqueio'
         end
  from avaliadas a
  left join detalhe d on d.organization_id = a.id
  -- A ordem de antes: a bloqueada primeiro, depois o vencimento mais antigo.
  -- A tela publicada lê só a primeira linha, e a linha da recepção (sem
  -- vencimento) vem depois de toda linha com número: quem é gestor de uma
  -- academia na tolerância e recepção de outra, bloqueada, continua vendo a
  -- faixa da tolerância. O nome só desempata.
  order by (a.inadimplente and a.role <> 'recepcao') desc,
           d.venc asc nulls last,
           a.nome;
end;
$$;

comment on function public.get_bloqueio_organizacao() is
  'O gate de inadimplência B2B da equipe: uma linha por academia em que quem chama é equipe ativa. modo: bloqueio (gestor, professor e nutricionista da academia bloqueada), essencial (a recepção dela) ou normal. A recepção não recebe valor, vencimento nem link da fatura.';

-- Recriada, a função volta com o EXECUTE padrão para o PUBLIC: a mesma
-- concessão de 20261215010000. Sem sessão ela não devolve nada de útil, mas
-- também não tem por que atender.
revoke execute on function public.get_bloqueio_organizacao() from public, anon;
grant execute on function public.get_bloqueio_organizacao() to authenticated, service_role;
