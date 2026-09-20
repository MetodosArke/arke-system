-- Anti-duplicidade no check-in diário de "Como está sendo seguir seu
-- plano?" — hoje o aluno pode enviar quantos check-ins quiser no mesmo
-- dia (cada clique gera uma linha nova), poluindo o Progresso Semanal e
-- a fila de atendimento (que reage a cada novo registro). Trava por
-- constraint única (aluno_id, data) — defesa em profundidade além do
-- lock de UI feito no frontend.
alter table public.checkins add column data date;
update public.checkins set data = created_at::date where data is null;

-- Antes de travar a constraint, remove duplicatas já existentes (múltiplos
-- check-ins no mesmo dia enviados antes desta trava existir) — mantém só
-- o mais recente de cada dia.
delete from public.checkins c
using public.checkins c2
where c.aluno_id = c2.aluno_id
  and c.data = c2.data
  and c.created_at < c2.created_at;

alter table public.checkins
  alter column data set not null,
  alter column data set default current_date;

alter table public.checkins
  add constraint checkins_aluno_data_unique unique (aluno_id, data);
