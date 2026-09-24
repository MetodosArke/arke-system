-- Aplicar DEPOIS do deploy da ficha que usa get_jornada_aluno
-- (20261274010000). Antes disso a ficha publicada ainda chama as três
-- direto, e revogar agora apagaria o aviso de "por que não avança".
--
-- As três respondem sobre qualquer aluno pelo id. Quem continua chamando:
-- get_jornada_aluno, get_fila_mentor e o avanço automático (SECURITY DEFINER,
-- rodam como dono) e mentor-sugerir-resposta (service role).
revoke execute on function public.aluno_constancia(uuid, integer) from public, anon, authenticated;
revoke execute on function public.fase_elegivel(uuid) from public, anon, authenticated;
revoke execute on function public.motivo_nao_avanca(uuid) from public, anon, authenticated;

grant execute on function public.aluno_constancia(uuid, integer) to service_role;
grant execute on function public.fase_elegivel(uuid) to service_role;
grant execute on function public.motivo_nao_avanca(uuid) to service_role;
