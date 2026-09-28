-- Contrato da Academia e Política de Privacidade 2026-09-28: o Método ARKE
-- como ele passou a funcionar (fases 1 a 6 do plano "o mentor assume o aluno").
--
-- No Método, a ArkeFit prescreve treino e dieta, por profissionais com registro
-- (CREF, CRN), e responde pelo conteúdo prescrito; a academia vê o treino,
-- para orientar o aluno no salão, e deixa de ver a anamnese e a dieta dele;
-- ao sair do Método, o acompanhamento volta à academia, e o último treino e a
-- última dieta seguem valendo até ela publicar os seus. Textos aprovados pelo
-- responsável no chat em 28/09/2026. Versão nova, hash novo, e a plataforma
-- pede o aceite de novo.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values
  ('privacidade', '2026-09-28', '61c0f3c69fe42815b738b2f921221fd87f2249c238ff6e222a94bc83e465bec2', now()),
  ('contrato_academia', '2026-09-28', '5d6966d9cf70f1156e9f38cbb87bca60090dd93075b24e701e4dd3f835df5f4e', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
