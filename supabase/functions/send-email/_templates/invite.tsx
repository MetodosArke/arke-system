/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors } from './_components/brand.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
  fullName?: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl, fullName }: InviteEmailProps) => (
  <EmailLayout preview={`Você foi convidado para o ${siteName}`}>
    <Heading style={h1}>Você foi convidado{fullName ? `, ${fullName}` : ''}</Heading>
    <Text style={text}>
      Você foi convidado para participar da{' '}
      <Link href={siteUrl} style={link}>
        <strong>{siteName}</strong>
      </Link>
      . Clique no botão abaixo para aceitar o convite e criar sua conta.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Aceitar convite
    </Button>
    <Text style={footer}>Se você não esperava este convite, pode ignorar este e-mail com segurança.</Text>
  </EmailLayout>
)

export default InviteEmail

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
