-- Consentimento de IA: por propósito, versionado, e dizendo a verdade (23/09/2026).
--
-- Três correções numa migration só, porque as três são o mesmo defeito visto de
-- ângulos diferentes: **o consentimento declarava coisas que não correspondiam
-- ao que de fato acontece.**
--
-- 1. **O texto prometia o que o contrato não garante.** Dizia "o provedor de IA
--    processa **sem reter**", e o padrão da API da OpenAI retém por até 30 dias
--    para monitoramento de abuso. Consentimento que declara condição falsa é
--    consentimento viciado — pior do que não ter prometido nada, porque o vício
--    contamina a base legal inteira (LGPD art. 11, I).
--
-- 2. **O texto não declarava a transferência internacional.** O processamento
--    acontece em servidor fora do Brasil. Como não há mais a opção de manter o
--    processamento no país, a base da transferência passa a ser o **art. 33,
--    VIII** — consentimento específico e destacado, *com informação prévia
--    sobre o caráter internacional da operação*. Sem a frase, não há base.
--
-- 3. **O chat ia para o modelo sem consentimento nenhum.** A finalidade
--    declarada era só "resumir a anamnese", e `mentor-sugerir-resposta` mandava
--    as palavras do aluno — que podem trazer dor, cirurgia, medicamento — sem
--    conferir nada. São finalidades diferentes e por isso pedem consentimentos
--    diferentes: juntá-las num interruptor só recriaria exatamente o
--    "consentimento genérico não é consentimento" que esta tabela existe para
--    evitar.

-- ── 1. Propósito ───────────────────────────────────────────────────────────
alter table public.aluno_consentimento_ia
  add column if not exists proposito text not null default 'anamnese';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'consentimento_ia_proposito_valido') then
    alter table public.aluno_consentimento_ia
      add constraint consentimento_ia_proposito_valido check (proposito in ('anamnese', 'chat'));
  end if;
end $$;

comment on column public.aluno_consentimento_ia.proposito is
  'Para que a IA le o dado: anamnese (auditoria preventiva) ou chat (sugestao de resposta). Finalidades diferentes pedem consentimentos diferentes.';

-- ── 2. Versão do texto ─────────────────────────────────────────────────────
--
-- Mesmo mecanismo de `documentos_legais`: o registro prova o que exatamente foi
-- aceito. Quando o texto muda de sentido — e mudou, porque prometia retenção
-- zero e omitia o exterior —, o consentimento antigo **deixa de valer** e a
-- pessoa é perguntada de novo. Reescrever a linha antiga no lugar falsificaria
-- a prova: diria que ela concordou com um texto que nunca leu.
alter table public.aluno_consentimento_ia
  add column if not exists versao_texto text not null default '2026-09-23';

comment on column public.aluno_consentimento_ia.versao_texto is
  'Versao do texto consentido. Texto novo = versao nova = todos consentem de novo; reescrever a linha antiga falsificaria a prova.';

create or replace function public.versao_consentimento_ia()
returns text
language sql
immutable
as $$ select '2026-09-23'::text $$;

comment on function public.versao_consentimento_ia() is
  'Versao vigente do texto de consentimento de IA. Mudou o sentido do texto, muda aqui, e os consentimentos anteriores param de valer.';

-- Um consentimento vigente por aluno **e propósito**.
drop index if exists public.idx_consentimento_ia_vigente;
create unique index if not exists idx_consentimento_ia_vigente
  on public.aluno_consentimento_ia (aluno_id, proposito) where revogado_em is null;

-- ── 3. O texto novo ────────────────────────────────────────────────────────
--
-- Duas mudanças de conteúdo, e as duas são de honestidade:
--
-- **Declara o exterior.** É o que o art. 33, VIII exige para a transferência
-- internacional se apoiar no consentimento — e, sem a opção de processar no
-- Brasil, é a base que resta.
--
-- **Para de prometer retenção zero.** Descreve a retenção que de fato existe
-- hoje. Se a retenção zero for contratada com o provedor, isto muda junto com
-- a versão — e aí a promessa passa a ser verdadeira, que é a única condição em
-- que ela pode aparecer aqui.
alter table public.aluno_consentimento_ia
  alter column finalidade set default
    'Analisar dado do aluno com inteligência artificial para apoiar a equipe de acompanhamento da ArkeFit.',
  alter column retencao_descricao set default
    'O processamento é feito por provedor de inteligência artificial com servidores fora do Brasil. '
    'O provedor pode guardar o conteúdo por até 30 dias para checagem de uso indevido, e não o utiliza '
    'para treinar modelos. O que o ARKE guarda fica enquanto durar a matrícula e é apagado se a '
    'autorização for retirada.';

-- ── 4. A checagem passa a ser por propósito ────────────────────────────────
--
-- Assinatura nova: a antiga `(uuid)` não sabia distinguir, e mantê-la ao lado
-- seria deixar no PostgREST uma função que responde "sim" para um propósito que
-- ninguém autorizou.
drop function if exists public.aluno_consentiu_ia(uuid);

create or replace function public.aluno_consentiu_ia(_aluno_id uuid, _proposito text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.aluno_consentimento_ia c
     where c.aluno_id = _aluno_id
       and c.proposito = _proposito
       and c.revogado_em is null
       -- Consentimento dado sob texto antigo não vale para o texto novo.
       and c.versao_texto = public.versao_consentimento_ia()
  );
$$;

comment on function public.aluno_consentiu_ia(uuid, text) is
  'Consentimento especifico, destacado e VIGENTE para a IA processar aquele dado (LGPD art. 11, I e art. 33, VIII). Revogavel.';

revoke execute on function public.aluno_consentiu_ia(uuid, text) from public;
grant execute on function public.aluno_consentiu_ia(uuid, text) to authenticated, service_role;
revoke execute on function public.versao_consentimento_ia() from public;
grant execute on function public.versao_consentimento_ia() to authenticated, service_role;

-- ── 5. A anamnese acompanha a assinatura nova ──────────────────────────────
create or replace function public.anamnese_para_auditoria(_aluno_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _t text;
begin
  if not public.aluno_consentiu_ia(_aluno_id, 'anamnese') then
    raise exception 'Este aluno não autorizou a análise da anamnese por inteligência artificial.'
      using errcode = '42501';
  end if;

  select concat_ws(E'\n',
           nullif('Objetivo: ' || nullif(btrim(an.objetivo_principal), ''), 'Objetivo: '),
           nullif('Histórico de dores ou lesões: ' || nullif(btrim(an.dores_lesoes), ''), 'Histórico de dores ou lesões: '),
           nullif('Medicamentos: ' || nullif(btrim(an.medicamentos), ''), 'Medicamentos: '),
           nullif('Experiência com exercício: ' || nullif(btrim(an.experiencias_exercicio), ''), 'Experiência com exercício: ')
         )
    into _t
    from public.anamnese_acolhimento an
   where an.aluno_id = _aluno_id and an.concluida_em is not null;

  return _t;
end;
$$;

revoke execute on function public.anamnese_para_auditoria(uuid) from public;
grant execute on function public.anamnese_para_auditoria(uuid) to service_role;

-- ── 6. O chat ganha a mesma trava, pelo mesmo motivo ───────────────────────
--
-- **Conferir e obter são a mesma operação**, como na anamnese: a edge function
-- precisa desta função para ter a conversa, então não existe caminho novo que
-- esqueça de checar. Antes ela lia `mensagens_mentor` direto com a service
-- role, que ignora RLS — o tipo de acesso em que uma checagem esquecida não dá
-- erro nenhum.
--
-- Oito mensagens é o que a sugestão precisa para pegar o fio da conversa.
-- Mandar o histórico inteiro seria expor mais dado a um terceiro para melhorar
-- nada.
create or replace function public.conversa_para_sugestao(_aluno_id uuid, _limite integer default 8)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  _t text;
begin
  if not public.aluno_consentiu_ia(_aluno_id, 'chat') then
    raise exception 'Este aluno não autorizou a análise das mensagens por inteligência artificial.'
      using errcode = '42501';
  end if;

  select string_agg(
           case when m.remetente_tipo = 'aluno' then 'Aluno: ' else 'Mentor: ' end || m.mensagem,
           E'\n' order by m.created_at
         )
    into _t
    from (
      select remetente_tipo, mensagem, created_at
        from public.mensagens_mentor
       where aluno_id = _aluno_id
       order by created_at desc
       limit greatest(least(_limite, 30), 1)
    ) m;

  return _t;
end;
$$;

comment on function public.conversa_para_sugestao(uuid, integer) is
  'Ultimas mensagens para o Sentinela sugerir resposta. RECUSA sem consentimento de proposito "chat": conferir e obter sao a mesma operacao.';

revoke execute on function public.conversa_para_sugestao(uuid, integer) from public;
grant execute on function public.conversa_para_sugestao(uuid, integer) to service_role;

-- ── 7. Revogar apaga o derivado daquele propósito ──────────────────────────
--
-- A regra já valia para a anamnese e agora vale para os dois, cada um no que é
-- seu: revogar o consentimento do chat não pode apagar o resumo da anamnese,
-- que continua autorizado.
--
-- **A sugestão é anonimizada, não excluída.** `sentinela_sugestoes.sugestao` é
-- texto derivado da conversa e sai; o resto da linha — desfecho, fornecedor,
-- datas — fica, porque ela mede o comportamento do *mentor* (quanto da
-- sugestão ele aproveita), e é esse número que decide se o recurso se paga.
-- Apagar a linha inteira destruiria uma medida sobre outra pessoa para cumprir
-- um pedido que não era sobre ela.
create or replace function public.apagar_resumo_ao_revogar_ia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.revogado_em is not null and old.revogado_em is null then
    if new.proposito = 'anamnese' then
      delete from public.sentinela_anamnese where aluno_id = new.aluno_id;
    elsif new.proposito = 'chat' then
      update public.sentinela_sugestoes
         set sugestao = '[removido a pedido do aluno]'
       where aluno_id = new.aluno_id and sugestao <> '[removido a pedido do aluno]';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.apagar_resumo_ao_revogar_ia() from public;

-- O gatilho já existe desde a migration da Fase 5a; recriado aqui só para o
-- caso de a função ter sido substituída sem ele estar ligado.
drop trigger if exists trg_apagar_resumo_ao_revogar_ia on public.aluno_consentimento_ia;
create trigger trg_apagar_resumo_ao_revogar_ia
  after update on public.aluno_consentimento_ia
  for each row execute function public.apagar_resumo_ao_revogar_ia();
