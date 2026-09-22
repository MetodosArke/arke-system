-- "Primeiro acesso" por QR Code: um link só por academia, na recepção e no
-- WhatsApp. O aluno digita o e-mail ou o celular que a academia cadastrou e
-- recebe o próprio link para criar a senha. Substitui os centenas de cliques
-- no "Enviar Ativação via WhatsApp", aluno a aluno.
--
-- Esta função acha o e-mail de login do aluno daquela academia. Só a
-- service_role a alcança (a edge function primeiro-acesso): exposta ao
-- cliente, viraria um jeito de descobrir quem é aluno de qual academia.
create or replace function public.buscar_aluno_primeiro_acesso(_organization_id uuid, _contato text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_contato text := btrim(coalesce(_contato, ''));
  v_digitos text := regexp_replace(coalesce(_contato, ''), '\D', '', 'g');
  v_email text;
begin
  if v_contato = '' then
    return null;
  end if;

  if position('@' in v_contato) > 0 then
    select u.email into v_email
      from public.alunos a
      join auth.users u on u.id = a.user_id
     where a.organization_id = _organization_id
       and a.anonimizado_em is null
       and lower(u.email) = lower(v_contato)
     limit 1;
  elsif length(v_digitos) >= 10 then
    -- Celular: compara os últimos 11 (ou 10) dígitos, para "+55 (11) 9..." e
    -- "119..." baterem com o que a academia cadastrou.
    select u.email into v_email
      from public.alunos a
      join public.profiles p on p.user_id = a.user_id
      join auth.users u on u.id = a.user_id
     where a.organization_id = _organization_id
       and a.anonimizado_em is null
       and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(v_digitos, 10)
     order by a.created_at
     limit 1;
  end if;

  return v_email;
end;
$$;

revoke execute on function public.buscar_aluno_primeiro_acesso(uuid, text) from public, anon, authenticated;
grant execute on function public.buscar_aluno_primeiro_acesso(uuid, text) to service_role;
