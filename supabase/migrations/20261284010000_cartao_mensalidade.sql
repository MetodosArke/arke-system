-- Cobrança automática no cartão também na mensalidade da academia (24/09/2026).
--
-- O cartão recorrente existia só no Método ARKE. A mensalidade do plano
-- próprio da academia seguia só por fatura — todo mês o aluno tinha de
-- lembrar de pagar, que é onde nasce a inadimplência de quem não quer sair,
-- só esqueceu. As colunas espelham as de `aluno_assinaturas`: o banco guarda
-- só os 4 últimos dígitos e a bandeira, nunca o número.
alter table public.aluno_matriculas_academia
  add column forma_pagamento text not null default 'fatura' check (forma_pagamento in ('fatura', 'cartao')),
  add column cartao_final text check (cartao_final is null or cartao_final ~ '^\d{4}$'),
  add column cartao_bandeira text,
  add column cartao_atualizado_em timestamptz,
  add column cartao_atualizado_por uuid,
  add column cartao_recusado_em timestamptz;

-- Recusa na cobrança recorrente: não corta o acesso (a cobrança ainda não
-- venceu), mas a academia precisa agir agora. A mensalidade é relação da
-- academia com o aluno, então a tarefa é dela — mesmo para aluno do Método.
create or replace function public.abrir_tarefa_cartao_recusado_mensalidade(_matricula_id uuid, _asaas_payment_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tarefas (organization_id, aluno_id, motivo, prioridade, sla_prazo, origem_evento, tipo, dono)
  select m.organization_id, m.aluno_id,
         'Cartão recusado na mensalidade da academia'
           || coalesce(' (final ' || m.cartao_final || ')', '')
           || ' — falar com o aluno para atualizar o cartão ou pagar pela fatura antes do vencimento',
         'alta', now() + interval '24 hours',
         'cartao_recusado_mensalidade:' || coalesce(_asaas_payment_id, m.id::text),
         'cobranca', 'academia'
    from public.aluno_matriculas_academia m
   where m.id = _matricula_id
  on conflict (organization_id, origem_evento) do nothing;
end;
$$;
revoke execute on function public.abrir_tarefa_cartao_recusado_mensalidade(uuid, text) from public, anon, authenticated;
grant execute on function public.abrir_tarefa_cartao_recusado_mensalidade(uuid, text) to service_role;
