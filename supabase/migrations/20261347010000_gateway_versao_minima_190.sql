-- Versão mínima do Gateway para 1.9.0 (06/10/2026).
--
-- A 1.9.0 corrige o que a auditoria de prontidão achou nas catracas: o nome
-- e o motivo financeiro no display da Topdata Inner, o código de barras e o
-- QR que valiam como o número do aluno, a fila de acessos offline que um
-- registro com problema travava, e o CPF que ficava no computador da recepção.
-- Com a mínima em 1.9.0, a Visão Master marca qualquer Gateway anterior.
-- Nada é bloqueado. Só muda se ninguém tiver mexido no valor.
--
-- Aplicar depois de o instalador da 1.9.0 estar publicado: antes disso, a
-- Visão Master pediria uma atualização que ainda não existe.
set lock_timeout = '5s';

update public.plataforma_textos
   set valor = '1.9.0', updated_at = now()
 where chave = 'gateway_versao_minima'
   and valor = '1.8.1';
