-- Rosto pelo app: uma vez só (decisão do responsável, 02/10/2026).
--
-- "No app do aluno vamos travar só a cadastrar a facial 1x, demais edições
-- somente com a academia pra não virar bagunça." O aluno manda a foto pelo
-- app enquanto não tiver rosto cadastrado nem foto a caminho das catracas.
-- Depois disso, trocar é com a recepção, pela câmera do leitor
-- (cadastrar_rosto, botão da ficha).
--
-- O que conta como "já cadastrou": ordem de rosto (foto do app ou câmera do
-- leitor) concluída, ou foto ainda a caminho (pendente ou entregue). O que
-- não conta: tentativa que falhou ou expirou — foto sem rosto, leitor fora
-- do ar por um dia —, para uma foto ruim não trancar o aluno fora do app.
-- Vale também depois de a autorização ser retirada e dada de novo: o
-- cadastro seguinte é com a academia.
--
-- Com isto, "foto nova troca a anterior" deixa de existir: a segunda foto
-- é recusada enquanto a primeira está a caminho.

create or replace function public.aluno_pode_enviar_foto_rosto(_aluno_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.gateway_comandos c
     where c.aluno_id = _aluno_id
       and c.tipo in ('enviar_foto_rosto', 'cadastrar_rosto')
       and c.status in ('pendente', 'entregue', 'concluido')
  );
$$;

revoke all on function public.aluno_pode_enviar_foto_rosto(uuid) from public, anon, authenticated;
grant execute on function public.aluno_pode_enviar_foto_rosto(uuid) to service_role;

-- A foto do rosto que o próprio aluno manda pelo app. Só ele: foto de rosto
-- é dado biométrico, e quem autoriza e envia é o titular.
create or replace function public.enviar_foto_rosto(_aluno_id uuid, _foto text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos;
  v_foto uuid;
  v_lote uuid := gen_random_uuid();
  v_ident text;
  v_n integer := 0;
  v_tentativa integer := 0;
  r record;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null or v_aluno.user_id is distinct from auth.uid() then
    raise exception 'Só o próprio aluno envia a foto do rosto.' using errcode = '42501';
  end if;
  if v_aluno.anonimizado_em is not null then
    raise exception 'Cadastro anonimizado não recebe foto.';
  end if;
  if not public.situacao_permite_app(v_aluno.situacao_academia, v_aluno.situacao_academia_em) then
    raise exception 'Fale com a recepção da academia antes de cadastrar o rosto.';
  end if;
  if not public.aluno_consentiu_rosto(_aluno_id) then
    raise exception 'Autorize antes o uso do rosto na catraca, em Perfil → Privacidade.';
  end if;
  -- Pelo app, uma vez só (decisão do responsável, 02/10/2026): trocar o
  -- rosto depois é com a academia, pela câmera do leitor. Tentativa que
  -- falhou ou expirou não conta, para foto ruim não trancar ninguém fora.
  if not public.aluno_pode_enviar_foto_rosto(_aluno_id) then
    raise exception 'O seu rosto já foi cadastrado nas catracas, ou a foto está a caminho delas. Para trocar, fale com a recepção da academia.';
  end if;
  if _foto is null or _foto not like 'data:image/jpeg;base64,%' or length(_foto) < 2000 or length(_foto) > 400000 then
    raise exception 'A foto precisa ser um JPEG de até 300 KB. Tire de novo pelo app.';
  end if;
  -- Freio: cinco fotos por dia bastam para quem está acertando o enquadramento.
  if (select count(distinct c.parametros->>'foto_id')
        from public.gateway_comandos c
       where c.aluno_id = _aluno_id and c.tipo = 'enviar_foto_rosto'
         and c.solicitado_em > now() - interval '24 hours') >= 5 then
    raise exception 'Você já enviou cinco fotos hoje. Tente de novo amanhã ou peça ajuda na recepção.';
  end if;
  if not exists (
    select 1 from public.organizacao_catracas c
      join public.gateway_telemetria t on t.catraca_id = c.id
     where c.organization_id = v_aluno.organization_id and c.status = 'ativo'
       and 'enviar_foto_rosto' = any (t.capacidades)
  ) then
    raise exception 'A sua academia ainda não tem catraca com leitor facial ligada ao ArkeFit.';
  end if;

  -- O leitor cria o aluno junto com a foto. O número sai daqui, pela mesma
  -- conta do cadastro pela ficha; dois cadastros ao mesmo tempo esbarram no
  -- índice único, e a tentativa seguinte pega o número de depois.
  v_ident := v_aluno.identificador_catraca;
  while v_ident is null loop
    v_tentativa := v_tentativa + 1;
    begin
      v_ident := public.proximo_identificador_catraca(v_aluno.organization_id);
      update public.alunos set identificador_catraca = v_ident where id = _aluno_id;
    exception when unique_violation then
      v_ident := null;
      if v_tentativa >= 3 then
        raise exception 'Não foi possível reservar o número do aluno no equipamento agora. Tente de novo.';
      end if;
    end;
  end loop;

  insert into public.fotos_rosto_pendentes (organization_id, aluno_id, foto)
  values (v_aluno.organization_id, _aluno_id, _foto)
  returning id into v_foto;

  for r in
    select c.id
      from public.organizacao_catracas c
      join public.gateway_telemetria t on t.catraca_id = c.id
     where c.organization_id = v_aluno.organization_id and c.status = 'ativo'
       and 'enviar_foto_rosto' = any (t.capacidades)
  loop
    insert into public.gateway_comandos
      (organization_id, catraca_id, tipo, parametros, aluno_id, lote, solicitado_por, expira_em)
    values
      (v_aluno.organization_id, r.id, 'enviar_foto_rosto',
       jsonb_build_object('user_id', v_ident, 'foto_id', v_foto),
       _aluno_id, v_lote, auth.uid(), now() + interval '24 hours');
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

revoke all on function public.enviar_foto_rosto(uuid, text) from public, anon;
grant execute on function public.enviar_foto_rosto(uuid, text) to authenticated;

-- O que o app do aluno e a ficha mostram sobre o rosto: se a academia tem
-- leitor facial, se a autorização cobre o rosto e como foi o último envio.
-- Nada da foto em si.
create or replace function public.get_cadastro_rosto(_aluno_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_aluno public.alunos;
  v_ultimo public.gateway_comandos;
  v_ultimo_json jsonb := null;
begin
  select * into v_aluno from public.alunos where id = _aluno_id;
  if v_aluno.id is null
     or not (v_aluno.user_id = auth.uid()
             or public.is_org_staff(auth.uid(), v_aluno.organization_id)
             or public.has_role(auth.uid(), 'superadmin')
             or public.has_role(auth.uid(), 'admin_arke')) then
    raise exception 'Aluno não encontrado.' using errcode = '42501';
  end if;

  select * into v_ultimo
    from public.gateway_comandos
   where aluno_id = _aluno_id and tipo in ('enviar_foto_rosto', 'cadastrar_rosto')
   order by solicitado_em desc
   limit 1;

  if v_ultimo.id is not null then
    select jsonb_build_object(
             'tipo', v_ultimo.tipo,
             'enviado_em', v_ultimo.solicitado_em,
             'catracas', count(*),
             'pendentes', count(*) filter (where c.status in ('pendente', 'entregue')),
             'concluidas', count(*) filter (where c.status = 'concluido'),
             'falhas', count(*) filter (where c.status in ('falhou', 'expirado')),
             'erro', (array_agg(c.erro order by c.concluido_em desc nulls last) filter (where c.erro is not null))[1]
           )
      into v_ultimo_json
      from public.gateway_comandos c
     where (v_ultimo.lote is not null and c.lote = v_ultimo.lote)
        or (v_ultimo.lote is null and c.id = v_ultimo.id);
  end if;

  return jsonb_build_object(
    'foto_pelo_app', exists (
      select 1 from public.organizacao_catracas c
        join public.gateway_telemetria t on t.catraca_id = c.id
       where c.organization_id = v_aluno.organization_id and c.status = 'ativo'
         and 'enviar_foto_rosto' = any (t.capacidades)),
    'texto_cobre_rosto', public.versao_consentimento_biometrico() >= public.versao_consentimento_rosto(),
    'autorizado', public.aluno_consentiu_rosto(_aluno_id),
    'pode_enviar_pelo_app', public.aluno_pode_enviar_foto_rosto(_aluno_id),
    'ultimo', v_ultimo_json
  );
end;
$$;

revoke all on function public.get_cadastro_rosto(uuid) from public, anon;
grant execute on function public.get_cadastro_rosto(uuid) to authenticated;
