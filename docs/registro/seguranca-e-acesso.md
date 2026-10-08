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

**Conferido pela tela em produção, depois do deploy (06/10/2026), e o defeito que ela mostrou.**
- **No computador e no celular:** a conta sem academia viu "Nenhuma academia vinculada a esta conta", sem rolagem lateral, e o "Sair" apagou a sessão da aba.
- **A falha de rede, com a leitura dos vínculos bloqueada,** chegou à tela "Não conseguimos carregar o seu acesso", mas levou 34 segundos. Nesse tempo, o formulário de entrar ficava parado, sem dizer nada.
- **A causa:** o supabase-js já repete por baixo toda consulta ao PostgREST que falha por rede, até 3 vezes, com 1, 2 e 4 segundos de espera. As 4 tentativas do app por cima multiplicavam isso: foram 16 consultas bloqueadas, e não 4.
- **A correção:** `comNovasTentativas` passou a tentar 2 vezes, e o "Entrar" mostra "Entrando..." até o acesso carregar ou falhar. Um teste novo trava o padrão de duas tentativas.

## Marco Civil, o IP do limite de tentativas e as cláusulas da ANPD (06/10/2026)

Rodada 3 da auditoria: os três pontos que a auditoria deixou "a conferir fora do código".

**Registros de acesso por 6 meses** (migration `20261380010000`).
- **A obrigação:** a ArkeFit é provedor de aplicação de internet com fins econômicos. O art. 15 do Marco Civil manda guardar os registros de acesso (data e hora de uso a partir de um IP) por 6 meses, sob sigilo.
- **Defeito:** nada cumpria isso. `auth.audit_log_entries` estava vazia, porque o Supabase guarda a auditoria do login só nos logs da plataforma, por poucos dias. `auth.sessions` tem o IP, mas a sessão some quando a pessoa sai.
- **O que entrou:** um gatilho em `auth.sessions` anota, em `registros_acesso_aplicacao`, uma linha por pessoa, IP e dia, com a primeira e a última hora vistas, na entrada e a cada renovação do token.
- **Leitura e prazo:** ninguém lê pela API (RLS sem regra, sem permissão para anon e authenticated). A rotina `arke-registros-de-acesso` apaga o que passou de 6 meses. O gatilho engole o próprio erro: o login nunca falha por causa do registro.
- **Ordem judicial:** a leitura é da ArkeFit, por SQL, só diante de ordem judicial, e a consulta entra na auditoria (`registrar_auditoria`).
- **Capacidade:** com 100 academias (30 mil alunos), a conta fica na casa de dezenas de milhões de linhas em 6 meses, cerca de 1 GB. Cabe no plano Pro e entra no painel de capacidade.

**O limite por IP não se burla trocando o cabeçalho.** A suspeita era que as funções públicas usavam o primeiro item do `x-forwarded-for`, que o cliente poderia forjar. Teste em produção, com uma função descartável que só devolvia os cabeçalhos e foi apagada em seguida:
- o `X-Forwarded-For` mandado pelo cliente foi substituído, e o primeiro item da lista sempre é o IP real;
- o `CF-Connecting-IP` forjado é recusado pela borda.

Suspeita descartada; o código fica como está.

**Cláusulas-padrão da ANPD.** Desde 23/08/2025, a transferência internacional baseada em contrato só vale com as cláusulas-padrão da ANPD (Resolução CD/ANPD 19/2024), sem alteração, ou com cláusulas específicas aprovadas por ela. A Política se apoia nas "garantias contratuais de cada provedor". A pesquisa pública não mostrou se Vercel, Sentry, Resend e AWS assinam as cláusulas brasileiras. A pergunta foi a eles, e a base legal vai ao advogado, como pendência do responsável no workspace.

**Conferido:**
- **Em transação desfeita:**
  - uma renovação de sessão criou o registro;
  - a segunda, no mesmo dia e IP, só atualizou a hora;
  - a rotina apagou uma linha de 200 dias;
  - a equipe não lê.
- **Em produção:** o gatilho no ar.
- **O cabeçalho:** os dois testes de forja descritos acima.

## Auditoria de prontidão, rodada 3: quem vê o quê, e quem é quem (06/10/2026)

Os achados médios de acesso e de identidade da auditoria de 05/10. Migrations `20261360010000` a `20261363010000`.

**Acesso aos dados.**
- **O professor e a recepção abriam a receita pelo endereço.** As rotas de `/admin` tinham uma guarda só, de equipe; o menu escondia Gestão 360°, Financeiro e Equipe, e o banco entregava as mensalidades a toda a equipe (`is_org_staff` inclui professor, nutricionista e recepção).
  - Na tela, a rota passa a conferir o papel pela mesma tabela do menu (`src/lib/acessoPainel.ts`, `PortaoDaRota` no `AdminLayout`). Rota fora da tabela não abre, e o menu continua como era (`src/lib/menuPainel.ts`).
  - No banco, `cuida_do_dinheiro()` (gestão e recepção, que cobra) substitui `is_org_staff` nas regras de mensalidades, cobranças avulsas, pagamentos, matrículas, assinaturas do Método e notas fiscais. Conferido antes de cortar: o professor não usa nada disso, e a recepção matricula, emite a cobrança avulsa, cadastra o cartão e acompanha a mensalidade.
- **A recepção via a saúde do aluno na ficha.** `atende_saude()` (gestão, professor e nutricionista) entra na anamnese, no resumo da IA, na avaliação física, na dieta e na adesão à dieta. A ficha esconde esses blocos da recepção, e também o comentário dos check-ins e as pendências de dor e de anamnese; a fila não oferece a anamnese a ela.
  - **O PAR-Q e o atestado ficam com a recepção**, por decisão desta rodada. São o documento de aptidão que a academia guarda: quem recebe o atestado no balcão e registra a validade é quase sempre a recepção, e sem isso o aluno com "sim" no PAR-Q ficaria sem registrar treino até alguém da gestão aparecer. Na ficha, a recepção vê se o PAR-Q pede atestado, mas não quais perguntas tiveram "sim". O banco ainda entrega a ela a linha inteira do PAR-Q; separar as respostas por coluna fica como opção, se o responsável quiser.
- **A ArkeFit lia a saúde de todo aluno do Free.** A anamnese, a dieta e o resumo da IA passam a ser da ArkeFit só no aluno do Método (`equipe_metodo()` com `aluno_no_metodo()`), como dizem o termo de saúde e a Política. O suporte a um aluno do Free passa pelo perfil simulado, que fica na auditoria. Os registros da catraca, com o CPF, saem do `admin_arke`: a Visão Master já os mostrava pelo servidor, sem o CPF.
- **O consentimento de saúde é do titular.** A regra de alteração da anamnese deixava a equipe gravar as colunas do consentimento. Um gatilho (`trg_consentimento_saude_so_do_titular`) só aceita a concessão do próprio aluno, como na IA e na biometria. Retirar segue possível para quem já escreve a linha, como na trava do menor, porque a retirada do aceite do responsável é feita pela equipe quando ele pede à academia.
- **O aluno retira o consentimento de saúde pelo app.** A Política prometia, e não havia como. Em Perfil → Privacidade, o quadro **Dados de saúde** diz o efeito antes de confirmar: `revogar_consentimento_saude()` apaga as respostas da anamnese e o resumo da IA, e guarda a data do aceite (prova) e a da retirada. A avaliação física, o PAR-Q e o atestado não são desta autorização e saem pelo pedido de exclusão. Quem retirou não fica preso no acolhimento, e autoriza de novo preenchendo a anamnese.

**Identidade.**
- **Conta criada sem prova de posse do e-mail podia virar gestão.** A matrícula pública cria a conta com o e-mail já confirmado, e criar a academia na Visão Master e convidar o profissional autônomo ligavam a conta existente como gestora só pelo e-mail.
  - **A escolha:** a conta que já existia entra na gestão **pendente** e recebe o link de definir a senha; a gestão só vale quando a pessoa entra por esse link e define a senha ali. Olhando a conta, não dá para saber se o e-mail foi provado (a matrícula pública, o cadastro pela equipe e o convite deixam a conta igual), então a regra vale para toda conta existente, inclusive a do gestor de verdade que ganha uma segunda academia: ele define a senha uma vez.
  - `ativar_gestao_pendente()` só ativa numa sessão aberta por link do e-mail e nunca em perfil simulado. As telas de senha encerram as outras sessões da conta **antes** de ativar (`src/lib/senhaDefinida.ts`): sem isso, quem tinha a senha antiga continuaria com uma sessão viva no painel novo.
  - A gestão pendente conta como a próxima para `prevent_remover_ultimo_gestor` (trocar o responsável que nunca entrou por uma conta existente deixava o anterior ativo para sempre) e como outra academia para `alvoSoNaAcademia`. A Visão Master mostra o responsável pendente.
- **Cadastro aberto.** Nenhum fluxo do produto usava o `signUp`: a conta nasce na matrícula pública, no convite da academia ou no da ArkeFit, e a do "Cadastre-se" ficava sem academia nenhuma. Saem o "Cadastre-se" e a página; o endereço antigo cai no login. Desligar o cadastro na configuração do Auth é passo do responsável: o painel do Supabase não é mexido por aqui.
- **A gestão que ligou as duas etapas só valia na tela.** Medido antes de escolher onde pôr a conferência (Postgres 18 em WASM, `EXPLAIN (ANALYZE, BUFFERS)` sobre 5.000 linhas de uma academia; as páginas lidas não variam entre rodadas, o tempo em WASM varia demais): dentro das funções de papel, a conferência rodaria a cada linha, com 6,02 páginas por linha contra 4,02 hoje (+50%) e mais a leitura do JWT a cada linha; numa regra restritiva com `(select ...)`, custa 3 páginas por consulta. A escolha foi o recorte: a regra restritiva `"duas etapas"` (`sessao_cumpre_duas_etapas()`) em toda tabela com `aluno_id`, no aluno, no perfil (menos o da própria pessoa, que o app lê antes do código), no funil, na importação e no dinheiro da academia e da equipe. Ficam de fora as tabelas que o app lê antes do código e a configuração. A sessão simulada pela ArkeFit passa. **Próximo passo:** as funções do banco que devolvem dado de aluno à equipe sem passar pelo RLS (histórico, caixa de mensagens) e as edge functions que leem pela service role ainda não conferem.
- **O link de acesso gerado pela ArkeFit.** Ele abre uma sessão de verdade como a pessoa, fora do perfil simulado. Agora só o Super Admin com as duas etapas gera, as travas da equipe valem para ele também (só quem nunca entrou e está numa academia só), e todo link gerado, por qualquer pessoa, vai para a auditoria antes de sair.
- **Cobrança no perfil simulado.** `asaas-cartao-assinatura` e `asaas-assinatura-ciclo` deixam o aluno agir por si e gravam pela service role, que os gatilhos do banco não alcançam. As duas passam a recusar a ação do próprio aluno quando o `session_id` da sessão está em `sessoes_simuladas`, com a frase das outras autorizações (`_shared/sessaoSimulada.ts`), e a tela do aluno avisa antes.

**Travas:** `acessoPainel.guarda.test.ts`, `consentimentoSaude.guarda.test.ts`, `duasEtapasNoBanco.guarda.test.ts` e `identidade.guarda.test.ts`; `perfilSimulado.guarda.test.ts` passou a cobrar a retirada do consentimento e o cartão.

**Defeitos do caminho.**
- A prova local da migration do consentimento recusou a semente que gravava a anamnese com o aceite sem pessoa (a service role): é a trava funcionando. Nenhum script do repositório grava anamnese; uma restauração de banco carrega os dados com os gatilhos desligados, como já faz.
- O teste do cadastro aberto passou do prazo de 5 segundos com a máquina ocupada, porque lê o `src` inteiro; ganhou prazo próprio.
- Duas travas novas acusaram o próprio código certo, e foram corrigidas antes dos defeitos plantados: o `perfilSimulado.guarda` lia a declaração do tipo da situação do consentimento como uma gravação, e o `identidade.guarda` confundia o perfil (que nasce "active") com o vínculo de gestão.

**Conferido:**
- **O banco, em Postgres 18 local (PGlite, em WASM) com o esqueleto das tabelas e as regras de produção pelos mesmos nomes:** as quatro migrations rodam, e 80 casos passam, entre eles professor e nutricionista lendo 0 linha nas seis tabelas do dinheiro e a recepção lendo todas; a recepção lendo 0 nas cinco da saúde; o `admin_arke` sem ler o aluno do Free e lendo o do Método; gestor e professor recusados ao conceder o consentimento, o aluno concedendo, a equipe retirando; a retirada apagando as respostas e o resumo e recusada em perfil simulado; a gestão pendente recusada com sessão de senha e em perfil simulado e ativada pelo link, com a auditoria; o gestor com as duas etapas e só a senha sem ler alunos nem mensalidades e lendo o próprio perfil, e passando com o código.
- **11 defeitos plantados, os 11 pegos:** o professor de volta ao dinheiro (pela trava e pela prova do banco), a página sem o portão, uma rota nova fora da tabela, a retirada sem os medicamentos, o gatilho aceitando a equipe (trava e prova), uma tabela com `aluno_id` fora das duas etapas, a conta existente virando gestão na hora, o cartão sem conferir a sessão simulada, a ArkeFit pulando a trava de quem já entra, a ativação antes de encerrar as outras sessões e o perfil simulado ativando a gestão (trava e prova).
- **Testes:** 38 novos (11 em `acessoPainel.guarda`, 8 em `consentimentoSaude.guarda`, 4 em `duasEtapasNoBanco.guarda`, 10 em `identidade.guarda`, 4 da ordem do "definir a senha" e 1 da Visão Master). Suíte inteira, depois do rebase sobre a main: 1.079 testes em 145 arquivos, todos passando. Na rodada anterior ao rebase, com a máquina carregada, 9 testes de telas que esta entrega não toca passaram do prazo de 5 segundos; rodados sozinhos, os 10 arquivos passaram (52 testes).
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 55 funções e a auditoria das dependências (0 vulnerabilidades).
- **Falta, depois do deploy:** a prova no banco de produção em transação desfeita e a corrente real pelas funções publicadas; a tela no computador e no celular (o painel de cada papel, a ficha da recepção e do professor, a retirada no app, a gestão pendente com uma conta temporária); e desligar o cadastro aberto no Auth.

## Auditoria de prontidão: as sobras de banco e de funções (06/10/2026)

Seis sobras da auditoria de prontidão, de banco e de funções. Migrations `20261393010000` a `20261397010000`.

**1. O admin da ArkeFit só nas tarefas da ArkeFit** (`20261393`). A fila do Mentor é a mesma `tarefas`, com `dono`, e a separação mora no RLS. A academia já não lia o que é da ArkeFit, mas o lado inverso estava aberto: o `admin_arke` lia, alterava e excluía toda tarefa de toda academia, inclusive cobrança, atestado e a fila do aluno do Free.
- Agora o `admin_arke` alcança só `dono = 'arkefit'`, nas duas metades de cada regra. O Super Admin continua vendo tudo.
- No `with check` da alteração, cada lado só deixa a tarefa com o próprio dono: antes a equipe podia mudar o dono de uma tarefa dela. A inclusão da equipe fica como estava, porque o gatilho decide o dono antes do `with check`, e o relato de dor de um aluno do Método vira tarefa do mentor.
- Conferido antes de cortar: a fila, a operação, a ficha do Método, a instrução presencial e a liberação da progressão passam por funções `security definer`. A única gravação direta da ArkeFit é encerrar o chamado da fila, que é sempre `dono = 'arkefit'`.

**2. O histórico do aluno mostra só o que quem pede pode ver** (`20261394`). `get_historico_aluno` rodava com a permissão da função e devolvia à recepção e ao professor o que o RLS das tabelas esconde deles: as tarefas do mentor, a dieta, o comentário de saúde do check-in e, no aluno do Método, o que é da ArkeFit. E o `admin_arke` abria o histórico de qualquer aluno do Free.
- **A escolha:** a função passa a `security invoker`. Cada parte passa pelo RLS da tabela de origem, e a regra mora num lugar só: quando a regra de `tarefas`, `dietas` ou `checkins` mudar, o histórico muda junto, sem ninguém lembrar dele. A outra saída, repetir as condições do RLS dentro da função, deixaria duas cópias da regra para divergirem na primeira correção, que é como esta divergência nasceu. De quebra, a regra restritiva "duas etapas" passa a valer para o histórico, que era o próximo passo da rodada 3. A caixa de mensagens (`get_caixa_mensagens`) continua `security definer`. *Superado em 06/10/2026: a caixa também passou a `security invoker` (ver "as últimas sobras de banco", abaixo).*
- O que o RLS não diz, a função diz com a mesma função das regras, `atende_saude()`. A recepção não vê o comentário e o motivo do check-in nem as pendências de dor e de anamnese. A lista dos tipos de saúde mora em `TAREFAS_DE_SAUDE` (`src/lib/acessoPainel.ts`), usada pela ficha e conferida contra a função.
- Quem pede: a equipe da academia, ou a ArkeFit só no aluno do Método. O suporte ao Free passa pelo perfil simulado, como na anamnese.
- O autor que o RLS não deixa ler não some. Aparece como **Equipe ArkeFit** quando a linha é da ArkeFit (`dono = 'arkefit'`, ou a fase mudada por quem não é da academia). Aparece como **Equipe da academia** quando é de alguém que saiu da equipe: o perfil de quem foi inativado também deixa de ser lido, e sem essa distinção o ex-professor apareceria como ArkeFit.
- O `profiles` foi conferido: só uma regra permissiva de leitura em produção. O leitor de regras das guardas chegou ao mesmo número (ver os defeitos do caminho).

**3. A equipe só com o e-mail provado** (`20261395`, `cadastrar-membro-equipe`). A matrícula pública e a gestão nova já esperavam a prova do e-mail (`20261362`). O cadastro da equipe, não. *Correção de 07/10/2026: a matrícula pública não esperava; ela criava a conta com o e-mail confirmado e a senha de quem digitava. Passou a esperar nesta data (ver "A matrícula pública confirmada pelo e-mail", abaixo).*
- Ele criava a conta com o e-mail confirmado e uma senha temporária que voltava para quem cadastrava. A gestão ficava com a senha da conta de outra pessoa, e o e-mail nunca era provado.
- A parceria do profissional autônomo (`convidar_parceiro_autonomo`) ligava na hora, como professor ou nutricionista, a conta que já existisse com o e-mail digitado. Quem se matriculasse antes com o e-mail de uma nutricionista leria a ficha completa dos alunos do painel.
- `convidar-membro` só cadastra aluno: e-mail novo recebe o convite do Auth, sem senha, e a importação sem e-mail cria a conta sem senha. A conta que já existe é ligada pelo CPF (decisão de 03/10/2026; ver abaixo o que ficou de fora).

O que muda, no molde da gestão:
- e-mail sem conta recebe o convite do Auth, e a senha nasce no link (`inviteUserByEmail`, sem `password` nem `email_confirm`);
- conta que já existe entra **pendente** e recebe o link de definir a senha (`generateLink` de recuperação);
- `ativar_gestao_pendente()` passa a ativar também professor, nutricionista e recepção pendentes. O nome fica, porque o app publicado a chama depois de definir a senha, e a auditoria distingue `equipe.ativada_pelo_email` de `gestao.ativada_pelo_email`;
- a parceria liga a conta existente como pendente, e a tela passa pelo mesmo cadastro, que manda o link;
- o gatilho `trg_vinculo_pendente_so_pelo_email` recusa trocar `pending` por `active` pela API. A tela da Equipe oferecia **Ativar** para quem não estava ativo, e o clique de boa-fé do gestor completaria o pré-sequestro. Agora a tela mostra **Aguardando o e-mail** e não oferece o botão;
- as telas (Equipe, a etapa Equipe da configuração e a Parceria) não mostram nem copiam senha nenhuma, e os artigos da Central mudaram junto.

**4. O roteiro de reconstrução cria todos os buckets.** `02-depois-da-restauracao.sql` criava 8 dos 9 buckets e esquecia `termos-biometria` (`20261250`). As regras de `storage.objects` dele eram as de `20261214`, sem o termo da digital e sem o teto diário de envio (`20261322`): rodar o roteiro depois de uma reconstrução pelas migrations voltaria as regras para trás.
- O roteiro passou a ter os 9 buckets e as regras vigentes.
- `scripts/migracao/buckets.mjs` lê as migrations e o histórico na ordem da reconstrução, no molde de `rotinas.mjs`.
- A guarda `bucketsBanco.guarda` falha em quatro casos: um bucket de migration fora do roteiro ou com outro valor; um bucket usado no código que o roteiro não cria; uma regra de Storage do roteiro diferente da última versão das migrations; e o retrato de produção (os 9 nomes e o público ou privado de cada um) diferente do roteiro.
- Cinco buckets nasceram pelo painel, antes das migrations (avatars, dietas, email-assets e os dois de exercício): para os limites deles, o roteiro é o registro.

**5. O encerramento anonimiza o cliente no Asaas** (`20261396`, `encerramento-organizacao`, `_shared/saidaAsaas.ts`). A eliminação apagava os alunos sem passar pela anonimização que a saída de um aluno já faz.
- Agora a etapa de eliminação anonimiza o cliente de cada aluno antes de apagar contas (o CPF está no perfil) e organização (o ambiente vem do status dela). Vai em lotes de 50, cinco em paralelo, com cursor em `organizacao_encerramentos.asaas_cursor` e o placar na Auditoria. Lote novo não começa depois de 60 segundos: a rodada é retomável.
- Quem falha vira pendência, e a eliminação segue, como na saída. Se um lote inteiro falha (o Asaas fora do ar, a chave errada), a rodada para sem avançar o cursor e fica como falha na Visão Master: seguir só trocaria cada aluno por uma pendência, com um prazo de 20 segundos de cada vez.
- `eliminar_organizacao` recusa enquanto o passo não terminou, e assim uma versão antiga da função publicada não elimina sem ele.
- **Outro vínculo:** a regra é a da saída, olhada para fora desta academia. Quem tem matrícula viva ou vínculo ativo noutra academia fica intocado na conta da ArkeFit. O vínculo de equipe na mesma academia não conta, porque também está saindo.
- **Só a conta da ArkeFit.** A conta Asaas da academia é dela: a subconta aberta pela ArkeFit ou a conta própria que ela conectou. As cobranças, as notas e os clientes de lá são o registro dela, que continua depois do contrato, e a responsabilidade fiscal segue o split. Anonimizar ali apagaria o contato de quem ainda deve à academia. A ArkeFit só apaga do cofre a chave que guardava. A saída de um aluno com a academia ainda no ArkeFit continua tratando as duas contas. Antes de eliminar, a rodada tenta de novo as pendências de saída daquela academia, enquanto a chave existe.
- **A pendência sobrevive à eliminação.** `asaas_saida_pendente` não tem chave estrangeira, e a eliminação não a apaga (a guarda confere). Com a organização apagada, a nova tentativa não saberia o ambiente (trial vai ao sandbox) nem teria a chave da academia, que sai do cofre junto. A pendência passa a guardar o ambiente, se toca a conta da academia (falso no encerramento) e as outras matrículas da pessoa (só ids), que o banco não acha depois da exclusão das contas. Sem dado pessoal, como antes. A pendência antiga, sem ambiente, segue a regra de antes (produção).

**6. A troca do e-mail de login sem o e-mail na trilha** (`20261397`, `superadmin-suporte-tenant`). O registro `gestor.email_alterado` guardava `novo_email` em claro. No molde de `20261376`, a função manda só `{"mudou": "e-mail de login"}`, e um gatilho tira de todo registro dessa ação qualquer chave com e-mail. Ele vale já, antes de a função nova ser publicada, e para qualquer caminho.

**Fica de fora, e por quê.**
- **O aluno com conta que já existe** (`convidar-membro`). A matrícula liga a conta pelo CPF, sem a prova do e-mail (decisão de 03/10/2026). O pré-sequestro ainda é possível por aí: quem se matricula antes pela matrícula pública, com o e-mail e o CPF de outra pessoa, recebe depois a matrícula que outra academia fizer para ela. Pôr o aluno pendente não cabe no `organization_members`: o RLS do aluno, em mais de 40 tabelas, olha `alunos.user_id`, que é obrigatório e nasce na matrícula, e várias funções do app leem pela mesma coluna. As saídas são uma matrícula que só se liga à conta depois do link (a academia não veria o aluno até ele aceitar) ou a matrícula pública com e-mail confirmado. É decisão de produto do responsável. *Superado em 07/10/2026: o responsável escolheu a matrícula pública confirmada (ver "A matrícula pública confirmada pelo e-mail", abaixo).*
- **A troca do e-mail de um membro da equipe pela gestão** (`editar-membro-equipe`) não vai à auditoria. Ela já pede as duas etapas e só vale para quem está apenas naquela academia; registrar a troca (sem o e-mail, como aqui) é um passo a decidir, e não estava nesta lista. *Superado em 06/10/2026: a troca vai à auditoria como `equipe.email_alterado`, sem o e-mail (abaixo).*

**Defeitos do caminho.**
- O leitor de regras das guardas via viva a regra antiga de leitura de `profiles`. O Postgres corta o nome com mais de 63 bytes, e a regra foi apagada pelo nome cortado. O leitor passou a cortar igual e chegou à única regra de leitura que produção tem.
- A prova no banco local mostrou a nota do mentor ao mudar a fase do aluno do Método chegando ao professor: `aluno_fase_historico` é legível pela equipe inteira. No Método, a academia vê que a fase mudou, mas a nota fica com a ArkeFit.
- O roteiro voltaria as regras do Storage para a versão de `20261214`. O caso não estava na lista da auditoria, e a guarda dos buckets o pegou na primeira rodada.
- A parceria do autônomo e o botão **Ativar** da Equipe também não estavam na lista. Os dois completariam o pré-sequestro, e foram corrigidos no mesmo molde.
- O teste do passo do Asaas importa `_shared/saidaAsaas.ts`, e o `tsc` do app não entende o `npm:` do Deno. O módulo deixou de importar o tipo do cliente do Supabase e usa só o pedaço que lê, como `arquivosDoAluno.ts`. A primeira tentativa, comparar o cliente de verdade com esse pedaço, estourou a checagem do Deno ("instanciação profunda demais"), e o cliente entra como `object`, convertido num lugar só.

**Travas:** `tarefasPorDono.guarda` e `historicoDoAluno.guarda` (novas) leem a versão vigente de cada regra com `scripts/migracao/regras.mjs`, que aplica `create`, `alter` e `drop policy` na ordem da reconstrução. `bucketsBanco.guarda` (nova) é a dos buckets. `identidade.guarda` ganhou a equipe, `saidaDoAluno.guarda` a eliminação e a pendência, e `perfilSimulado.guarda` a troca de e-mail.

**Conferido:**
- **O banco, em Postgres local (PGlite), sobre um esqueleto com as tabelas e as funções de papel copiadas das migrations.** As regras de acesso não foram copiadas à mão: foram geradas pelo mesmo leitor das guardas, no estado de antes desta entrega. As cinco migrations rodaram duas vezes seguidas, e **108 casos** passaram, cada um em transação desfeita:
  - **itens 1 e 2, 68 casos.** Antes, o `admin_arke` lia as 5 tarefas e a recepção via pelo histórico a dor, o comentário do check-in, a tarefa do mentor e a dieta do Método. Depois, o `admin_arke` lê, altera e encerra só a da ArkeFit, não muda o dono, não abre tarefa na fila da academia e, sem as duas etapas, não lê nada. Os quatro papéis da academia leem as quatro dela e não mudam o dono. O histórico ficou certo para gestor, professor, nutricionista, recepção, `admin_arke`, Super Admin, gestor de outra academia, o próprio aluno e o gestor só com a senha. A função não é mais `security definer`;
  - **item 3, 14 casos:** a parceria liga a conta existente como pendente, e antes ligava ativa; nem o gestor nem a ArkeFit ativam o pendente pela API; a ativação é recusada só com a senha e em perfil simulado, vale pelo link e fica na auditoria como da equipe, e a gestão pendente segue ativando;
  - **item 4, 4 casos:** a seção Storage do roteiro roda duas vezes e cria os 9 buckets e as 5 regras, com o termo e o teto;
  - **item 5, 17 casos:** a pendência antiga ganha as colunas, a chamada de antes com cinco parâmetros continua valendo, e a repetida junta as matrículas e não volta a tocar a conta da academia. A lista dos alunos pula o anonimizado, marca o outro vínculo só fora da academia, traz o CPF e pagina pelo cursor. A eliminação é recusada sem o passo do Asaas; feito o passo, a chave sai do cofre, as pendências sobrevivem, e a Auditoria guarda o placar. Nenhum usuário logado chama as funções novas;
  - **item 6, 5 casos:** o registro antigo perde o e-mail, o novo e a alteração também, e outra ação não é tocada.
- **7 defeitos plantados, os 7 pegos:**
  - o `admin_arke` sem `dono = 'arkefit'` no `with check` da alteração;
  - o comentário do check-in sem a conferência da saúde;
  - a lista de tarefas de saúde da ficha diferente da do banco;
  - a conta existente ligada como ativa no cadastro da equipe;
  - o bucket do termo trocado de nome no roteiro (3 testes);
  - a eliminação tocando a conta da academia (a guarda e 3 testes do passo);
  - o e-mail de volta no registro da troca.
- **Testes:**
  - 39 novos: 6 em `tarefasPorDono.guarda`, 6 em `historicoDoAluno.guarda`, 6 em `bucketsBanco.guarda`, 8 do passo do Asaas na eliminação contra um Asaas e um banco de mentira com o código real (`eliminacaoAsaas.test.ts`), 5 em `cadastroEquipe`, 5 em `identidade.guarda`, 2 em `saidaDoAluno.guarda` e 1 em `perfilSimulado.guarda`;
  - suíte inteira: 1.282 testes em 171 arquivos, todos passando. Antes do `npm run ajuda:indice`, falhou só o índice da Central, que acusa artigo mudado sem índice novo.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 56 funções e a auditoria das dependências (0 vulnerabilidades).
- **Falta, porque esta frente não toca produção:**
  - aplicar as migrations e provar no banco de produção em transação desfeita;
  - publicar as funções e a corrente real: o convite e o pendente com uma conta temporária, e um encerramento de homologação até a eliminação;
  - a tela no computador e no celular: a Equipe com o pendente, a Parceria, a ficha da recepção e do professor;
  - publicar `assistente-academia` com o índice novo.

## Auditoria de prontidão: as últimas sobras de banco (06/10/2026)

Três sobras que a frente anterior achou, e uma quarta que a prova desta achou. Migrations `20261398010000` a `20261401010000`.

**1. A recepção não lê as tarefas de saúde** (`20261398`). A ficha e o histórico já escondiam da recepção as pendências de dor e de anamnese, mas pela tela. O RLS de `tarefas` dava à recepção toda tarefa `dono = 'academia'`, e a prova em produção mostrou a recepção lendo pela API a tarefa de dor ("Dor no joelho"), com o desfecho do professor.
- **A escolha:** a regra mora no RLS, como a do dono (`20261393`). Na leitura, nas duas metades da alteração e na exclusão, o termo da equipe da academia ganha "a tarefa não é de saúde, ou quem pede atende a saúde" (`atende_saude()`). Uma regra por operação, como antes.
- Os tipos de saúde moram numa função só, `tarefa_de_saude()`: `dor` e `anamnese`, a mesma lista de `TAREFAS_DE_SAUDE` da ficha. Ficam de fora o `atestado` (o documento que a recepção recebe no balcão, decisão de `20261360`), e também `ajuste` e `barreira`, que dizem que o plano precisa de ajuste ou que a rotina travou, sem o relato de saúde (o check-in com dor abre `dor`).
- A inclusão fica como está: abrir uma tarefa não mostra outra, e a de saúde que a recepção abrisse pela API iria para quem atende, sem voltar para ela.
- A Fila de atendimento lê pelo RLS: o professor, a nutricionista e a gestão seguem vendo a dor e a anamnese, sem responsável, na "Minha Fila". A pendência de saúde aberta que uma recepcionista já tinha assumido sumiria da fila dela e ficaria fora da "Minha Fila" dos outros, então a migration a devolve para a fila comum (sem responsável). A tela da fila também não tratava o erro da leitura: com o banco fora, dizia "Nenhuma pendência encontrada" (corrigido junto).
- O histórico (`get_historico_aluno`) continua com o filtro dele, agora redundante; a lista dele e a do RLS são conferidas contra a mesma `TAREFAS_DE_SAUDE`.

**2. A caixa de mensagens pelo RLS de quem pede** (`20261399`). `get_caixa_mensagens` rodava com a permissão da função, a mesma classe do histórico. Conferida contra o RLS de `mensagens_treino` e `mensagens_dieta`:
- ela pulava a regra restritiva das duas etapas: a gestão com o fator cadastrado e a sessão só com a senha lia a caixa inteira, que a API recusa;
- o resto ela entregava igual ao RLS, e era o RLS da conversa da nutrição que estava largo: `is_org_staff` (a recepção inclusive) e o `admin_arke` de qualquer academia. A conversa da nutrição é saúde (a dieta, a alergia, o refluxo), e a dieta já era só de quem atende e, no Free, não da ArkeFit (`20261360`, blocos 2 e 3). A recepção lia pela caixa e pela API a conversa da nutricionista com o aluno;
- a conversa do mentor do Método mora em `mensagens_mentor`, que a academia não lê, e a caixa já tirava o aluno do Método: por aí não havia vazamento.

**A escolha**, no molde do histórico: a conversa da nutrição segue a regra da dieta (o aluno; quem atende a saúde, inclusive a conversa antiga de quem entrou no Método, que `20261295` deixou legível; e a ArkeFit só no aluno do Método), e a caixa passa a `security invoker`, com cada canal lido pelo RLS da própria tabela, duas etapas inclusive. A conversa de treino fica como está, porque o treino é lido por toda a equipe. No app, a recepção deixa de ter o canal de nutrição na caixa (`canaisDoPapel`), e o **Chat Nutrição** da ficha fica desativado para ela, com o porquê; o artigo de Mensagens mudou junto.

**3. A mensagem lida passa a gravar** (`20261400`, achado da prova do item 2). O chat de treino e o de nutrição tinham uma regra só, `for all`, e o `with check` dela exige que a linha seja de quem grava. Isso vale para a inclusão, que era o que ele queria, e também para a alteração: marcar como lida a mensagem do outro lado, que o chat faz ao abrir, era recusado com 42501. O app engolia o erro, e a contagem de não lidas da caixa e do menu nunca baixava.
- Uma regra por operação, com o mesmo quem-lê de hoje: leitura (o aluno e quem atende o canal), inclusão (o `with check` de antes: cada um escreve só como ele mesmo), alteração (quem lê) e exclusão (como estava; nenhuma tela exclui mensagem).
- A permissão de alterar a tabela sai, e volta só para a coluna `lida`: o texto, o remetente e a data de uma mensagem não mudam pela API.

**4. A troca do e-mail de alguém da equipe vai para a auditoria** (`20261401`, `editar-membro-equipe`). A gestão (com as duas etapas) ou a ArkeFit troca o e-mail de login de um professor, nutricionista, recepcionista ou gestor, e não ficava registro. Trocar o e-mail entrega a conta a quem tem o e-mail novo, o mesmo peso de `gestor.email_alterado`.
- A função registra `equipe.email_alterado`: quem trocou, de quem, o papel da pessoa e se foi a ArkeFit, sem o e-mail (nem o novo nem o antigo). A falha do registro não desfaz a troca já feita e vai ao log, como em `superadmin-suporte-tenant`.
- O gatilho de `20261397` passa a valer para toda ação que termina em `.email_alterado`, por qualquer caminho. A Auditoria da Visão Master ganhou o rótulo.
- Os três logs da função que levavam o objeto de erro passaram por `resumoDoErro()`.

**Fica de fora, e por quê.**
- **`get_atendimentos_mentor_organizacao`** (a tela Acompanhamento ARKE, da gestão) é `security definer` e entrega o motivo e o desfecho das tarefas do mentor a qualquer pessoa da equipe que chame a função, inclusive o da tarefa de dor. A tela existe de propósito, para mostrar à academia o resultado do mentor, e a rota é só da gestão. Mas a função confere `is_org_staff`, e não a gestão, e o motivo pode trazer saúde do aluno do Método. Decidir se a academia vê o motivo da tarefa de saúde do Método, e restringir a função à gestão, é decisão de produto. *Resolvido em 07/10/2026: a linha de saúde sai com o motivo neutro e sem o desfecho, e não sai para a recepção (ver "As sobras da frente B", abaixo).*
- **A ArkeFit lê a conversa de treino do aluno do Free**, como lê o treino (`treinos`). Foi mantido para o chat seguir a regra do treino; se o treino do Free sair do alcance da ArkeFit, o chat sai junto.
- **A exclusão de mensagem** segue com quem lê a conversa: a equipe pode excluir a mensagem do aluno pela API. Nenhuma tela faz isso. Fechar a exclusão é um passo pequeno, mas muda o que o banco permite hoje, e não estava na lista. *Resolvido em 07/10/2026: ninguém apaga mensagem pela API (ver "As sobras da frente B", abaixo).*
- **A troca de papel e de nome pela gestão** (`editar-membro-equipe`) também não vai à auditoria. Promover alguém a gestor dá acesso ao dinheiro: vale registrar, a decidir. *Resolvido em 07/10/2026: as duas vão à auditoria, e a do papel também quando é feita direto pela API (ver "As sobras da frente B", abaixo).*

**Defeitos do caminho.**
- A prova da caixa voltava vazia em todos os papéis: o esqueleto deixava `metodo_arke_status` nulo no aluno do Free, e `<> 'ativo'` com nulo descarta a linha. Em produção a coluna é `not null default 'sem_adesao'`, e o esqueleto passou a seguir.
- A prova esperava que a recepção, sem fator cadastrado, não lesse nada sem as duas etapas. A regra restritiva só pesa para quem tem o fator, e o caso passou a usar o professor com o fator.
- O primeiro texto da migration das tarefas dizia que a recepção "registra a dor do balcão", mas nenhuma tela da equipe abre tarefa de dor. O comentário e o artigo da Fila dizem o que existe: o aluno registra pelo app.
- A primeira rodada da suíte pegou o teste antigo de `canaisDoPapel`, que esperava a recepção com os dois canais. Ele mudou com a decisão.

**Travas:**
- `tarefasPorDono.guarda` ganhou "a saúde fica com quem atende": todo termo da equipe, nas quatro metades, pede a condição; a lista do banco é a da ficha; e o leitor acha a recepção lendo a dor.
- `caixaDeMensagens.guarda` (nova): a caixa `security invoker`, lendo só tabela com regra de leitura; uma regra por operação nos dois chats; a nutrição sem `is_org_staff` nem o `admin_arke` solto; a alteração só da coluna `lida`; e a recepção sem o canal de nutrição no app.
- `perfilSimulado.guarda` passou a ler a definição vigente do gatilho e ganhou o registro da troca da equipe.

**Conferido:**
- **O banco, em Postgres local (PGlite)**, no esqueleto da frente anterior com os chats acrescentados. As regras de acesso foram geradas pelo leitor das guardas no estado de antes desta entrega (até `20261397`). Cada migration rodou duas vezes seguidas, e **81 casos** passaram, cada um em transação desfeita:
  - **tarefas de saúde, 25 casos.** Antes, a recepção lia a dor. Depois, a recepção não lê, não altera nem exclui dor e anamnese, não transforma tarefa dela em tarefa de saúde, abre a de dor sem lê-la de volta e segue lendo cobrança, atestado e barreira. Gestor, professor e nutricionista leem as 7 da academia, assumem a dor e a veem no histórico. A dor que estava com a recepção voltou para a fila comum, e a cobrança dela ficou com ela. O professor com o fator e sem as duas etapas não lê nada;
  - **caixa, 27 casos.** Antes, a recepção e a ArkeFit recebiam a conversa da nutrição, e a gestão sem as duas etapas recebia a caixa. Depois, a recepção recebe só o treino e não lê, não responde nem marca a nutrição. Gestor, professor e nutricionista recebem os dois canais do Free e não o do Método, e leem a conversa antiga de quem entrou no Método. Sem as duas etapas, a caixa vem vazia. A ArkeFit não recebe a nutrição do Free. O aluno e a gestão de outra academia não abrem a caixa;
  - **mensagem lida, 22 casos.** Antes, nem o professor nem o aluno marcavam a mensagem do outro lado. Depois, os dois marcam, e a contagem da caixa baixa. Ninguém altera o texto nem o remetente, e as inclusões seguem como eram. Pela API só `lida` se altera, e o servidor segue com tudo;
  - **troca de e-mail da equipe, 7 casos:** o registro guarda quem, de quem, o papel e se foi a ArkeFit; o banco tira o e-mail de qualquer caminho, inclusive por alteração; o do gestor segue sem e-mail; e outra ação não é tocada (o `_` do `like` é literal).
- **5 defeitos plantados, os 5 pegos:**
  - a exclusão sem a condição de saúde;
  - `barreira` na lista da ficha (pegam as duas guardas, a das tarefas e a do histórico);
  - a recepção de volta ao canal de nutrição;
  - a leitura da nutrição com `is_org_staff`;
  - o `novo_email` de volta no registro da troca da equipe.
- A suíte e o `npm run check` estão no fechamento da rodada 3 do app (`produto.md`), que entrou no mesmo PR.
- **Falta, porque esta frente não toca produção:**
  - aplicar as quatro migrations e provar em produção em transação desfeita;
  - publicar `editar-membro-equipe` e `assistente-academia` (o índice da Central mudou);
  - a corrente real: trocar o e-mail de uma conta temporária da equipe e conferir a Auditoria.

## A matrícula pública confirmada pelo e-mail (07/10/2026)

O último caminho de pré-sequestro de conta, fechado pela decisão do responsável de 07/10/2026 ("matrícula pública confirmada"). Migrations `20261403010000` e `20261404010000`; funções `matricula-publica`, `convidar-membro` e `send-email`; telas da matrícula, de definir a senha, de entrar e o **Meu perfil** do painel.

**O defeito.** `matricula-publica` criava a conta com a senha que o visitante digitava e com `email_confirm: true`, sem a prova de que o e-mail era dele. Quem fizesse a matrícula pública numa academia com o e-mail e o CPF de outra pessoa ficava com uma conta usável, com senha conhecida. Quando outra academia matriculasse a pessoa de verdade, a matrícula se ligava a essa conta pelo CPF (decisão de 03/10), e o atacante passava a ver o que era da pessoa. A equipe e a gestão já tinham fechado o mesmo buraco (`20261362`, `20261395`). A ligação pelo CPF mora em `convidar-membro` (o cadastro e a importação de aluno); `academia-criar-matricula` só cria a mensalidade de um aluno que já existe e não liga conta nenhuma, e por isso não mudou.

**1. A conta nasce sem senha, e a senha nasce no link do e-mail.**
- O formulário não pede senha. A função cria a conta sem senha e sem o e-mail confirmado, com a marca `app_metadata.origem = 'matricula_publica'`, que só o servidor grava. Perfil, vínculo, aluno e aceite dos termos são gravados como antes.
- O link de criar a senha sai pelo caminho do primeiro acesso: o e-mail de recuperação do Auth (`resetPasswordForEmail`), com destino `/auth/definir-senha`. Abrir o link confirma o e-mail. É o caminho que a importação sem e-mail usa desde 04/10: conta sem senha, e o primeiro acesso manda o link.
- **Por que o e-mail de recuperação, e não o convite do Auth** (o da equipe): o convite não grava `app_metadata` ao criar a conta (seria uma segunda chamada, com o e-mail já enviado), e o texto dele, "Você foi convidado", não é o de quem se matriculou sozinho. O de recuperação é o mesmo do primeiro acesso, que o aluno usa se o e-mail não chegar.
- Se o envio falhar (o Auth limita um e-mail por minuto por endereço), a matrícula fica, a resposta traz `email_enviado: false`, e a tela aponta o primeiro acesso. Desfazer a matrícula por causa do e-mail trocaria uma falha de entrega por uma matrícula perdida.
- A tela diz "Matrícula feita! Enviamos para o seu e-mail um link para criar a sua senha", com o e-mail digitado, a caixa de spam, os 7 dias, **Não chegou? Pedir o link de novo** (o primeiro acesso) e **Já criei a senha: entrar**. Ela não entra mais no app sozinha. O erro fica na tela, ao lado do botão, e não num aviso que some: o "já existe uma conta" diz o que fazer.
- **A tela antiga com a função nova.** A página publicada antes manda a senha e entra com ela logo depois. Com a função nova, a matrícula seria criada e a entrada falharia; a pessoa tentaria de novo e leria que o e-mail já tem conta. A função recusa o pedido que traz senha, antes de criar qualquer coisa: "Esta página foi atualizada... Recarregue a página e faça a matrícula de novo". O app instalado guarda a página antiga por um tempo, e a recusa continua valendo para ele.
- **O fluxo, do formulário ao primeiro login**, conferido no código: o formulário → a função → o e-mail "Crie a sua senha" → o link → o `index.html` leva o `type=recovery` com destino `/auth/definir-senha` à tela de definir a senha (`linkAuthIndexHtml.test`) → a senha, com a conferência de vazamento → `depoisDeDefinirASenha` encerra as outras sessões e chama `ativar_gestao_pendente` (zero, para o aluno) → `refreshOrganization` → `/app`, onde o primeiro login pede o que já pedia (contrato e PAR-Q, se a academia usa). O aceite dos termos já está gravado desde a matrícula.
- **A conta que ainda não definiu a senha** não entra: a senha que o Auth grava ao criar a conta sem senha é aleatória e ninguém a conhece, e o login não oferece link mágico nem código. O login errado passou a lembrar o link do e-mail e o **Esqueceu a senha?**, que manda o link de recuperação e serve igual a quem ainda não criou a senha (a recuperação também confirma o e-mail). O link vencido na tela de definir a senha aponta o mesmo caminho, em vez de "peça a quem te convidou".

**2. A senha vazada é conferida onde a senha nasce.** A conferência pelo Pwned Passwords (k-anonimato, falha aberta) morava em `matricula-publica` e era a única do servidor. A matrícula deixou de receber senha, e a conferência saiu de lá.
- A primeira senha nasce na tela de definir a senha, que já conferia no navegador, como a de redefinir: os mesmos 5 primeiros caracteres do SHA-1, a mesma falha aberta e a mesma mensagem (`src/lib/senhaVazada.ts`). A política de conteúdo do site já permitia a chamada.
- O **Meu perfil** do painel trocava a senha sem conferir. A guarda nova o achou, e ele passou a conferir com a mesma mensagem.
- **O que se perde:** a conferência deixa de ser autoritativa. Quem chama o Auth direto, sem a tela, passa, como já valia nas telas de definir e redefinir. O recurso do próprio Auth existe só no plano pago.

**3. O e-mail que já tem conta continua 409.** Considerada a resposta sempre igual, como no primeiro acesso, com um aviso ao dono do e-mail. Ela não abre buraco, mas a pessoa que já tem conta e quer entrar nesta academia leria "Matrícula feita" sem matrícula nenhuma: a conta que existe só se liga a outra academia com o CPF conferido pela equipe (decisão de 03/10). O 409 revela que o e-mail tem conta, como antes, sob o limite por IP, o teto por academia e o captcha. A mensagem ganhou o caminho de quem ainda não criou a senha (o **Esqueceu a senha?**, que só o dono do e-mail recebe) e o de quem quer usar a conta nesta academia (a recepção). A recusa é reconhecida pelo código `email_exists` e, nas versões do Auth que não o mandam, pelo texto.

**4. A conta que nunca confirma.** Com o item 1, o atacante ainda cria uma conta sem senha e não confirmada, com o e-mail e o CPF de outra pessoa. Ela não é usável, mas fica ligada à academia do link, conta no limite de alunos dela e guarda o nome, o telefone e o CPF que alguém digitou. **A escolha foram as duas medidas**, porque cada uma sozinha deixa uma ponta:
- **A outra academia espera a confirmação** (gatilho `trg_matricula_publica_sem_outra_academia` em `alunos`). A conta com a marca e o e-mail não confirmado não recebe aluno de outra academia até o dono do e-mail criar a senha pelo link. A regra mora no banco, numa função só (`conta_da_matricula_publica_nao_confirmada`), e vale para todo caminho, inclusive a versão publicada de `convidar-membro`, que receberia a recusa como erro genérico. A versão nova pergunta antes, depois de o CPF conferir (só quem já conhece a pessoa fica sabendo), e responde 409 com o caminho. A conta de convite ou de importação, sem a marca, segue ligada pelo CPF como decidido em 03/10. Sozinha, esta medida deixaria a academia que matricula a pessoa de verdade parada para sempre, se ela nunca confirmar: a conta existe, e o Auth não convida e-mail que existe.
- **A matrícula que não confirmou em 7 dias sai** (rotina diária `arke-matriculas-nao-confirmadas`, 04:35 de Brasília). Sai a que ficou como nasceu: a marca da matrícula pública, o e-mail não confirmado, nenhuma entrada, mais de 7 dias, nenhum outro vínculo (aluno, equipe pendente ou papel da plataforma), nenhum número na catraca, nenhum arquivo na pasta do aluno e **nenhuma linha de outra tabela apontando para o aluno**. Sai junto a conta, e com ela o perfil, o vínculo e o aceite. Fica na Auditoria (`matricula_publica.apagada_sem_confirmacao`), sem dado da pessoa. Sozinha, esta medida deixaria a outra academia ligar a matrícula à conta nos 7 dias.
- **"Como nasceu" vem do catálogo** (`aluno_como_nasceu`), e não de uma lista escrita à mão: a tabela nova que apontar para `alunos` passa a segurar a matrícula sem ninguém lembrar da rotina. O caso que pesou: a pessoa que se matriculou pelo link no balcão e treina pela catraca sem abrir o e-mail. A presença, o número na catraca, a cobrança, o documento e a conversa seguram a matrícula, e ela fica; quem vê o cadastro é a academia.
- Cada exclusão roda no próprio bloco: a que uma trava desconhecida segura fica inteira, e as outras seguem. A falta de permissão não é engolida: aparece como falha da rotina na Visão Master, e não como "zero apagadas". O filtro "como nasceu" está na seleção, e não só no laço, para as matrículas antigas que ficam não tomarem a vez das novas.
- **Descartadas:** a outra academia apagar a matrícula não confirmada e seguir (uma academia apagaria o cadastro de outra, e quem se matriculou de verdade e demorou a abrir o e-mail perderia a matrícula sem a academia saber); e não criar o aluno até a confirmação, como o vínculo pendente da equipe (o RLS do aluno lê `alunos.user_id` em mais de 40 tabelas, e a academia deixaria de ver na hora quem se matriculou).
- Os 7 dias estão na tela, no e-mail, na mensagem de `convidar-membro` e na Central; a guarda confere que dizem o mesmo que a rotina.

**5. O e-mail do link diz o que é** (`send-email`). O e-mail de recuperação dizia "Redefinir sua senha... Sua senha permanecerá a mesma", o que não serve a quem acabou de se matricular nem a quem recebe sem ter pedido porque alguém usou o e-mail dele. A conta da matrícula pública que ainda não confirmou recebe "Crie a sua senha", com "Se não foi você, ignore este e-mail: sem o link, ninguém entra na conta, e a matrícula sem confirmação é apagada depois de 7 dias". Qualquer outra conta recebe o texto de sempre, sem mudança. A escolha usa a marca e o `email_confirmed_at` que o Auth manda ao hook; sem eles, sai o texto de sempre.

**6. A trava dos logs pega o nome de erro em camelCase** (achado de passagem). A expressão de `logsSemDadoPessoal.guarda` era `[a-z]+Error`, que não casa com nome com maiúscula no meio: `console.error("Teto por organização indisponível...", orgLimiteError)` mandava o objeto inteiro ao log. A expressão passou a pegar qualquer identificador terminado em `Error` ou `Erro` (e os curtos `e`, `err`, `error`, `erro`, `ex`, `falha`), também dentro de `JSON.stringify`, e achou **15 chamadas em 9 funções** (`callerRolesError`, `callerMembershipError`, `targetMembershipError`, `targetUserError`, `orgLimiteError`, `alunoAlvoError`, `treinoExistenteError`), todas trocadas por `resumoDoErro(...)`. O teste de leitura ganhou os casos em camelCase.

**Fica de fora, e por quê.**
- **As contas da matrícula pública criadas antes desta entrega.** Nasceram com o e-mail confirmado, a senha de quem digitou e sem a marca: não dá para separar a legítima da que não é, e as duas medidas do item 4 não as alcançam. Quando outra academia liga uma delas pelo CPF, o dono do e-mail recebe o aviso, e o "Esqueceu a senha?" encerra as outras sessões ao definir a senha. Para medir em produção, sem dado pessoal: contar as contas com aluno e sem `invited_at`, com `email_confirmed_at` igual ao `created_at` e criadas antes de 07/10. Decidir se vale pedir a essas contas uma senha nova é do responsável. *Medido em 07/10/2026, depois da publicação:* 182 contas casam com esse perfil, e as 182 são da academia de homologação e da de demonstração, criadas pelos roteiros com o e-mail confirmado. Nenhuma é de academia real, e não há senha nova a pedir.
- **O CPF de outra pessoa com o e-mail do próprio visitante.** O visitante se matricula com o e-mail dele e o CPF de outra pessoa, confirma o próprio e-mail, e o CPF fica preso a essa conta (`profiles.cpf` é único): a pessoa de verdade não é cadastrada com ele em lugar nenhum. Já era assim, não é pré-sequestro e não mudou aqui; é decisão de produto (conferir o CPF na Receita, ou deixar a recepção liberar).
- **A conta não confirmada que recebe vínculo de equipe ou de gestão** (pendente, por outro caminho) e é confirmada pelo link desse vínculo fica com o aluno da matrícula pública: quem confirmou é o dono do e-mail, mas a matrícula do link pode ter sido feita por outra pessoa. É raro, e a pessoa vê a academia no seletor; tratar isso pediria saber por qual link a conta foi confirmada.
- **O texto "Crie a sua senha" só para a matrícula pública.** O aluno importado, que também cria a primeira senha pelo primeiro acesso, segue recebendo "Redefinir sua senha". Estender pede a certeza de que o hook manda `email_confirmed_at` em toda conta confirmada; sem ela, o "Esqueceu a senha?" de quem já usa o app poderia sair com o texto errado.

**Defeitos do caminho.**
- O pedido nomeava `academia-criar-matricula` como a função que liga pelo CPF; quem liga é `convidar-membro`.
- A fumaça do e2e (`fumaca.spec.ts`) esperava o campo de senha no formulário da homologação e falharia no primeiro deploy. Passou a conferir o CPF, o botão e nenhum campo de senha.
- A primeira versão da rotina conferia "como nasceu" só dentro do laço, depois do `limit`: 100 matrículas antigas seguradas pela academia tomariam a vez das novas, todo dia. O filtro foi para a seleção, e a prova ganhou o caso das 150; o defeito plantado ali só é pego por ele.
- O defeito plantado no gatilho (barrar também a própria academia) passou pelos 28 primeiros casos. A prova ganhou "a ficha da própria academia segue editável", que o pega.
- O defeito "a rotina sem a confirmação na seleção" também passou: a segunda conferência, dentro do laço, não deixa apagar quem confirmou. Mas as confirmadas antigas tomariam a vez das novas, e a prova ganhou as 150 confirmadas, que o pegam.
- A Auditoria da Visão Master mostraria a ação nova pelo nome técnico; ganhou o rótulo, e o artigo de Configurações diz que ela entra ali.
- A guarda nova da senha vazada achou o **Meu perfil** trocando a senha sem conferir.
- **A rotina não apagaria nenhuma matrícula** (achado na prova em produção, antes de aplicar). Depois de 48 horas, `gerar_tarefas_ativacao_pendente` abre a tarefa "Aluno sem 1º acesso" em todo aluno em dia que não entrou, e a tarefa aponta para o aluno: a matrícula não confirmada chega sempre ao sétimo dia com ela, e `aluno_como_nasceu` dava falso. O esqueleto do PGlite não tinha as rotinas da fila, e por isso a prova local não viu. `aluno_como_nasceu` passou a aceitar essa tarefa enquanto ninguém registrou ação nem desfecho (o escalonamento só troca o responsável e não conta como ação); ela sai com o aluno, porque `tarefas.aluno_id` apaga em cascata. A tarefa em que a recepção agiu segura a matrícula: é sinal de pessoa de verdade.
- **A senha vazia não era sinal de nada** (achado na corrente real, depois de aplicar `20261403`). A rotina só apagava a conta com `encrypted_password` vazio, mas o Auth, ao criar a conta sem senha, grava o hash de uma senha aleatória: a condição nunca casava, e a rotina não apagaria nenhuma matrícula. A prova em transação desfeita e o PGlite criavam a conta direto no banco, com a senha vazia, e não viram; a conta criada pelo Auth, como a função cria, mostrou. `20261404010000` tira a condição: só o link do e-mail cria a senha, e ele confirma o e-mail e abre a sessão, que `email_confirmed_at` e `last_sign_in_at` já conferem. O caso "a com senha" do PGlite partia da mesma premissa.
- A máquina ficou sem memória para o PGlite (o processo do Node caiu ao compilar o WebAssembly) no meio da rodada dos defeitos plantados; as rodadas foram repetidas quando a memória voltou.

**Travas:**
- `identidade.guarda` ganhou "a matrícula pública só com o e-mail provado" (10 casos): a conta sem senha, sem `email_confirm` e com a marca; o link pelo caminho do primeiro acesso, depois do aluno gravado; a tela antiga recusada antes de criar a conta; o 409; a tela sem senha nem entrada; a regra e o gatilho no banco, com a mensagem do banco reconhecida pela função; `convidar-membro` perguntando depois do CPF e antes de ligar; a rotina com cada condição, o catálogo, a falha de permissão e o agendamento; e os mesmos 7 dias na tela e na mensagem.
- `senhaVazada.guarda` (nova, 6 casos): toda tela que grava senha confere antes, com a falha aberta e a mensagem; a lista das telas (o detector detecta); nenhuma função consulta o serviço; a mensagem é a de antes; só 5 caracteres saem; a política de conteúdo permite a chamada.
- `emailRecuperacao.test` (novo, 5 casos), `PublicMatricula.test` (+4) e o caso camelCase em `logsSemDadoPessoal.guarda`.
- `rotinasBanco.guarda` cobra a rotina nova no roteiro de reconstrução, gerado de novo (33 rotinas).

**Conferido:**
- **O banco, em Postgres local (PGlite), sobre um esqueleto** com `auth.users`, `storage.objects`, o `cron`, as tabelas que a migration toca com as chaves de produção (cascade e set null), a auditoria e a trava de cobrança viva copiadas das migrations. A migration rodou duas vezes seguidas, e **30 casos** passaram, cada um em transação desfeita:
  - **a regra, 4:** a conta da matrícula sem confirmar, a confirmada, a do convite ou da importação (sem a marca) e a que não existe;
  - **o gatilho, 6:** a própria matrícula cria o aluno; outra academia é recusada; depois de confirmar, passa; a conta de convite sem confirmar segue ligada pelo CPF; a ficha da própria academia segue editável; trocar o dono de um aluno de outra academia para a conta não confirmada é recusado;
  - **a rotina, 18:** a matrícula como nasceu sai com a conta, o perfil, o vínculo, o aceite e a identidade, e a auditoria não tem dado da pessoa; ficam a de 6 dias, a confirmada, a com senha, a de quem entrou, a sem a marca, a com presença, a com comando de catraca (chave que solta a linha), a com mensalidade, a com número na catraca, a com arquivo, a com equipe pendente em outra academia e a com papel da plataforma; a mistura (três saem, duas ficam, a segunda rodada não apaga nada); a trava desconhecida segura uma e as outras saem; 150 antigas seguradas pela academia e 150 antigas já confirmadas não tomam a vez da nova; a mensalidade viva no Asaas segura também pela trava do banco;
  - **permissões e rotina, 2:** anon, authenticated e o PUBLIC não executam nenhuma função nova, o servidor executa as três que chama; a rotina agendada uma vez só, às 07:35 GMT.
- **10 defeitos plantados, os 10 pegos:**
  - a expressão antiga da trava dos logs (o teste de leitura deixa passar `orgLimiteError` e `callerMembershipError`);
  - o `email_confirm: true` de volta na criação da conta (`identidade.guarda`);
  - o **Meu perfil** sem a conferência de senha vazada (`senhaVazada.guarda`);
  - `convidar-membro` ignorando a resposta do banco (`identidade.guarda`);
  - o texto da matrícula para quem já confirmou o e-mail (`emailRecuperacao.test`);
  - na migration, pela prova do PGlite: a regra sem a confirmação do e-mail (2 casos), o gatilho barrando a própria academia (1), a rotina sem o prazo de 7 dias (2), a rotina sem "como nasceu" na seleção (1) e a rotina sem a confirmação na seleção (1).
- **Testes:** 25 novos (10 em `identidade.guarda`, 6 em `senhaVazada.guarda`, 5 em `emailRecuperacao.test`, 4 em `PublicMatricula.test`), e o caso camelCase na leitura de `logsSemDadoPessoal.guarda`. Suíte inteira: **1.326 testes em 176 arquivos, todos passando**, rodada em 9 lotes de 20 arquivos com um processo só, porque a suíte de uma vez derrubou o Node por falta de memória da máquina. Na primeira rodada falhou só o índice da Central, que acusou o artigo da Visão Master mudado depois do `npm run ajuda:indice`; gerado de novo, passou.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 56 funções e a auditoria das dependências (0 vulnerabilidades).
- **O banco de produção, em transação desfeita, antes de aplicar** (07/10/2026). Foram 3 contas criadas como a função cria, com 8 dias, na homologação. Depois rodaram as 10 rotinas que abrem tarefa ou mexem em aluno: ativação, barreira, atestado, inércia, acolhimento, engajamento, avanço de fases, situação por mensalidade, remoções de fim de matrícula e escalonamento.
  - **A conta não confirmada:** fica só com a tarefa de ativação, já escalonada, e `aluno_como_nasceu` dá verdadeiro.
  - **A conta em que a recepção registrou ação na tarefa:** dá falso e fica.
  - **A outra academia:** é recusada com a mensagem da matrícula online, e a conta confirmada passa.
  - **A rotina:** apagou 1. Sumiram a conta, o perfil, o vínculo, o aluno e a tarefa; as outras duas ficaram; a Auditoria tem 1 linha só com `dias_sem_confirmacao`; a segunda rodada apagou 0.
  - **Permissões e agendamento:** as quatro funções ficam fechadas para anon e authenticated, e o agendamento é `35 7 * * *`.
  - **Defeito plantado:** a migration sem a exceção da tarefa de ativação. Com ela, `aluno_como_nasceu` dá falso, a rotina apaga 0 e a conta fica.
- **A publicação (07/10/2026), na ordem:** `20261403010000` aplicada; `convidar-membro` (v30), `send-email` (v25) e `matricula-publica` (v26); o app (#354); `assistente-academia` e as 7 funções que só tiveram o log trocado.
- **A corrente real, com a homologação e uma academia temporária, 10 casos.** A conta foi criada pelo Auth como a função cria, porque o captcha não é contornado. Contas e academia temporárias foram apagadas no fim (0 e 0).
  - **9 passaram:**
    - o aluno recém-criado está como nasceu;
    - o Auth mandou o link, e o Resend entregou "Crie a sua senha do app da ARKE Homologação";
    - a tela antiga é recusada com "Esta página foi atualizada", sem criar conta;
    - a outra academia recebe 409 com o caminho, sem criar aluno;
    - pelo link, a senha vazada é recusada na tela ("já apareceu 2.266.543 vezes");
    - a senha boa confirma o e-mail e leva a `/app`;
    - confirmada, a outra academia liga a conta pelo CPF (200), e sai o aviso "Sua matrícula... está no app";
    - o login errado lembra o link e o "Esqueceu a senha?";
    - o formulário no celular e no computador não tem senha, tem a dica e não rola de lado.
  - **1 falhou e virou `20261404`:** a conta não nasce com a senha vazia (ver "A senha vazia não era sinal de nada").
- **`20261404`, em produção em transação desfeita, com a conta criada pelo Auth.**
  - A senha da conta sem senha é um hash de 60 caracteres.
  - A versão no ar apagou 0 (o defeito); a nova apagou 1, a confirmada ficou, e a segunda rodada apagou 0.
  - anon e authenticated seguem sem executar.
  - A guarda passou a recusar `encrypted_password` na rotina. O defeito plantado, a condição de volta na 1404, foi pego.
- **A matrícula de verdade pelo link, com o captcha, no celular (07/10/2026, 18:55):** o cartão "Matrícula feita!" no tema escuro, com o e-mail quebrando a linha e os botões empilhados; o e-mail "Crie a sua senha" na caixa de entrada (não no spam) em um minuto, com a marca da academia; no banco, a conta com a marca, sem confirmar, sem entrada, com o aluno na homologação, os 2 aceites e `aluno_como_nasceu` verdadeiro. A conta de teste foi apagada em seguida.

## As sobras da frente B (07/10/2026)

Quatro sobras pequenas de segurança e qualidade, três delas da lista "Fica de fora" das últimas sobras de banco (acima). Migrations `20261405010000` a `20261407010000`; função `editar-membro-equipe`; telas Acompanhamento ARKE, Agenda, Acervo (painel e Visão Master), Simulação de perfil e Auditoria da Visão Master.

**1. O Acompanhamento ARKE sem o motivo de saúde para a academia** (`20261405`). `get_atendimentos_mentor_organizacao` entrega à equipe da academia os atendimentos que o mentor da ArkeFit encerrou com os alunos do Método, com o tipo, o motivo e o desfecho. Ela entregava, a qualquer pessoa da equipe (a recepção pela API, a gestão pela tela), a tarefa de dor ("Relatou dor no joelho", tipo `dor`, com o desfecho do mentor) e a de anamnese. No Método, a anamnese e a saúde do aluno são do mentor.
- **A escolha: a academia vê a linha, com o motivo trocado.** O tipo vira `outro` (o selo da tela diz "Atendimento", e não "Relato de dor"), o motivo vira "Atendimento de saúde com o mentor" e o desfecho sai. **Por que não esconder a linha:** o cartão "Atendimentos feitos" (`get_valor_mentor_organizacao`) conta todos, e a lista passaria a desmentir o cartão; e a tela existe para ser a prova de serviço que a academia vê, e a prova de que o aluno foi atendido, e quando, não é dado de saúde.
- **A recepção não recebe a linha de saúde, nem com o texto neutro**, a mesma regra do RLS de `tarefas` (`20261398`): a recepção não lê nem que a tarefa de saúde existe. A tela é só da gestão, e a recepção chegaria aqui só pela API. A ArkeFit recebe o mesmo que a gestão: a função é a janela da academia, e o conteúdo inteiro está no console do Mentor.
- A classificação é a de `tarefa_de_saude()` (`dor` e `anamnese`), e não uma lista nova. A tela tirou a dor e a anamnese dos rótulos, que não chegam mais, e o aviso do rodapé e o artigo do Método dizem o que a academia vê no atendimento de saúde.
- A assinatura da função não mudou: a tela publicada funciona com a migration nova antes do deploy do app, e `types.ts` fica como está.

**2. A equipe não apaga mensagem do aluno pela API** (`20261406`). A regra de exclusão do chat de treino e do de nutrição era a de leitura (`20261400`): quem lê, apaga qualquer mensagem. Pela API, a recepção e o professor apagavam a mensagem que o aluno mandou, a nutricionista a conversa de nutrição inteira, e o aluno a orientação do professor. O canal do Mentor nunca teve regra de exclusão (`20261219`: "conversa de acompanhamento é registro").
- **O que a tela faz hoje:** nada exclui. O chat do painel, o da ficha e o do app só incluem e marcam como lida.
- **A escolha: ninguém apaga pela API, nem a do outro lado nem a própria.** Deixar a equipe apagar a própria mensagem abriria uma operação que nenhuma tela pede, e a orientação dada ao aluno sumiria do registro do atendimento. O aluno também não apaga a mensagem do professor, pelo mesmo motivo.
- A regra de exclusão sai dos dois chats (uma regra por operação: leitura, inclusão e alteração ficam como estão). A permissão de excluir sai de `anon` e `authenticated` nos três chats, o do Mentor inclusive: sem a regra, o RLS responderia 200 com zero linhas, e sem a permissão o pedido é recusado com 42501, e quem tenta sabe que não apagou.
- **O que continua apagando:** a saída do aluno (`anonimizar_dados_do_aluno`, `excluir_aluno_da_academia`), que roda como dono das tabelas, e as exclusões em cascata (do aluno, da academia, da dieta), que o Postgres faz como dono da tabela e sem o RLS. A prova local confere as três.

**3. A troca de papel e de nome da equipe na auditoria** (`editar-membro-equipe` e `20261407`). A função registrava só a troca do e-mail (`20261401`).
- A função passa a registrar `equipe.nome_alterado` e `equipe.papel_alterado`, cada um depois de a troca gravar, por um ajudante que guarda quem trocou (`ator_user_id`) e de quem (`entidade_id`, a conta). O papel vai como `{"papel": {"de": "professor", "para": "gestor"}}`, o formato que a Auditoria da Visão Master já mostra como "papel: professor → gestor".
- **O nome não vai para a trilha**, nem o novo nem o antigo: as outras ações guardam a pessoa só pelo id (a simulação perdeu o e-mail em `20261376`, a troca de e-mail em `20261397`), a trilha não tem prazo, e o nome mora na conta. O registro diz `mudou: "nome"`, o papel da pessoa e se foi a ArkeFit.
- O mesmo papel de antes deixou de gravar e de ir para a trilha.
- **O segundo caminho do papel.** A regra de alteração de `organization_members` deixa a gestão e a ArkeFit alterarem o vínculo direto pela API: a recepcionista virava gestora sem rastro. Um gatilho (`trg_auditar_troca_de_papel`, `after update of role`) registra a troca feita com sessão de usuário, no mesmo formato e marcada `pela_api`. A troca pela função roda com a service role, sem `auth.uid()`: o gatilho a deixa passar, e quem registra é a função, que sabe quem pediu; sem isso, a mesma troca entraria duas vezes, uma sem autor. O nome não tem esse caminho: a regra de alteração de `profiles` só deixa cada um mudar o próprio.
- A Auditoria da Visão Master ganhou os dois rótulos, e o texto do topo diz que as trocas da equipe entram ali; os artigos da Equipe e das Configurações da Visão Master também.

**4. A trava "erro não é vazio" pega a lista filtrada** (`estadoVazio.guarda`). A guarda olhava só o dado do `useQuery`, e a tela cujo vazio vinha de uma lista que sai dele (`const filtrados = dados.filter(...)` e `filtrados.length === 0`) passava dizendo "Nenhum..." com a consulta falhando.
- A guarda passou a seguir as listas que saem do dado: por `filter`, `map`, `slice`, `sort` e afins, por `useMemo`, por `(dados ?? [])`, por espalhamento (`[...dados]`) e de uma derivada para outra. Ficam de fora, de propósito, o item achado (`find`: "o aluno precisa autorizar" não é estado vazio) e o nome que só cita a consulta (uma mutação).
- **Ela achou cinco**, e as cinco passaram a mostrar `<ErroAoCarregar>` quando a consulta de origem falhou sem dado guardado: a Agenda, nas turmas do dia ("Nenhuma turma cadastrada para este dia da semana") e nos alunos de cada turma ("Nenhum aluno agendado ainda", com a lotação "0/20"); o Acervo do painel ("Nenhum exercício próprio cadastrado ainda"); o Acervo da Visão Master ("Nenhum exercício encontrado"); e a Simulação de perfil ("Nenhum usuário cadastrado nessa categoria ainda"). O artigo dos primeiros passos do painel cita a agenda e o acervo.

**Defeitos do caminho.**
- A primeira versão da guarda nova seguia **todo** nome que citava o dado e achou 16 telas, quase todas falsas: a mutação que lê a lista, o consentimento vigente (`find`), a telemetria do equipamento. A derivação passou a ser só de lista para lista, e sobraram as 5 de verdade.
- A busca de quem vê a saúde achou um segundo buraco no item 1: o **tipo** `dor` também é dado de saúde. Esconder o motivo e o desfecho e deixar o selo "Relato de dor" não resolvia; o tipo passou pela mesma troca.
- A guarda da troca do e-mail (`perfilSimulado.guarda`) lia a chamada `"registrar_auditoria"` logo depois da troca e quebraria com o ajudante. Ela foi para `auditoriaDaEquipe.guarda`, junto das novas, lendo o ajudante.
- O defeito plantado "o registro do nome também antes da troca" passou pela primeira versão da guarda nova, que achava o registro certo depois da troca e não via o a mais. A guarda passou a cobrar um registro só por ação, e pegou.
- O defeito plantado "o gatilho dispara em qualquer alteração do vínculo" (sem o `when`) não muda o resultado: a função confere de novo se o papel mudou, e o `when` só poupa a chamada. O defeito que tira as duas conferências registra a inativação como troca de papel, e a prova pega.
- A busca pelas tabelas de mensagens achou também que **a equipe exclui o aluno pela API** (abaixo).

**Fica de fora, e por quê.**
- **A equipe inteira, a recepção inclusive, exclui o aluno pela API** (regra de exclusão de `alunos`: `is_org_staff` ou `admin_arke`). A exclusão em cascata leva as conversas, as tarefas e o resto, sem passar pela saída do aluno (`excluir-aluno`: o Asaas, os arquivos, a auditoria). Os gatilhos `before delete` seguram a cobrança viva e mandam tirar a biometria, mas o resto da saída não roda. Nenhuma tela faz isso. Fechar é restringir a regra (ou tirar a permissão, como aqui) e conferir que nenhum caminho do app exclui aluno direto; é mudança do que o banco permite hoje, e fica para decidir. *Resolvido em 07/10/2026: ninguém exclui o aluno pela API (ver "Auditoria de prontidão, frente D", abaixo).*
- **`get_valor_mentor_organizacao`** segue com `is_org_staff`: entrega só contagens, sem aluno nem motivo.
- **A troca de papel pelo cadastro de membro** (`cadastrar-membro-equipe`, o upsert do vínculo pendente) roda com a service role e não passa pelo gatilho; ele recusa quem já está ativo, e a pessoa pendente ainda não acessa nada.
- **A Auditoria da Visão Master mostra pelo nome técnico** cerca de trinta ações sem rótulo (`equipe.ativada_pelo_email`, `aluno.excluido`, as do Vigia e dos agentes...). Esta entrega rotulou as dela; as outras ficam para uma passada só.

**Travas:**
- `tarefasPorDono.guarda` ganhou "o Acompanhamento ARKE não entrega a saúde" (3 casos): o tipo, o motivo e o desfecho só saem por `case when tarefa_de_saude(...)`, sem coluna da tarefa no lado da saúde; a linha de saúde sai só para quem atende a saúde (`atende_saude`, nunca `is_org_staff`); e o leitor acha as três colunas soltas na versão de `20261230`.
- `caixaDeMensagens.guarda`: uma regra por operação nos dois chats, **sem** a de exclusão; nenhuma regra de exclusão (nem `for all`) nos três chats, e a última permissão de excluir para `authenticated` é um `revoke`; e o leitor acha a permissão devolvida (`grant ... delete`, `grant all`) e a regra de volta.
- `auditoriaDaEquipe.guarda` (nova, 7 casos): o ajudante grava quem e de quem pelo id; cada troca (e-mail, nome, papel) registra uma vez, depois de gravar, sem e-mail nem nome; o papel com `{de, para}`; o gatilho, a conferência da sessão e o `revoke`; cada ação com rótulo na Auditoria; e o leitor acha o registro que falta e o nome na trilha. A troca do e-mail saiu de `perfilSimulado.guarda` para cá.
- `estadoVazio.guarda`: `nomesDoDado()` e o caso novo do detector (a lista filtrada, a tratada, a encadeada por `useMemo`, `?? []`, espalhamento e `slice`, a com `?.`, e os dois que não são estado vazio).

**Conferido:**
- **O banco, em Postgres local (PGlite)**, no esqueleto das frentes anteriores com o tipo da tarefa de produção, `concluida_em`, `tarefa_de_saude()`, o canal do Mentor e as permissões de `20261400`. As regras de acesso foram geradas pelo leitor das guardas no estado de antes desta entrega (até `20261403`). Cada migration rodou duas vezes seguidas, e **85 casos** passaram, cada um em transação desfeita:
  - **Acompanhamento, 31 casos.** Antes, a gestão lia "dor no joelho" e o tipo `dor`, e a recepção a anamnese. Depois, a gestão, o professor e a nutricionista recebem os 3 atendimentos da janela (e não a dor da academia nem a de 40 dias), as duas de saúde com o texto neutro, o tipo `outro` e sem desfecho, e o ciclo travado com o motivo e o desfecho; nenhum texto de saúde em nenhum campo. A recepção recebe só o ciclo travado. O mentor e o Super Admin recebem o mesmo que a gestão. A gestão de outra academia, o aluno, o professor que saiu e o mentor sem as duas etapas são recusados (42501); a outra academia recebe 0. O limite e a ordem seguem, e em 90 dias a dor antiga entra neutra. `anon` não executa; a função segue `security definer` com o `search_path` fixo;
  - **conversas, 32 casos.** Antes, o professor e a recepção apagavam a mensagem do aluno, a nutricionista a da nutrição e o aluno a do professor. Depois, os três chats ficam com leitura, inclusão e alteração; 11 tentativas de exclusão (o professor, a recepção, a gestão, a nutricionista, o aluno, a ArkeFit e o aluno do Método, a do outro e a própria) e a do `anon` são recusadas com 42501; o professor lê, responde e marca como lida, e o aluno escreve na nutrição; a saída do aluno (função do dono) apaga, a exclusão da dieta leva a conversa em cascata, a da academia leva os três chats, e a service role apaga; nenhuma permissão de excluir pela API, e a `lida` segue;
  - **troca de papel, 22 casos.** Antes, a gestão fazia da recepcionista uma gestora pela API sem rastro. Depois, a troca vai para a trilha uma vez, com quem, de quem, a academia e `{"papel": {"de": "recepcao", "para": "gestor"}, "pela_api": true, "pela_arkefit": false}`; o mesmo papel e a inativação não entram; a troca da service role não entra (a função registra); a da ArkeFit entra com `pela_arkefit: true`; a gestão de outra academia, a recepção, o professor e a ArkeFit sem as duas etapas não trocam nem registram; a gestão não lê a trilha; os registros da função (nome e papel) ficam como vieram; a função do gatilho fechada para a API; um gatilho só.
- **Defeitos plantados: 23, os 23 pegos.**
  - **Pelas guardas, 16:** a Agenda de antes (a guarda nova acusa as turmas e os agendamentos; **a guarda antiga, com a mesma tela, passa**); no Acompanhamento, o motivo solto, o tipo solto, o desfecho no lado da saúde, a recepção vendo a saúde e o filtro de saúde tirado; nas conversas, a permissão não revogada, a regra da dieta mantida e o chat do Mentor fora do `revoke`; na auditoria, o papel sem registro, o nome na trilha, o registro do nome a mais antes da troca (pego depois de a guarda apertar), o registro do papel antes da troca, o gatilho sem conferir a sessão, o gatilho sem o `revoke` e a ação sem rótulo.
  - **Pela prova do PGlite, 7:** no Acompanhamento, o motivo solto (9 casos), a recepção vendo (2) e o tipo solto (6); nas conversas, só a regra sem a permissão (13: a exclusão "dá certo" com zero linhas) e a regra do treino mantida (1); na troca de papel, o gatilho sem conferir a sessão (a troca da função entra sem autor) e sem conferir a troca (a inativação entra como troca).
- **Os scripts da prova em produção** (no relatório da entrega: um bloco por item, que monta os casos na academia de homologação, confere e termina sempre em exceção, para desfazer) **rodaram no mesmo esqueleto**, com a academia `homologacao` e as contas e2e: sem a migration, os três acusam o defeito; com a migration colada no começo, passam (6, 13 e 5 casos); e nada fica gravado depois.
- **Testes:** 12 novos (1 em `estadoVazio.guarda`, 3 em `tarefasPorDono.guarda`, 2 em `caixaDeMensagens.guarda`, 7 em `auditoriaDaEquipe.guarda`, um deles vindo de `perfilSimulado.guarda`). Suíte inteira: **1.338 testes em 177 arquivos, todos passando**, em 9 lotes de 20 arquivos com um processo só. A prova do PGlite rodada junto com a suíte derrubou o Node por falta de memória, e foi repetida depois dela.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes, nenhum dos arquivos desta entrega), o `deno check` das 56 funções e a auditoria das dependências (0 vulnerabilidades).
- **O banco de produção, em transação desfeita, antes de aplicar (07/10/2026).** Os três roteiros rodaram sem a migration e com ela:

  | Item | Sem a migration (o defeito) | Com a migration |
  |---|---|---|
  | 1, Acompanhamento | 3 de 6 falham: a gestora recebe 2 linhas com saúde e 0 neutras, e a recepção 2 linhas de saúde | 6 casos ok |
  | 2, conversas | 10 de 13 falham: há regra de exclusão, a API tem a permissão, e a gestora e a aluna apagam | 13 casos ok |
  | 3, papel | 4 de 5 falham: a troca pela API não deixa registro, e não há função do gatilho | 5 casos ok |

  Depois, nada ficou gravado: nenhuma tarefa de prova, a conta e2e da jornada seguiu como aluna, nenhum registro de papel na auditoria, e as duas regras de exclusão seguiam no ar até aplicar.
  - **Defeito do caminho:** o roteiro do item 1 gravava as três tarefas de prova com a mesma `origem_evento`, que o índice único `(organization_id, origem_evento)` de produção recusa; o esqueleto do PGlite não tinha o índice. Cada tarefa ganhou a sua origem.
- **A publicação (07/10/2026):**
  - as três migrations;
  - `editar-membro-equipe` (v31) e `assistente-academia` (v31);
  - o app (#356). A Vercel não recebeu o aviso do merge e não publicou; o deploy de produção do mesmo commit foi pedido direto à Vercel.
- **A corrente real**, com academia e contas temporárias (apagadas no fim, 0 e 0), 4 casos:
  - pela função, o nome e o papel mudam, e cada troca entra uma vez na Auditoria pela gestora, sem o nome da pessoa;
  - pela API, a troca de papel entra com `pela_api: true`;
  - a gestora e a aluna recebem 403 ao apagar a mensagem do aluno, e marcar como lida segue (200).
- **A tela, no computador e no celular:**
  - a Agenda, com a consulta das turmas falhando de verdade (pedido abortado no navegador), mostra "Não foi possível carregar as turmas." com "Tentar de novo", e não "nenhuma turma".
  - O Acompanhamento não mostra a lista em produção: nenhuma academia tem aluno no Método ainda, e a tela diz "Nenhum aluno seu está no Método ARKE ainda". A resposta da função foi provada no banco; a tela foi conferida com a resposta simulada no navegador, no formato novo. A linha de saúde sai com o selo "Atendimento" e o texto neutro, sem desfecho, sem rolagem lateral e com o rodapé novo.

## Auditoria de prontidão, frente D: os achados baixos de banco e de funções (07/10/2026)

Oito achados "baixos" da auditoria de prontidão. Migrations `20261408010000` e `20261409010000`; funções `catraca-sincronizar-alunos`, `send-email`, `criar-organizacao-superadmin`, `convidar-membro`, `editar-membro-equipe`, `superadmin-suporte-tenant`, `vapid-public-key` e `vigia-aprovar`; artigo das Catracas. O item 7 (o bloqueio B2B) ficou mapeado, sem implementação, para decisão do responsável.

**1. O aluno só sai pela saída** (`20261408`). A regra de exclusão de `alunos` (`20261205`) era `is_org_staff` ou `admin_arke`: pela API, a equipe inteira, a recepção inclusive, apagava o aluno com um DELETE, e a cascata levava as conversas, as tarefas, os treinos, a dieta e a anamnese sem passar pela saída (`excluir-aluno`, `anonimizar-aluno`): o cliente no Asaas ficava com nome e e-mail, os arquivos ficavam nos buckets, e nada ia para a auditoria. Era a sobra da frente B (acima).
- **Conferido antes de cortar:** nenhuma tela nem função apaga `alunos` direto. As telas chamam as duas funções da saída, que apagam pelo banco em `excluir_aluno_da_academia` e `anonimizar_dados_do_aluno`, com a permissão do dono. O único outro `delete from public.alunos` é a limpeza da matrícula pública não confirmada, também do dono.
- **A escolha, no molde das conversas** (`20261406`): a regra de exclusão sai (leitura, inclusão e alteração ficam), e a permissão de excluir sai de `anon` e `authenticated`. Sem a permissão, o pedido é recusado com 42501, e não respondido com 200 e zero linhas.
- **O que continua apagando:** a saída do aluno, a limpeza da matrícula pública, a service role e as cascatas (a da academia, a da conta), que o Postgres faz como dono da tabela. A trava da cobrança viva (`trg_impedir_exclusao_com_cobranca_viva`) e a da biometria seguem valendo para todos.

**2. As tabelas com o RLS ligado e sem regra.** São 18, todas de propósito: cada uma é só do servidor (a service role das edge functions ou funções `security definer`), e o motivo está no texto da migration que a criou. Entre elas, o token do webhook da conta da academia, o freio, o contador do número na catraca, o segredo do QR do check-in, os registros do Marco Civil e a sessão simulada. Nenhuma tela lê uma delas. Nenhuma mudança no banco.
- A trava é nova: `rlsSemRegra.guarda` guarda a lista com o motivo de cada uma, e falha com a tabela nova que liga o RLS sem regra e não entra na lista. É o defeito silencioso que ela pega: a tela que lê uma tabela dessas não recebe erro, recebe vazio. A guarda também cobra que toda tabela do `public` nasça com o RLS ligado (as 134 estão) e que nenhuma tela leia uma tabela da lista.
- `scripts/migracao/tabelas.mjs` lê as tabelas na ordem da reconstrução, como `regras.mjs` lê as regras, e segue a regra quando a tabela troca de nome.

**3. As sequências da service role** (`20261409`). Das 8 colunas que se numeram sozinhas, as 5 com `bigserial` tinham o `grant usage`. As 3 do Vigia (`vigia_ocorrencias`, `vigia_analises`, `vigia_acoes`), apontadas pela auditoria, numeram por `generated always as identity`, e o Postgres não confere a permissão da sequência de uma coluna identity: a prova local insere com a service role sem o grant, e o `bigserial` sem o grant é recusado com 42501. O grant entra mesmo assim, só para a service role, para a regra ser uma só, sem exceção por tipo de coluna. A trava nova, `sequencias.guarda`, pega a tabela nova com `serial`, `bigserial` ou identity sem o grant, também a coluna acrescentada por `alter table` e o grant tirado depois.

**4. A catraca desativada não recebe a lista de alunos** (`catraca-sincronizar-alunos`). A sincronização lia o `status` da catraca e não o usava: a catraca desativada pela gestão seguia recebendo o CPF e a situação de cada aluno a cada 5 minutos. A validação (`catraca-validar-acesso`) já a recusava com "Dispositivo inativo.", e o canal de ordens (`catraca-comandos`) já não lhe dava ordem.
- Agora a sincronização responde **403 "Dispositivo inativo."**, a mesma mensagem da validação, antes de montar a lista e o hash. O token desconhecido segue com 401.
- O sinal de vida (`ultimo_heartbeat_em`) continua gravado antes da recusa, como a telemetria do canal de ordens: a tela mostra que o computador está ligado.
- O artigo das Catracas diz o que a catraca desativada deixa de fazer, e que, ativada de novo, o cadastro chega na próxima rodada.

**5. A resposta sem a mensagem crua do erro.** `criar-organizacao-superadmin` devolvia a mensagem do Auth quando a conta do gestor não nascia. A busca pelo mesmo padrão achou mais 7 respostas em 5 funções: a troca de e-mail (`editar-membro-equipe` e `superadmin-suporte-tenant`), o convite do aluno (`convidar-membro`), a exclusão da organização (a mensagem crua do banco), a chave das notificações (`vapid-public-key`) e a aprovação do Vigia (`vigia-aprovar`, que repassava qualquer erro do banco). A mensagem crua pode trazer o e-mail digitado ("Email address \"x@y\" is invalid"), fala em inglês e descreve o servidor.
- O erro do Auth passa por `respostaDoErroDoAuth()` (`_shared/erroDoAuth.ts`): e-mail já cadastrado é 409, e-mail inválido 400, limite 429, outra recusa do Auth 400 e falha do Auth 502, sempre com mensagem nossa. "Já cadastrado" passou a ler também o código novo do Auth (`email_exists`), e não só a mensagem antiga.
- **A recusa nossa segue para a tela**, porque diz o que fazer: o `raise exception` das funções do banco (P0001, 42501), o limite de alunos do plano (o gatilho, `23514`) e a cobrança viva que segura a exclusão da organização (`23001`). Ela se declara pelo código na mesma linha da resposta; a outra falha do banco vira mensagem nossa, com `resumoDoErro()` no log.
- A trava nova, `respostaSemErroInterno.guarda`, lê as mais de 500 respostas das funções (`jsonResponse`, `errorResponse`, `new Response`) e falha na que leva `.message` ou `String(erro)` sem declarar o código. Ela também testa `respostaDoErroDoAuth()`.

**6. O e-mail do login com prazo** (`send-email`). As 16 chamadas ao Resend por `fetch` já tinham prazo, desde a regra de 05/10 (`prazoChamadas.guarda`). O envio sem prazo era o do e-mail do login (o convite, a confirmação, a recuperação de senha), que ia pelo SDK do Resend: o SDK não aceita prazo, e a guarda, que procura `fetch(`, não o via. Um Resend lento segurava a função até o limite da plataforma, e o Auth desistia do hook antes. Agora vai pela API, com `AbortSignal.timeout` de 4 segundos por tentativa e as mesmas novas tentativas no 429. A guarda passou a cobrar todo envio ao Resend com prazo e nenhum uso do SDK.

**7. O bloqueio B2B: mapeado, e não implementado.** A regra é que a academia inadimplente no plano B2B tem a equipe bloqueada depois de 7 dias de tolerância, a ArkeFit nunca é bloqueada, e o aluno não é bloqueado por isso.
- **Como é calculado:** `organizacao_inadimplente_b2b(org)` (`20261213`, só a service role executa) diz se há cobrança B2B `pendente` ou `atrasado` vencida há mais de 7 dias. `get_bloqueio_organizacao()` responde por quem chama: as academias em que a pessoa é gestor, professor ou nutricionista, fora a ArkeFit e a academia em trial.
- **O que a tela barra:** `OrganizacaoBillingGate` envolve as rotas `/admin` e troca o painel inteiro pela tela "Acesso suspenso", com o link da fatura e o "Já paguei, verificar novamente". Antes do prazo, o painel avisa no topo. O app do aluno não passa por ele. O desenho de 20/09 diz que o gate é de experiência, e não fronteira de segurança.
- **O que a equipe bloqueada ainda grava pela API:** tudo o que o RLS dá à equipe, cerca de 46 tabelas com regra de inclusão, alteração ou exclusão para ela (alunos, tarefas, treinos, dietas, agendamentos, turmas, comunicados, planos, a folha da equipe...), as funções `security definer` que a equipe chama e as edge functions que gravam com a service role depois de conferir o papel (o convite do aluno, a matrícula, a cobrança avulsa, o cadastro da equipe, o comunicado). Nenhuma confere o bloqueio. O banco não bloqueia nada.
- **Um buraco na própria tela:** a recepção não é bloqueada. O papel nasceu em 24/09, e a lista de `get_bloqueio_organizacao` (gestor, professor, nutricionista) é de 20/09. A recepção de uma academia bloqueada segue com o painel.
- **Por que não foi implementado.** O caminho contido seria uma função, `equipe_bloqueada_b2b(org)` (quem chama é equipe ativa da academia, ela não está em trial, há inadimplência, e quem chama não é da ArkeFit), e uma regra restritiva de escrita por tabela operacional. Ele não fecha o que promete, e o risco é real:
  - as edge functions gravam com a service role, que pula o RLS, e as funções `security definer` também. Cada uma teria de conferir o bloqueio, e é aí que mora boa parte da escrita da equipe;
  - as regras restritivas de alteração respondem 200 com zero linhas, a armadilha do CLAUDE.md;
  - `tarefas`, `presencas` e `checkins` também nascem de gatilhos de ações do aluno, que rodam com a sessão dele. A pessoa que é aluna e equipe da mesma academia teria o próprio check-in recusado;
  - cobrar a recepção no banco e não na tela deixaria a recepção com o painel aberto e toda gravação recusada. Antes, é preciso decidir se a recepção entra no bloqueio;
  - pôr o bloqueio dentro de `is_org_staff()` seria uma função só, mas mudaria o RLS de todas as tabelas da equipe (a leitura junto), e o que a academia ainda precisa com a mensalidade vencida (a exportação de dados depois do encerramento, por exemplo) teria de ser conferido caminho por caminho.
- **O caminho do pagamento não depende de nada disso:** a fatura abre na página do Asaas, e o webhook grava com a service role. Qualquer proposta o mantém.
- **A proposta, para decidir:** (a) pôr a recepção no gate da tela: uma linha em `get_bloqueio_organizacao`, decisão de produto; (b) se o bloqueio tiver de valer no servidor, começar pelas edge functions que gravam em nome da equipe (o convite do aluno, a matrícula, a cobrança avulsa, o cadastro da equipe), com uma conferência só em `_shared`, e só depois as regras restritivas, nas tabelas que só a equipe grava (treinos, dietas, modelos, turmas, comunicados, planos), deixando de fora as que nascem de ação do aluno. O risco hoje é comercial, e não de dado: quem precisa da API para trabalhar de graça teria de saber usá-la.
- *Decidido em 08/10/2026: (a), com a recepção em modo essencial, e não na tela de suspensão (migration `20261420010000`; ver "A recepção em modo essencial no bloqueio B2B" em [cobranca.md](cobranca.md)). O (b) fica para depois do primeiro cliente pagante (`docs/DECISOES_PENDENTES.md`) e, quando vier, barra só a gestão, e não o que a recepção usa no modo essencial.*

**8. Os índices sem uso e o `pg_net` no `public`: ficam, com o motivo.**
- **Os índices sem uso ficam até depois do lançamento.** O advisor marca como sem uso o índice que não foi lido desde que as estatísticas começaram, e o banco ainda não tem uso real: nenhuma academia em operação, só a homologação e a demonstração. Com volume, são esses índices que sustentam as chaves estrangeiras, as regras de acesso e as telas. Remover agora seria adivinhar. A revisão fica para 30 a 60 dias de uso real, com `pg_stat_user_indexes`, e mantém o índice de chave estrangeira e o de restrição única.
- **O `pg_net` fica no `public`, aceito.** O que o advisor vê é só o registro da extensão: as funções e as tabelas dela já moram no schema `net`, e as rotinas chamam `net.http_post`. O `pg_net` não se muda com `alter extension ... set schema`; o caminho é apagar a extensão e criá-la de novo em `extensions`. Isso apaga a fila e as respostas das chamadas em curso, depende de o Supabase devolver as permissões do schema `net`, e pede uma janela sem rotina rodando. O ganho seria só o aviso do advisor. O roteiro de reconstrução (`01-antes-da-restauracao.sql`) cria a extensão como produção a tem.

**Defeitos do caminho.**
- **A primeira contagem do item 2 deu 19**, e não 18: `leads_comerciais_mensagens` aparecia sem regra. A regra de leitura dela nasceu como `leads_site_mensagens` (`20261298`) e foi junto na troca de nome (`20261301`), como o Postgres faz. O leitor de regras das guardas (`regras.mjs`) não segue troca de nome; o leitor novo de tabelas segue, e a guarda prova com uma troca plantada.
- **As 3 sequências do Vigia não quebravam nada.** A prova local mostrou que a coluna identity insere sem o grant. O achado da auditoria era só de forma, e o grant entrou para a regra ficar uma só.
- **O Resend sem prazo não estava onde a busca procurava.** As 16 chamadas com `api.resend.com` tinham prazo. O que não tinha era o SDK, que não tem `fetch(` nem o endereço no código.
- **O texto genérico teria escondido a recusa útil.** A exclusão da organização pela Visão Master (`superadmin-suporte-tenant`) é recusada pelo gatilho da cobrança viva de um aluno, e a mensagem dele diz o que fazer. A troca cega pela mensagem genérica a apagaria; a recusa dos nossos gatilhos ficou.
- **O roteiro de produção do item 1** tratava só a recusa esperada. Outra falha (uma chave estrangeira sem cascata, por exemplo) sairia como o erro cru do banco, e não como "FALHOU". Cada tentativa passou a anotar o código de qualquer outra falha.
- **Achado no mapa do item 7:** a recepção fora do gate B2B (acima).

**Fica de fora, e por quê.**
- **O cadastro guardado no computador da catraca desativada.** A nuvem para de mandar a lista, mas o Gateway fica com a que já tinha, e sem internet decide por ela. Apagar o cadastro ao receber o 403 é mudança do Gateway (versão nova), e a catraca desativada não libera ninguém pela nuvem.
- **O corpo do erro do Asaas na emissão da cobrança B2B** (`asaas-emitir-cobranca-b2b`) vai como `detalhe` para a Visão Master. É a mensagem do Asaas, e não do Auth nem do banco, e só a ArkeFit a vê.
- **As tabelas sem regra seguem com a permissão padrão** de `authenticated`: o RLS recusa tudo, e tirar a permissão trocaria a resposta vazia por 42501 sem fechar nada. Fica para uma passada só.
- **O item 7**, para decisão. *Decidido em 08/10/2026 (acima).*

**Travas:**
- `saidaDoAluno.guarda` (3 casos novos): nenhuma regra de exclusão em `alunos`, e a última permissão de excluir para `authenticated` e para `anon` é um `revoke`; o leitor acha a permissão e a regra devolvidas; e nenhuma tela nem função apaga o aluno direto, por um leitor da corrente do `.from("alunos")` que segue os parênteses (o código sem ponto e vírgula também).
- `ultimaPermissao()` foi para `regras.mjs`, e `caixaDeMensagens.guarda` passou a usá-la.
- `rlsSemRegra.guarda` (nova, 5 casos), `sequencias.guarda` (nova, 3 casos) e `scripts/migracao/tabelas.mjs`.
- `tokenCatraca.guarda` (1 caso novo): a validação, a sincronização e o canal de ordens conferem o status antes de entregar dado de aluno, e só a sincronização entrega a lista.
- `respostaSemErroInterno.guarda` (nova, 6 casos).
- `prazoChamadas.guarda` (1 caso novo): o Resend só por `fetch` com prazo, e nenhum uso do SDK.

**Conferido:**
- **O banco, em Postgres local (PGlite)**, no esqueleto das frentes anteriores, com o gatilho da cobrança viva e `excluir_aluno_da_academia` com o texto de produção. As regras de acesso foram geradas pelo leitor das guardas no estado de antes desta entrega (até `20261407`). Cada migration rodou duas vezes seguidas:
  - **item 1, 30 casos.** Antes, 16 falham: o gestor, a recepção, o professor, a nutricionista e o `admin_arke` apagam o aluno, e o Super Admin, o próprio aluno, o gestor de outra academia e o `anon` recebem zero linhas sem erro. Depois, os nove são recusados com 42501 e o aluno fica; a recepção segue lendo, incluindo e alterando; a saída do aluno apaga, com a biometria, a cascata e a auditoria; a cobrança viva segura a saída; a service role apaga; a exclusão da academia pela ArkeFit leva o aluno em cascata; e o banco fica sem regra nem permissão de excluir pela API, com a service role e o resto da equipe intactos;
  - **item 3, 17 casos:** antes da migration, a identity insere sem o grant e o `bigserial` sem o grant é recusado (42501); depois, as 3 do Vigia têm o uso, a service role segue inserindo, e `authenticated` não ganhou nada.
- **Os roteiros da prova em produção rodaram no mesmo esqueleto**, com a academia `homologacao` e as contas e2e: o do item 1 acusa 6 de 7 sem a migration (a gestora apaga a aluna) e dá 7 casos ok com ela, também com a cobrança viva da aluna (o dono é recusado pelo gatilho); o do item 2, contra um catálogo de 18 tabelas sem regra, dá 3 casos ok, e acusa a tabela plantada; o do item 3 acusa as 3 sequências do Vigia e dá 2 casos ok com a migration. Nada fica gravado depois.
- **Defeitos plantados: 10, os 10 pegos:** a migration do item 1 tirada; o `revoke` só do `anon`; uma tela apagando o aluno; uma tabela nova sem regra; uma tela lendo `freio_chamadas`; a migration do item 3 tirada; a sincronização sem a conferência do status; a conferência depois de montar a lista; as 6 funções do item 5 como eram (as 8 respostas cruas apontadas); e `send-email` de volta ao SDK.
- **Testes:** 19 novos (3 em `saidaDoAluno.guarda`, 5 em `rlsSemRegra.guarda`, 3 em `sequencias.guarda`, 1 em `tokenCatraca.guarda`, 6 em `respostaSemErroInterno.guarda` e 1 em `prazoChamadas.guarda`). Suíte inteira: **1.357 testes em 180 arquivos, todos passando**, em 18 lotes de 10 arquivos, um por vez. Na primeira rodada, um caso novo de `saidaDoAluno.guarda` estourou os 5 segundos (6,1 s) com a máquina carregada: ele relia todos os textos da reconstrução três vezes. Os textos passaram a ser lidos uma vez por arquivo, `ultimaPermissao()` pula o texto que não cita a tabela, e os casos que leem a reconstrução inteira ganharam 30 segundos, como os de `cpfSemMascara` e `identidade`. O lote rodou de novo e passou.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 56 funções e a auditoria das dependências (0 vulnerabilidades).
- **O banco de produção, em transação desfeita, antes de aplicar (07/10/2026):**
  - **item 1:**
    - sem a migration: "FALHOU 6 de 7", com a gestora apagando a aluna e2e pela API (1 linha), a regra de exclusão e a permissão no ar;
    - com a migration: 7 casos ok, e o dono das tabelas apaga.
  - **item 2:** 18 tabelas sem regra, as mesmas da lista.
  - **item 3:**
    - sem a migration: as 3 sequências do Vigia sem o uso para a service role;
    - com a migration: 8 sequências, todas com o uso.
  - **Depois, nada gravado:** a aluna e2e seguiu lá, e a regra e a permissão de exclusão seguiam no ar até aplicar.
- **A publicação (07 e 08/10/2026):**
  - as duas migrations;
  - as 9 funções: `catraca-sincronizar-alunos` v28, `send-email` v26, `criar-organizacao-superadmin` v28, `convidar-membro` v31, `editar-membro-equipe` v32, `superadmin-suporte-tenant` v29, `vapid-public-key` v23, `vigia-aprovar` v13 e `assistente-academia` v32;
  - o app (#357). Desta vez a Vercel publicou sozinha.
- **A corrente real:**
  - **O e-mail do login pela versão nova do `send-email`:** a recuperação de senha de uma conta temporária respondeu 200, e o Resend entregou "Redefinir sua senha do ArkeFit".
  - **A catraca:** com um equipamento temporário na homologação, a inativa recebeu 403 "Dispositivo inativo.", sem a lista, e o sinal de vida foi gravado; ativada, a lista saiu (200). O equipamento foi apagado.
  - **O convite com e-mail que o Auth recusa:** não foi pela corrente real, de propósito. Para o Auth recusar, o convite sairia para um endereço que não existe, e o e-mail devolvido pesa na reputação de envio do domínio. Ficam a guarda `respostaSemErroInterno` e os testes do tradutor.
- **O item 7:** decidido em 08/10/2026, com a recepção em modo essencial (ver `docs/registro/cobranca.md`).

## A frente E: os baixos de app e conformidade (07/10/2026)

Seis achados "baixos" da auditoria de prontidão (05/10), do grupo de app e conformidade. Migration `20261410010000_prova_do_consentimento.sql`; funções `agente-comercial`, `agente-implantacao` e `responsavel-aceite`; o app.

**O que já estava resolvido, e não foi refeito.**
- **O feed não misturava as academias:** a consulta já fixava a academia (o feed por cursor, #351). Os desafios e as competições, que a auditoria citava junto, não fixavam (item 2).
- **As páginas já eram baixadas sob demanda** (`paginaPreguicosa`, desde setembro). O que pesava no pacote principal eram os layouts, o login e o que eles puxam (item 1).
- **A assinatura dos e-mails da Letícia e do Bruno já era de equipe** ("Equipe comercial ArkeFit", "Equipe de implantação ArkeFit"), e o modelo nunca recebeu a assinatura do e-mail. O que ia ao modelo era a assinatura do contato, dentro da mensagem dele (item 6).
- **O consentimento de saúde já era só do titular** (`20261361`), e o de IA e o de biometria só do aluno (regra de inclusão). O que faltava era a prova: a data, a versão e a origem saíam de quem gravava (item 5).

**1. O pacote do app.**
- **Antes** (`vite build`, com o Sentry ligado, como em produção): o pacote principal, que é tudo o que a página inicial baixa, tinha **1.065 kB (329 kB comprimido)**, e era o único pedaço acima de 500 kB. Ele levava o React, o Supabase, o Sentry e o react-query, os três layouts, o login com o framer-motion e os documentos legais inteiros. O aviso de tamanho do Vite estava em 1.000 kB, para calar esse pacote. (O build local sem as variáveis de ambiente tira o Sentry e dá 972 kB; a auditoria tinha medido 947 kB, numa versão anterior.)
- **Os layouts sob demanda.** `AppLayout`, `AdminLayout` e `SuperAdminLayout` saíram do pacote principal, pelo mesmo `paginaPreguicosa` das páginas: o aluno deixou de baixar o menu do painel e o da Visão Master (com a saúde das rotinas), e a recepção o do app do aluno. O `Suspense` de fora mostra o "Carregando" enquanto o layout chega, como numa página.
- **O login sem o framer-motion.** Ele pesava uns 100 kB no pacote principal só para duas animações de entrada (o cartão subindo e o aviso de instalar o app). Elas passaram para o CSS (`tailwindcss-animate`, que o app já usa), com `motion-safe:`, que respeita quem pediu menos movimento no aparelho; o aviso de instalar some sem a animação de saída. As outras três telas que usam o framer-motion já eram baixadas sob demanda.
- **Os documentos legais fora do pacote principal.** O aceite e os links do login importavam `documentosLegais.ts`, e com ele os três textos (38 kB). O texto foi para `documentosLegaisTexto.ts`, que só a página do documento importa; a versão e o hash ficam onde estavam.
- **A exportação do encerramento sob demanda.** O portão do encerramento importava os dois exportadores (planilha da academia e do contador), que só aparecem depois do término do contrato.
- **As bibliotecas em arquivos próprios** (`manualChunks`, no `vite.config.ts`). O React e o roteador, o Supabase, o Sentry e o react-query, que todo mundo baixa ao abrir, saíram do pacote principal para arquivos que só mudam quando a versão delas muda: o navegador os guarda de um deploy para o outro, e o deploy troca só o pacote do app. Antes, cada deploy trocava o pacote inteiro. Só entra ali o que já está no pacote inicial: uma biblioteca de tela só, agrupada ali, passaria a ser baixada por todo mundo. O aviso de tamanho do Vite voltou para 500 kB (estava em 1000, para calar o pacote principal).
- **O PWA não muda:** o service worker só cuida dos avisos (não tem `fetch`), então não havia carregamento offline a quebrar; os arquivos novos seguem o mesmo caminho das páginas, com a recarga única quando um deploy troca os arquivos (`carregamentoPreguicoso.ts`).
- **Depois** (o mesmo build): a página inicial baixa **790 kB (243 kB comprimido)**, 26% a menos, em cinco arquivos: o do app, com 249 kB (82 kB comprimido), e os das bibliotecas, o React com o roteador (182 kB), o Supabase (227 kB), o Sentry (89 kB) e o react-query (42 kB). A cada deploy, quem já abriu o app baixa de novo só o do app: 82 kB comprimidos em vez de 329. **Nenhum pedaço passa de 500 kB**; o maior é a planilha (`xlsx`, 492 kB), baixada só na exportação. Só com as quatro primeiras mudanças, sem separar as bibliotecas, o principal já tinha caído para 696 kB (sem o Sentry; 972 kB antes, na mesma conta).

**2. Quem tem dois papéis em academias diferentes.**
- **A recepção caía depois do aluno.** `escolherVinculo` tinha a hierarquia gestor, professor, nutricionista, aluno, e a recepção, fora dela, ia para o fim como "papel desconhecido": quem era recepção numa academia e aluno em outra entrava como aluno, e só achava o balcão pelo seletor. A recepção entrou antes do aluno, e a hierarquia virou `PRIORIDADE_DO_PAPEL`.
- **Desafios e competições do aluno misturavam as academias.** As duas telas liam a tabela sem a academia, e a regra de acesso devolve também as da academia em que a pessoa trabalha. Passaram a fixar a academia da matrícula.
- **O seletor de exercícios da prescrição** mostrava os exercícios próprios de todas as academias da pessoa (o professor em duas, a ArkeFit em todas). Ele passou a mostrar o acervo padrão e o da academia do aluno (`exercicioDoEscopo`). A consulta continua sem filtro, de propósito: a chave do cache é da pessoa, e o acervo do painel já separava por academia.
- **A troca de academia** recarrega a página inteira (`trocarOrganizacao`), e o cache do react-query não sobrevive à recarga; não há cache gravado no aparelho. Nada a mudar.
- **Fica:** `obter_perfis_publicos_org()` devolve os nomes das duas academias para a lista do feed, que só os usa para pôr o nome em post da academia aberta; e são pessoas que a própria pessoa já vê.

**3. A situação do aluno com o app aberto.**
- **O defeito:** a situação (em dia, pausado, inadimplente) era lida só na entrada, pelo `AuthContext`. A academia pausava o aluno e ele seguia usando o app até sair e entrar de novo, o que, no celular, com a sessão de semanas, é quase nunca. O banco não recusa o aluno pausado pelo RLS (os dados são dele): só a catraca, o check-in por QR e a foto do rosto seguem `situacao_permite_app()`. O portão do app é o que aplica a regra, e precisava da situação em dia. O portão de cobrança do Método já relia ao voltar para a aba (o padrão do react-query).
- **A correção** (`src/lib/releituraSituacao.ts`): a situação é relida ao voltar para o app, se a última leitura tem mais de 1 minuto, e de 15 em 15 minutos com o app na tela, nunca com ele escondido. É uma consulta leve (`situacao_academia`, `situacao_academia_em`), separada da leitura da entrada, que registra o primeiro acesso e a atividade: voltar para a aba não conta como abrir o app para a regra de inércia do mentor. A falha mantém o que já estava.
- O artigo da situação do aluno diz quando a mudança chega ao app.

**4. A limpeza do Sentry.**
- **O que passava:** o `beforeSend` limpava os objetos pela chave (`cpf`, `email`) e cortava a query string, mas não tocava no texto. O erro do Postgres repete a linha que falhou ("Key (email)=(maria@…) already exists"), e esse texto ia no `exception.value` e na mensagem; o texto das migalhas e o endereço da página nos quadros da pilha também. E o link de senha que o Supabase manda por e-mail traz o token depois de `#` (`/#access_token=…&refresh_token=…`), sem `?`, e passava pelo corte inteiro.
- **Agora** (`limparEvento`, `limparTexto`, `limparUrl`): a mensagem, o `exception.value`, a mensagem e os dados das migalhas, os textos dos extras, dos contextos e das etiquetas e o endereço da página nos quadros perdem o e-mail, o CPF (com e sem máscara), o telefone com DDD, a sequência solta de 10 ou 11 dígitos, o JWT, o `Bearer`, a chave do Asaas e os tokens de link (`access_token`, `refresh_token`, `token_hash`, `token`, o `code` longo do retorno do login e o `t` do "não quero mais receber"). O usuário sai só com o UUID, mesmo que o SDK junte outra coisa. Fica o que ajuda a investigar: o UUID, o código do erro do Postgres, a rota e a mensagem de rede.
- **Fica de fora:** o DSN compartilhado com outro sistema (é um projeto novo no Sentry e uma variável na Vercel, decisão e conta do responsável) e o UUID ser dado pseudonimizado (é o que a Política diz: "a pessoa e a academia aparecem só por um código interno").

**5. A prova do consentimento** (`20261410010000`).
- **O defeito:** o próprio aluno gravava os campos que provam o consentimento dele. Pela API, `aluno_consentimento_ia` aceitava a finalidade, a versão, a data e o provedor que o aluno mandasse, e a regra de alteração deixava reescrever a linha inteira, desfazer uma retirada e mandar a data da retirada; `aluno_consentimento_biometrico` aceitava a origem "termo assinado", o arquivo e quem registrou; e o de saúde gravava a data do relógio do celular. Nenhum guardava o hash do texto nem o navegador.
- **Quem pode mandar o quê:** pela API, o aluno manda só o aluno, a academia e o propósito (privilégio de coluna), e, para retirar, só a data da retirada, que o banco troca pela hora dele, com quem retirou. A autorização retirada não volta: autoriza-se de novo, numa linha nova. Na biometria, a API manda só o aluno e a academia; o caminho do app (`consentir_biometria`) e o do termo assinado (a recepção) são funções do banco e seguem iguais.
- **O que o banco carimba**, por gatilho, em cada um: a data (`now()`), a versão vigente, o hash do texto (`hash_texto_consentimento`, a mesma tabela de `_shared/responsavel.ts`, conferida contra o texto do app) e o navegador, lido do cabeçalho da requisição (`navegador_da_requisicao`) e não do corpo. Os gatilhos não são `security definer`, de propósito: é `current_user` que separa a gravação pela API da gravação pelas funções do banco.
- **Saúde:** na concessão (só o titular chega lá, pelo gatilho de `20261361`), a data é a do banco e entram o hash e o navegador; fora dela, a API não mexe nessas colunas nem na data da retirada. O hash e o navegador ficam depois da retirada, com a data do aceite, como prova do que foi aceito.
- **Documentos legais:** o aceite copia a versão e o hash do documento na própria linha, e as linhas de antes ganharam a cópia na migration. `documentos_legais` é editável pela ArkeFit; a cópia congela o que foi aceito. O navegador passou a vir do cabeçalho, e o mesmo no contrato de matrícula (que já tinha o hash do texto assinado, calculado pelo banco).
- **O aceite do responsável pelo menor** ganhou o navegador, que a função `responsavel-aceite` lê do cabeçalho (o responsável não tem conta, e os registros de acesso não o alcançam), e o banco passou a conferir o hash que a função manda contra o da tabela. `registrar_aceite_responsavel` ganhou o parâmetro com padrão: a função publicada antes da migration continua funcionando.
- **Sem IP, por decisão.** A Política (seção 7) promete o IP só nos registros de acesso, por 6 meses (Marco Civil, `registros_acesso_aplicacao`), e cifrado no limite de tentativas e no contato pelo site. O consentimento é guardado enquanto for preciso provar a autorização, bem mais que 6 meses: guardar o IP nele contrariaria a Política. Nos 6 meses, o IP de um aceite se acha pelos registros de acesso da pessoa naquele dia.
- As linhas de antes ficam sem hash e sem navegador: quer dizer "gravado antes de 07/10/2026", e a versão continua dizendo qual texto.
- **Fica de fora:** o aceite dos Termos do Asaas pela gestão (`aceites_termos_asaas`) não tem versão nem hash (o texto é do Asaas, por endereço), e a recusa do aceite com a versão que a tela mostrou (registro de 23/09: "a solução definitiva... o aceite mandar o hash do texto que a tela mostrou"), que pede mudar a chamada do app.

**6. A Letícia e a assinatura.**
- **O que ia ao modelo:** a mensagem do contato, inteira, menos e-mail e telefone. A assinatura dela ("Att, Maria Souza, gerente da Academia X") e o nome de quem escreveu iam junto. E nada impedia o modelo de devolver um espelho assinado ("— Letícia") ou com o nome da pessoa: a trava recusava número, preço e promessa, não nome.
- **Agora:** a entrada do modelo sai sem a assinatura do fim da mensagem (da linha de despedida curta para baixo, entre as últimas linhas: "Att,", "Abraços", "Obrigada") e com o nome do cadastro do contato trocado por "[nome]" onde aparecer (o mesmo `tirarNomes` do assistente). A trava do espelho recusa o nome da Letícia, do Bruno, do Jean e do assistente, a despedida e a assinatura, o "[nome]" e o nome do contato. A assinatura do e-mail, que mora em `plataforma_textos` e muda sem deploy, volta à padrão quando não começa por "Equipe" (`assinaturaDeEquipe`), na Letícia e no Bruno. O Bruno não usa IA.
- **O roteiro (`SISTEMA_ESPELHO`) não mudou**, e a guarda da avaliação continua verde. A entrada mudou, então vale rodar `npm run avaliar:ia -- --so leticia` antes de publicar (chama a IA de verdade; não rodado nesta frente).

**Travas** (guardas novas, cada uma com defeito plantado):
- `pacoteInicial.guarda` (3 casos): segue os imports estáticos a partir de `main.tsx` e confere que só os pacotes da lista (cada um com o motivo) chegam ao pacote inicial, que o framer-motion, os gráficos, o PDF, a planilha e afins nunca chegam, e que os layouts, os exportadores, o texto legal e as páginas (menos o login e a não encontrada) ficam de fora.
- `monitoramento.guarda` (8 casos): o link de senha com e sem a rota antes, o convite, o retorno do login, o link do responsável e o "não quero mais receber"; o erro do Postgres com e-mail, CPF e telefone; os quadros, as migalhas, os extras e os contextos; o usuário só com o UUID; e o que não pode sumir (UUID, código do erro, rota).
- `vinculos.guarda` (5): todo papel de academia na hierarquia, com o aluno por último; recepção e aluno nas duas ordens; o seletor vence; o seletor de exercícios; e toda leitura de desafios, competições, feed e comunicados fixa a academia.
- `releituraSituacao.guarda` (6) e um caso novo em `AuthContext.acesso.test.tsx`: a academia pausa a aluna com o app aberto, e a volta para o app mostra a pausa.
- `provaDoConsentimento.guarda` (12): o hash de cada texto vigente na tabela do banco; as colunas que a API pode mandar; nenhuma migration depois devolve a tabela inteira; os gatilhos carimbam e não são `security definer`; o navegador só para a sessão de uma pessoa; a tela não manda o que o banco carimba; o responsável leva o navegador; nenhum IP. `consentimentoSaude.guarda` ganhou o porquê das duas colunas novas que ficam depois da retirada.
- `assinaturaDosAgentes.guarda` (18): a mensagem real com assinatura, nome e telefone; o "obrigado" do começo fica; o roteiro ainda proíbe nome e despedida; cinco espelhos recusados; sete assinaturas; e as duas funções passam pela conferência.

**Defeitos do caminho.**
- **O relógio da releitura.** `vigiarSituacao` guardava `Date.now` pela referência, e o teste do `AuthContext`, com o relógio trocado, não via o tempo passar: a aluna pausada seguia "em dia". Passou a chamar `Date.now()` a cada vez.
- **A guarda da saúde acusou as colunas novas.** `consentimentoSaude.guarda` pede que toda coluna da anamnese saia na retirada ou diga por que fica. O hash e o navegador do aceite ficam, como prova, e entraram na lista com o motivo.
- **O plantio que "passou" por falta de memória.** Na primeira rodada dos defeitos plantados na migration, 5 deram "não pego": as provas filhas morreram sem memória e sem saída, e zero "FALHOU" parecia aprovação. O script passou a mostrar a linha de resumo de cada rodada, e na segunda os 11 foram pegos.
- **O roteiro de produção e a trava do menor.** A semente do esqueleto dava à aluna e2e IA e biometria sem data de nascimento, e a trava do menor recusou, como recusaria em produção na hora de o roteiro autorizar. O roteiro acerta a data de nascimento dentro da transação desfeita.
- **O `vite build` não cabia na memória.** Com outros processos abertos na máquina (4 GB), o build caiu cinco vezes por falta de memória (o Node, o SWC e o esbuild, cada um por sua vez). A medida provisória foi pelo esbuild direto, com o mesmo grafo (o pacote inicial de 1.099 kB para 832 kB); os números do item 1 são do `vite build`, rodado quando a memória folgou. E o build local sem as variáveis de ambiente tira o Sentry do pacote inteiro (o `if (!DSN) return` vira código morto): a medida final foi com um DSN e uma URL de exemplo, como em produção.

**Conferido:**
- **O banco, em Postgres local (PGlite)**, num esqueleto com as tabelas de consentimento e de aceite como estão hoje (colunas, regras de acesso, gatilhos da sessão simulada, do titular e do menor, privilégios padrão do Supabase) e as funções que gravam nelas. A migration rodou duas vezes seguidas (idempotente), e **49 conferências** passaram, cada caso em transação desfeita:
  - **IA (22):** a tela autoriza; a data é a do banco, a versão a vigente, o hash e o navegador carimbados, nenhum IP; a aluna não manda nem altera a finalidade, a data, a versão, o provedor, o navegador e o hash (42501); a retirada leva a hora do banco e quem retirou, sem mexer na prova; a retirada não volta pela API (P0001); a função do banco retira sem mexer no hash; a recepção não autoriza pela aluna;
  - **biometria (6):** a aluna não grava a origem do termo, o arquivo, quem registrou nem a data; pelo app, origem app com hash e navegador; a aluna não altera a linha; o termo assinado segue pela recepção, com o navegador dela; a inclusão mínima pela API ganha os carimbos;
  - **saúde (7):** o aceite do onboarding com uma data antiga fica com a hora do banco, com hash e navegador; a aluna edita a anamnese, mas não a prova nem a data da retirada; a data do aceite não volta no tempo; a equipe não concede (gatilho do titular); a retirada pela função guarda o hash; a anamnese sem consentimento não ganha hash;
  - **documentos e contrato (5):** a cópia da versão e do hash nos aceites de antes e nos novos; o navegador do cabeçalho no lugar do mandado pelo corpo; pela matrícula pública (service role), o navegador que a função mandou; a cópia fica mesmo com o documento editado; o contrato com o navegador do cabeçalho;
  - **responsável (4):** hash errado recusado; o navegador gravado; uma assinatura só da função; a chamada antiga, sem o navegador, continua valendo;
  - **privilégios e navegador (5):** a API manda só o propósito e a retirada; anon sem nada, a service role com tudo; funções de gatilho fora da API; navegador nulo fora de requisição e para a service role.
  - **Sem a migration**, 21 das 25 conferências que dá para rodar falham, entre elas as do defeito: a aluna grava a finalidade, muda a data e grava a origem do termo.
- **O roteiro da prova em produção** (`prod-item5.sql`, na pasta da frente: `begin`, a migration colada no lugar marcado, um bloco que sempre termina em exceção, `rollback`; academia `homologacao`, conta `e2e-jornada`, nenhuma tarefa) rodou no mesmo esqueleto: **sem a migration, "FALHOU 10 de 12"** (a aluna grava a finalidade e a data, muda a data, a retirada fica com a data mandada, grava a origem do termo, o aceite da saúde com a data antiga, e os privilégios); **com ela, "14 casos ok"**; e nada ficou gravado.
- **Defeitos plantados: 36, os 36 pegos.**
  - **Na migration, pela prova do PGlite, 11:** o gatilho da IA como `security definer`, a API de volta à tabela inteira na inclusão e na alteração da IA e na inclusão da biometria, a retirada sem a hora do banco, a saúde com a data do celular, a saúde deixando a API mexer na prova, o navegador da service role, o aceite sem a cópia congelada, o responsável sem a conferência do hash e o hash errado na tabela.
  - **Pelas guardas, 25:** no Sentry, o `exception.value` sem limpeza, o `access_token` fora da lista, o usuário com e-mail e a migalha sem limpar; nos vínculos, a recepção fora da hierarquia, os desafios sem a academia e o seletor de exercícios com as outras academias; na situação, o `AuthContext` sem a releitura e a releitura com o app escondido; na prova do consentimento, o hash errado, a finalidade na lista da API, o gatilho `security definer`, o responsável sem o navegador e a tela mandando a versão; na Letícia, a assinatura indo ao modelo, o nome indo ao modelo, o espelho assinado pela Letícia passando, a assinatura de pessoa aceita, o Bruno sem a conferência e a função sem passar o nome; no pacote, o layout do painel, o framer-motion no login, o texto legal pelo aceite, o exportador no portão e uma biblioteca de gráficos no inicial.
- **Testes:** 53 novos (8 em `monitoramento.guarda`, 5 em `vinculos.guarda`, 6 em `releituraSituacao.guarda` e 1 em `AuthContext.acesso.test.tsx`, 12 em `provaDoConsentimento.guarda`, 18 em `assinaturaDosAgentes.guarda`, 3 em `pacoteInicial.guarda`). Suíte inteira: **1.391 testes em 183 arquivos, todos passando**, em 19 lotes de 10 arquivos, um processo por lote. O teste do portão do encerramento passou a esperar os exportadores, que chegam depois do cartão.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes, nenhum dos arquivos desta entrega), o `deno check` das 56 funções e a auditoria das dependências (0 vulnerabilidades). `npm run ajuda:indice` rodado depois dos artigos.
- **O build:** o `vite build` passou, com e sem as variáveis de ambiente, e o `index.html` final carrega o pacote do app e as quatro bibliotecas (`modulepreload`).
- **O banco de produção, em transação desfeita, antes de aplicar (08/10/2026):**
  - **sem a migration:** "FALHOU 10 de 12". A aluna gravava a finalidade e a data do próprio consentimento de IA e mudava a data depois; não havia hash nem navegador; e a retirada ficava com a data que a tela mandava.
  - **com a migration:** 14 casos ok, e nada ficou gravado.
- **A avaliação da Letícia (08/10/2026), três rodadas:**

  | Código | Resultado | Caso que errou |
  |---|---|---|
  | desta entrega, rodada 1 | 6 de 7 | migração |
  | desta entrega, rodada 2 | 5 de 7 | catraca e migração |
  | do `main`, para comparar | 7 de 7 | nenhum |

  - **A entrada não mudou nesses casos.** Ela foi comparada caso a caso nas duas versões e saiu idêntica: as mensagens da avaliação não têm nome nem assinatura. A diferença é do modelo, e não desta entrega.
  - **As três recusas têm o mesmo motivo:** o modelo escreveu "precisa" ("a transição precisa ser feita com cuidado", "você precisa que tudo funcione"), palavra proibida no espelho desde 28/09.
  - **A recusa é a falha segura:** o e-mail sai sem a frase de espelho, com a proposta padrão do assunto.
  - **Fica para depois:** pedir ao roteiro que evite "precisa", o que muda a assinatura e pede avaliação nova. O registro da rodada 2 está em `docs/avaliacoes-ia/2026-10-08.json`.
- **A publicação (08/10/2026):**
  - `20261410010000` aplicada;
  - os tipos gerados de novo, idênticos aos escritos à mão;
  - as funções `responsavel-aceite` (v2), `agente-comercial` (v10), `agente-implantacao` (v11) e `assistente-academia` (v34);
  - o app (#359).
- **O e2e de produção** rodou depois do deploy e passou: a fumaça, a jornada do aluno e o painel do gestor carregam com o pacote dividido.
- **A corrente real**, com uma aluna temporária na homologação, apagada no fim:
  - a autorização de IA gravada como o app grava (o aluno, a academia e o propósito) respondeu 201. O banco carimbou a versão (`2026-09-23.4`), o hash do texto, o navegador do cabeçalho e a hora dele;
  - a mesma gravação com a data escolhida pela aluna foi recusada (403);
  - a retirada ficou com a hora do banco, e não com a data mandada, e a tentativa de desfazer a retirada foi recusada (400).
- **A tela, no celular:** com o app aberto, a academia pausou a aluna; passado mais de 1 minuto, ao voltar para a tela, ela viu "Sua matrícula está pausada", que não aparecia antes.
- **Defeito do caminho:** a primeira rodada da corrente real usou o propósito `ia_chat`, que é o nome do aceite do responsável, e não o da autorização (`chat`). O banco recusou pela regra do propósito, e o roteiro foi corrigido.
- **Ficaram sem conferência na tela:**
  - a animação do login, o "Carregando" do painel e da Visão Master e o seletor de exercícios. O e2e cobre a abertura do painel;
  - o link do responsável, que pede um menor com e-mail de responsável. A guarda e a prova do banco cobrem.

## A equipe da ArkeFit por convite (08/10/2026)

O pedido do responsável: "Não temos como cadastrar novos membros da equipe ArkeFit. Chegou o terceiro sócio e preciso cadastrar ele. Futuramente vamos ter que contratar equipe e definir os acessos." As duas contas da ArkeFit nasceram direto no banco, com `superadmin` e `admin_arke`, e a tela **Equipe ArkeFit** só editava o registro profissional. Migration `20261421010000_equipe_arkefit_por_convite.sql`; função nova `equipe-arkefit-convidar`; a tela Equipe ArkeFit, o mentor da ficha do aluno, a Auditoria e a Central de Ajuda.

**O achado grave: o Admin ARKE se dava `superadmin` pela API.** As regras de inclusão, alteração e exclusão de `user_roles` (`20261205010000`) eram `has_role(admin_arke)`. O Admin ARKE com as duas etapas se dava `superadmin` (a Visão Master inteira, o dinheiro e a equipe) com um POST, e tirava o papel dos sócios. Ninguém subiu de nível porque as duas contas de hoje têm os dois papéis; a primeira contratação como Admin ARKE subiria. Quem não é da ArkeFit já era recusado (42501). Agora as três regras saíram e a permissão de escrever saiu de `anon` e `authenticated`, no molde da exclusão de alunos (`20261408`): o pedido é recusado com 42501, em vez de responder 200 sem gravar. A leitura ficou (o app decide a rota pelos papéis de quem entra). Quem escreve: a service role (o convite) e as funções da migration. Nenhuma tela escrevia em `user_roles` (conferido no código do app e das funções).

**O que mudou.**
- **Os níveis num lugar só** (`src/lib/acessosArkefit.ts`, com o espelho em `equipe-arkefit-convidar/fluxo.ts`, que o Deno lê; `acessosArkefit.test.ts` confere os dois). Hoje há um: **Sócio**, os dois papéis, como as contas de hoje. Nível novo é uma entrada a mais; papel novo no enum entra também em `papeis_da_arkefit()` (o que o convite dá e a retirada tira) e em `has_role()`.
- **O convite** (a função, só para o sócio com as duas etapas, o papel lido do banco):
  - e-mail que já tem conta é recusado: "Esse e-mail já tem conta no ArkeFit. Para a equipe da ArkeFit, use um e-mail que ainda não tenha conta." Também quando a conta nasce entre a conferência e o convite (`emailJaCadastrado`);
  - e-mail novo recebe o convite do Auth (`inviteUserByEmail`), sem senha, com o link para `/auth/definir-senha`, como a equipe da academia;
  - `gravar_convite_equipe_arkefit()` grava o perfil, os papéis, a linha da equipe (`mentor = false`, `ativo`, `atualizado_por` = quem convidou) e a auditoria numa transação, só pela service role. Ela confere de novo quem convida (sócio), os papéis (da ArkeFit) e a conta (convite novo: sem senha, sem papel, sem vínculo, sem matrícula). Se falha, a função apaga a conta;
  - `equipe_arkefit.convidada` na auditoria só com ids, o nível e os papéis.
- **O estado de cada conta** (`estado_conta_arkefit()`, a coluna nova `estado` de `get_superadmin_equipe_arkefit()`): **Convite enviado** (não criou a senha), **Sem as duas etapas** (criou a senha e não cadastrou o aplicativo) e **Ativo**. As colunas de antes ficaram; a assinatura mudou, então a função é recriada na mesma transação.
- **Reenviar convite** só para quem ainda não criou a senha: o link de definir a senha (`generateLink` de recuperação), num e-mail nosso pelo remetente de acesso. O mesmo link serve a quem nunca abriu o primeiro e a quem abriu e não criou a senha.
- **Tirar o acesso** (`retirar_acesso_equipe_arkefit()`, chamada pela função com a sessão de quem pede): tira os papéis da ArkeFit, marca a equipe como inativa, apaga as sessões da pessoa (os tokens de renovação vão junto) e registra `equipe_arkefit.acesso_retirado` com os papéis e o número de sessões. Recusa o próprio acesso, o último sócio com as duas etapas, quem não é sócio verificado e o perfil simulado. A conta continua existindo.
- **O piso:** o gatilho `trg_user_roles_sempre_um_socio` recusa apagar ou trocar o último `superadmin`, por qualquer caminho: a API, a service role, o SQL e a exclusão da conta.
- **O aviso aos outros sócios** pelo remetente de alertas, como a troca da carteira de recebimento: quem convidou ou tirou, o nome de quem entrou ou saiu, o acesso e a data, e o que fazer se não reconhecer. Vai a cada `superadmin` ativo (senha e duas etapas), não banido, menos quem pediu e a pessoa (`emails_socios_para_aviso()`). Sem e-mail de ninguém no texto.
- **A tela:** o botão **Convidar para a equipe** (nome, e-mail e o acesso, com a frase dos acessos que virão), o nível e o estado em cada conta, **Reenviar convite** e **Tirar o acesso** com confirmação (escondido na própria conta). O erro da lista passou a `<ErroAoCarregar>`.
- **O mentor da ficha do aluno** deixou de oferecer, em **Passar para...**, quem ainda não entra (convite enviado ou sem as duas etapas).
- **A Auditoria** ganhou os rótulos do convite e da retirada, e o de `equipe_arkefit_salva` (o registro profissional), que não tinha.
- `config.toml` declara `verify_jwt = true` para a função, de propósito: ela dá o papel de sócio.

**Decisões, e por quê.**
- **Conta que existe é recusada, sem caminho pendente.** A gestão e a equipe da academia têm o vínculo pendente que espera o link; `user_roles` não tem, e criar esse estado para o papel mais poderoso do sistema não vale para três sócios. Pedir outro e-mail resolve.
- **A retirada passa pelo banco com a sessão de quem pede** (`asUser.rpc`), e não pela service role: a regra (sócio verificado, nunca o próprio, nunca o último) mora na função do banco e vale para a API direta também. Pela API direta, a retirada vale e fica na auditoria, sem o e-mail aos sócios.
- **O convite grava pela service role**, numa função só dela: a conta é criada pelo Auth, fora do banco, e só a função do convite sabe que ela acabou de nascer.
- **O "último sócio" tem dois andares.** Na função, o último sócio com as duas etapas. Na vida real quem pede é sócio verificado e não é o alvo, então a função nunca chega lá sozinha; o que segura de verdade é o gatilho, que vale para todo caminho. A regra da função fica pelo caso em que um caminho novo (uma rotina, a service role) chamar a retirada.
- **O estado não confia só na senha vazia.** O convite do Auth cria a conta com `encrypted_password` vazio, mas a lição de `20261404` é que outro caminho do Auth grava o hash de uma senha aleatória. Convite em aberto é senha vazia, ou e-mail não confirmado, ou nenhuma entrada.
- **O gatilho do piso é `security definer`:** a exclusão da conta pelo Auth roda como o papel do Auth, que não lê `user_roles`; sem isso, apagar a conta de qualquer sócio quebraria.
- **As sessões saem pelo banco**, na mesma transação dos papéis: o Auth não tem "encerrar as sessões de outra pessoa" pela chave de serviço. O token de acesso que ainda não venceu não serve para nada da ArkeFit, porque `has_role` e as funções leem `user_roles` a cada pedido.
- **Quem saiu some da lista** (a lista é de quem tem papel da ArkeFit); o registro fica na auditoria e em `equipe_arkefit` (inativo).
- **Freio de 30 pedidos por hora por sócio**, com falha aberta: cada pedido manda e-mail.

**Defeitos do caminho.**
- O achado de `user_roles`, acima. Ele não estava no pedido como defeito, e a prova local mostrou a escalada antes de corrigir: a Admin ARKE com as duas etapas termina com `admin_arke,superadmin` depois de um POST.
- `create or replace function` não muda as colunas de uma função que devolve tabela: o estado na lista pede `drop` e `create` na mesma migration, com o `grant` de novo.
- A guarda nova passou com os arquivos em LF e falhou com o checkout do Windows (CRLF, `autocrlf`): o teste do defeito plantado procurava uma linha com `\n`. A guarda passou a ler os arquivos sem o `\r`.
- O seletor **Passar para...** da ficha oferecia o aluno a quem ainda não entra; corrigido junto.

**Travas:** `equipeArkefit.guarda` (nova, 14 testes): a função confere o sócio do banco com `verificada` antes de qualquer conta, link ou retirada; a conta que existe é recusada antes do convite; a conta nasce pelo convite, sem senha e sem papel gravado fora do banco; a gravação falha e a conta é apagada; o reenvio só para quem não criou a senha; o aviso aos sócios sem quem pediu e sem a pessoa; a auditoria sem e-mail; a retirada no banco, com as duas recusas; o gatilho do piso; e nenhuma regra nem permissão de escrita em `user_roles`. Os quatro detectores são provados contra defeitos plantados no próprio teste. `acessosArkefit.test.ts` (novo, 12 testes): o espelho dos níveis, o pedido e os e-mails. `verificacao.guarda` já cobria a função nova.

**Conferido:**
- **O banco, em Postgres local (PGlite)**, sobre um esqueleto com `user_roles`, `equipe_arkefit`, a auditoria e as funções de antes com o texto das migrations. A migration rodou duas vezes seguidas, e **81 casos** passaram, cada um em transação desfeita:
  - **sem a migration:** a Admin ARKE se dá `superadmin`, vira `superadmin` pela alteração e tira o papel de um sócio; um sócio dá e tira papel pela API. A gestora e a aluna já eram recusadas;
  - **com a migration:** as sete escritas pela API e a do anon recusadas com 42501; a leitura de cada um e a da ArkeFit verificada continuam; só a regra de leitura; o estado de seis contas (convite sem abrir, aberto sem senha, com o hash de uma senha aleatória, sem fator, com o fator começado, ativo); a gravação recusa sete pedidos errados (quem não é sócio, papel de academia, papéis vazios, conta com senha, conta da gestora, acesso fora do formato, nome vazio) e não deixa nada; grava os papéis, a equipe, o perfil e a auditoria sem e-mail nem nome; a lista com as colunas de antes e o estado, recusada à sócia só com a senha, à Admin ARKE e à gestora; a retirada tira os papéis, as duas sessões e o token de renovação, deixa a conta e a sessão do outro sócio, registra, e recusa o próprio acesso, a conta sem papel, a sessão só com a senha, a Admin ARKE, a gestora, o perfil simulado, o anon e o último sócio com as duas etapas; o piso recusa apagar todos, trocar o papel do último e apagar a conta dele, inclusive pela service role, e deixa apagar a conta comum; o aviso só aos sócios ativos, sem quem pediu, sem a pessoa e sem a conta banida; e as funções do servidor fora do alcance da API.
- **O roteiro de produção** (`begin`, a migration, um bloco que sempre termina em exceção, `rollback`), conferido no esqueleto: sem a migration, "FALHOU" com 17 falhas, a primeira "a Admin ARKE se deu superadmin pela API (gravou)"; com ela, **18 casos ok**; e nada gravado depois. Cria três contas temporárias (`@sim.invalid`) e não depende de conta real.
- **Defeitos plantados, todos pegos:**
  - na guarda, nos arquivos de verdade: a função sem `verificada` (pegou também `verificacao.guarda`); a retirada sem a recusa do próprio acesso; o `revoke` sem o `insert`;
  - na prova local: o último sócio sem o "com as duas etapas"; a retirada sem a recusa do próprio acesso; o estado só pela senha vazia; a gravação sem conferir que a conta é um convite novo;
  - no roteiro de produção: a retirada sem a recusa do próprio acesso, o `revoke` sem o `insert` e o gatilho do piso desligado.
- **Testes:** 26 novos (14 na guarda, 12 nos níveis). Suíte inteira, em lotes de 10 arquivos: **1.467 testes em 191 arquivos**, todos passando. Três passaram do prazo de 5 segundos com a máquina sem memória (`CartaoAssinatura`, dois, e `historicoDoAluno.guarda`, um) e passaram rodados de novo sozinhos.
- `npm run check` sem erro: tipos, lint (0 erros, os 27 avisos de antes), o `deno check` das 57 funções e a auditoria das dependências (0 vulnerabilidades).
- `npm run ajuda:indice` rodou: o artigo novo `vm-equipe-arkefit` e os links em `vm-mentoria` e `vm-duas-etapas` entram no índice do assistente.
- **Falta, porque esta entrega não toca produção:**
  - o roteiro de prova no banco de produção, e aplicar a migration;
  - gerar os tipos de novo (`supabase gen types`) e conferir com os escritos à mão;
  - publicar `equipe-arkefit-convidar` e `assistente-academia`;
  - a corrente real com uma conta temporária: o convite, o aviso ao outro sócio, o reenvio, o link até o QR das duas etapas, a recusa do mesmo e-mail, a retirada e a sessão caindo, e apagar a conta no fim;
  - a tela no computador e no celular.

**Fica de fora, e por quê.**
- **Os níveis Suporte, Comercial, Mentor e Financeiro**, que outro trabalho está mapeando: entram como entradas novas da lista, cada um com o próprio papel (`docs/DECISOES_PENDENTES.md`). O `admin_arke` age como gestor em toda academia, e é amplo demais para uma contratação.
- **Devolver o acesso a quem saiu:** a conta continua, e o convite recusa o e-mail. Decidir entre reativar pelo link (como a gestão pendente) ou pedir outro e-mail.
- **O e-mail aos sócios na retirada pela API direta:** a retirada fica na auditoria; o e-mail sai só pela função.
- **Os alunos do Método de um mentor que saiu** continuam com ele como responsável; passar a carteira é da Mentoria. Hoje não há mentor contratado.
- **Perder o celular** continua pelo SQL (`vm-duas-etapas`).
