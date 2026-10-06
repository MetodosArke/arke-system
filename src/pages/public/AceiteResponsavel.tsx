import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { formatarDataBR } from "@/lib/dataBrasilia";
import { AVISO_PROCESSAMENTO_IA } from "@/lib/consentimentoIA";
import { PROPOSITOS_RESPONSAVEL, type PropositoResponsavel } from "@/lib/menorDeIdade";
import { TEXTOS_CONSENTIMENTO, VERSAO_DO_PROPOSITO } from "@/lib/textosConsentimento";
import { LinksLegais } from "@/components/legal/LinksLegais";

type Consulta =
  | {
      situacao: "aberto";
      aluno_primeiro_nome: string | null;
      academia: string | null;
      responsavel_nome: string;
      propositos: string[];
      expira_em: string;
    }
  | { situacao: "inexistente" | "expirado" | "cancelado" }
  | { situacao: "respondido"; respondido_em: string };

type Resposta = { nome: string; propositos: PropositoResponsavel[] };

const ehProposito = (p: string): p is PropositoResponsavel => (PROPOSITOS_RESPONSAVEL as readonly string[]).includes(p);

/**
 * A página do link que o responsável legal do aluno menor recebe por e-mail
 * (`/responsavel/<token>`, sem login; decisão de 06/10/2026).
 *
 * Mostra o primeiro nome do aluno, a academia e, para cada item pedido, o
 * texto de consentimento que o aluno lê no app — os mesmos textos, nas mesmas
 * versões (`lib/textosConsentimento`). Nenhum texto jurídico novo: o cabeçalho
 * só diz que quem marca autoriza como responsável legal. O responsável marca
 * cada item e confirma; a função grava nome, e-mail, propósito, versão e hash
 * do texto, com data e hora. Abrir a página não aceita nada.
 */
export default function AceiteResponsavel() {
  const { token } = useParams<{ token: string }>();
  const [marcados, setMarcados] = useState<PropositoResponsavel[]>([]);
  const [nome, setNome] = useState<string | null>(null);
  const [resultado, setResultado] = useState<number | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["aceite-responsavel", token],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<Consulta>("responsavel-aceite", {
        body: { acao: "consultar", token },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível abrir o pedido agora."));
      return data ?? { situacao: "inexistente" as const };
    },
    enabled: !!token,
    retry: 1,
    staleTime: Infinity,
  });

  const responder = useMutation({
    mutationFn: async (r: Resposta) => {
      const versoes = Object.fromEntries(r.propositos.map((p) => [p, VERSAO_DO_PROPOSITO[p]]));
      const { data, error } = await supabase.functions.invoke<{ autorizados?: number }>("responsavel-aceite", {
        body: { acao: "aceitar", token, nome: r.nome, propositos: r.propositos, versoes },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível registrar a resposta agora."));
      return data?.autorizados ?? 0;
    },
    onSuccess: (n) => setResultado(n),
  });

  const pagina = (conteudo: React.ReactNode) => (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4">
        {conteudo}
        <LinksLegais />
      </div>
    </div>
  );

  if (isLoading) {
    return pagina(
      <div className="flex justify-center py-20">
        <div role="status" aria-label="Carregando" className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Falha nossa não é link expirado: a página não diz que o link morreu.
  if (isError || !data) {
    return pagina(
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <p className="font-medium">Não foi possível abrir o pedido agora</p>
          <p className="text-sm text-muted-foreground">O link continua valendo. Tente de novo em instantes.</p>
          <Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Tentando..." : "Tentar de novo"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (data.situacao !== "aberto") {
    const mensagens: Record<string, [string, string]> = {
      inexistente: ["Link inválido", "Confira se o endereço foi copiado inteiro do e-mail."],
      expirado: ["Este link expirou", "O pedido vale 7 dias. Peça um novo ao aluno ou à academia."],
      cancelado: [
        "Este link não vale mais",
        "Ele foi substituído por um pedido mais novo (use o link do último e-mail), ou a autorização deixou de ser necessária.",
      ],
      respondido: [
        "Este pedido já foi respondido",
        "Para mudar a resposta, peça um novo link ao aluno ou à academia. Para retirar uma autorização, fale com a academia.",
      ],
    };
    const [titulo, texto] = mensagens[data.situacao] ?? mensagens.inexistente;
    return pagina(
      <Card>
        <CardContent className="space-y-2 py-8 text-center">
          <p className="font-medium">{titulo}</p>
          <p className="text-sm text-muted-foreground">
            {texto}
            {data.situacao === "respondido" && ` Respondido em ${formatarDataBR(data.respondido_em)}.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  const aluno = data.aluno_primeiro_nome?.trim() || "o aluno";
  const academia = data.academia?.trim() || "a academia";
  const propositos = data.propositos.filter(ehProposito);
  const nomeAtual = nome ?? data.responsavel_nome;

  if (resultado !== null) {
    return pagina(
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          <p className="font-medium">Resposta registrada</p>
          <p className="text-sm text-muted-foreground">
            {resultado === 0
              ? `Você não autorizou nenhum item. Se mudar de ideia, peça um novo link a ${aluno} ou à academia.`
              : `${resultado === 1 ? "Um item autorizado" : `${resultado} itens autorizados`}. Agora ${aluno} pode ligar cada autorização no app. Para retirar uma autorização a qualquer momento, fale com a academia.`}
          </p>
        </CardContent>
      </Card>
    );
  }

  const alternar = (p: PropositoResponsavel, marcado: boolean) =>
    setMarcados((atual) => (marcado ? [...new Set([...atual, p])] : atual.filter((x) => x !== p)));

  return pagina(
    <>
      <div className="space-y-1 text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-xl font-bold">Autorização do responsável legal</h1>
        <p className="text-sm text-muted-foreground">{academia}</p>
      </div>

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <p>
            {aluno} tem menos de 18 anos e indicou você como responsável legal no ArkeFit, o app da {academia}. Os itens
            abaixo dependem da sua autorização (Lei 13.709/2018, art. 14).
          </p>
          <p className="text-muted-foreground">
            Cada item traz o texto que {aluno} lê no app. Onde ele diz "meu" ou "minha", trata-se dos dados de {aluno}.
            Marque o que você autoriza, como responsável legal; o que ficar sem marcar não é autorizado. Depois, quem
            liga cada autorização no app é {aluno}, e ela pode ser retirada a qualquer momento, pela academia.
          </p>
          <p className="text-xs text-muted-foreground">Este link vale até {formatarDataBR(data.expira_em)}.</p>
        </CardContent>
      </Card>

      {propositos.map((p) => {
        const t = TEXTOS_CONSENTIMENTO[p];
        const ia = p === "ia_anamnese" || p === "ia_chat";
        return (
          <Card key={p}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(ia ? t.paragrafos.slice(0, 1) : t.paragrafos).map((paragrafo, i) => (
                <p key={i} className="text-sm text-muted-foreground">
                  {paragrafo}
                </p>
              ))}
              {ia && (
                <p className="text-sm text-muted-foreground">
                  {AVISO_PROCESSAMENTO_IA.map((s, i) => (s.destaque ? <strong key={i}>{s.texto}</strong> : <span key={i}>{s.texto}</span>))}
                </p>
              )}
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <Checkbox
                  id={`autorizo-${p}`}
                  checked={marcados.includes(p)}
                  onCheckedChange={(v) => alternar(p, v === true)}
                />
                <Label htmlFor={`autorizo-${p}`} className="text-sm font-normal leading-snug">
                  Autorizo, como responsável legal de {aluno}. <span className="text-muted-foreground">(versão {t.versao})</span>
                </Label>
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              responder.mutate({ nome: nomeAtual, propositos: marcados });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nome-responsavel">Seu nome completo</Label>
              <Input id="nome-responsavel" required value={nomeAtual} onChange={(e) => setNome(e.target.value)} />
            </div>
            {responder.isError && <p className="text-sm text-destructive">{(responder.error as Error).message}</p>}
            <Button type="submit" className="w-full" disabled={responder.isPending || !nomeAtual.trim()}>
              {responder.isPending
                ? "Registrando..."
                : marcados.length === 0
                  ? "Confirmar que não autorizo nenhum item"
                  : `Confirmar ${marcados.length === 1 ? "a autorização marcada" : `as ${marcados.length} autorizações marcadas`}`}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
