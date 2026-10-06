-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- A subconta aberta pela ArkeFit fica atrás de um interruptor (06/10/2026).
--
-- O Asaas respondeu que abrir a conta da academia pela conta da ArkeFit
-- (`POST /accounts`) é BaaS, e o BaaS passa por homologação: formulário,
-- análise e contrato. Desde 28/11/2025 ele segue a Resolução Conjunta BCB/CMN
-- nº 16/2025 (adequação até 31/12/2026): o prestador, o Asaas, aparece
-- identificado nas telas e nos contratos (art. 14), e a conta é do cliente
-- final, na instituição prestadora. A decisão do responsável foi não pedir o
-- BaaS agora: a academia abre a própria conta no Asaas e a conecta pela
-- carteira e pela chave, o caminho recomendado desde 05/10. O sistema fica
-- pronto para o BaaS, de modo que ligar seja configuração, e não reescrita.
--
-- O que muda:
--   1. `asaas_subcontas_baas` em `plataforma_config`, com faixa 0–1 e valor
--      0. Com 0, "Abrir pela ArkeFit" some da tela e `asaas-conta-academia`
--      recusa `acao: "criar"`. A subconta que já existe continua: situação,
--      nota fiscal e saída do aluno não olham o interruptor.
--   2. `asaas_subcontas_baas_ligadas()`: a tela do gestor pergunta por ela,
--      porque `plataforma_config` só a ArkeFit lê.
--   3. `aceites_termos_asaas`: com o interruptor ligado, a conta só é aberta
--      depois de o titular (a gestão da academia) aceitar os Termos de Uso
--      do Asaas. Fica quem aceitou, quando e qual endereço dos termos — e
--      nada mais.

-- ── 1. O interruptor, com a faixa ─────────────────────────────────────────
-- O corpo de 20261327010000, com a chave nova. Chave nova nasce com faixa.
create or replace function public.faixa_plataforma_config(_chave text)
returns table (minimo numeric, maximo numeric, inteiro boolean)
language sql
immutable
set search_path = public
as $$
  select f.minimo, f.maximo, f.inteiro
    from (values
      -- Interruptores: 0 desligado, 1 ligado.
      ('agente_comercial_ativo', 0::numeric, 1::numeric, true),
      ('agente_comercial_ia', 0, 1, true),
      ('agente_comercial_outras_origens', 0, 1, true),
      ('agente_implantacao_ativo', 0, 1, true),
      ('assistente_ativo', 0, 1, true),
      ('assistente_ia', 0, 1, true),
      ('asaas_subcontas_baas', 0, 1, true),
      ('exigir_registro_metodo', 0, 1, true),
      ('vigia_ativo', 0, 1, true),
      -- Janela e prazo do aviso de catraca fora do ar (horas de Brasília, minutos).
      ('alerta_catraca_hora_inicio', 0, 23, true),
      ('alerta_catraca_hora_fim', 1, 24, true),
      ('alerta_catraca_minutos', 2, 240, true),
      -- Disco do banco contratado, em MB.
      ('limite_banco_mb', 100, 10000000, true),
      -- Dinheiro: taxa de implantação em reais; taxa do gateway em % e em reais.
      ('taxa_implantacao_referencia', 0, 100000, false),
      ('taxa_processamento_percentual', 0, 15, false),
      ('taxa_processamento_fixa', 0, 10, false),
      ('taxa_processamento_minima', 0, 20, false)
    ) as f(chave, minimo, maximo, inteiro)
   where f.chave = _chave;
$$;

revoke execute on function public.faixa_plataforma_config(text) from public, anon;
grant execute on function public.faixa_plataforma_config(text) to authenticated;

insert into public.plataforma_config (chave, valor, descricao)
values (
  'asaas_subcontas_baas',
  0,
  'Subconta Asaas aberta pela ArkeFit (BaaS): 1 mostra "Abrir pela ArkeFit" na conta de recebimentos, com o aceite dos Termos do Asaas. Só ligar depois da homologação do BaaS com o Asaas.'
)
on conflict (chave) do nothing;

-- ── 2. A pergunta da tela ──────────────────────────────────────────────────
-- Sem parâmetro, sem dado de academia: só diz se o caminho está aberto.
create or replace function public.asaas_subcontas_baas_ligadas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select c.valor = 1 from public.plataforma_config c where c.chave = 'asaas_subcontas_baas'), false);
$$;

comment on function public.asaas_subcontas_baas_ligadas() is
  'O interruptor asaas_subcontas_baas, para a tela da gestão (que não lê plataforma_config). Falso sem a chave.';

revoke execute on function public.asaas_subcontas_baas_ligadas() from public, anon;
grant execute on function public.asaas_subcontas_baas_ligadas() to authenticated, service_role;

-- ── 3. O aceite dos Termos do Asaas ────────────────────────────────────────
create table if not exists public.aceites_termos_asaas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Quem aceitou pela academia. Sem chave estrangeira: o registro sobrevive
  -- à saída da pessoa, que é quando ele mais importa.
  aceito_por uuid not null,
  aceito_em timestamptz not null default now(),
  -- O endereço dos termos que a tela mostrou.
  termos_url text not null check (termos_url ~ '^https://'),
  check (char_length(termos_url) <= 500)
);

comment on table public.aceites_termos_asaas is
  'Aceite dos Termos de Uso do Asaas pela gestão da academia, antes de a ArkeFit abrir a subconta (BaaS). Só quem, quando e qual endereço. Gravado por asaas-conta-academia.';

create index if not exists idx_aceites_termos_asaas_org on public.aceites_termos_asaas (organization_id, aceito_em desc);

alter table public.aceites_termos_asaas enable row level security;
revoke all on public.aceites_termos_asaas from anon, authenticated;
grant select on public.aceites_termos_asaas to authenticated;
grant all on public.aceites_termos_asaas to service_role;

-- Uma regra por operação: a leitura. A gestão da academia e a ArkeFit leem;
-- ninguém grava pela API (só a função, com a service_role).
drop policy if exists "leitura" on public.aceites_termos_asaas;
create policy "leitura" on public.aceites_termos_asaas
  for select to authenticated
  using (
    public.has_role((select auth.uid()), 'superadmin'::app_role)
    or public.has_role((select auth.uid()), 'admin_arke'::app_role)
    or exists (
      select 1 from public.organization_members m
       where m.organization_id = aceites_termos_asaas.organization_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
         and m.role = 'gestor'
    )
  );
