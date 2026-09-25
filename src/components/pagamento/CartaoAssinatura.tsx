import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import {
  NOME_BANDEIRA,
  detectarBandeira,
  erroNoCartao,
  mascararNumero,
  type Bandeira,
  type DadosCartao,
  type DadosTitular,
} from "@/lib/cartao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, CreditCard, Lock } from "lucide-react";

/**
 * Forma de pagamento de uma assinatura do aluno — a do Método ARKE ou a
 * mensalidade do plano da academia — e o cadastro do cartão.
 *
 * Os dados do cartão vivem só no estado deste componente, só enquanto o
 * diálogo está aberto: não passam por rascunho (useRascunho), não vão para
 * storage nenhum e são apagados ao fechar — inclusive depois de salvar. O que
 * sobra depois é o que o banco guarda: bandeira e final de 4 dígitos.
 *
 * Desligado por padrão: com VITE_CARTAO_RECORRENTE diferente de "true" a tela
 * mostra a forma de pagamento atual e não oferece cadastro. A edge function tem
 * o próprio interruptor (CARTAO_RECORRENTE_ATIVO), e os dois precisam estar
 * ligados — ver a pendência de validação em sandbox no CLAUDE.md.
 */

// Função, e não constante de módulo: lida a cada renderização. Em produção dá
// no mesmo (o Vite fixa o valor no build); no teste, trocar a variável basta —
// antes cada teste recarregava o módulo inteiro, e a carga lenta de um vazava
// para o seguinte quando a máquina estava ocupada.
export function cartaoRecorrenteLigado(): boolean {
  return import.meta.env.VITE_CARTAO_RECORRENTE === "true";
}

export interface AssinaturaPagamento {
  status: string;
  asaas_subscription_id: string | null;
  forma_pagamento: string | null;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  cartao_recusado_em: string | null;
}

interface Props {
  alunoId: string;
  /** Qual assinatura recebe o cartão: a do Método ARKE (padrão) ou a mensalidade do plano da academia. */
  tipo?: "metodo" | "plano";
  assinatura: AssinaturaPagamento | null;
  /** Pré-preenche o titular com os dados do aluno; ele pode trocar. */
  titularPadrao?: Partial<DadosTitular>;
  onSalvo?: () => void;
  onErro?: (mensagem: string) => void;
  onSucesso?: (mensagem: string) => void;
}

const CARTAO_VAZIO: DadosCartao = { titular: "", numero: "", mes: "", ano: "", cvv: "" };
const TITULAR_VAZIO: DadosTitular = { nome: "", email: "", cpf: "", cep: "", numeroEndereco: "", telefone: "" };

function nomeBandeira(bandeira: string | null): string {
  return NOME_BANDEIRA[(bandeira ?? "outra") as Bandeira] ?? "Cartão";
}

export function CartaoAssinatura({ alunoId, tipo = "metodo", assinatura, titularPadrao, onSalvo, onErro, onSucesso }: Props) {
  const [aberto, setAberto] = useState(false);
  const [cartao, setCartao] = useState<DadosCartao>(CARTAO_VAZIO);
  const [titular, setTitular] = useState<DadosTitular>(TITULAR_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const emitida = !!assinatura?.asaas_subscription_id && ["ativa", "atrasada"].includes(assinatura.status);
  const noCartao = assinatura?.forma_pagamento === "cartao" && !!assinatura.cartao_final;

  function abrir() {
    setCartao(CARTAO_VAZIO);
    setTitular({ ...TITULAR_VAZIO, ...titularPadrao });
    setErro(null);
    setAberto(true);
  }

  // Fechar apaga tudo o que foi digitado — ver o comentário do topo.
  function fechar() {
    setAberto(false);
    setCartao(CARTAO_VAZIO);
    setTitular(TITULAR_VAZIO);
    setErro(null);
  }

  async function salvar() {
    const problema = erroNoCartao(cartao, titular);
    if (problema) {
      setErro(problema);
      return;
    }
    setEnviando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke<{ cartao_final: string; cartao_bandeira: string; error?: string }>(
      "asaas-cartao-assinatura",
      {
        body: {
          aluno_id: alunoId,
          tipo,
          cartao: cartao,
          titular: {
            nome: titular.nome,
            email: titular.email,
            cpf: titular.cpf,
            cep: titular.cep,
            numero_endereco: titular.numeroEndereco,
            telefone: titular.telefone,
          },
        },
      }
    );
    setEnviando(false);
    if (error || data?.error) {
      const mensagem = data?.error ?? (await mensagemDeErroEdge(error, "Não foi possível cadastrar o cartão."));
      setErro(mensagem);
      onErro?.(mensagem);
      return;
    }
    fechar();
    onSucesso?.(`Cartão ${nomeBandeira(data?.cartao_bandeira ?? null)} final ${data?.cartao_final} cadastrado. As próximas mensalidades serão cobradas nele.`);
    onSalvo?.();
  }

  const bandeiraDigitada = detectarBandeira(cartao.numero);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <CreditCard className="h-4 w-4 text-muted-foreground" />
        {!assinatura || !emitida ? (
          <span className="text-muted-foreground">Cobrança ainda não emitida.</span>
        ) : noCartao ? (
          <span>
            {nomeBandeira(assinatura.cartao_bandeira)} final <strong>{assinatura.cartao_final}</strong> · cobrança automática
          </span>
        ) : (
          <span>Fatura mensal (boleto, PIX ou cartão na página de pagamento)</span>
        )}
      </div>

      {emitida && assinatura?.cartao_recusado_em && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>O cartão foi recusado na última cobrança. Atualize o cartão ou pague pela fatura antes do vencimento.</span>
        </div>
      )}

      {cartaoRecorrenteLigado() && emitida && (
        <Button size="sm" variant="outline" onClick={abrir}>
          <CreditCard className="mr-1.5 h-3.5 w-3.5" />
          {noCartao ? "Trocar cartão" : "Pagar automático no cartão"}
        </Button>
      )}

      <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{noCartao ? "Trocar cartão" : "Cobrança automática no cartão"}</DialogTitle>
            <DialogDescription>
              A mensalidade passa a ser cobrada no cartão a cada mês, sem precisar pagar fatura. Nada é cobrado agora.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault();
              void salvar();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="cc-titular">Nome impresso no cartão</Label>
              <Input
                id="cc-titular"
                autoComplete="cc-name"
                value={cartao.titular}
                onChange={(e) => setCartao((c) => ({ ...c, titular: e.target.value.toUpperCase() }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-numero">
                Número do cartão
                {cartao.numero && bandeiraDigitada !== "outra" && (
                  <span className="ml-2 text-xs text-muted-foreground">{NOME_BANDEIRA[bandeiraDigitada]}</span>
                )}
              </Label>
              <Input
                id="cc-numero"
                inputMode="numeric"
                autoComplete="cc-number"
                value={mascararNumero(cartao.numero)}
                onChange={(e) => setCartao((c) => ({ ...c, numero: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="cc-mes">Mês</Label>
                <Input id="cc-mes" inputMode="numeric" autoComplete="cc-exp-month" placeholder="MM" maxLength={2}
                  value={cartao.mes} onChange={(e) => setCartao((c) => ({ ...c, mes: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cc-ano">Ano</Label>
                <Input id="cc-ano" inputMode="numeric" autoComplete="cc-exp-year" placeholder="AAAA" maxLength={4}
                  value={cartao.ano} onChange={(e) => setCartao((c) => ({ ...c, ano: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cc-cvv">CVV</Label>
                <Input id="cc-cvv" type="password" inputMode="numeric" autoComplete="cc-csc" maxLength={4}
                  value={cartao.cvv} onChange={(e) => setCartao((c) => ({ ...c, cvv: e.target.value }))} />
              </div>
            </div>

            <p className="pt-1 text-xs font-medium text-muted-foreground">Dados do titular</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 space-y-1">
                <Label htmlFor="tit-nome">Nome completo</Label>
                <Input id="tit-nome" autoComplete="name" value={titular.nome}
                  onChange={(e) => setTitular((t) => ({ ...t, nome: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tit-cpf">CPF</Label>
                <Input id="tit-cpf" inputMode="numeric" value={titular.cpf}
                  onChange={(e) => setTitular((t) => ({ ...t, cpf: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tit-tel">Telefone com DDD</Label>
                <Input id="tit-tel" inputMode="tel" autoComplete="tel" value={titular.telefone}
                  onChange={(e) => setTitular((t) => ({ ...t, telefone: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label htmlFor="tit-email">E-mail</Label>
                <Input id="tit-email" type="email" autoComplete="email" value={titular.email}
                  onChange={(e) => setTitular((t) => ({ ...t, email: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tit-cep">CEP</Label>
                <Input id="tit-cep" inputMode="numeric" autoComplete="postal-code" value={titular.cep}
                  onChange={(e) => setTitular((t) => ({ ...t, cep: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tit-num">Número</Label>
                <Input id="tit-num" value={titular.numeroEndereco}
                  onChange={(e) => setTitular((t) => ({ ...t, numeroEndereco: e.target.value }))} />
              </div>
            </div>

            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}

            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" />
              O cartão vai direto ao Asaas, nosso processador de pagamento. O ARKE guarda só a bandeira e os 4 últimos dígitos.
            </p>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={fechar} disabled={enviando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={enviando}>
                {enviando ? "Salvando..." : "Salvar cartão"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
