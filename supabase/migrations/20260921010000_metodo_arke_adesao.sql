-- A academia já tem os próprios alunos matriculados (mensalidade, planos,
-- etc. — sistema normal de academia). O método ARKE é um produto
-- adicional, vendido à parte: o aluno só ganha a experiência ARKE
-- (M.A.P.A.®, acolhimento, onboarding, treino/dieta guiados) quando adere
-- a ela. Até lá, ele é só "aluno matriculado na academia" — precisa
-- continuar com acesso básico funcionando (ex.: treino publicado
-- manualmente pelo professor), só não passa pelo onboarding do método.
--
-- Split/pagamento de adesão (Asaas) fica fora de escopo por enquanto —
-- aqui só criamos o status e a marcação manual do staff.
create type public.metodo_arke_status as enum ('sem_adesao', 'ativo', 'cancelado');

alter table public.alunos
  add column metodo_arke_status public.metodo_arke_status not null default 'sem_adesao',
  add column metodo_arke_ativado_em timestamptz;
