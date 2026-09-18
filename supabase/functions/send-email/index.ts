import * as React from 'npm:react@18.3.1'
import { Webhook } from 'npm:standardwebhooks@1.0.0'
import { Resend } from 'npm:resend@4.0.0'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { InviteEmail } from './_templates/invite.tsx'
import { SignupEmail } from './_templates/signup.tsx'
import { MagicLinkEmail } from './_templates/magic-link.tsx'
import { RecoveryEmail } from './_templates/recovery.tsx'
import { EmailChangeEmail } from './_templates/email-change.tsx'
import { ReauthenticationEmail } from './_templates/reauthentication.tsx'

const resend = new Resend(Deno.env.get('RESEND_API_KEY') as string)
// O Supabase mostra o secret como "v1,whsec_<base64>" — o Webhook (padrão
// standardwebhooks/Svix) espera só a parte depois do "v1,".
const hookSecret = (Deno.env.get('SEND_EMAIL_HOOK_SECRET') as string).replace('v1,whsec_', '')
const SITE_NAME = 'ArkeFit'
const FROM = Deno.env.get('EMAIL_FROM') ?? 'ArkeFit <convites@arkefit.com.br>'

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
  email: string
  new_email?: string
  user_metadata?: Record<string, unknown>
}

// Auth Hook "Send Email": o Supabase Auth chama esta função (em vez do
// próprio mailer built-in) toda vez que precisa mandar um e-mail de
// autenticação (convite, confirmação de cadastro, magic link, recuperação
// de senha, troca de e-mail, reautenticação) — isso é o que dá controle
// total sobre o layout, usando os templates React Email já existentes no
// repo (antes órfãos, nunca ligados a nada) renderizados e enviados via
// Resend. Autenticação da chamada é por assinatura de webhook (Svix), não
// por JWT — por isso a função é implantada com verify_jwt = false.
Deno.serve(async (req: Request) => {
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
    console.error('Invalid send-email hook signature', error)
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
    const confirmationUrl = `${supabaseUrl}/auth/v1/verify?token=${emailData.token_hash}&type=${emailData.email_action_type}&redirect_to=${emailData.redirect_to}`
    const fullName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : undefined

    let subject: string
    let element: React.ReactElement

    switch (emailData.email_action_type) {
      case 'invite':
        subject = `Você foi convidado para o ${SITE_NAME}`
        element = React.createElement(InviteEmail, { siteName: SITE_NAME, siteUrl, confirmationUrl, fullName })
        break
      case 'signup':
        subject = `Confirme seu e-mail no ${SITE_NAME}`
        element = React.createElement(SignupEmail, {
          siteName: SITE_NAME,
          siteUrl,
          recipient: user.email,
          confirmationUrl,
        })
        break
      case 'magiclink':
        subject = `Seu link de acesso ao ${SITE_NAME}`
        element = React.createElement(MagicLinkEmail, { siteName: SITE_NAME, confirmationUrl })
        break
      case 'recovery':
        subject = `Redefinir sua senha do ${SITE_NAME}`
        element = React.createElement(RecoveryEmail, { siteName: SITE_NAME, confirmationUrl })
        break
      case 'email_change':
        subject = `Confirme a alteração de e-mail no ${SITE_NAME}`
        element = React.createElement(EmailChangeEmail, {
          siteName: SITE_NAME,
          oldEmail: user.email,
          newEmail: user.new_email ?? user.email,
          confirmationUrl,
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

    const { error } = await resend.emails.send({ from: FROM, to: [user.email], subject, html })
    if (error) throw error
  } catch (error) {
    console.error('Error sending auth email via send-email hook', error)
    return new Response(JSON.stringify({ error: { http_code: 500, message: 'Falha ao enviar e-mail.' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
