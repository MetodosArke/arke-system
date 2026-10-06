-- Termos de Uso, versão 2026-10-06: quem prescreve, no modelo híbrido.
--
-- Parecer revisto do advogado sobre o item 3 do memorando de adequação
-- regulatória, registrado pelo responsável no workspace em 06/10/2026: no
-- plano Free, a prescrição é da academia; no Método ARKE, da equipe de
-- mentoria da ArkeFit, por profissionais com registro no CREF e no CRN, e a
-- ArkeFit responde por ela. Os Termos diziam "pela equipe indicada" e "não pela
-- plataforma", vago justamente no Método. O Contrato e a Política já diziam o
-- mesmo que o parecer.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.

set lock_timeout = '5s';

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('termos_uso', '2026-10-06', '7e1bba0f223a16a4c5e6315afa58edee86ed50d85f9c05790e076d0c83dc33bf', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
