-- Documentos legais após o parecer jurídico de 23/09/2026.
--
-- O parecer aprovou as minutas e determinou quatro ajustes de texto. Como o
-- texto mudou, a versão muda junto — a regra de sempre, e a razão de estas
-- linhas existirem: o aceite aponta para o hash, e hash novo é texto novo.
--
-- **Política de Privacidade → 2026-09-23.2**
--   - seção 1: a cocontroladoria sobre os dados que servem às duas partes
--     passa a ser nomeada, com a responsabilidade na medida das decisões de
--     cada uma (art. 42, § 1º, I) — item 3.1 do parecer;
--   - seção 4: a redução do prazo de retenção a zero deixa de prometer novo
--     aceite, porque só diminui o risco do titular e não amplia finalidade —
--     item 3.6.
--
-- **Contrato da Academia → 2026-09-23.2**
--   - subseção 6.2 reescrita: nomeia a cocontroladoria, cita o art. 42,
--     distribui o atendimento ao art. 18 e **afasta a responsabilidade da
--     ArkeFit por falha exclusiva da academia na execução presencial** —
--     item 3.1.
--
-- **Termos de Uso → 2026-09-23** (primeira mudança desde 2026-09-22.2)
--   - cláusula 3 passa a declarar que resposta "sim" no PAR-Q sem atestado
--     conferido **bloqueia o registro de treino** — item 3.8. A trava já
--     existia no produto e não estava escrita em documento nenhum.
--
-- Os três entram com `revisadoJuridico: true` no repositório: as alterações
-- são exatamente as que o parecer prescreveu, inclusive na redação.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values
  ('termos_uso', '2026-09-23',
   '848e8dadb79ee19758769adb316e5d74598e18f537f475dddebcc98de05c219e', now()),
  ('privacidade', '2026-09-23.2',
   '7b48f0515413a990e644349048fe4a556d53685518ac628e1b7d42508554f17a', now()),
  ('contrato_academia', '2026-09-23.2',
   '9d3f4f50878f311363a87d9235dcaaa42b026a58cdd86734d1601584f993421d', now())
on conflict (tipo, versao) do update
  set sha256 = excluded.sha256,
      publicado_em = excluded.publicado_em;
