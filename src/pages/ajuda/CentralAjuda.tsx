import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownSimples } from "@/lib/markdownSimples";
import { artigoPorSlug, artigosPara, buscarArtigos, type ArtigoAjuda } from "@/lib/ajuda/catalogo";
import { TEXTOS_AJUDA } from "@/lib/ajuda/textos";
import { useAjuda } from "@/components/ajuda/useAjuda";
import { SuporteBotao } from "@/components/admin/onboarding/SuporteBotao";
import { cn } from "@/lib/utils";

type Grupo = "Painel da academia" | "App do aluno" | "Visão Master";
const GRUPOS: Grupo[] = ["Painel da academia", "App do aluno", "Visão Master"];

const grupoDe = (a: ArtigoAjuda): Grupo =>
  a.publicos.every((p) => p === "arkefit") ? "Visão Master" : a.publicos.every((p) => p === "aluno") ? "App do aluno" : "Painel da academia";

/** Seções na ordem em que aparecem no catálogo. */
function porSecao(artigos: ArtigoAjuda[]) {
  const secoes = new Map<string, ArtigoAjuda[]>();
  for (const a of artigos) secoes.set(a.secao, [...(secoes.get(a.secao) ?? []), a]);
  return [...secoes.entries()];
}

function Rodape({ area }: { area: string }) {
  if (area === "app") {
    return (
      <p className="text-sm text-muted-foreground">
        Ainda com dúvida? Fale com a recepção da sua academia ou use o botão de ajuda na tela inicial.
      </p>
    );
  }
  if (area === "superadmin") return null;
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">Não achou o que procurava?</p>
      <SuporteBotao
        contexto="Central de Ajuda"
        mensagem="Olá! Tenho uma dúvida sobre o ARKE que não encontrei na Central de Ajuda."
        assunto="Dúvida sobre o ARKE"
        pergunta="Fale com o suporte da ArkeFit:"
      />
    </div>
  );
}

function Artigo({ artigo, base, area, publicos }: { artigo: ArtigoAjuda; base: string; area: string; publicos: ReturnType<typeof useAjuda>["publicos"] }) {
  const texto = TEXTOS_AJUDA[artigo.slug] ?? "";
  const resolverLink = (destino: string) => (destino.startsWith("ajuda:") ? `${base}/${destino.slice(6)}` : destino);
  const relacionados = artigosPara(publicos)
    .filter((a) => a.secao === artigo.secao && a.slug !== artigo.slug)
    .slice(0, 4);

  useEffect(() => {
    document.title = `${artigo.titulo} — Ajuda ARKE`;
    window.scrollTo(0, 0);
  }, [artigo.titulo]);

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={base} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Central de Ajuda
        </Link>
        <Button variant={artigo.imprimivel ? "default" : "outline"} size="sm" onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Imprimir ou salvar em PDF
        </Button>
      </div>
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-primary">{artigo.secao}</p>
        <h1 className="text-2xl font-bold">{artigo.titulo}</h1>
        <p className="text-muted-foreground">{artigo.resumo}</p>
      </header>
      <MarkdownSimples texto={texto} resolverLink={resolverLink} />
      {relacionados.length > 0 && (
        <nav className="space-y-2 border-t pt-4" aria-label="Veja também">
          <p className="text-sm font-semibold">Veja também</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {relacionados.map((a) => (
              <li key={a.slug}>
                <Link to={`${base}/${a.slug}`} className="block rounded-md border px-3 py-2 text-sm hover:bg-muted">
                  {a.titulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="border-t pt-4">
        <Rodape area={area} />
      </div>

      {/* A versão impressa: só o artigo, fora do layout do painel. */}
      {createPortal(
        <div className="print-only print-area print-area--documento">
          <p style={{ fontSize: 11, color: "#555" }}>ARKE · Central de Ajuda · {artigo.secao}</p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 8px" }}>{artigo.titulo}</h1>
          <MarkdownSimples texto={texto} resolverLink={resolverLink} />
        </div>,
        document.body,
      )}
    </article>
  );
}

export default function CentralAjuda() {
  const { slug } = useParams();
  const { area, publicos, base } = useAjuda();
  const [busca, setBusca] = useState("");
  const artigos = useMemo(() => artigosPara(publicos), [publicos]);
  const grupos = useMemo(() => GRUPOS.filter((g) => artigos.some((a) => grupoDe(a) === g)), [artigos]);
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const grupoAtivo = grupo && grupos.includes(grupo) ? grupo : grupos[0];

  useEffect(() => {
    if (!slug) document.title = "Central de Ajuda — ARKE";
  }, [slug]);

  if (slug) {
    const artigo = artigoPorSlug(slug, publicos);
    if (!artigo) {
      return (
        <div className="mx-auto max-w-3xl space-y-3">
          <p className="text-muted-foreground">Este artigo não existe ou não é para o seu perfil.</p>
          <Link to={base} className="text-primary underline">
            Voltar à Central de Ajuda
          </Link>
        </div>
      );
    }
    return <Artigo artigo={artigo} base={base} area={area} publicos={publicos} />;
  }

  const resultados = busca.trim() ? buscarArtigos(busca, artigos, TEXTOS_AJUDA) : null;
  const visiveis = artigos.filter((a) => grupoDe(a) === grupoAtivo);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Central de Ajuda</h1>
        <p className="text-muted-foreground">
          {area === "app"
            ? "Como usar o app da sua academia, passo a passo."
            : area === "superadmin"
              ? "Todos os artigos: os da Visão Master e os que as academias e os alunos leem."
              : "Como fazer as tarefas do dia a dia no ARKE. Em cada tela, o ? no alto abre o artigo dela."}
        </p>
      </header>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar: importar alunos, segunda via, catraca…"
          aria-label="Buscar na Central de Ajuda"
          className="pl-9"
        />
      </div>

      {resultados ? (
        resultados.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum artigo com essas palavras. Tente outras, mais curtas.</p>
        ) : (
          <ul className="space-y-2">
            {resultados.map(({ artigo, trecho }) => (
              <li key={artigo.slug}>
                <Link to={`${base}/${artigo.slug}`} className="block rounded-lg border p-3 hover:bg-muted">
                  <p className="font-medium">{artigo.titulo}</p>
                  <p className="text-sm text-muted-foreground">{trecho ?? artigo.resumo}</p>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {grupos.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Área">
              {grupos.map((g) => (
                <Button key={g} role="tab" aria-selected={g === grupoAtivo} size="sm" variant={g === grupoAtivo ? "default" : "outline"} onClick={() => setGrupo(g)}>
                  {g}
                </Button>
              ))}
            </div>
          )}
          {artigos.length === 0 && <p className="text-sm text-muted-foreground">Ainda não há artigos para o seu perfil.</p>}
          {porSecao(visiveis).map(([secao, lista]) => (
            <section key={secao} className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{secao}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {lista.map((a) => (
                  <Link key={a.slug} to={`${base}/${a.slug}`} className="group">
                    <Card className={cn("h-full transition-colors group-hover:border-primary/60")}>
                      <CardContent className="space-y-1 p-4">
                        <p className="font-medium">{a.titulo}</p>
                        <p className="text-sm text-muted-foreground">{a.resumo}</p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          <div className="border-t pt-4">
            <Rodape area={area} />
          </div>
        </>
      )}
    </div>
  );
}
