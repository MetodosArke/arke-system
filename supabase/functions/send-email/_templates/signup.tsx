/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors } from './_components/brand.tsx'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ siteName, siteUrl, recipient, confirmationUrl }: SignupEmailProps) => (
  <EmailLayout preview={`Confirme seu e-mail no ${siteName}`}>
    <Heading style={h1}>Confirme seu e-mail</Heading>
    <Text style={text}>
      Obrigado por se cadastrar na{' '}
      <Link href={siteUrl} style={link}>
        <strong>{siteName}</strong>
      </Link>
      !
    </Text>
    <Text style={text}>
      Confirme o e-mail{' '}
      <Link href={`mailto:${recipient}`} style={link}>
        {recipient}
      </Link>{' '}
      clicando no botão abaixo:
    </Text>
    <Button style={button} href={confirmationUrl}>
      Confirmar e-mail
    </Button>
    <Text style={footer}>Se você não criou esta conta, pode ignorar este e-mail com segurança.</Text>
  </EmailLayout>
)

export default SignupEmail

const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: colors.heading, margin: '0 0 20px' }
const text = { fontSize: '14px', color: colors.text, lineHeight: '1.5', margin: '0 0 25px' }
const link = { color: colors.gold, textDecoration: 'underline' }
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
