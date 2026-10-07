/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Button, Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailLayout, colors, type MarcaEmail } from './_components/brand.tsx'
import type { TextoRecuperacao } from '../recuperacao.ts'

interface RecoveryEmailProps {
  confirmationUrl: string
  marca?: MarcaEmail | null
  // O texto vem de ../recuperacao.ts: o de sempre, ou o da matrícula pública
  // que ainda não criou a senha (07/10/2026).
  texto: TextoRecuperacao
}

export const RecoveryEmail = ({ confirmationUrl, marca, texto }: RecoveryEmailProps) => (
  <EmailLayout preview={texto.assunto} marca={marca}>
    <Heading style={h1}>{texto.titulo}</Heading>
    <Text style={text}>{texto.corpo}</Text>
    <Button style={button} href={confirmationUrl}>
      {texto.botao}
    </Button>
    <Text style={footer}>{texto.rodape}</Text>
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
