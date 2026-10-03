-- Liga a resposta escrita pela IA no assistente da academia (decisão do
-- responsável, 03/10/2026), com o modelo do Vigia e a pergunta sem
-- identificação (`20261319010000_assistente_sem_nomes.sql`). Aplicada depois
-- de a função publicada ter passado na corrente real.
update public.plataforma_config set valor = 1 where chave = 'assistente_ia';
