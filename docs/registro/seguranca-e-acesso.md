# Segurança e acesso

Senha, captcha, vínculos, RLS, a rodada 360°, o freio, o perfil simulado, as duas etapas e o "Sair".

## Senha Vazada: substituta do recurso pago do Supabase

O Supabase bloqueia senha vazada a partir do plano pago. Enquanto o projeto está no free, a checagem é nossa, contra a API **Pwned Passwords** do HaveIBeenPwned — pública, gratuita e sem chave, diferente da API de vazamento de contas do mesmo serviço.

A senha não sai do navegador. O protocolo é k-anonimato: calcula-se o SHA-1 localmente, envia-se só os **5 primeiros caracteres** do hash, a API devolve as algumas centenas de sufixos daquela faixa com a contagem de cada um, e a comparação acontece aqui. O serviço recebe um prefixo compartilhado por milhares de senhas e não sabe qual foi consultada. O cabeçalho `Add-Padding` completa isso enchendo a resposta com registros falsos, para que o tamanho dela também não entregue a faixa — e esses registros vêm com **contagem zero** e precisam ser ignorados, senão o próprio mecanismo de privacidade recusaria senha limpa. SHA-1 aqui é só o índice do corpus do HIBP; não tem relação com como a senha é guardada (bcrypt, no Auth).

**Nenhum Auth Hook resolve isto.** O *Password Verification Hook* dispara na tentativa de login, para limitar tentativa e erro. O *Before User Created* recebe o registro de `auth.users` **sem a senha em claro** — e o que está lá é bcrypt, incompatível com o índice SHA-1 do HIBP —, além de só disparar na criação, nunca na troca de senha. Por isso a verificação mora em dois lugares:

- **`src/lib/senhaVazada.ts`**, no cliente, ligado em `Register`, `DefinirSenha` e `ResetPassword` — as três telas falam direto com o GoTrue, e ali não existe ponto de servidor nosso para interceptar.
- **`matricula-publica`**, no servidor, com a mesma lógica duplicada em Deno pelo motivo de sempre (edge function não importa do bundle do app). É a única entrada de senha que passa por código nosso, e por isso a única **autoritativa**: não dá para contornar chamando a função na mão, porque a função é o caminho.

**Falha aberta, de propósito.** HIBP fora do ar não pode impedir ninguém de criar conta ou recuperar senha. Isto é trava de qualidade de senha, não fronteira de segurança — transformar indisponibilidade de terceiro em cadastro bloqueado troca um risco pequeno por uma falha certa. Daí `verificou` no resultado: `senhaDeveSerRecusada()` só recusa quando a consulta de fato aconteceu.

A mensagem evita dizer "sua senha vazou": ela não vazou daqui, e sugerir isso assusta sem informar. O que houve é que a combinação já aparece em bases públicas de outros sites, o que a torna alvo de ataque automatizado.

## Matrícula Pública: limite de taxa e o erro que não chegava ao usuário

`matricula-publica` é endpoint público (`verify_jwt = false`) que cria usuário no Auth e linhas em `profiles`, `organization_members` e `alunos`. O único freio era não saberem o slug; no dia em que a academia divulgar o link, um script cria mil contas na conta dela — e cada uma conta contra o `limite_alunos` do plano, então o ataque também tranca a matrícula de quem é aluno de verdade.

O limite mora em `matricula_publica_tentativas` e em três funções que só a `service_role` alcança (`registrar_tentativa_matricula`, `matricula_publica_org_permitida`, `concluir_tentativa_matricula`). **Os números são folgados por IP de propósito:** alunos se matriculando no Wi-Fi da academia saem todos pelo mesmo IP, e o dia de lançamento — recepção cheia, QR code na parede — é exatamente quando um limite apertado bloquearia gente de verdade. Então: por IP, **30 tentativas em 15 min** e **20 matrículas concluídas por hora**; por organização, **60 concluídas por hora**, que é o teto que independe de quantos IPs o atacante tiver. A contagem por IP acontece antes de qualquer validação, para conter também o script que martela o endpoint com lixo; tentativa barrada não gera linha, então o ataque contido não faz a tabela crescer.

IP é dado pessoal: o banco guarda só **SHA-256 do IP com pimenta** (a service role key, que já está no ambiente da função e nunca vai ao cliente — sem pimenta, o hash de um IPv4 se reverte por força bruta em segundos). Linhas com mais de 24 h são apagadas na própria chamada, sem cron. Falha do limitador **libera** em vez de travar: com o banco fora, a matrícula falharia adiante de qualquer jeito, e travar ali só trocaria uma mensagem honesta por uma falsa de "muitas tentativas".

Verificado contra a função publicada em 21/09/2026: 30 requisições com payload inválido passaram (400), a 31ª em diante voltou **429** com a mensagem em português, e o banco guardou um único hash SHA-256 e nenhum valor com cara de IP.

**Captcha (Cloudflare Turnstile), ligado em 21/09/2026.** Segunda camada por cima do limite por IP: o limite segura o script que sai de um endereço só, o captcha segura o que se espalha por muitos. Turnstile e não reCAPTCHA porque não pede ao aluno para clicar em imagens e não usa cookie de rastreamento. Dois interruptores: o secret `TURNSTILE_SECRET_KEY` em `matricula-publica` (verifica o token em `siteverify`, depois das validações baratas e antes da checagem de senha vazada e da criação do usuário) e `VITE_TURNSTILE_SITE_KEY` na Vercel (mostra o widget, `src/components/public/Turnstile.tsx`, e só libera o botão com o token). Sem eles, tudo como antes. Token ausente ou recusado barra; Cloudflare fora do ar **libera**, pelo mesmo motivo do limitador. O token é de uso único: a cada falha o widget é remontado. Verificado com as chaves de teste oficiais da Cloudflare: aprova, recusa e sem token se comportam como esperado, e na tela o botão fica desabilitado até o token chegar. O widget está na Cloudflare (conta da ArkeFit, domínios `arkefit.com.br` e `www.arkefit.com.br`, modo Managed); a Site Key é a variável `VITE_TURNSTILE_SITE_KEY` da Vercel e a Secret Key o secret `TURNSTILE_SECRET_KEY` do Supabase. Conferido em produção: o widget aparece acima do botão e, sem token ou com token inventado, a função responde 400 com a mensagem em português. **Desligar sem deploy:** `supabase secrets unset TURNSTILE_SECRET_KEY` — a tela continua mostrando o widget, mas o servidor para de exigir. **Armadilha que já aconteceu:** variável de ambiente nova na Vercel só vale no deploy seguinte; e sem o prefixo `VITE_` o app não a enxerga. Consequência: a conta de teste E2E não pode mais ser recriada pela matrícula pública por script — se ela sumir, é criar pela ficha do aluno (equipe da Tietê) ou desligar o secret por alguns minutos.

**O erro que não chegava ao usuário.** Com status não-2xx, `supabase.functions.invoke` devolve `data: null` e um `FunctionsHttpError` cuja mensagem é sempre "Edge Function returned a non-2xx status code" — o texto que a função escreveu fica no corpo da resposta, em `error.context`. O padrão do app era `data?.error ?? error.message`, que parece cobrir o caso mas não cobre, porque é justamente `data` que vem nulo. Toda validação feita no servidor — e-mail repetido, CPF inválido, senha vazada, excesso de tentativas — chegava ao usuário como essa frase em inglês. `mensagemDeErroEdge()` (`src/lib/erroEdge.ts`) lê o corpo, e hoje as 22 chamadas de `functions.invoke` do app passam por ela — menos duas que não mostram erro a ninguém por desenho (`sendChatPush`, disparo em segundo plano; e o treino de boas-vindas do `Onboarding`, que só registra no console). O caso mais caro era a **importação de alunos**: cada linha com falha guardava a frase genérica como motivo, então "tentar de novo só as que falharam" listava o mesmo texto inútil em todas e escondia justamente o que a importação retomável existe para mostrar.

Como o vínculo duplo, este é um padrão que parece certo e por isso volta a cada tela nova. Em vez de confiar em lembrar, `src/lib/erroEdge.guarda.test.ts` lê o código-fonte: para cada `functions.invoke`, identifica a variável de erro que **aquela** chamada devolveu e falha se o resto do bloco a relançar crua ou ler `.message` direto. O escopo é o bloco, não uma janela de caracteres, porque o `onError` do `useMutation` logo abaixo usa `error.message` corretamente — ali `error` já é o Error montado com a mensagem real.

## Vínculo do Usuário com a Organização

Uma pessoa pode ter vínculo ativo em mais de uma organização — gestor de uma academia e aluno de outra, professor em duas unidades da mesma rede. O `AuthContext` lia esse vínculo com `.maybeSingle()`, então o caso legítimo virava erro e a pessoa entrava **sem organização nenhuma**, fora do painel que ela própria administra.

Navegar **não cria vínculo**. Até 20/09/2026, `AdminLayout` chamava `provisionar_organizacao_padrao()` sozinho para todo `admin_arke` sem organização: a pessoa ia a `/admin` e o layout criava a academia "Academia Piloto" e a vinculava como gestora dela. Um tenant nascia sem ninguém pedir — com seed de 5 modelos de treino, 5 de dieta e 3 linhas de precificação, linha no funil de conversão como `trial`, e um vínculo novo que passava a decidir o contexto da pessoa no app. Também havia dois atalhos que levavam a esse caminho por engano: *Sair do modo Super Admin* (que só fazia `navigate("/app")`, sem modo nenhum para sair) e *Visão do Aluno*, ambos abrindo o app do aluno vazio para quem não tem registro de aluno. Os três foram removidos, e a função foi derrubada do banco: o painel Super Admin já cria organização pelo caminho próprio (*+ Nova Organização* → `criar-organizacao-superadmin`), com nome, slug e plano escolhidos. Quem chega a `/admin` sem organização agora vê um empty state dizendo isso, e o *Painel de Gestão* no app do aluno só aparece quando existe organização. Para ver o produto pelos olhos de outro papel existe a simulação de perfil (`impersonar-perfil` + `ImpersonationBanner`), que troca a sessão de verdade, sinaliza com faixa permanente e devolve cada um à sua rota real ao sair.

`escolherVinculo()` (`src/lib/vinculos.ts`) resolve a escolha por hierarquia — gestor → professor → nutricionista → aluno — e desempata pelo vínculo mais antigo. O critério é o do dano: quem administra precisa do painel, e entrar como aluno tranca. Papel desconhecido vai para o fim da fila em vez de derrubar a escolha. Trocar de organização na sessão ainda não existe; quando existir, é aqui que entra.

## O Defeito do Vínculo Duplo (`.maybeSingle()` sobre `organization_members`)

Esta classe de defeito reapareceu quatro vezes em arquivos diferentes, o que já a qualifica como armadilha estrutural e não descuido pontual. O padrão é sempre o mesmo: consultar `organization_members` filtrando por `user_id` sem fixar a organização, e fechar com `.maybeSingle()`. Quem tem vínculo ativo em duas academias faz a consulta devolver duas linhas, `.maybeSingle()` rejeita, e a pessoa leva 403 — muitas vezes na própria academia que administra.

Uma varredura dedicada em 21/09/2026 encontrou mais cinco ocorrências, corrigidas com três receitas diferentes conforme o que a função sabe:

- **A organização do alvo já é conhecida** (`anonimizar-aluno`, `excluir-aluno`): perguntar direto se o chamador é gestor DAQUELA organização. Elimina a ambiguidade em vez de desempatá-la, e é a correção preferida sempre que possível.
- **A organização sai do vínculo do chamador** (`cadastrar-membro-equipe`): a escolha é genuinamente ambígua, então vale a regra de desempate de `escolherVinculo()` — vínculo de gestor mais antigo.
- **Os dois lados podem ter vários vínculos** (`gerar-link-ativacao`, `send-chat-push`): buscar listas e cruzar. Aqui a correção deixa a função mais correta, não só menos quebrada: em `send-chat-push` a pergunta real passa a ser "qual academia os dois têm em comum", e em `gerar-link-ativacao` fecha um buraco sutil — a versão anterior comparava o papel do alvo num vínculo possivelmente de outra academia.

`.eq("organization_id", ...)` junto de `.eq("user_id", ...)` é seguro: `organization_members` tem `unique(organization_id, user_id)`. `.order(...).limit(1)` antes do `.maybeSingle()` também é — foi por não ver o `.limit(1)` que a auditoria inicial reportou dois falsos positivos (`asaas-emitir-cobranca-b2b` e `superadmin-suporte-tenant` já estavam corretos).

## Higiene de Superfície no PostgREST

Toda função `returns trigger` herda EXECUTE do PUBLIC e aparece em `/rest/v1/rpc/<nome>`. Chamá-la fora do contexto de trigger só produz erro, mas não há razão para deixá-la alcançável: a migration `20261124010000` revoga EXECUTE de todas elas em bloco. **Esse revoke NÃO se mantém sozinho** — o registro anterior dizia que ele "segue pegando as próximas automaticamente", e isso era falso. Ele rodou uma vez, sobre as funções daquele dia; toda função criada depois nasce com o ACL padrão do Postgres, que concede EXECUTE ao PUBLIC. A auditoria de 22/09/2026 encontrou **sete** funções de gatilho reexpostas assim, das rodadas 3 a 6, e `20261215010000_higiene_execute_e_search_path.sql` as fechou. **Regra: rodar a revogação de novo depois de cada rodada que crie função de gatilho** — o bloco é idempotente. Tornar isso automático exigiria event trigger, que precisa de superusuário. As RPCs `get_superadmin_*` deixaram de aceitar chamada anônima pelo mesmo motivo — todas checam o papel por dentro, então não havia vazamento, mas 9 das 13 aceitavam sondagem sem login e 4 não, defesa em profundidade desigual sem motivo.

Revogar EXECUTE **não** afeta o disparo de triggers — o PostgreSQL não checa esse privilégio ao dispará-los. Foi verificado contra o banco real, em transação revertida, com `exigir_limite_alunos` e `set_updated_at`.

## Regras de Acesso (RLS): uma por operação

Até 21/09/2026, 38 tabelas tinham mais de uma regra permissiva valendo para a mesma operação — quase sempre "equipe gerencia" (`FOR ALL`) somada a "aluno vê o próprio" (`FOR SELECT`) —, e o Postgres avaliava as duas em toda leitura. Foram consolidadas em `20261205010000_consolidar_politicas_rls.sql`: 79 regras viraram 152, **uma por tabela e operação** (`leitura`, `inclusão`, `alteração`, `exclusão`), cuja condição é o OU das que valiam antes — exatamente como o Postgres combina regras permissivas, então o acesso é idêntico por construção. Cada regra nova diz, em comentário, quais originais consolida. O arquivo foi **gerado a partir de `pg_policies`** e aplicado pelo mesmo gerador dentro do banco; o SQL de volta está guardado em `supabase_migrations.schema_migrations` (`consolidar_politicas_rls`, coluna `rollback`).

Verificado em produção: 12 identidades reais (anônimo, 2 Super Admins, gestor, professor, nutricionista, 5 alunos, conta E2E) × 38 tabelas, linhas visíveis antes e depois — **456 medições, 0 divergências** —, mais escritas em transação revertida (aluno não cria treino, não se dá papel, não grava na biblioteca; gestor grava exercício da academia, não global; Super Admin grava global, não de academia; anônimo nada). **Regra nova daqui para a frente:** tabela nova segue o formato de uma regra por operação; somar uma segunda regra permissiva para a mesma operação recria o problema.

## Rodada 360° de 24/09/2026: prontidão para as primeiras academias

Conferência de ponta a ponta, com a infraestrutura paga como premissa (regra do responsável: todo upgrade vem antes do primeiro cliente pagante).

**O que estava bem, e como foi conferido:**

- 23 rotinas agendadas no ar, nenhuma execução com falha no cron em 7 dias, zero linhas órfãs, banco em 4,8% do limite, última reconciliação com o Asaas sem erro;
- as 43 edge functions do repositório são exatamente as 43 publicadas, com o mesmo `verify_jwt` do `config.toml`, e todas sobem: chamada sem credencial responde 400 ou 401, nunca 5xx;
- **52 telas em produção** abertas com sessões reais de gestor, aluno, Super Admin e visitante, sem clicar em nada: nenhum erro de console, exceção, resposta ≥ 400 do Supabase ou queda no ErrorBoundary;
- o teste de ponta a ponta da jornada do aluno roda de verdade a cada deploy (10 de 10), e não "pulado".

**O que foi encontrado e corrigido:**

1. **Funções que respondiam sobre qualquer aluno.** Treze funções SECURITY DEFINER sem checagem de quem chama estavam alcançáveis por qualquer pessoa logada em `/rest/v1/rpc`, recebendo o id de um aluno ou de uma academia: constância, dias sem aparecer, se está inadimplente, se consentiu IA, o briefing inteiro da academia, o repasse negociado com a ArkeFit. Um aluno de uma academia conseguia perguntar sobre aluno de outra. Nenhuma era usada pelo app — quem chama são outras funções SECURITY DEFINER e edge functions com a service role —, então foram fechadas (`20261274010000`). A ficha do aluno usava outras três direto; passou a usar `get_jornada_aluno()`, que confere se quem pergunta é da equipe, da ArkeFit ou o próprio aluno, e as três fecham em `20261275010000`, **depois do deploy da tela**. `valor_mensal_b2b` ganhou a checagem por dentro (a Visão Master e a edge function usam). Conferido em 25 casos, inclusive gestor de outra academia e outro aluno da mesma levando 42501 e as chamadas com service role seguindo iguais. **Regra que fica:** função SECURITY DEFINER nova que recebe id de aluno ou de academia confere quem chama, ou nasce sem EXECUTE para `authenticated` — o mesmo tipo de higiene que a revogação das funções de gatilho, e que também não se mantém sozinha.
2. **Rotina em andamento contava como rotina que falhou.** O pg_cron grava a execução como `running` e só depois como `succeeded`; `avaliar_rotinas()` pegava a última linha, qualquer que fosse. A varredura do Vigia, a análise dele e o alerta de catracas disparam no mesmo segundo a cada 10 minutos, e o Vigia via a vizinha em andamento: **22 ocorrências falsas em 3 horas**, desde que a Fase 3 entrou no ar, três delas com a própria análise reexecutada sem necessidade. Nenhum e-mail falso saiu, porque o alerta de rotinas lê meio segundo depois. Agora só a execução terminada conta; desde a correção, nenhuma ocorrência nova. **As 22 de 24/09/2026 entre 10:35 e 12:30 são do defeito e não entram na avaliação do Vigia.**
3. **Números escritos com ponto.** O saldo do financeiro da academia aparecia como "R$ 125.53", a Visão Master como "41.2%" e a mensagem de erro da cobrança como "R$ 49.05" — `toFixed` escreve no padrão americano, e eram mais de 40 pontos em 21 arquivos, cada tela copiando a vizinha. Tudo passou por `src/lib/numeros.ts` (`reais`, `decimal`), e `numeros.guarda.test.ts` falha se um `toFixed` voltar a ir para a tela.
4. **Faixa vermelha por rotina que ainda não teve a primeira janela** — ver *Rotinas agendadas não falham em silêncio*.
5. **O aluno não via a mensalidade da academia.** O app mostrava só a assinatura do Método; vencimento, segunda via e histórico existiam só no e-mail do Asaas, e "me manda o boleto" ia para a recepção. `MinhasMensalidades` (Perfil) mostra a que está em aberto, com o link da fatura, e as últimas pagas; sem mensalidade cobrada pelo ARKE, não aparece.
6. **Importação com sobrenome ou DDD em coluna própria.** O aluno entrava só com o primeiro nome, e o celular sem DDD não serve nem para o WhatsApp nem para o primeiro acesso por QR, que procura pelos últimos 10 dígitos. `juntarPartes()` junta os dois antes de validar, sem duplicar sobrenome repetido e sem mexer em telefone que já tem DDD.
7. **Lint fora do CI.** Sete erros acumulados que ninguém via; corrigidos, e o `npm run check`, que o CI já roda, passou a incluir o `eslint` (só erro reprova; aviso fica como aviso). Foi pelo `check`, e não por um passo novo no workflow, porque o token destas sessões não tem permissão para alterar `.github/workflows`.
8. **`search_path` fixo** nas onze funções que tinham nascido sem ele.

Um achado de dado, não de produto: o nome do gestor de homologação estava gravado como "Homologa��o" desde a migração — o único texto com U+FFFD no banco inteiro, vindo de um script. Corrigido.

## Freio, tetos e quem age sobre o quê: a prévia do teste de concorrência (04/10/2026)

Antes de medir muitos usuários ao mesmo tempo, a pergunta foi o contrário: o que acontece com **um** usuário fazendo milhares de chamadas, por defeito do app ou de propósito. A conta do Asaas é uma só para todas as academias (25.000 chamadas a cada 12 horas, e o `/payments` com uns 140 por minuto), o e-mail do login é um orçamento do projeto inteiro, e o modelo de IA se paga por uso. Um laço numa academia não pode parar as outras.

**Freio nas edge functions** (`20261321010000_freio_chamadas.sql`, `_shared/freio.ts`). `registrar_chamada(chave, limite, janela)` conta numa tabela só da service role, com uma trava por chave para duas chamadas simultâneas não passarem juntas; a chamada recusada não conta. **Falha do banco libera**, pelo motivo do limitador da matrícula pública. Os limites são folgados: uso de verdade não chega neles.

| Onde | Limite |
|---|---|
| Funções que chamam o Asaas (`regrasAsaas`) | 30 por pessoa a cada 10 min; 120 por academia por hora; 400 no total por hora |
| Cartão | mais 5 por pessoa por hora e 10 por aluno por dia |
| Dieta por PDF (IA) | 30 por pessoa por hora, 100 por dia; 300 no total por hora |
| Comunicado | 10 por pessoa por hora; 20 por academia por dia (só conta quem pode publicar) |
| Cadastro de aluno | 600 por pessoa por hora, 1.500 por academia por dia; sobre conta que já existe, 20 por hora e 50 por dia, contados **antes** de comparar o CPF |
| Aviso no celular | 60 por pessoa a cada 10 min |

`freio.guarda.test.ts` falha em função nova que fale com o Asaas ou com a IA sem passar pelo freio, salvo a lista com o porquê (rotinas com token, funções só da ArkeFit com as duas etapas, o assistente com freio próprio, exclusão e encerramento). As linhas do freio saem em 2 dias, na limpeza diária (`limpar_historicos_antigos`).

**Tetos diários no banco** (`20261322010000_teto_diario.sql`), para o que a pessoa logada grava direto e outras pessoas veem: 30 posts e 200 comentários no feed por pessoa; 100 mensagens por conversa e por quem envia (o professor que responde 50 alunos não é barrado); 15 chamados por aluno quando quem abre é o próprio aluno (o alerta do app); e, no Storage, 30 arquivos por dia na pasta do feed e do logo e 20 na pasta do aluno (atestado, vídeo do chat, termo da digital). Valem só com usuário logado: rotina e service role passam. O teto do Storage entrou na regra de inclusão que já existia, por `alter policy`, e não numa regra a mais. O gatilho de `tarefas` (`trg_teto_alertas_aluno`) ordena antes de `trg_ultimo_sla_util_mentor`.

**Quem age sobre o quê**, conferido nas próprias funções, e não só pela regra de leitura das tabelas:

- **Matrícula e assinatura do Método**: só a gestão e a recepção da academia do aluno, ou a ArkeFit com as duas etapas (`_shared/papelCobranca.ts`, `podeCobrarNaAcademia`). A regra de leitura deixa o aluno ler o próprio cadastro, o plano e a academia, e por isso não serve de autorização. Na tela, **Matricular** e **Método** aparecem só para a gestão e a recepção.
- **A conta de outra pessoa** (simular o perfil, trocar o e-mail de login ou o nome, gerar link de ativação): a equipe da academia só age sobre quem está **apenas** na academia dela (`_shared/alvoNaAcademia.ts`). A conta vale em todas as academias da pessoa; quem também está em outra, ou é da ArkeFit, fica com a ArkeFit ou com a própria pessoa. O **link de ativação** sai só para quem nunca entrou: para quem já entra, o caminho é "Esqueci a senha".
- **Aviso no celular** (`send-chat-push/regras.ts`): o aluno só avisa a equipe da academia dele; o aviso em massa só vai a papéis da equipe; o link fica preso a um caminho do app (e o service worker ignora endereço de fora); título e texto têm tamanho máximo.
- **Aprovar ação do Vigia** exige a sessão verificada em duas etapas. A aprovação confere o papel no banco com a service role passando o usuário, e ali `has_role` não exige as duas etapas; `verificacao.guarda.test.ts` passou a reconhecer esse caminho.

**O aviso do chat nunca tinha saído.** `send-chat-push` importava a biblioteca do Supabase fixada na 2.49.1, que não tem `getClaims`, e respondia 500 a toda mensagem desde que a função passou a conferir a sessão. Conferido contra a versão publicada antes da troca; hoje importa a mesma biblioteca das outras funções.

**Um defeito que passou nos testes de recusa pelo motivo errado.** A primeira versão de `alvoSoNaAcademia` pedia `user_roles.organization_id`, coluna que não existe; a consulta falhava, e a função, que nega em caso de erro, negava todo mundo. As três recusas da corrente passavam; só os casos de **permitir** acusaram. `colunasConsultas.guarda.test.ts` passou a ler também `supabase/functions/` — nenhuma outra função pedia coluna inexistente — e pega esse defeito plantado de volta. **Regra: toda trava se testa nos dois sentidos, recusar e permitir.**

**De passagem:** o comunicado lia os destinatários sem paginar e com a lista inteira de ids no `.in()`, e numa academia com mais de mil alunos parte deles ficaria sem o aviso. Agora pagina e busca as inscrições em lotes de 200. E o cadastro de aluno passou a dizer em português quando o limite de e-mails do login por hora estoura, para a importação ser retomada depois.

**Conferido:** 18 casos das migrations em transação desfeita; 6 defeitos plantados (as duas travas de papel, o freio, e três nas regras do aviso), os seis pegos; e a **corrente real**, 30 verificações pelas funções publicadas com duas academias temporárias apagadas no fim — a aluna recusada na própria matrícula e na assinatura, recepção e gestora passando da trava de papel, o aviso voltando a funcionar e recusado de aluno para aluno, simular, editar e gerar link recusados para quem é de outra academia e permitidos para quem é só da academia, o link recusado para quem já entra, o Super Admin sem as duas etapas recusado no Vigia, o freio segurando a 31ª chamada ao Asaas e a 6ª de cartão sem criar nada, o comunicado parando em 10 por pessoa e 20 por academia, e o 31º post recusado com a frase em português.

## Perfil simulado e importação sem e-mail (decisões de 04/10/2026)

Duas decisões do responsável que saíram da prévia do teste de concorrência; a terceira, captcha no login, ficou para quando aparecer tentativa em massa nos registros do Auth.

**Em perfil simulado, só a própria pessoa autoriza** (`20261323010000_sessao_simulada.sql`). Simular é entrar na conta da pessoa, e o banco via o próprio aluno: quem simulava podia autorizar a IA, a digital e o rosto, enviar a foto do rosto, aceitar os documentos, dar o consentimento de saúde e assinar o contrato em nome dele.

- **A sessão simulada nasce marcada.** `impersonar-perfil` abre a sessão no servidor (`verifyOtp` do link mágico) e grava o `session_id` em `sessoes_simuladas` (RLS sem regra, só a service role) **antes** de entregar os tokens; sem a marca, a sessão não sai. O navegador só recebe a sessão pronta e faz `setSession`. Antes, recebia o código e abria a sessão sozinho, e o banco não tinha como saber.
- **A trava é gatilho** (`trg_autorizacao_da_propria_pessoa`) em `aluno_consentimento_ia`, `aluno_consentimento_biometrico`, `aceites_documentos`, `aluno_assinaturas_contrato` e `fotos_rosto_pendentes`, e em `anamnese_acolhimento` só para as colunas do consentimento de saúde (preencher a anamnese continua). `sessao_simulada()` compara o `session_id` do JWT. Vale para a tela, a RPC e qualquer caminho novo. A equipe retirando a digital pela própria conta segue igual.
- **A visita não conta como do aluno:** `registrar_primeiro_acesso_aluno` e `registrar_atividade_aluno` não fazem nada na sessão simulada, para a ativação e a inércia do Mentor não lerem a visita de quem simula.
- **Voltar encerra a sessão simulada no servidor** (`signOut` local antes de restaurar a sessão de quem simulou). A marca sai na limpeza diária quando a sessão já não existe.
- **Na tela**, `emPerfilSimulado()` (`src/lib/impersonation.ts`) desativa o que só a pessoa faz e mostra `AvisoPerfilSimulado`; os portões de aceite de documentos e do acolhimento deixam quem simula ver o app. `perfilSimulado.guarda.test.ts` falha em tela nova que grave autorização sem o aviso, e se a sessão simulada voltar a nascer no navegador.

**A importação não manda e-mail.** O convite do login sai de um orçamento único do projeto (500 por hora), o mesmo da recuperação de senha de todas as academias, e uma importação de 400 alunos gastava 80% dele de uma vez. Agora a importação chama `convidar-membro` com `sem_email`: o cadastro nasce por `auth.admin.createUser`, sem convite, e quem já tinha conta é ligado sem o aviso. O aluno ativa pelo convite de primeiro acesso da academia (QR Code e link), e o e-mail de criar a senha sai quando ele pede, espalhado pelos dias. O cadastro de um aluno só, pela ficha, continua mandando o convite. A tela da importação e os artigos dizem isso.

**Conferido:** 22 casos da migration em transação desfeita; três defeitos plantados nas travas, os três pegos; a **corrente real**, 18 verificações pelas funções publicadas (a sessão simulada sai pronta e marcada, as quatro autorizações recusadas com a frase, a visita sem primeiro acesso, o app visível, a sessão encerrada ao voltar, a aluna autorizando pela conta dela; a importação sem convite nem e-mail, com o e-mail de senha saindo quando pedido e o link funcionando, quem já tinha conta ligado sem aviso, e a ficha ainda convidando); e **15 pela tela**, com a aba simulada e sem ela, no computador e no celular.

## Correções da conferência de 04/10/2026

O resto dos defeitos que a conferência de 04/10/2026 confirmou no código. A cobrança e as catracas têm seções próprias.

- **Só a ArkeFit simula perfil** (decisão de 04/10/2026). A sessão simulada lê o que a pessoa lê. O gestor simulava aluno da própria academia, inclusive do Método, e assim lia a conversa com o mentor, a dieta e a anamnese, que a academia não lê. Na tela, a simulação já existia só na Visão Master; o caminho do gestor ficava aberto para quem chamasse `impersonar-perfil` direto. A recusa vem antes de consultar o perfil de destino, para não revelar quem é de qual academia.
- **O código do link de ativação saía de `Math.random()`.** Esse código abre a definição de senha de uma conta. Agora sai de `crypto.getRandomValues`, sem viés. `aleatorio.guarda.test.ts` barra `Math.random()` nas funções e nas telas; a única exceção listada é a largura do esqueleto do menu.
- **O Sentinela lia "ATENÇÃO" com acento como "não exige atenção"**, e a linha esquecida também. Um aluno com lesão declarada podia aparecer sem cuidado especial. `lerAtencao()` (`sentinela-anamnese/atencao.ts`) aceita a linha com e sem acento e, sem ela, pede atenção. É a única mudança no Sentinela, que segue congelado.
- **`conversarComIA` não tinha prazo.** Uma resposta presa segurava a função até o limite da plataforma. Agora o prazo é de 30 s, e de 90 s na dieta do PDF. `prazoIA.guarda.test.ts` exige prazo em toda chamada ao modelo.
- **O assistente chamava o modelo sem trecho da Central.** Agora, sem trecho, não chama. A tela já dizia "não achei" e oferecia o chamado.
- **O chamado do assistente agora grava o contexto.** A coluna `contexto` existia e nunca era preenchida. Agora leva as intenções, se a pessoa citou um aluno e a situação do sistema na hora, relida no servidor e no resumo sem nome de pessoa. Esse resumo vai no e-mail e aparece em Visão Master → Suporte.
- **`plataforma_config` aceitava qualquer número.** Uma taxa de 29,9% em vez de 2,99 valeria para toda cobrança nova, e um interruptor podia ficar em 2. Agora cada chave tem faixa em `faixa_plataforma_config()`, e um gatilho recusa o valor fora dela com a faixa na mensagem. Chave sem faixa também é recusada: quem cria a chave define a faixa junto (`20261327010000`).
- **Migration nova começa com `set lock_timeout = '5s'`.** Sem isso, um `alter table` esperando a trava de uma tabela ocupada faz o app e a catraca esperarem atrás dele. `migrations.guarda.test.ts` cobra isso das migrations a partir de `20261324010000`.

**Conferido:**
- 12 casos das faixas em transação desfeita.
- Os testes do Sentinela, do e-mail do chamado e das quatro travas novas.
- A **corrente real**, com 10 verificações pelas funções publicadas, numa academia temporária com um Super Admin verificado em duas etapas:
  - o gestor é recusado na simulação, com a mesma frase para qualquer alvo, e a ArkeFit só simula com as duas etapas;
  - três links de ativação saem com códigos diferentes, no alfabeto;
  - a pergunta sem trecho fica sem resposta escrita e sem o modelo;
  - o chamado guarda a situação da aluna pausada sem o nome dela, e o e-mail sai;
  - a taxa de 29,9% é recusada pela API com a faixa na mensagem.

## Duas etapas para a gestão (decisão de 04/10/2026)

A senha sozinha dava a quem a tivesse três coisas:
- a planilha com e-mail, telefone e endereço de todos os alunos;
- o fim do contrato;
- a conta de um membro da equipe, trocando o e-mail de login dele e pedindo a senha nova nesse e-mail.

A decisão foi oferecer as duas etapas à gestão e exigi-las nessas três ações. Migration `20261328010000_duas_etapas_gestor.sql`.

- **O servidor exige.** `sessao_verificada()` lê o `aal` do JWT.
  - `emails_alunos_organizacao()` exige a sessão verificada. É a única peça da exportação que vem do servidor; o resto a gestão já lê nas telas.
  - `avisar_encerramento_organizacao()` exige o mesmo da gestão; a ArkeFit já chega verificada pelo `has_role`.
  - `editar-membro-equipe` recusa a troca de e-mail sem a sessão verificada. Trocar nome e papel segue só com a senha.
- **A tela pede o código antes.** `useDuasEtapasNaAcao()` (`src/components/duasEtapas/`): com a sessão já verificada, a ação roda direto. Sem ela, abre uma janela que pede o código e roda a ação depois. Quem ainda não ativou faz o cadastro pelo QR code na própria janela. É o mesmo `VerificacaoDuasEtapas` da Visão Master, agora com três usos: tela inteira (ArkeFit), embutida numa janela (as três ações) e `soSeAtivada` (a entrada no painel).
- **É opcional na entrada.** Em Meu perfil, o quadro **Verificação em duas etapas** (`DuasEtapasGestor`) liga e desliga. Ligada, a entrada no painel pede o código: é o `soSeAtivada` no `ProtectedRoute`, que deixa passar direto quem não ligou e mostra o painel enquanto confere. Na sessão simulada pela ArkeFit, nem o portão nem o quadro aparecem: ela não tem o celular da pessoa, e ligar as duas etapas na conta de outra pessoa a trancaria fora.
- **Perdeu o celular:** a ArkeFit remove o fator no banco (`auth.mfa_factors`), como faz com a conta dela.
- Artigo **Verificação em duas etapas** na Central de Ajuda, com links nos artigos de exportação e de equipe.

**Um defeito antigo que a tela mostrou: a sessão renovada desmontava o painel.** Conferindo pela tela em produção, a exportação não rodava depois do código. O `AuthContext` tratava todo evento de sessão como uma entrada nova, inclusive o token renovado de hora em hora e o código das duas etapas confirmado: marcava os papéis como não carregados, e o `ProtectedRoute` trocava o painel inteiro pelo carregamento. A cada renovação do token, o formulário aberto se perdia, e aqui a ação que esperava o código se perdia junto. Agora evento da mesma pessoa só atualiza a sessão; depois do código, os papéis são relidos em segundo plano, sem desmontar nada. Outra pessoa entrando recarrega tudo, como antes. `AuthContext.sessao.test.tsx` falha na versão anterior.

**Conferido:**
- 8 casos da migration em transação desfeita.
- 8 testes do componente e do gancho, com dois defeitos plantados (a ação rodando sem o código, a gestão forçada a cadastrar na entrada), os dois pegos.
- A **corrente real**, com 9 verificações pelas funções publicadas e uma gestora de verdade:
  - só com a senha, as três ações são recusadas com a frase, e o nome segue mudando;
  - depois de cadastrar o aplicativo e verificar, a gestora exporta, troca o e-mail, avisa e retira o encerramento.
- **Pela tela em produção**, com 7 verificações e uma gestora temporária:
  - sem o aplicativo, a exportação abre a janela com o QR code, que cabe no celular;
  - com o código, a planilha baixa;
  - na entrada seguinte, o painel pede o código antes de aparecer;
  - com o código, o perfil mostra as duas etapas ativadas;
  - na sessão já verificada, a exportação baixa direto.

## Gravação que não grava não passa em silêncio (05/10/2026)

Rodada B. Quando a regra de acesso recusa a linha, o PostgREST responde sucesso com zero linhas alteradas e nenhum erro. Esse silêncio já custou quatro vezes: o primeiro acesso do aluno ficou nulo para todo mundo, a meta semanal nunca gravou, a ArkeFit "alterava" tarefa sem alterar, e a publicação do mentor não mudava a fase do aluno. Das 62 gravações do app, só 2 conferiam a linha gravada.

- **`exigirGravacao`** (`src/lib/gravacao.ts`) recebe a gravação com `.select(...)` no fim. Ela devolve as linhas gravadas e, quando não vem nenhuma, falha com `NADA_GRAVADO`. O erro do banco passa adiante com o código, e por isso as mensagens do 23505 (endereço de link já usado) continuam. Há duas formas de conferir: passar por ela, ou pedir as linhas de volta e acusar `NADA_GRAVADO` na mão, onde a tela trata o erro de outro jeito.
- **As 60 foram convertidas**: 46 por um script e 14 à mão. Os casos mais relevantes:
  - **Importação de alunos.** O andamento de cada linha não conferia nem o erro. Se ele não gravasse, a linha seguiria pendente e seria processada de novo na retomada. Agora a importação para com a mensagem e pode ser retomada.
  - **Atualização em lote do acervo.** Ela confere quantas fichas mudaram.
  - **Revogação de versão antiga do consentimento de IA.** Passou a conferir o erro; ali zero linhas é o normal.
- **`gravacao.guarda.test.ts`** lê o código e falha em `.update` sem conferência. As exceções são por arquivo e tabela, cada uma com o motivo e valendo para uma gravação só: marcar mensagens como lidas, o desfecho da sugestão do Sentinela, revogar a versão anterior antes de autorizar, e voltar as linhas com erro da importação. Em todas, zero linhas é o resultado normal.

**Conferido:**
- 845 testes, com os do auxiliar.
- O guarda das colunas pegou uma chave errada da conversão (`planos_b2b_precos` não tem `id`).
- Dois defeitos plantados, os dois pegos: uma gravação voltando ao formato antigo, e um `exigirGravacao` de outra instrução logo antes de uma gravação sem conferência.

## Auditoria de prontidão, rodada 1: dinheiro, saída do aluno e acesso (06/10/2026)

A auditoria de 05/10 achou três bloqueadores e quinze achados altos antes da primeira academia pagante. Esta rodada fecha os que são do banco e das funções do servidor. O app, as catracas e os menores de idade foram em frentes próprias. As decisões são as registradas pelo responsável no workspace em 06/10.

**Dinheiro do Método** (migration `20261338010000`).
- **A exceção de repasse por nível ganhou a trava que o repasse da academia já tinha.** A regra de alteração de `organization_planos_precificacao` é do gestor, porque ali ele põe o preço de varejo, e a mesma regra deixava gravar a exceção de repasse. O gatilho `trg_proteger_repasse_por_nivel` recusa incluir, alterar e apagar a exceção para quem não é da ArkeFit. Apagar também conta: sem a exceção, o nível voltaria ao valor da academia.
- **`pagamentos` passou a ser só leitura para a equipe.** Havia uma regra única para todas as operações, com toda a equipe da academia. Quem grava pagamento é o webhook, pela service role. A correção foi feita sem reproduzir a gravação, por decisão do responsável (D5): a trava do Claude Code recusou o teste de escrita, mesmo em transação desfeita.
- **Assinatura do Método cancelada encerra o Método no aluno.** O plano é calculado por `alunos.metodo_arke_status`, e nenhum cancelamento mudava essa coluna: a cobrança parava e o aluno seguia com mentor e nutricionista. A regra mora num gatilho, porque o cancelamento chega por mais de um caminho.
- **O próprio aluno com cobrança vencida não cancela sozinho.** Cancelar no Asaas leva as cobranças em aberto junto; para a academia ou a ArkeFit, é decisão de quem cobra, mas para o aluno seria apagar a dívida com um clique. Ele recebe a frase para quitar ou falar com a recepção.
- **Pagar a mensalidade libera o aluno na hora.** A situação só era recalculada quando o webhook criava a mensalidade, e o aviso de pagamento cai quase sempre no ramo da mensalidade que já existe. Quem pagava o PIX de manhã ficava barrado até a rotina da madrugada.

**Saída do aluno** (migration `20261339010000`, decisão D1).
- **Defeito:** a exclusão apagava a conta de login, e a cascata levava a matrícula, o histórico e as mensagens da pessoa em todas as academias dela, e os pagamentos do Método. A anonimização trocava o e-mail e o perfil, que são da pessoa, cortava o acesso dela em todas as academias e anonimizava só nome, CPF e telefone.
- **`anonimizar_dados_do_aluno`** faz o trabalho do banco numa transação só, dentro da academia que pede:
  - apaga a ficha, a anamnese (fica a data e a versão do consentimento, como prova), as avaliações, os treinos, as dietas, as conversas, o feed e as autorizações;
  - tira o nome da assinatura do contrato, o CPF dos registros da catraca e as linhas da importação;
  - desativa o vínculo, o que já esconde o perfil daquela academia pela regra de leitura de `profiles`;
  - anonimiza o perfil e o login só quando a pessoa não tem vínculo vivo em outro lugar;
  - fica o que a lei manda guardar (mensalidades, pagamentos, notas, comissões) e as presenças, que com o aluno anonimizado viram contagem;
  - a sugestão ao mentor perde o texto e fica, como na revogação, porque ela mede o trabalho do mentor.
- **`excluir_aluno_da_academia`:** só em academia em teste. Apaga o aluno daquela academia, e a conta só quando não sobra vínculo nenhum. O botão de excluir só aparece com a academia em teste.
- As duas registram a ação na auditoria. As fotos do feed e a foto de perfil, que ficam em bucket público, saem pela URL (`apagarArquivosPorUrl`).

**Acesso.**
- `editar-membro-equipe` recusa aluno como alvo: a gestão trocaria o e-mail de login do aluno pelo dela e entraria como ele.
- `sentinela-anamnese` segue a separação do Mentor Centralizado: o aluno do Método é da ArkeFit, o do plano Free é da academia, e a recepção não atende saúde. Correção no Sentinela congelado, autorizada pelo responsável (D4).

**Prazos da Política** (migration `20261340010000`). A foto do rosto e o hash de IP das tentativas prometiam até 24 horas, mas a limpeza só rodava quando outra coisa a chamava. Agora há uma rotina de hora em hora (`arke-dados-de-passagem`), e a foto vence em 23 horas. O fim da última matrícula apaga o resumo da anamnese e o texto das sugestões, como a Política promete. A rotina nova entrou também no roteiro de reconstrução do banco.

**Travas:** `dinheiroDoMetodo.guarda.test.ts` e `saidaDoAluno.guarda.test.ts`. A segunda lê o histórico do banco e as migrations e falha quando surge uma tabela com `aluno_id` que a anonimização não trata e que não diz por que fica.

**Defeitos do caminho.**
- A primeira versão da guarda não achava `sentinela_sugestoes`, que nasceu por fora das migrations e só existe no histórico. Ela passou a ler os dois.
- A primeira versão da anonimização apagava as sugestões ao mentor, contra a regra registrada na migration `20261231`. Passou a só tirar o texto.

**Conferido:**
- **Dinheiro, em transação desfeita:**
  - a gestora alterando e incluindo a exceção de repasse, recusada (42501);
  - o varejo seguindo editável (2 linhas);
  - a equipe sem permissão de alterar e apagar pagamentos, só a regra de leitura;
  - uma assinatura de teste cancelada tirando do Método o único aluno ativo.
- **Saída, em transação desfeita, com uma aluna da academia de demonstração:**
  - avaliações (2), treinos (1), dietas (1) e registros de treino (23) apagados;
  - presenças (23), mensalidades (4) e matrícula (1) mantidas;
  - perfil anonimizado, vínculo inativo e a ação na auditoria;
  - excluir numa academia fora de teste, recusado;
  - com um vínculo de professora em outra academia, o perfil e esse vínculo intactos, e a exclusão sem apagar a conta.
- **Testes:** 12 testes nas duas guardas, e um defeito plantado (uma tabela fora da anonimização) pego.
- **A corrente real, depois do deploy:** 8 verificações pelas funções publicadas, com contas temporárias apagadas no fim.
  - Editar a equipe recusou um aluno como alvo (403).
  - O resumo da anamnese recusou a recepção e atendeu o gestor do aluno do plano Free.
  - Sem outro vínculo, a anonimização apagou a ficha e a avaliação e anonimizou o perfil e o login.
  - Com vínculo em outra academia, ficaram intactos o perfil, o login e o outro vínculo.
  - A exclusão em academia em teste apagou o aluno e a conta.
  - As três saídas ficaram na auditoria.

## O "Sair" que limpa, e a falha de rede que não vira falta de acesso (06/10/2026)

Achados da auditoria de prontidão no app (A11, A12, a conta sem vínculo e o rascunho da anamnese).

**A11. O "Sair" deixava a sessão para trás.** Ele só zerava o estado da tela. O cache das consultas ficava, e quem entrava na mesma aba via por um instante os dados de quem saiu; algumas chaves de cache nem levavam a pessoa ou a academia. O aparelho seguia recebendo os avisos da conta. A sessão saía com o escopo padrão do Supabase, o global, derrubando a pessoa em todos os aparelhos. No perfil simulado, a cópia da sessão da ArkeFit ficava na aba depois do "Sair", e a aba continuava "em simulação": o próximo login ali pulava o aceite de documentos e as duas etapas. E a simulação registrava o aparelho da ArkeFit como destino dos avisos da pessoa simulada.

- **O passo a passo mora em `src/lib/sair.ts`**, com a ordem testada. Os avisos saem primeiro (`src/lib/avisosDoAparelho.ts`): a linha de `push_subscriptions` deste aparelho é apagada ainda com a sessão, porque o RLS só deixa a própria pessoa apagar, e depois a assinatura é cancelada no navegador. Esse passo tem prazo de 4 segundos, para um navegador lento não segurar a saída. Depois, a sessão sai com `scope: 'local'`, e se o `signOut` falhar antes de apagar (sem rede, com o token vencido) a sessão guardada é apagada à mão. Por fim a aba é limpa sempre, mesmo com falha antes: o cache do react-query, os rascunhos (`descartarTodosOsRascunhos`) e a cópia da simulação. Enquanto sai, a árvore do app fica desmontada (tela "Saindo..."), e nenhuma tela dispara consulta no meio da troca.
- **Na simulação, "Sair" encerra a simulação e sai também da conta da ArkeFit.** Havia duas saídas possíveis: agir como "Voltar para Admin" ou sair de vez. A escolha foi sair de vez. Um botão "Sair" que deixasse uma conta da ArkeFit aberta no aparelho seria o pior resultado num computador compartilhado, e "Voltar" continua na faixa para quem quer seguir trabalhando.
- **O cache é de uma pessoa só.** O `AuthContext` limpa o cache sempre que a pessoa da sessão muda (entra outra ou a sessão termina), e não só no "Sair". O fim da sessão por qualquer motivo apaga a cópia da simulação, e a entrada com senha também, porque nunca é simulação. A faixa da simulação relê a cópia a cada troca de pessoa.
- **Chaves com a pessoa ou a academia:** `bloqueio-organizacao` (pessoa e academia), `exercicios-biblioteca` e `alimentos-biblioteca` (pessoa, porque a consulta não filtra e quem decide é a regra de acesso), `aluno-competicoes` (aluno), `duas-etapas-fator`, `carteira-mentor`, `fila-mentor` e, do mesmo tipo, `fila-chamados-mentor` (pessoa). As outras chaves sem id são configuração da plataforma ou números da Visão Master, iguais para quem as vê.
- **Na simulação não se registra assinatura de avisos**, e a volta para a ArkeFit apaga a linha da pessoa simulada neste aparelho, sem cancelar a assinatura do navegador, que é a mesma da conta da ArkeFit. Isso limpa, aos poucos, as linhas que a simulação criou antes desta data. O registro de avisos volta a valer para a pessoa seguinte que entra na aba.

**A12. Uma falha de rede ao abrir mandava a equipe para o app do aluno.** O `AuthContext` ignorava o erro das leituras de `user_roles` e `organization_members`. Sem vínculo, marcava os papéis como carregados, e o `ProtectedRoute` mandava para `/app`, onde a home ficava em "carregando". A leitura da anamnese também ignorava o erro: com ela falha, o aluno do Método era mandado de volta ao acolhimento, e o envio (um `upsert`) sobrescrevia a anamnese que o mentor já tinha lido.

- **Ler, depois aplicar.** `lerAcesso` lê papéis, vínculos, aluno e anamnese e lança no erro. `comNovasTentativas` (`src/lib/tentativas.ts`) tenta quatro vezes, com 1, 2 e 4 segundos entre elas. Esgotadas, o contexto marca `erroAcesso`, e a raiz, o login e as rotas protegidas mostram **Não conseguimos carregar o seu acesso**, com **Tentar de novo** e **Sair**, sem redirecionar. A releitura em segundo plano (depois das duas etapas ou da troca de marca) mantém o que já estava carregado. Toda resposta confere se a pessoa ainda é a mesma antes de virar estado.
- **Anamnese com leitura falha é desconhecida** (`null`), e não incompleta: o portão do acolhimento só redireciona com `false`.
- **O acolhimento não sobrescreve** (`src/lib/acolhimento.ts`). Ele inclui a anamnese; se ela já existe, completa só a que ainda não foi concluída. A concluída fica como está, e o aluno lê que nada foi alterado. Zero linhas ali é o resultado normal, e por isso o envio entrou nas exceções de `gravacao.guarda`.

**A conta sem vínculo ativo.** A rota `/app` não pede papel, e a conta sem matrícula ativa (o aluno desligado, quem criou conta sem matrícula) ficava na home em "carregando" para sempre. `AlunoVinculoGate` espera os papéis. A equipe que abre `/app` volta para o painel dela, e quem não tem academia vê **Nenhuma academia vinculada a esta conta**, com **Sair**. A tela da gestão sem organização também ganhou o **Sair**.

**O rascunho da anamnese saiu do localStorage.** Dores, lesões, medicamentos, sono e estresse ficavam no disco do aparelho, sem prazo, e voltavam sozinhos ao abrir o acolhimento. Isso contrariava a Política e a regra dos rascunhos. Agora é `useRascunho`: o rascunho fica no `sessionStorage`, vale por 48 horas e a tela oferece **Restaurar** ou **Descartar**. Ele some ao fechar a aba e ao sair, e não guarda nada em perfil simulado. Na primeira carga do app novo, `apagarRascunhosAntigosDoAcolhimento` apaga as chaves antigas (`arke_onboarding_draft:`) do localStorage dos aparelhos. O envio passou a receber as respostas no `mutate`, como pede a regra dos formulários.

Os artigos da Central mudaram junto: `app-primeiro-acesso` (Sair e as duas telas novas), `app-metodo-arke` (o acolhimento), `painel-primeiros-passos` (Sair e o painel que não abre) e `vm-visao-geral` ("Sair" na simulação).

**Defeito do caminho:** o `gravacao.guarda` acusou o envio do acolhimento. A inclusão e a conclusão estavam no mesmo objeto, e o leitor do guarda via as duas como uma cadeia só e contava a conclusão duas vezes. Cada gravação virou uma instrução própria.

**Conferido:**
- 41 testes novos: o passo a passo do "Sair" (5), as tentativas e o prazo (7), os avisos do aparelho (4), o envio da anamnese (5), a limpeza dos rascunhos (3), o `AuthContext` com a rede falhando e o "Sair" de verdade (8), o portão do app do aluno e o erro de acesso na rota da gestão (6) e o registro de avisos na simulação (3).
- Suíte inteira: 923 testes em 128 arquivos. Na primeira rodada, 915 passaram; das 8 falhas, 7 foram tempo esgotado em telas que esta entrega não toca, com a máquina carregada, e 1 foi o defeito do guarda acima. Depois da correção, os 108 arquivos com os guardas, as sete telas e as áreas tocadas passaram: 812 de 812.
- Seis defeitos plantados, os seis pegos, com 9 testes falhando: o erro da leitura dos papéis ignorado de novo, o "Sair" com o escopo global, o cache que não limpa na troca de pessoa, a anamnese concluída tratada como completada, a simulação registrando o aparelho para os avisos, e a rota da gestão sem a tela de erro.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 53 funções e a auditoria das dependências (0 vulnerabilidades).
- Falta conferir em produção: a tela no computador e no celular (o "Sair" com e sem simulação, o erro de acesso com a rede desligada, a conta sem academia e o rascunho do acolhimento), e o aviso que para de chegar no aparelho depois do "Sair".
