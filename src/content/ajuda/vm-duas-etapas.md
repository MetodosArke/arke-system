A Visão Master enxerga todas as academias, e por isso exige **verificação em duas etapas**: além da senha, um código de 6 dígitos gerado por um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password, Authy ou similar).

## O primeiro acesso

1. Entre com e-mail e senha.
2. A tela **Verificação em duas etapas** mostra um QR Code. Abra o aplicativo autenticador e escaneie. Sem câmera, digite no aplicativo o código mostrado abaixo do QR.
3. Digite o código de 6 dígitos que o aplicativo mostra. Pronto.

**Recomendação:** escaneie o mesmo QR Code em dois aparelhos (o seu celular e o de reserva, ou o celular e o gerenciador de senhas). Assim a perda de um não tranca você para fora.

## Nos acessos seguintes

Depois da senha, o ARKE pede o código do aplicativo. O código muda a cada 30 segundos; se der inválido, espere o próximo.

## O que exige as duas etapas

Tudo o que é da ArkeFit: a Visão Master inteira, as ações sobre academias (repasse, taxa de implantação, encerramento, cobrança B2B) e as leituras que atravessam academias. Uma sessão só com senha é tratada como sessão comum, sem nenhum poder da ArkeFit, mesmo que a pessoa seja Super Admin.

## Perdi o celular

Sem o código não há como entrar, e isso é o objetivo. Para recuperar:

1. Peça a outra pessoa com acesso ao painel do Supabase do projeto (hoje, o responsável técnico) para apagar o seu fator de verificação. No **SQL Editor** do Supabase:

```
delete from auth.mfa_factors
 where user_id = (select id from auth.users where email = 'SEU-EMAIL');
```

2. Entre de novo com e-mail e senha: o ARKE mostra um QR Code novo para cadastrar o aplicativo no aparelho novo.
3. Se a senha também pode ter vazado junto com o celular, troque a senha logo depois.

> Nunca apague o fator de alguém sem falar com a própria pessoa por outro canal (telefone, vídeo). É exatamente o pedido que um golpista faria.
