-- Regras e limites dos buckets de Storage: uma regra por operação, e limite de
-- tamanho em todo bucket que aceita envio do cliente.
--
-- Por que agora: a migração para o projeto novo recria os buckets do zero, e
-- levar as regras atuais como estão significaria carregar dois defeitos para
-- dentro da produção nova.
--
-- Defeito 1 — `feed-images` aceitava envio em qualquer pasta. Havia duas
-- regras permissivas de INSERT no mesmo bucket: uma exigindo a pasta do próprio
-- usuário (`<user_id>/`, que é o que o código faz) e outra, "Authenticated
-- upload feed images", pedindo só `bucket_id = 'feed-images'`. Regras
-- permissivas se somam com OU, então a frouxa vencia: qualquer pessoa logada
-- podia gravar — e sobrescrever — arquivo na pasta de qualquer outra. O mesmo
-- par duplicado existia na leitura e na exclusão.
--
-- Defeito 2 — `feed-images`, `chat-videos` e `email-assets` não tinham
-- `file_size_limit`. O app confere 10 MB no vídeo do chat antes de enviar, mas
-- essa conferência é do navegador: quem chama a API direto não passa por ela.
-- Sem limite no bucket, o teto real era o do plano.
--
-- O formato segue a regra do projeto (uma regra por operação, ver
-- 20261205010000_consolidar_politicas_rls.sql). Em `storage.objects` isso vira
-- uma regra por operação para `authenticated`, mais uma única leitura para
-- `anon` nos buckets públicos. As duas de leitura não se somam: cada uma vale
-- para um papel, então ninguém é avaliado por duas regras na mesma operação.

-- 1) Limites de tamanho e tipo nos buckets que aceitam envio do cliente.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif']
 where id = 'feed-images';

-- 10 MB é o mesmo teto que o ChatPanel confere no navegador; aqui ele passa a
-- valer também para quem chamar a API por fora.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['video/mp4','video/webm','video/quicktime']
 where id = 'chat-videos';

-- `email-assets` não tem regra de INSERT: só a service_role grava. Fica com
-- limite mesmo assim, para o caso de alguém abrir o envio depois sem lembrar.
update storage.buckets
   set file_size_limit = 2097152
 where id = 'email-assets';

-- 2) Fora as regras antigas, inclusive as duplicadas.
drop policy if exists "Anyone can read exercise images" on storage.objects;
drop policy if exists "Anyone can read exercise videos" on storage.objects;
drop policy if exists "Anyone can view avatars" on storage.objects;
drop policy if exists "Authenticated upload feed images" on storage.objects;
drop policy if exists "Email assets are publicly accessible" on storage.objects;
drop policy if exists "Public read feed images" on storage.objects;
drop policy if exists "User deletes own feed images" on storage.objects;
drop policy if exists "Users can delete their own avatar" on storage.objects;
drop policy if exists "Users can update their own avatar" on storage.objects;
drop policy if exists "Users can upload their own avatar" on storage.objects;
drop policy if exists "atestados: envio" on storage.objects;
drop policy if exists "atestados: exclusão" on storage.objects;
drop policy if exists "atestados: leitura" on storage.objects;
drop policy if exists "atestados: troca" on storage.objects;
drop policy if exists "chat-videos: envio" on storage.objects;
drop policy if exists "chat-videos: exclusão" on storage.objects;
drop policy if exists "chat-videos: leitura" on storage.objects;
drop policy if exists "leitura pública dos posts de feed-images" on storage.objects;
drop policy if exists "midia de exercicio: envio" on storage.objects;
drop policy if exists "midia de exercicio: exclusão" on storage.objects;
drop policy if exists "midia de exercicio: troca" on storage.objects;
drop policy if exists "usuário autenticado faz upload no próprio path de feed-images" on storage.objects;
drop policy if exists "usuário remove as próprias imagens de feed-images" on storage.objects;

-- Também as novas, para a migração ser reaplicável.
drop policy if exists "objetos: leitura pública" on storage.objects;
drop policy if exists "objetos: leitura" on storage.objects;
drop policy if exists "objetos: inclusão" on storage.objects;
drop policy if exists "objetos: alteração" on storage.objects;
drop policy if exists "objetos: exclusão" on storage.objects;

-- 3) Leitura sem login: só os buckets públicos. `dietas` fica de fora de
-- propósito — está vazio e sem uso, e só a service_role o alcança.
create policy "objetos: leitura pública"
  on storage.objects for select to anon
  using (
    bucket_id = any (array['avatars','email-assets','exercicio-videos','exercicio-imagens','feed-images'])
  );

-- 4) Leitura logada: os públicos acima, mais os privados conferidos por função.
-- `pode_acessar_atestado` compara `<organization_id>/<aluno_id>/` do caminho com
-- o vínculo de quem pergunta; devolve falso sem sessão, então nunca vaza.
create policy "objetos: leitura"
  on storage.objects for select to authenticated
  using (
    bucket_id = any (array['avatars','email-assets','exercicio-videos','exercicio-imagens','feed-images'])
    or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  );

-- 5) Envio. `feed-images` e `avatars` só na pasta do próprio usuário — era este
-- o buraco: a regra frouxa de `feed-images` aceitava qualquer pasta.
create policy "objetos: inclusão"
  on storage.objects for insert to authenticated
  with check (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  );

create policy "objetos: alteração"
  on storage.objects for update to authenticated
  using (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = 'atestados' and public.pode_acessar_atestado(name))
  )
  with check (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = 'atestados' and public.pode_acessar_atestado(name))
  );

create policy "objetos: exclusão"
  on storage.objects for delete to authenticated
  using (
    (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = 'feed-images' and (storage.foldername(name))[1] = auth.uid()::text)
    or (bucket_id = any (array['exercicio-videos','exercicio-imagens'])
        and public.pode_gravar_midia_exercicio((storage.foldername(name))[1]))
    or (bucket_id = any (array['atestados','chat-videos']) and public.pode_acessar_atestado(name))
  );

-- 6) As duas funções são chamadas de dentro de regra de `storage.objects`, que
-- roda como o usuário logado: sem EXECUTE, a regra erraria em vez de negar.
grant execute on function public.pode_acessar_atestado(text) to authenticated;
grant execute on function public.pode_gravar_midia_exercicio(text) to authenticated;
