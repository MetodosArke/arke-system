-- Sem esperar trava: se a tabela estiver ocupada, a migration falha e é rodada de novo,
-- em vez de fazer o app e a catraca esperarem atrás dela.
set lock_timeout = '5s';

-- Cada configuração da plataforma com a sua faixa válida.
--
-- `plataforma_config` aceitava qualquer número, e um erro de digitação em
-- Visão Master → Configurações valia na hora para todas as academias: a taxa
-- de processamento em 29,9 em vez de 2,99 mudaria o split de toda cobrança
-- nova, e um interruptor em 2 não é nem ligado nem desligado. Agora cada
-- chave tem mínimo, máximo e se aceita casa decimal, num lugar só, e o
-- gatilho recusa o que sai da faixa. Chave nova sem faixa também é recusada:
-- quem cria a chave define a faixa junto.

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

create or replace function public.conferir_faixa_plataforma_config()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  f record;
begin
  select * into f from public.faixa_plataforma_config(new.chave);
  if f.minimo is null then
    raise exception using
      message = format('A configuração "%s" não tem faixa válida. Defina a faixa em faixa_plataforma_config() ao criar a chave.', new.chave),
      errcode = '23514';
  end if;
  if new.valor is null or new.valor < f.minimo or new.valor > f.maximo or (f.inteiro and new.valor <> trunc(new.valor)) then
    raise exception using
      message = format('Valor fora da faixa para "%s": use de %s a %s%s.', new.chave,
                       replace(trim_scale(f.minimo)::text, '.', ','), replace(trim_scale(f.maximo)::text, '.', ','),
                       case when f.inteiro then ', sem casas decimais' else '' end),
      errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.conferir_faixa_plataforma_config() from public, anon, authenticated;

drop trigger if exists trg_faixa_plataforma_config on public.plataforma_config;
create trigger trg_faixa_plataforma_config
  before insert or update of chave, valor on public.plataforma_config
  for each row execute function public.conferir_faixa_plataforma_config();

-- O que já está gravado tem de caber: se não couber, a migration para aqui,
-- em vez de deixar uma configuração que nenhuma tela consegue mais salvar.
do $$
declare
  r record;
  f record;
begin
  for r in select chave, valor from public.plataforma_config loop
    select * into f from public.faixa_plataforma_config(r.chave);
    if f.minimo is null or r.valor < f.minimo or r.valor > f.maximo or (f.inteiro and r.valor <> trunc(r.valor)) then
      raise exception 'Configuração atual fora da faixa nova: % = %', r.chave, r.valor;
    end if;
  end loop;
end;
$$;
