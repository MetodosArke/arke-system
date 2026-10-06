import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ATENDIMENTO_ASAAS,
  SELO_ASAAS,
  SITE_ASAAS,
  TAMANHO_SELO,
  TEXTO_PRESTADOR,
} from "@/lib/prestadorPagamentos";

/**
 * O selo oficial do Asaas, o texto do prestador e o atendimento do Asaas.
 *
 * Vai em toda tela que mostra ou cria cobrança, e onde a conta Asaas da
 * academia é aberta ou conectada (`prestadorPagamentos.guarda.test.ts`). As
 * regras do selo estão em `src/lib/prestadorPagamentos.ts`; as que valem
 * aqui: a imagem vem do endereço do Asaas (nunca copiada), sem
 * `referrerPolicy`, e o texto fica de pé sozinho se ela não carregar.
 *
 * `atendimento={false}` só onde o bloco do atendimento já aparece na mesma
 * tela (uma lista com o componente em cada linha, por exemplo).
 */
export function PrestadorPagamentos({
  className,
  atendimento = true,
}: {
  className?: string;
  atendimento?: boolean;
}) {
  // Imagem que falha sai da tela; o texto fica, e é ele que diz quem é o prestador.
  const [falhou, setFalhou] = useState<{ claro: boolean; escuro: boolean }>({ claro: false, escuro: false });
  const semSelo = falhou.claro && falhou.escuro;

  return (
    <aside
      aria-label="Prestador dos serviços de pagamento"
      data-prestador-pagamentos=""
      className={cn("rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground", className)}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {!semSelo && (
          <a href={SITE_ASAAS} target="_blank" rel="noopener noreferrer" className="shrink-0 self-start sm:self-center" aria-label="Asaas (abre em nova aba)">
            {!falhou.claro && (
              <img
                src={SELO_ASAAS.positivo}
                alt="Serviços financeiros Asaas"
                width={TAMANHO_SELO.largura}
                height={TAMANHO_SELO.altura}
                className="block h-12 w-40 dark:hidden"
                onError={() => setFalhou((f) => ({ ...f, claro: true }))}
              />
            )}
            {!falhou.escuro && (
              <img
                src={SELO_ASAAS.negativoBranco}
                alt="Serviços financeiros Asaas"
                width={TAMANHO_SELO.largura}
                height={TAMANHO_SELO.altura}
                className="hidden h-12 w-40 dark:block"
                onError={() => setFalhou((f) => ({ ...f, escuro: true }))}
              />
            )}
          </a>
        )}
        <p className="leading-snug">{TEXTO_PRESTADOR}</p>
      </div>
      {atendimento && (
        <p className="mt-2 leading-snug">
          Dúvidas sobre o pagamento em si (fatura, PIX, boleto, cartão, conta): atendimento do Asaas,{" "}
          <a href={ATENDIMENTO_ASAAS.telefoneLink} className="underline underline-offset-2">
            {ATENDIMENTO_ASAAS.telefone}
          </a>{" "}
          ({ATENDIMENTO_ASAAS.observacaoTelefone}) e{" "}
          <a href={`mailto:${ATENDIMENTO_ASAAS.email}`} className="underline underline-offset-2">
            {ATENDIMENTO_ASAAS.email}
          </a>
          .
        </p>
      )}
    </aside>
  );
}
