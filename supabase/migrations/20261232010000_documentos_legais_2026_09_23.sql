-- Política de Privacidade e Contrato da Academia, versão 2026-09-23.
--
-- O Ecossistema mudou os fatos que os dois textos descreviam, e eles ficaram
-- desatualizados em três pontos — dois deles desfavoráveis ao titular, que é o
-- que torna a correção obrigatória e não cosmética:
--
-- 1. **"Acesso restrito aos profissionais da Academia que atendem você"**, na
--    seção de dados de saúde, deixou de ser verdade quando o Mentor
--    Centralizado passou a acompanhar o aluno do Método: a célula da ArkeFit
--    também lê a anamnese. O aluno precisa saber quem vê a saúde dele.
--
-- 2. **A lista de suboperadores não incluía o provedor de inteligência
--    artificial.** A cláusula 6.4 do Contrato da Academia obriga a usar
--    "apenas os suboperadores listados na Política de Privacidade" — então
--    usar um que não está lá é descumprimento do próprio contrato, antes de
--    qualquer discussão de LGPD.
--
-- 3. **A transferência internacional** falava de hospedagem e registro de
--    erros. Processar anamnese num modelo é categoria diferente, e a única que
--    toca dado sensível. Agora está declarada com as duas bases que valem ao
--    mesmo tempo: cláusulas-padrão contratuais (art. 33, II, Resolução
--    CD/ANPD nº 19/2024) e consentimento do titular (art. 33, VIII).
--
-- O Contrato ganhou as subseções 6.1 e 6.2: o Método ARKE é tratado pela
-- ArkeFit como **controladora** — o que o texto anterior já dizia numa linha —
-- e agora com as consequências escritas, inclusive a que a academia mais
-- precisa saber: **ela não lê a conversa entre o aluno e o mentor**. A 6.2
-- reconhece que treino, frequência e check-in servem aos dois ao mesmo tempo
-- e que aí o tratamento é conjunto.
--
-- Os **Termos de Uso não mudaram** e seguem na versão 2026-09-22.2: só quem
-- mudou pede aceite de novo.
--
-- Os dois voltam a `revisadoJuridico: false` no repositório, e as páginas
-- voltam a marcá-los como minuta até a revisão. Manter `true` diria que um
-- advogado leu um texto que ainda não existia quando ele leu.

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values
  ('privacidade', '2026-09-23',
   '27f55132300f39c74ae2d79acf2dd67a9184b09d1fc3221a4b9c508941781b03', now()),
  ('contrato_academia', '2026-09-23',
   '1892e08c58d5d4d56c273af7c43ecbed7fcd9c38f1ebbdc68bb74c54fa35439c', now())
on conflict (tipo, versao) do update
  set sha256 = excluded.sha256,
      publicado_em = excluded.publicado_em;
