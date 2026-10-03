-- O rosto entra no texto: autorização e Política 2026-10-03.
--
-- O cadastro do rosto (20261310010000) ficou dormente até aqui de propósito:
-- `aluno_consentiu_rosto()` exige que o texto vigente da autorização seja o
-- 2026-10-03 ou posterior (`versao_consentimento_rosto()`), porque o texto
-- 2026-09-23 só fala da digital, e consentimento dado por um texto que não
-- menciona o rosto não autoriza o rosto.
--
-- O texto novo (src/lib/termoBiometria.ts) é um só para digital e rosto, no
-- app e no termo impresso: os dois ficam só nos equipamentos da academia, o
-- ARKE guarda só o número, a foto enviada pelo app passa pela plataforma só
-- para chegar aos equipamentos e é apagada ao chegar ou em até 24 horas, e
-- tudo sai dos equipamentos ao retirar a autorização ou deixar a academia.
-- A Política (seções 2, 3 e 7) diz o mesmo. Texto-base aprovado pelo
-- responsável no chat em 02/10/2026.
--
-- Efeito: quem autorizou sob o texto 2026-09-23 é perguntado de novo (a tela
-- do aluno e a ficha já mostram "o texto mudou"); a digital já cadastrada
-- continua no equipamento até a pessoa confirmar ou retirar. Versão nova da
-- Política, hash novo: a plataforma pede o aceite de novo.
--
-- **Ordem de aplicação:** DEPOIS de o deploy com o texto novo estar no ar.
-- Antes, o banco trataria como vigente um texto que a página ainda não
-- mostra, e um aceite dado nesse intervalo ficaria gravado com o hash de um
-- texto que a pessoa não leu.

create or replace function public.versao_consentimento_biometrico()
returns text
language sql
immutable
-- Repetido aqui porque `create or replace` sem o `set` apagaria o que a
-- higiene de 22/09/2026 gravou.
set search_path = public
as $$ select '2026-10-03'::text $$;

grant execute on function public.versao_consentimento_biometrico() to authenticated, service_role;

insert into public.documentos_legais (tipo, versao, sha256, publicado_em)
values ('privacidade', '2026-10-03', 'b2202eedc569ca283804cfef14d4ad974545a80a6356c12984fd90e16505ade5', now())
on conflict (tipo, versao) do update set sha256 = excluded.sha256, publicado_em = excluded.publicado_em;
