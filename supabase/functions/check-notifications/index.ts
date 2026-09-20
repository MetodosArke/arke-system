// LÁPIDE — a varredura diária de lembretes foi descontinuada no PR #171.
//
// O código original era resquício pré-reset e não sobrevivia ao schema
// multitenant: referenciava 4 tabelas inexistentes, consultava outras 3 com
// `profiles.user_id` onde a chave é `alunos.id`, não filtrava por
// organização e usava cópia punitiva que a metodologia abandonou. Como as
// buscas por id errado voltavam vazias, ela concluía que ninguém havia
// bebido água nem treinado e dispararia lembrete diário para todo perfil
// ativo da plataforma — gestores e professores inclusive.
//
// Este arquivo existe por dois motivos:
//   1. a Edge Function ainda está publicada no projeto Supabase (a exclusão
//      é manual, pelo dashboard ou `supabase functions delete`), e enquanto
//      estiver de pé é melhor que ela recuse execução de forma explícita do
//      que rodar o código antigo;
//   2. mantém `supabase/functions/` fiel ao que está publicado, para que um
//      `supabase functions deploy` a partir do repositório não ressuscite a
//      versão antiga.
//
// Não construir em cima disto. Se a funcionalidade voltar, volta desenhada
// para o multitenant — preferências por aluno, escopo por organização e
// linguagem alinhada à gamificação positiva. O código antigo está no
// histórico do git (ver PR #171).
Deno.serve(() =>
  new Response(
    JSON.stringify({
      error: "Função descontinuada.",
      detalhe:
        "A varredura diária de lembretes foi removida no PR #171 por não ser compatível com o schema multitenant. Nenhuma notificação é enviada por aqui.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } }
  )
);
