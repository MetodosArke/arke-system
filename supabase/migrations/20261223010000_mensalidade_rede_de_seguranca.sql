-- Mensalidade da academia: emissão registrada, e a situação do aluno
-- acompanhando a cobrança (23/09/2026).
--
-- O Método ARKE ganhou rede de segurança contra webhook perdido em 21/09; a
-- mensalidade de plano próprio ficou de fora, com a justificativa de que
-- `mensalidades.status` é NOT NULL e criar a linha na emissão quebraria o
-- upsert. A justificativa não se sustentava: a coluna tem **default**
-- `pendente`, então bastava omitir a chave em vez de mandá-la nula.
--
-- Isso importa porque é o fluxo principal do cliente. Sem registro na
-- emissão, um `PAYMENT_OVERDUE` perdido não deixava linha nenhuma, e nenhuma
-- verificação de "venceu e ninguém confirmou" tinha o que verificar — o aluno
-- seguia treinando de graça, em silêncio.
--
-- **O bloqueio não ganha um caminho novo.** A mensalidade vencida marca
-- `situacao_academia = 'inadimplente'`, que é o mecanismo que já existe, com
-- a tolerância de 5 dias, a contagem regressiva no topo do app e o
-- encerramento das automações. Criar um segundo caminho de bloqueio daria
-- duas regras para a mesma pergunta, que é como elas começam a divergir.

-- ── 1. O predicado ─────────────────────────────────────────────────────────
--
-- Lista de inclusão nos status, pela mesma razão do B2C: `<> 'confirmado'`
-- trata todo status novo como dívida por omissão, e foi assim que `estornado`
-- passou a bloquear quem não devia nada.
create or replace function public.aluno_mensalidade_vencida(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.aluno_matriculas_academia m
    join public.mensalidades s on s.matricula_id = m.id
    where m.aluno_id = _aluno_id
      and m.status = 'ativa'
      and s.status in ('pendente', 'atrasado')
      and (
        s.status = 'atrasado'
        or s.vencimento < current_date
      )
  );
$$;

comment on function public.aluno_mensalidade_vencida(uuid) is
  'Aluno com mensalidade da academia emitida e vencida sem confirmacao. Rede de seguranca para PAYMENT_OVERDUE perdido.';

-- ── 2. A sincronização ─────────────────────────────────────────────────────
--
-- Marca quem passou a dever e libera quem pagou. A marca automática se
-- identifica pelo motivo: sem isso, liberar alguém desfaria uma marcação que
-- a recepção fez à mão por outro motivo — e a academia perderia a decisão
-- dela sem ninguém pedir.
create or replace function public.sincronizar_situacao_por_mensalidade()
returns table(marcados integer, liberados integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _motivo constant text := 'Mensalidade em atraso (automático)';
  _m integer := 0;
  _l integer := 0;
begin
  with alvo as (
    select a.id
      from public.alunos a
     where a.situacao_academia = 'em_dia'
       and public.aluno_mensalidade_vencida(a.id)
  )
  update public.alunos a
     set situacao_academia = 'inadimplente',
         situacao_academia_motivo = _motivo
    from alvo
   where a.id = alvo.id;
  get diagnostics _m = row_count;

  with alvo as (
    select a.id
      from public.alunos a
     where a.situacao_academia = 'inadimplente'
       -- Só desfaz o que ela mesma marcou.
       and a.situacao_academia_motivo = _motivo
       and not public.aluno_mensalidade_vencida(a.id)
  )
  update public.alunos a
     set situacao_academia = 'em_dia',
         situacao_academia_motivo = null
    from alvo
   where a.id = alvo.id;
  get diagnostics _l = row_count;

  return query select _m, _l;
end;
$$;

comment on function public.sincronizar_situacao_por_mensalidade() is
  'Poe em inadimplente quem tem mensalidade vencida e libera quem pagou. So desfaz a marca que ela propria criou.';

revoke execute on function public.sincronizar_situacao_por_mensalidade() from public;
revoke execute on function public.aluno_mensalidade_vencida(uuid) from public;
grant execute on function public.aluno_mensalidade_vencida(uuid) to authenticated, service_role;
grant execute on function public.sincronizar_situacao_por_mensalidade() to service_role;

-- ── 3. O detalhe do bloqueio também usa lista de inclusão ──────────────────
--
-- `get_bloqueio_aluno` contava e somava as cobranças em aberto com
-- `status <> 'confirmado'`. A decisão de bloquear já foi corrigida em
-- `aluno_inadimplente_b2c`, mas os números mostrados ao aluno ainda incluíam
-- cobrança cancelada ou estornada — a tela diria que ele deve algo que não
-- existe mais.
create or replace function public.get_bloqueio_aluno(_aluno_id uuid)
returns table(
  aluno_id uuid, bloqueado boolean, assinatura_status text, cobrancas_vencidas bigint,
  valor_em_aberto numeric, vencimento_mais_antigo date, invoice_url text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.has_role(auth.uid(), 'superadmin') or public.has_role(auth.uid(), 'admin_arke') then
    return;
  end if;

  return query
  with assinatura as (
    select a.id, a.aluno_id, a.status::text as status, a.fatura_pendente_url
    from public.aluno_assinaturas a
    join public.alunos al on al.id = a.aluno_id
    where al.id = _aluno_id
      and al.user_id = auth.uid()
  ),
  detalhe as (
    select p.aluno_assinatura_id,
           count(*) as qtd,
           sum(p.valor) as valor,
           min(p.vencimento) as venc,
           (array_agg(p.invoice_url order by p.vencimento nulls last, p.created_at))[1] as link
    from public.pagamentos p
    join assinatura s on s.id = p.aluno_assinatura_id
    where p.status in ('pendente', 'atrasado')
      and (p.status = 'atrasado' or (p.vencimento is not null and p.vencimento < current_date))
    group by p.aluno_assinatura_id
  )
  select s.aluno_id,
         (s.status in ('ativa', 'atrasada')
          and (s.status = 'atrasada' or public.aluno_inadimplente_b2c(s.aluno_id))) as bloqueado,
         s.status,
         coalesce(d.qtd, 0),
         coalesce(d.valor, 0),
         d.venc,
         coalesce(s.fatura_pendente_url, d.link)
  from assinatura s
  left join detalhe d on d.aluno_assinatura_id = s.id;
end;
$$;
