-- Consentimento de dados de saúde: versionado, para forçar o re-aceite
-- determinado pelo parecer jurídico de 23/09/2026 (item 3.3).
--
-- **O vício que se está sanando.** O termo que o aluno lia dizia que os dados
-- de saúde eram usados *"exclusivamente pela equipe da sua academia (…) com
-- acesso restrito ao profissional responsável por você"*. Com o Mentor
-- Centralizado isso deixou de ser verdade: a célula da ArkeFit também lê a
-- anamnese do aluno do Método. Era o mesmo defeito corrigido na Política de
-- Privacidade — mas aqui estava no texto que **é** a base legal do art. 11, I,
-- e por isso o parecer determinou recolher o consentimento, e não só corrigir
-- o texto daqui para a frente.
--
-- `consentimento_lgpd_aceito_em` sozinho não distingue **qual texto** foi
-- aceito, então não havia como saber quem precisa reconfirmar. A coluna de
-- versão resolve isso do mesmo jeito que `documentos_legais` e o consentimento
-- de IA: o aceite vale enquanto a versão do texto for a vigente.

alter table public.anamnese_acolhimento
  add column if not exists consentimento_lgpd_versao text;

comment on column public.anamnese_acolhimento.consentimento_lgpd_versao is
  'Versao do texto de consentimento de saude aceito. Nula = aceite anterior ao versionamento, que o parecer de 23/09/2026 mandou recolher.';

create or replace function public.versao_consentimento_saude()
returns text
language sql
immutable
as $$ select '2026-09-23'::text $$;

comment on function public.versao_consentimento_saude() is
  'Versao vigente do termo de consentimento de dados de saude. Texto novo = versao nova = todos reconfirmam.';

revoke execute on function public.versao_consentimento_saude() from public;
grant execute on function public.versao_consentimento_saude() to authenticated, service_role;

-- **As linhas antigas ficam com versão nula, de propósito.** O aceite delas foi
-- dado sob o texto viciado, então não pode contar como aceite do texto novo —
-- é exatamente isso que o parecer determinou. Carimbar a versão nova nelas
-- seria declarar que essas pessoas concordaram com um texto que nunca viram,
-- que é o mesmo erro de origem, agora praticado de propósito.
