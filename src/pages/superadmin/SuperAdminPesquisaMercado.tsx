import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Download, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErroAoCarregar } from "@/components/ErroAoCarregar";
import { podeArea } from "@/lib/acessosArkefit";
import { formatarDataBR, hojeBrasilia } from "@/lib/dataBrasilia";
import { baixarCsv } from "@/lib/exportarPlanilha";
import { decimal } from "@/lib/numeros";
import { todasAsLinhas } from "@/lib/paginar";
import {
  BLOCOS,
  ESCALA,
  chaveDoTexto,
  contarOpcoes,
  linhasDoCsv,
  recursosPorEssencial,
  textosDe,
  type ContagemOpcao,
  type Pergunta,
  type Respostas,
} from "../../../supabase/functions/pesquisa-mercado/questionario";

const LINK_PUBLICO = "https://arkefit.com.br/#/pesquisa";

type Linha = { id: string; versao: number; respondida_em: string; respostas: Respostas };

const pct = (n: number) => `${decimal(n, 0)}%`;

/** Uma barra por opção: o rótulo, a contagem e o percentual sobre quem respondeu. */
function Barras({ opcoes }: { opcoes: ContagemOpcao[] }) {
  return (
    <ul className="space-y-2.5">
      {opcoes.map((o) => (
        <li key={o.id}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-foreground">{o.rotulo}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {o.total} · {pct(o.pct)}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${o.pct}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CartaoPergunta({ p, lista }: { p: Pergunta; lista: Respostas[] }) {
  const { responderam, opcoes } = contarOpcoes(p, lista);
  const comTexto = p.tipo === "unica" ? p.comTexto : undefined;
  const textos = comTexto ? textosDe(chaveDoTexto(p.id), lista) : [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {p.numero}. {p.titulo}
        </CardTitle>
        <CardDescription>
          {responderam} {responderam === 1 ? "respondeu" : "responderam"}
          {p.tipo === "varias" && ` · até ${p.max} escolhas, a soma passa de 100%`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Barras opcoes={opcoes} />
        {textos.length > 0 && <Textos titulo={`${comTexto!.rotulo.replace(" (opcional)", "")} (${textos.length})`} textos={textos} />}
      </CardContent>
    </Card>
  );
}

function Textos({ titulo, textos }: { titulo: string; textos: string[] }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">{titulo}</p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border p-3 text-sm text-foreground">
        {textos.map((t, i) => (
          <li key={i} className="whitespace-pre-wrap break-words border-b border-border pb-1.5 last:border-0 last:pb-0">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Visão Master → Pesquisa de mercado (área comercial): o total de respostas, a
 * distribuição de cada pergunta e a exportação das respostas em CSV, sem
 * e-mail. Os e-mails de quem pediu o resultado saem num CSV à parte, só para o
 * Sócio, e a exportação fica na Auditoria.
 */
export default function SuperAdminPesquisaMercado() {
  const { acessoArkefit } = useAuth();
  const { toast } = useToast();
  const [exportandoEmails, setExportandoEmails] = useState(false);

  const consulta = useQuery({
    queryKey: ["superadmin-pesquisa-mercado"],
    queryFn: async () =>
      (await todasAsLinhas((de, ate) =>
        supabase.rpc("get_superadmin_pesquisa_mercado").order("respondida_em").order("id").range(de, ate),
      )) as unknown as Linha[],
  });
  const linhas = useMemo(() => consulta.data ?? [], [consulta.data]);
  const lista = useMemo(() => linhas.map((l) => l.respostas ?? {}), [linhas]);
  const recursos = useMemo(() => recursosPorEssencial(lista), [lista]);

  const exportarEmails = async () => {
    setExportandoEmails(true);
    try {
      const { data, error } = await supabase.rpc("exportar_emails_pesquisa_mercado");
      if (error) throw error;
      const emails = (data ?? []) as { email: string; resultado_autorizado_em: string | null; conhecer_autorizado_em: string | null }[];
      baixarCsv(`pesquisa-de-mercado_emails_${hojeBrasilia()}.csv`, [
        ["E-mail", "Autorizou receber o resultado em", "Quer conhecer o ArkeFit desde"],
        ...emails.map((e) => [
          e.email,
          e.resultado_autorizado_em ? formatarDataBR(e.resultado_autorizado_em) : null,
          e.conhecer_autorizado_em ? formatarDataBR(e.conhecer_autorizado_em) : null,
        ]),
      ]);
      toast({ title: "E-mails exportados", description: `${emails.length} ${emails.length === 1 ? "e-mail" : "e-mails"}. A exportação ficou na Auditoria.` });
    } catch (e) {
      toast({ title: "Não foi possível exportar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setExportandoEmails(false);
    }
  };

  const total = linhas.length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-xl font-bold">Pesquisa de mercado</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        O que donos e gestores dizem que faz diferença num sistema de gestão. A pesquisa é pública e anônima, em{" "}
        <a href={LINK_PUBLICO} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
          arkefit.com.br/#/pesquisa <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
        . Quem marca "Quero também conhecer o ArkeFit" entra no Pipeline como contato do site, e a Letícia responde.
      </p>

      {consulta.error ? (
        <Card>
          <ErroAoCarregar oQue="as respostas da pesquisa" onTentarDeNovo={() => void consulta.refetch()} tentando={consulta.isFetching} />
        </Card>
      ) : consulta.isLoading ? (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Carregando as respostas…
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-3xl font-bold tabular-nums">{total}</p>
                <p className="text-sm text-muted-foreground">
                  {total === 1 ? "resposta" : "respostas"}
                  {total > 0 && ` · de ${formatarDataBR(linhas[0].respondida_em)} a ${formatarDataBR(linhas[total - 1].respondida_em)}`}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="sm" variant="outline" disabled={!total} onClick={() => baixarCsv(`pesquisa-de-mercado_${hojeBrasilia()}.csv`, linhasDoCsv(linhas))}>
                  <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Respostas (CSV)
                </Button>
                {podeArea(acessoArkefit, "socio") && (
                  <Button size="sm" variant="outline" disabled={exportandoEmails} onClick={() => void exportarEmails()}>
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    {exportandoEmails ? "Exportando..." : "E-mails para o resultado (CSV)"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {total === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma resposta ainda. Divulgue o link da pesquisa.</p>
          ) : (
            BLOCOS.map((b) => (
              <section key={b.titulo} aria-labelledby={`resultado-${b.titulo}`} className="space-y-3 pt-2">
                <h2 id={`resultado-${b.titulo}`} className="text-base font-semibold">
                  {b.titulo}
                </h2>
                {b.perguntas.every((p) => p.tipo === "escala") ? (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Do mais essencial ao menos</CardTitle>
                      <CardDescription>A barra é o "uso e é essencial". Os números são de quem respondeu cada recurso.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ol className="space-y-4">
                        {recursos.map((r) => (
                          <li key={r.pergunta.id}>
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="font-medium text-foreground">
                                {r.pergunta.numero}. {r.pergunta.titulo}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">{pct(r.opcoes[0].pct)}</span>
                            </div>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                              <div className="h-full rounded-full bg-primary" style={{ width: `${r.opcoes[0].pct}%` }} />
                            </div>
                            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                              {r.opcoes.map((o, i) => (
                                <div key={o.id} className="flex gap-1">
                                  <dt>{ESCALA[i].rotulo}:</dt>
                                  <dd className="tabular-nums text-foreground">
                                    {o.total} ({pct(o.pct)})
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {b.perguntas.map((p) =>
                      p.tipo === "texto" ? (
                        <Card key={p.id} className="md:col-span-2">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base">
                              {p.numero}. {p.titulo}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {textosDe(p.id, lista).length ? (
                              <Textos titulo={`${textosDe(p.id, lista).length} respostas`} textos={textosDe(p.id, lista)} />
                            ) : (
                              <p className="text-sm text-muted-foreground">Ninguém escreveu ainda.</p>
                            )}
                          </CardContent>
                        </Card>
                      ) : (
                        <CartaoPergunta key={p.id} p={p} lista={lista} />
                      ),
                    )}
                  </div>
                )}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
