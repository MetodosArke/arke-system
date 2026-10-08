import * as React from 'npm:react@18.3.1'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { InviteEmail } from './_templates/invite.tsx'
import { SignupEmail } from './_templates/signup.tsx'
import { MagicLinkEmail } from './_templates/magic-link.tsx'
import { RecoveryEmail } from './_templates/recovery.tsx'
import { EmailChangeEmail } from './_templates/email-change.tsx'
import { ReauthenticationEmail } from './_templates/reauthentication.tsx'
import type { MarcaEmail } from './_templates/_components/brand.tsx'
import { textoDaRecuperacao, varianteDaRecuperacao } from './recuperacao.ts'
import { servir } from '../_shared/servir.ts'
import { resumoDoErro } from '../_shared/resumoDoErro.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
// O Supabase mostra o secret como "v1,whsec_<base64>" — o Webhook (padrão
// standardwebhooks/Svix) espera só a parte depois do "v1,".
const hookSecret = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') as string).replace('v1,whsec_', '')
const SITE_NAME = 'ArkeFit'
const FROM = Deno.env.get('EMAIL_FROM') ?? 'ArkeFit <convites@arkefit.com.br>'

// O Resend aceita 10 envios por segundo por conta. No dia do QR Code de
// primeiro acesso a recepção enche, e um pico passa disso: sem nova
// tentativa, o aluno ficava sem o link. Espera curta, porque o Auth dá
// poucos segundos para o hook responder.
const ESPERAS_MS = [400, 800, 1200]
// Prazo de cada envio (frente D, 07/10/2026). Era pelo SDK do Resend, que não
// aceita prazo: um Resend lento segurava a função até o limite da
// plataforma, e o Auth desistia do hook antes. Agora vai pela API, como os
// outros envios, com `AbortSignal.timeout` (`prazoChamadas.guarda`).
const PRAZO_ENVIO_MS = 4_000
async function enviarComNovaTentativa(email: { from: string; to: string[]; subject: string; html: string }) {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(PRAZO_ENVIO_MS),
    })
    // O corpo não interessa (o da recusa pode citar o destinatário): só o status.
    await r.body?.cancel()
    if (r.ok) return
    if (r.status !== 429 || tentativa >= ESPERAS_MS.length) {
      throw Object.assign(new Error('Resend recusou o envio'), { name: 'ResendError', status: r.status })
    }
    await new Promise((espera) => setTimeout(espera, ESPERAS_MS[tentativa]))
  }
}

// A academia de quem é aluno: os e-mails de acesso saem com a marca dela
// (decisão do responsável de 03/10/2026). Quem é da equipe recebe o da
// ArkeFit. Falha aqui nunca segura o e-mail: sai com a marca da ArkeFit, e o
// aluno entra igual.
async function marcaDoUsuario(userId: string | undefined): Promise<MarcaEmail | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const chave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!userId || !url || !chave) return null
  try {
    const r = await fetch(`${url}/rest/v1/rpc/marca_do_usuario`, {
      method: 'POST',
      headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ _user_id: userId }),
      signal: AbortSignal.timeout(1500),
    })
    if (!r.ok) return null
    const m = (await r.json()) as { nome?: string; icone_192?: string | null } | null
    return m?.nome ? { nome: m.nome, icone: m.icone_192?.startsWith('https://') ? m.icone_192 : null } : null
  } catch {
    return null
  }
}

type EmailActionType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'reauthentication'

type EmailData = {
  token: string
  token_hash: string
  redirect_to: string
  email_action_type: EmailActionType
  site_url: string
  token_new?: string
  token_hash_new?: string
}

type HookUser = {
  id: string
  email: string
  new_email?: string
  user_metadata?: Record<string, unknown>
  // O Auth manda o usuário inteiro; estes dois decidem o texto da recuperação
  // (./recuperacao.ts). `email_confirmed_at` só vem quando o e-mail foi confirmado.
  app_metadata?: Record<string, unknown>
  email_confirmed_at?: string | null
}

// Auth Hook "Send Email": o Supabase Auth chama esta função (em vez do
// próprio mailer built-in) toda vez que precisa mandar um e-mail de
// autenticação (convite, confirmação de cadastro, magic link, recuperação
// de senha, troca de e-mail, reautenticação) — isso é o que dá controle
// total sobre o layout, usando os templates React Email já existentes no
// repo (antes órfãos, nunca ligados a nada) renderizados e enviados via
// Resend. Autenticação da chamada é por assinatura de webhook (Svix), não
// por JWT — por isso a função é implantada com verify_jwt = false.
servir("send-email", async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('not allowed', { status: 400 })
  }

  const payload = await req.text()
  const headers = Object.fromEntries(req.headers)

  let user: HookUser
  let emailData: EmailData
  try {
    const wh = new Webhook(hookSecret)
    const verified = wh.verify(payload, headers) as { user: HookUser; email_data: EmailData }
    user = verified.user
    emailData = verified.email_data
  } catch (error) {
    console.error('Invalid send-email hook signature', resumoDoErro(error))
    return new Response(JSON.stringify({ error: { http_code: 401, message: 'Assinatura inválida.' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const siteUrl = emailData.site_url || Deno.env.get('SITE_URL') || 'https://arkefit.com.br'
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // Mesmo formato de link que o Supabase Auth gera nativamente — o
    // index.html do app já sabe normalizar essa URL para o HashRouter.
    // redirect_to PRECISA ser url-encoded: como ele mesmo contém um "#"
    // (ex.: .../#/auth/definir-senha), colar o valor cru na query string
    // cortaria a URL bem ali — tudo depois do "#" vira fragmento do
    // navegador e nunca chega no servidor de verificação.
    const confirmationUrl = `${supabaseUrl}/auth/v1/verify?token=${emailData.token_hash}&type=${emailData.email_action_type}&redirect_to=${encodeURIComponent(emailData.redirect_to)}`
    const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : undefined

    let subject: string
    let element: React.ReactElement

    const marca = emailData.email_action_type === 'reauthentication' ? null : await marcaDoUsuario(user.id)
    const siteName = marca ? `app da ${marca.nome}` : SITE_NAME

    switch (emailData.email_action_type) {
      case 'invite':
        subject = marca ? `${marca.nome}: seu convite para o app` : `Você foi convidado para o ${SITE_NAME}`
        element = React.createElement(InviteEmail, { siteName, siteUrl, confirmationUrl, fullName, marca })
        break
      case 'signup':
        subject = `Confirme seu e-mail no ${siteName}`
        element = React.createElement(SignupEmail, {
          siteName,
          siteUrl,
          recipient: user.email,
          confirmationUrl,
          marca,
        })
        break
      case 'magiclink':
        subject = `Seu link de acesso ao ${siteName}`
        element = React.createElement(MagicLinkEmail, { siteName, confirmationUrl, marca })
        break
      case 'recovery': {
        // A conta da matrícula pública que ainda não criou a senha recebe o
        // texto de criar a senha, com o "se não foi você, ignore".
        const texto = textoDaRecuperacao(varianteDaRecuperacao(user), siteName)
        subject = texto.assunto
        element = React.createElement(RecoveryEmail, { confirmationUrl, marca, texto })
        break
      }
      case 'email_change':
        subject = `Confirme a alteração de e-mail no ${siteName}`
        element = React.createElement(EmailChangeEmail, {
          siteName,
          oldEmail: user.email,
          newEmail: user.new_email ?? user.email,
          confirmationUrl,
          marca,
        })
        break
      case 'reauthentication':
        subject = `${emailData.token} é o seu código de verificação`
        element = React.createElement(ReauthenticationEmail, { token: emailData.token })
        break
      default:
        // Tipo de e-mail futuro que ainda não tem template — não falha a
        // autenticação, só loga para investigação (o usuário fica sem
        // e-mail nesse caso específico, mas o fluxo de auth continua).
        console.error('Unknown email_action_type for send-email hook', emailData.email_action_type)
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const html = await renderAsync(element)

    await enviarComNovaTentativa({ from: FROM, to: [user.email], subject, html })
  } catch (error) {
    console.error('Error sending auth email via send-email hook', resumoDoErro(error))
    return new Response(JSON.stringify({ error: { http_code: 500, message: 'Falha ao enviar e-mail.' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
