/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors } from './_components/brand.tsx'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <EmailLayout preview={`Redefinir sua senha do ${siteName}`}>
    <Heading style={h1}>Redefinir sua senha</Heading>
    <Text style={text}>
      Recebemos uma solicitação para redefinir sua senha no {siteName}. Clique no botão abaixo para escolher
      uma nova senha.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Redefinir senha
    </Button>
    <Text style={footer}>
      Se você não solicitou a redefinição, pode ignorar este e-mail. Sua senha permanecerá a mesma.
    </Text>
  </EmailLayout>
)

export default RecoveryEmail

const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: colors.heading, margin: '0 0 20px' }
const text = { fontSize: '14px', color: colors.text, lineHeight: '1.5', margin: '0 0 25px' }
const button = {
  backgroundColor: colors.gold,
  color: colors.heading,
  fontSize: '14px',
  fontWeight: 'bold' as const,
  borderRadius: '12px',
  padding: '12px 20px',
  textDecoration: 'none',
  display: 'inline-block' as const,
}
const footer = { fontSize: '12px', color: colors.muted, margin: '30px 0 0' }
