/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors } from './_components/brand.tsx'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <EmailLayout preview={`Seu link de acesso ao ${siteName}`}>
    <Heading style={h1}>Seu link de acesso</Heading>
    <Text style={text}>Clique no botão abaixo para entrar no {siteName}. Este link expira em breve.</Text>
    <Button style={button} href={confirmationUrl}>
      Entrar
    </Button>
    <Text style={footer}>Se você não solicitou este link, pode ignorar este e-mail com segurança.</Text>
  </EmailLayout>
)

export default MagicLinkEmail

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
