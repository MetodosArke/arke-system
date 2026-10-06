-- Encerramento de academia: a conta só sai sem vínculo nenhum (06/10/2026).
--
-- Auditoria de prontidão, achado médio. A eliminação devolvia para apagar no
-- Auth a conta de quem não tinha vínculo **ativo** em outra organização. Quem
-- tinha um vínculo inativo noutra academia (o professor que saiu, o
-- ex-gestor, a parceria desfeita) perdia a conta, e a cascata da conta levava
-- junto, na outra academia, o histórico e as mensagens da pessoa — registro
-- daquela academia, que ninguém pediu para apagar.
--
-- A regra passa a ser a mesma de `excluir_aluno_da_academia`
-- (20261339010000): a conta só sai quando não sobra vínculo nenhum (nem
-- inativo) em outra organização, nenhuma matrícula em outra academia, nenhum
-- papel global e nenhum lugar na equipe da ArkeFit. O resto da função não
-- muda.

set lock_timeout = '5s';

create or replace function public.preparar_eliminacao_organizacao(_encerramento_id uuid)
returns table (user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enc record;
  v_org record;
  v_fiscais integer;
begin
  select * into v_enc from public.organizacao_encerramentos where id = _encerramento_id and etapa = 'encerrada';
  if v_enc.id is null then
    raise exception 'Encerramento não está encerrado.' using errcode = 'P0002';
  end if;
  select id, nome, cnpj_cpf into v_org from public.organizations where id = v_enc.organization_id;

  -- Refeito do zero a cada tentativa: uma eliminação que falhou no meio e roda de novo não duplica.
  delete from public.arquivo_fiscal_arkefit where organization_id = v_org.id;
  insert into public.arquivo_fiscal_arkefit (organization_id, organizacao_nome, organizacao_documento, origem,
                                             asaas_payment_id, data_pagamento, valor_cobrado, valor_arkefit, taxa_gateway)
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'b2b', b.asaas_payment_id, b.data_pagamento, b.valor, b.valor, b.taxa_gateway
    from public.cobrancas_b2b b where b.organization_id = v_org.id and b.status = 'confirmado'
  union all
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'metodo', p.asaas_payment_id, p.data_pagamento, p.valor, coalesce(p.valor_repasse_arke, 0), p.taxa_gateway
    from public.pagamentos p where p.organization_id = v_org.id and p.status = 'confirmado'
  union all
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'plano', m.asaas_payment_id, m.data_pagamento, m.valor, coalesce(m.valor_repasse_arke, 0), m.taxa_gateway
    from public.mensalidades m where m.organization_id = v_org.id and m.status = 'confirmado' and m.asaas_payment_id is not null
  union all
  select v_org.id, v_org.nome, v_org.cnpj_cpf, 'avulsa', c.asaas_payment_id, c.data_pagamento, c.valor, coalesce(c.valor_repasse_arke, 0), c.taxa_gateway
    from public.cobrancas_avulsas c where c.organization_id = v_org.id and c.status = 'confirmado';
  get diagnostics v_fiscais = row_count;

  -- A digital já foi agendada para sair no término. Sem o número, apagar o
  -- aluno junto com a organização não agenda de novo para catracas que
  -- também estão sendo apagadas.
  update public.alunos set identificador_catraca = null where organization_id = v_org.id;

  update public.organizacao_encerramentos set registros_fiscais = v_fiscais where id = _encerramento_id;

  -- Conta que só existia aqui. Vínculo inativo noutra organização segura a
  -- conta: na outra academia, até o histórico de quem saiu é registro dela.
  return query
  select distinct u.uid
    from (
      select m.user_id as uid from public.organization_members m where m.organization_id = v_org.id
      union
      select a.user_id from public.alunos a where a.organization_id = v_org.id
    ) u
   where u.uid is not null
     and not exists (select 1 from public.organization_members m2
                      where m2.user_id = u.uid and m2.organization_id <> v_org.id)
     and not exists (select 1 from public.alunos a2 where a2.user_id = u.uid and a2.organization_id <> v_org.id)
     and not exists (select 1 from public.user_roles r where r.user_id = u.uid)
     and not exists (select 1 from public.equipe_arkefit e where e.user_id = u.uid);
end;
$$;

revoke execute on function public.preparar_eliminacao_organizacao(uuid) from public, anon, authenticated;
grant execute on function public.preparar_eliminacao_organizacao(uuid) to service_role;
