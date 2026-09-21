-- A service_role ignora RLS, mas não ignora GRANT — e neste projeto os
-- privilégios padrão cobrem tabela, não sequência. Todas as tabelas antigas
-- usam uuid, então isso nunca apareceu; as duas primeiras com bigserial
-- (reconciliacoes_asaas e matricula_publica_tentativas) nasceram com a
-- sequência inacessível.
--
-- O sintoma foi o insert da reconciliação levando 403 em produção: a varredura
-- rodava, respondia 200, e o registro não era gravado. A de tentativas da
-- matrícula não quebrou só porque é escrita por funções security definer
-- (dono postgres), mas recebe o mesmo grant para não esperar o próximo caminho
-- que a escreva direto.

grant usage, select on sequence public.reconciliacoes_asaas_id_seq to service_role;
grant usage, select on sequence public.matricula_publica_tentativas_id_seq to service_role;
