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
- **`get_atendimentos_mentor_organizacao`** (a tela Acompanhamento ARKE, da gestão) é `security definer` e entrega o motivo e o desfecho das tarefas do mentor a qualquer pessoa da equipe que chame a função, inclusive o da tarefa de dor. A tela existe de propósito, para mostrar à academia o resultado do mentor, e a rota é só da gestão. Mas a função confere `is_org_staff`, e não a gestão, e o motivo pode trazer saúde do aluno do Método. Decidir se a academia vê o motivo da tarefa de saúde do Método, e restringir a função à gestão, é decisão de produto.
- **A ArkeFit lê a conversa de treino do aluno do Free**, como lê o treino (`treinos`). Foi mantido para o chat seguir a regra do treino; se o treino do Free sair do alcance da ArkeFit, o chat sai junto.
- **A exclusão de mensagem** segue com quem lê a conversa: a equipe pode excluir a mensagem do aluno pela API. Nenhuma tela faz isso. Fechar a exclusão é um passo pequeno, mas muda o que o banco permite hoje, e não estava na lista.
- **A troca de papel e de nome pela gestão** (`editar-membro-equipe`) também não vai à auditoria. Promover alguém a gestor dá acesso ao dinheiro: vale registrar, a decidir.

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

O último caminho de pré-sequestro de conta, fechado pela decisão do responsável de 07/10/2026 ("matrícula pública confirmada"). Migration `20261403010000`; funções `matricula-publica`, `convidar-membro` e `send-email`; telas da matrícula, de definir a senha, de entrar e o **Meu perfil** do painel.

**O defeito.** `matricula-publica` criava a conta com a senha que o visitante digitava e com `email_confirm: true`, sem a prova de que o e-mail era dele. Quem fizesse a matrícula pública numa academia com o e-mail e o CPF de outra pessoa ficava com uma conta usável, com senha conhecida. Quando outra academia matriculasse a pessoa de verdade, a matrícula se ligava a essa conta pelo CPF (decisão de 03/10), e o atacante passava a ver o que era da pessoa. A equipe e a gestão já tinham fechado o mesmo buraco (`20261362`, `20261395`). A ligação pelo CPF mora em `convidar-membro` (o cadastro e a importação de aluno); `academia-criar-matricula` só cria a mensalidade de um aluno que já existe e não liga conta nenhuma, e por isso não mudou.

**1. A conta nasce sem senha, e a senha nasce no link do e-mail.**
- O formulário não pede senha. A função cria a conta sem senha e sem o e-mail confirmado, com a marca `app_metadata.origem = 'matricula_publica'`, que só o servidor grava. Perfil, vínculo, aluno e aceite dos termos são gravados como antes.
- O link de criar a senha sai pelo caminho do primeiro acesso: o e-mail de recuperação do Auth (`resetPasswordForEmail`), com destino `/auth/definir-senha`. Abrir o link confirma o e-mail. É o caminho que a importação sem e-mail usa desde 04/10: conta sem senha, e o primeiro acesso manda o link.
- **Por que o e-mail de recuperação, e não o convite do Auth** (o da equipe): o convite não grava `app_metadata` ao criar a conta (seria uma segunda chamada, com o e-mail já enviado), e o texto dele, "Você foi convidado", não é o de quem se matriculou sozinho. O de recuperação é o mesmo do primeiro acesso, que o aluno usa se o e-mail não chegar.
- Se o envio falhar (o Auth limita um e-mail por minuto por endereço), a matrícula fica, a resposta traz `email_enviado: false`, e a tela aponta o primeiro acesso. Desfazer a matrícula por causa do e-mail trocaria uma falha de entrega por uma matrícula perdida.
- A tela diz "Matrícula feita! Enviamos para o seu e-mail um link para criar a sua senha", com o e-mail digitado, a caixa de spam, os 7 dias, **Não chegou? Pedir o link de novo** (o primeiro acesso) e **Já criei a senha: entrar**. Ela não entra mais no app sozinha. O erro fica na tela, ao lado do botão, e não num aviso que some: o "já existe uma conta" diz o que fazer.
- **A tela antiga com a função nova.** A página publicada antes manda a senha e entra com ela logo depois. Com a função nova, a matrícula seria criada e a entrada falharia; a pessoa tentaria de novo e leria que o e-mail já tem conta. A função recusa o pedido que traz senha, antes de criar qualquer coisa: "Esta página foi atualizada... Recarregue a página e faça a matrícula de novo". O app instalado guarda a página antiga por um tempo, e a recusa continua valendo para ele.
- **O fluxo, do formulário ao primeiro login**, conferido no código: o formulário → a função → o e-mail "Crie a sua senha" → o link → o `index.html` leva o `type=recovery` com destino `/auth/definir-senha` à tela de definir a senha (`linkAuthIndexHtml.test`) → a senha, com a conferência de vazamento → `depoisDeDefinirASenha` encerra as outras sessões e chama `ativar_gestao_pendente` (zero, para o aluno) → `refreshOrganization` → `/app`, onde o primeiro login pede o que já pedia (contrato e PAR-Q, se a academia usa). O aceite dos termos já está gravado desde a matrícula.
- **A conta que ainda não definiu a senha** não entra: não tem senha, e o login não oferece link mágico nem código. O login errado passou a lembrar o link do e-mail e o **Esqueceu a senha?**, que manda o link de recuperação e serve igual a quem ainda não criou a senha (a recuperação também confirma o e-mail). O link vencido na tela de definir a senha aponta o mesmo caminho, em vez de "peça a quem te convidou".

**2. A senha vazada é conferida onde a senha nasce.** A conferência pelo Pwned Passwords (k-anonimato, falha aberta) morava em `matricula-publica` e era a única do servidor. A matrícula deixou de receber senha, e a conferência saiu de lá.
- A primeira senha nasce na tela de definir a senha, que já conferia no navegador, como a de redefinir: os mesmos 5 primeiros caracteres do SHA-1, a mesma falha aberta e a mesma mensagem (`src/lib/senhaVazada.ts`). A política de conteúdo do site já permitia a chamada.
- O **Meu perfil** do painel trocava a senha sem conferir. A guarda nova o achou, e ele passou a conferir com a mesma mensagem.
- **O que se perde:** a conferência deixa de ser autoritativa. Quem chama o Auth direto, sem a tela, passa, como já valia nas telas de definir e redefinir. O recurso do próprio Auth existe só no plano pago.

**3. O e-mail que já tem conta continua 409.** Considerada a resposta sempre igual, como no primeiro acesso, com um aviso ao dono do e-mail. Ela não abre buraco, mas a pessoa que já tem conta e quer entrar nesta academia leria "Matrícula feita" sem matrícula nenhuma: a conta que existe só se liga a outra academia com o CPF conferido pela equipe (decisão de 03/10). O 409 revela que o e-mail tem conta, como antes, sob o limite por IP, o teto por academia e o captcha. A mensagem ganhou o caminho de quem ainda não criou a senha (o **Esqueceu a senha?**, que só o dono do e-mail recebe) e o de quem quer usar a conta nesta academia (a recepção). A recusa é reconhecida pelo código `email_exists` e, nas versões do Auth que não o mandam, pelo texto.

**4. A conta que nunca confirma.** Com o item 1, o atacante ainda cria uma conta sem senha e não confirmada, com o e-mail e o CPF de outra pessoa. Ela não é usável, mas fica ligada à academia do link, conta no limite de alunos dela e guarda o nome, o telefone e o CPF que alguém digitou. **A escolha foram as duas medidas**, porque cada uma sozinha deixa uma ponta:
- **A outra academia espera a confirmação** (gatilho `trg_matricula_publica_sem_outra_academia` em `alunos`). A conta com a marca e o e-mail não confirmado não recebe aluno de outra academia até o dono do e-mail criar a senha pelo link. A regra mora no banco, numa função só (`conta_da_matricula_publica_nao_confirmada`), e vale para todo caminho, inclusive a versão publicada de `convidar-membro`, que receberia a recusa como erro genérico. A versão nova pergunta antes, depois de o CPF conferir (só quem já conhece a pessoa fica sabendo), e responde 409 com o caminho. A conta de convite ou de importação, sem a marca, segue ligada pelo CPF como decidido em 03/10. Sozinha, esta medida deixaria a academia que matricula a pessoa de verdade parada para sempre, se ela nunca confirmar: a conta existe, e o Auth não convida e-mail que existe.
- **A matrícula que não confirmou em 7 dias sai** (rotina diária `arke-matriculas-nao-confirmadas`, 04:35 de Brasília). Sai a que ficou como nasceu: a marca da matrícula pública, o e-mail não confirmado, nenhuma entrada e nenhuma senha, mais de 7 dias, nenhum outro vínculo (aluno, equipe pendente ou papel da plataforma), nenhum número na catraca, nenhum arquivo na pasta do aluno e **nenhuma linha de outra tabela apontando para o aluno**. Sai junto a conta, e com ela o perfil, o vínculo e o aceite. Fica na Auditoria (`matricula_publica.apagada_sem_confirmacao`), sem dado da pessoa. Sozinha, esta medida deixaria a outra academia ligar a matrícula à conta nos 7 dias.
- **"Como nasceu" vem do catálogo** (`aluno_como_nasceu`), e não de uma lista escrita à mão: a tabela nova que apontar para `alunos` passa a segurar a matrícula sem ninguém lembrar da rotina. O caso que pesou: a pessoa que se matriculou pelo link no balcão e treina pela catraca sem abrir o e-mail. A presença, o número na catraca, a cobrança, o documento e a conversa seguram a matrícula, e ela fica; quem vê o cadastro é a academia.
- Cada exclusão roda no próprio bloco: a que uma trava desconhecida segura fica inteira, e as outras seguem. A falta de permissão não é engolida: aparece como falha da rotina na Visão Master, e não como "zero apagadas". O filtro "como nasceu" está na seleção, e não só no laço, para as matrículas antigas que ficam não tomarem a vez das novas.
- **Descartadas:** a outra academia apagar a matrícula não confirmada e seguir (uma academia apagaria o cadastro de outra, e quem se matriculou de verdade e demorou a abrir o e-mail perderia a matrícula sem a academia saber); e não criar o aluno até a confirmação, como o vínculo pendente da equipe (o RLS do aluno lê `alunos.user_id` em mais de 40 tabelas, e a academia deixaria de ver na hora quem se matriculou).
- Os 7 dias estão na tela, no e-mail, na mensagem de `convidar-membro` e na Central; a guarda confere que dizem o mesmo que a rotina.

**5. O e-mail do link diz o que é** (`send-email`). O e-mail de recuperação dizia "Redefinir sua senha... Sua senha permanecerá a mesma", o que não serve a quem acabou de se matricular nem a quem recebe sem ter pedido porque alguém usou o e-mail dele. A conta da matrícula pública que ainda não confirmou recebe "Crie a sua senha", com "Se não foi você, ignore este e-mail: sem o link, ninguém entra na conta, e a matrícula sem confirmação é apagada depois de 7 dias". Qualquer outra conta recebe o texto de sempre, sem mudança. A escolha usa a marca e o `email_confirmed_at` que o Auth manda ao hook; sem eles, sai o texto de sempre.

**6. A trava dos logs pega o nome de erro em camelCase** (achado de passagem). A expressão de `logsSemDadoPessoal.guarda` era `[a-z]+Error`, que não casa com nome com maiúscula no meio: `console.error("Teto por organização indisponível...", orgLimiteError)` mandava o objeto inteiro ao log. A expressão passou a pegar qualquer identificador terminado em `Error` ou `Erro` (e os curtos `e`, `err`, `error`, `erro`, `ex`, `falha`), também dentro de `JSON.stringify`, e achou **15 chamadas em 9 funções** (`callerRolesError`, `callerMembershipError`, `targetMembershipError`, `targetUserError`, `orgLimiteError`, `alunoAlvoError`, `treinoExistenteError`), todas trocadas por `resumoDoErro(...)`. O teste de leitura ganhou os casos em camelCase.

**Fica de fora, e por quê.**
- **As contas da matrícula pública criadas antes desta entrega.** Nasceram com o e-mail confirmado, a senha de quem digitou e sem a marca: não dá para separar a legítima da que não é, e as duas medidas do item 4 não as alcançam. Quando outra academia liga uma delas pelo CPF, o dono do e-mail recebe o aviso, e o "Esqueceu a senha?" encerra as outras sessões ao definir a senha. Para medir em produção, sem dado pessoal: contar as contas com aluno e sem `invited_at`, com `email_confirmed_at` igual ao `created_at` e criadas antes de 07/10. Decidir se vale pedir a essas contas uma senha nova é do responsável.
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
- **Falta, porque esta frente não toca produção:**
  - aplicar `20261403010000`;
  - publicar `matricula-publica`, `convidar-membro`, `send-email` e `assistente-academia` (o índice da Central mudou), e o app;
  - a corrente real na homologação, com e-mail temporário: a matrícula pelo link, o e-mail "Crie a sua senha", a senha e a entrada; o 409; a tela antiga recusada; e uma matrícula da academia sobre a conta não confirmada;
  - a tela no computador e no celular.
