/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Hr, Html, Img, Preview, Text } from 'npm:@react-email/components@0.0.22'

// Ficava hospedado em /public/logo-email.jpg (já existia no repo, pronto
// para isso) — e-mails não podem referenciar assets locais do bundle, só
// URLs absolutas públicas.
const LOGO_URL = 'https://arkefit.com.br/logo-email.jpg'

export const colors = {
  bg: '#ffffff',
  text: '#55575d',
  heading: '#0d0d0d',
  gold: '#c9952b',
  muted: '#999999',
  divider: '#eeeeee',
}

// Casca comum a todos os e-mails de Auth (convite, recuperação de senha,
// magic link etc.) — logo + rodapé consistentes, cada template só cuida
// do próprio conteúdo.
export function EmailLayout({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html lang="pt-BR" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.bg, fontFamily: 'Arial, sans-serif', margin: 0, padding: 0 }}>
        <Container style={{ padding: '32px 25px', maxWidth: '480px' }}>
          <Img
            src={LOGO_URL}
            width="56"
            height="56"
            alt="ArkeFit"
            style={{ borderRadius: '12px', marginBottom: '24px' }}
          />
          {children}
          <Hr style={{ borderColor: colors.divider, margin: '32px 0 16px' }} />
          <Text style={{ fontSize: '12px', color: colors.muted, margin: 0 }}>
            ArkeFit — metodologia ativa de retenção para academias, studios e profissionais autônomos.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
