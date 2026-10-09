set lock_timeout = '5s';

-- O acervo global vai ganhar os GIFs de um pacote que traz cada exercício
-- com um modelo masculino e um feminino (decisão de 09/10/2026). Quem vê
-- escolhe qual modelo quer ver; o app não pergunta nem guarda o sexo de
-- ninguém, e por isso nada muda na Política nem na matrícula.

-- 1) As duas mídias novas, ao lado de `gif_url`, que continua sendo a mídia
-- única que a academia ou a ArkeFit sobe pelo acervo (e a que vai para o
-- snapshot do treino). Quem grava o acervo segue igual: as regras de
-- `exercicios_biblioteca` são por linha, e a linha global (organization_id
-- nulo) só a ArkeFit (superadmin) grava; colunas novas não abrem brecha.
alter table public.exercicios_biblioteca
  add column if not exists gif_masculino_url text,
  add column if not exists gif_feminino_url text;

comment on column public.exercicios_biblioteca.gif_masculino_url is
  'GIF da execução com modelo masculino. O app mostra o do modelo que a pessoa escolheu (profiles.modelo_exercicio); sem ele, o do outro modelo; sem os dois, gif_url.';
comment on column public.exercicios_biblioteca.gif_feminino_url is
  'GIF da execução com modelo feminino. O app mostra o do modelo que a pessoa escolheu (profiles.modelo_exercicio); sem ele, o do outro modelo; sem os dois, gif_url.';

-- 2) A preferência de quem vê: o modelo dos exercícios. Nula até a pessoa
-- escolher (o app mostra o masculino e pergunta). É preferência de exibição,
-- não dado de sexo. A própria pessoa grava pelo RLS de `profiles` (alteração
-- só da própria linha, com o restritivo das duas etapas deixando a própria
-- passar), então não precisa de função nova. A sessão simulada é uma sessão
-- da própria pessoa e grava normalmente: escolher o modelo não é autorização.
alter table public.profiles
  add column if not exists modelo_exercicio text;

alter table public.profiles drop constraint if exists profiles_modelo_exercicio_check;
alter table public.profiles
  add constraint profiles_modelo_exercicio_check
  check (modelo_exercicio is null or modelo_exercicio in ('masculino', 'feminino'));

comment on column public.profiles.modelo_exercicio is
  'Modelo dos GIFs de exercício que a pessoa escolheu ver: masculino ou feminino. Nulo até ela escolher. Preferência de exibição; o app não coleta sexo.';
