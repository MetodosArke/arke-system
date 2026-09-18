/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors } from './_components/brand.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <EmailLayout preview="Seu código de verificação">
    <Heading style={h1}>Confirme sua identidade</Heading>
    <Text style={text}>Use o código abaixo para confirmar sua identidade:</Text>
    <Text style={codeStyle}>{token}</Text>
    <Text style={footer}>
      Este código expira em breve. Se você não solicitou, pode ignorar este e-mail com segurança.
    </Text>
  </EmailLayout>
)

export default ReauthenticationEmail

const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: colors.heading, margin: '0 0 20px' }
const text = { fontSize: '14px', color: colors.text, lineHeight: '1.5', margin: '0 0 25px' }
const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: colors.gold,
  margin: '0 0 30px',
}
const footer = { fontSize: '12px', color: colors.muted, margin: '30px 0 0' }
