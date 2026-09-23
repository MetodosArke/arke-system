-- Compromisso de rotina: só "Treino" ou "Descanso".
--
-- Decisão de 23/09/2026. O seletor tinha dezesseis modalidades (Treino A–D,
-- Yoga, Pilates, Funcional, CrossFit, Musculação, Caminhada, Corrida, Natação,
-- Ciclismo, Alongamento, HIIT). O compromisso responde uma pergunta só —
-- **neste dia eu treino ou descanso?** — e qual treino é assunto da ficha, que
-- já traz a divisão. Manter dezesseis opções pedia ao aluno um segundo
-- planejamento que nenhuma tela lia.
--
-- Conversão do que já está gravado: tudo que não é "Descanso" vira "Treino".
-- Isso preserva a intenção — quem marcou "Corrida" na terça estava dizendo que
-- terça é dia de se mexer, não de descansar. O caminho contrário (apagar) faria
-- a rotina de quem já preencheu voltar a zero sem aviso.

update public.aluno_rotina_semanal
   set modalidade = 'Treino'
 where modalidade is not null
   and modalidade <> 'Descanso'
   and modalidade <> 'Treino';

-- Fecha a porta para valor novo fora da lista, inclusive por service_role e
-- por qualquer tela futura que esqueça a regra.
alter table public.aluno_rotina_semanal
  drop constraint if exists aluno_rotina_semanal_modalidade_check;

alter table public.aluno_rotina_semanal
  add constraint aluno_rotina_semanal_modalidade_check
  check (modalidade is null or modalidade in ('Treino', 'Descanso'));

comment on constraint aluno_rotina_semanal_modalidade_check on public.aluno_rotina_semanal is
  'Compromisso de rotina é treinar ou descansar; a divisão do treino vem da ficha (decisão de 23/09/2026).';
