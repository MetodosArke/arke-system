-- Segunda rodada de auditoria de resiliência/usabilidade sobre o código
-- recente (Homes por papel, SuperAdmin onboarding, gestão de equipe):
-- adiciona duas travas de servidor que o client sozinho não garante.

-- 1) Nenhuma organização pode ficar sem gestor ativo. Sem isso, um gestor
-- (o único da organização) conseguia remover ou inativar o próprio
-- registro em organization_members e travar o tenant inteiro: ninguém
-- mais consegue convidar/editar/remover membros (as policies e a edge
-- function exigem um gestor ativo), só admin_arke/superadmin destravam.
create or replace function public.prevent_remover_ultimo_gestor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_outros_gestores_ativos integer;
begin
  v_org_id := coalesce(old.organization_id, new.organization_id);

  if old.role = 'gestor' and old.status = 'active'
     and (tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.status <> 'active' or new.role <> 'gestor'))) then
    select count(*) into v_outros_gestores_ativos
      from public.organization_members
      where organization_id = v_org_id
        and role = 'gestor'
        and status = 'active'
        and user_id <> old.user_id;

    if v_outros_gestores_ativos = 0 then
      raise exception 'Não é possível remover ou inativar o único gestor ativo da organização.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_remover_ultimo_gestor on public.organization_members;
create trigger trg_prevent_remover_ultimo_gestor
  before update or delete on public.organization_members
  for each row execute function public.prevent_remover_ultimo_gestor();

-- 2) O card "Perfil do Estabelecimento" (/admin/organizacao) faz update
-- direto na tabela organizations (sem edge function), então nada além da
-- RLS "gestor atualiza a própria organização" impede um gestor de tentar
-- setar tipo = 'profissional_autonomo' via uma chamada manual à REST API
-- (a UI só oferece Academia/Studio, mas isso não é garantia de servidor).
-- Converter em profissional autônomo é uma mudança estrutural do tenant
-- (perfil de negócio inteiro diferente) — fica restrita a admin_arke/superadmin.
create or replace function public.prevent_gestor_tipo_para_autonomo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tipo = 'profissional_autonomo' and old.tipo <> 'profissional_autonomo'
     and not (public.has_role(auth.uid(), 'admin_arke') or public.has_role(auth.uid(), 'superadmin')) then
    raise exception 'Apenas a ARKE pode converter uma organização em profissional autônomo.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_gestor_tipo_para_autonomo on public.organizations;
create trigger trg_prevent_gestor_tipo_para_autonomo
  before update of tipo on public.organizations
  for each row execute function public.prevent_gestor_tipo_para_autonomo();
