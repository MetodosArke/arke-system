-- O teto do Growth sobe de 300 para 500 alunos ativos (06/10/2026).
--
-- Decisão do responsável: o plano de entrada passa a ter teto de até 500
-- alunos, e os outros acompanham. O preço não muda. O Enterprise começa onde o
-- Growth termina (a página de vendas e a Visão Master calculam o 501 a partir
-- deste número), e o Redes e o Custom não têm teto de alunos.
--
-- As academias que estavam no Growth com o teto de antes sobem junto: o
-- limite gravado nelas é cópia do da tabela (`trg_limite_segue_plano`), e
-- mudar a tabela só vale para quem entra depois. Limite negociado à parte
-- (diferente de 300) não é tocado.

set lock_timeout = '5s';

update public.planos_b2b_precos
   set limite_alunos = 500, updated_at = now()
 where plano = 'growth' and limite_alunos = 300;

update public.organizations
   set limite_alunos = 500
 where plano_b2b = 'growth' and limite_alunos = 300;
