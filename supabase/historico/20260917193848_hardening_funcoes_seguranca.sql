-- Cópia fiel do que rodou no banco de produção (supabase_migrations.schema_migrations).
-- Gerada por scripts/migracao/historico.mjs; não editar à mão.

-- fixa search_path nas funções de trigger (mutable search_path warning)
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.bloquear_edicao_conteudo_publicado()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.conteudo is distinct from new.conteudo or old.versao_id is distinct from new.versao_id then
    raise exception 'Prescrição publicada é imutável: crie uma nova versão em vez de editar o conteúdo existente.';
  end if;
  return new;
end;
$$;

create or replace function public.exigir_desfecho_ao_concluir()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('concluida', 'cancelada')
     and old.status not in ('concluida', 'cancelada')
     and (new.desfecho_acao is null or btrim(new.desfecho_acao) = '') then
    raise exception 'Não é possível encerrar uma tarefa sem registrar o desfecho_acao.';
  end if;
  return new;
end;
$$;

-- as funções has_role/is_org_member/has_org_role/is_org_staff são de uso interno das
-- policies de RLS; não precisam ser chamáveis diretamente via REST RPC por anon/authenticated
revoke execute on function public.has_role(uuid, public.app_role) from anon, authenticated;
revoke execute on function public.is_org_member(uuid, uuid) from anon, authenticated;
revoke execute on function public.has_org_role(uuid, uuid, public.app_role) from anon, authenticated;
revoke execute on function public.is_org_staff(uuid, uuid) from anon, authenticated;
