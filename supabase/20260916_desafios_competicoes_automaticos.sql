-- Sessão A, fatias A4/A5: desafios e competições passam a ter progresso
-- calculado automaticamente a partir de dado real já registrado pelo aluno
-- (mesma lógica de calcAuto/computeScoreAluno em server/arkeGamification.ts),
-- sem nunca sobrescrever um ajuste que a equipe já fez manualmente.
--
-- `origem` marca quem escreveu a linha por último: o cron
-- (server/arkeDesafiosAutomaticos.ts / arkeCompeticoesAutomaticas.ts) só
-- grava linhas 'automatico' e pula qualquer aluno cuja linha já esteja
-- marcada 'manual' — a equipe sempre pode sobrescrever pontualmente sem o
-- job desfazer no próximo dia (mesmo mecanismo já usado por outras
-- automações do projeto, nunca afirmando um resultado que o cron não
-- calculou de verdade).
alter table public.desafio_progresso
  add column origem text not null default 'manual' check (origem in ('automatico', 'manual'));

alter table public.competicoes
  add column modo_pontuacao text not null default 'manual' check (modo_pontuacao in ('manual', 'automatica'));

alter table public.competicao_pontuacao
  add column origem text not null default 'manual' check (origem in ('automatico', 'manual'));
