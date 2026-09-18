/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors } from './_components/brand.tsx'

interface EmailChangeEmailProps {
  siteName: string
  oldEmail: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ siteName, oldEmail, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <EmailLayout preview={`Confirme a alteração de e-mail no ${siteName}`}>
    <Heading style={h1}>Confirme a alteração de e-mail</Heading>
    <Text style={text}>
      Você solicitou a alteração do seu e-mail no {siteName} de{' '}
      <Link href={`mailto:${oldEmail}`} style={link}>
        {oldEmail}
      </Link>{' '}
      para{' '}
      <Link href={`mailto:${newEmail}`} style={link}>
        {newEmail}
      </Link>
      .
    </Text>
    <Text style={text}>Clique no botão abaixo para confirmar a alteração:</Text>
    <Button style={button} href={confirmationUrl}>
      Confirmar alteração
    </Button>
    <Text style={footer}>Se você não solicitou esta alteração, proteja sua conta imediatamente.</Text>
  </EmailLayout>
)

export default EmailChangeEmail

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
