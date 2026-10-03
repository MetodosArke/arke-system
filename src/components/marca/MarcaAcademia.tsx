import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { coresDaMarca, cssDaMarca, enderecoDoManifesto, slugDeEntrada, slugValido } from "@/lib/marcaAcademia";
import { SimboloArkeFit } from "@/components/marca/MarcaArkeFit";

/**
 * A marca da academia no app do aluno (decisão do responsável de 03/10/2026).
 *
 * De onde ela vem, por ordem:
 * - aluno logado, em `/app`: a academia dele, do `AuthContext`;
 * - páginas da academia (`/p/<slug>`, `/p/<slug>/entrar`, primeiro acesso);
 * - telas de entrar e de senha abertas a partir delas ou do app instalado
 *   (`?academia=<slug>`, guardado na aba por `main.tsx`).
 * O painel da equipe e a Visão Master seguem ArkeFit.
 */
export interface MarcaAcademia {
  slug: string;
  nome: string;
  logoUrl: string | null;
  cor: string | null;
  icone192: string | null;
  icone512: string | null;
}

const MarcaContext = createContext<MarcaAcademia | null>(null);

export function useMarcaAcademia(): MarcaAcademia | null {
  return useContext(MarcaContext);
}

export const CHAVE_ENTRADA = "arke:academia-entrada";

/** A academia pela qual a pessoa entrou nesta aba. */
export function lerEntrada(): string | null {
  try {
    const s = window.sessionStorage.getItem(CHAVE_ENTRADA) ?? "";
    return slugValido(s) ? s : null;
  } catch {
    return null;
  }
}

export function guardarEntrada(slug: string) {
  try {
    window.sessionStorage.setItem(CHAVE_ENTRADA, slug);
  } catch {
    // sem storage: a marca vale só na própria tela da academia
  }
}

/** O link do manifesto e o do ícone do iPhone, conforme a academia. Chamado também por `main.tsx`, antes do React. */
export function apontarManifesto(slug: string | null) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link) link.href = slug ? enderecoDoManifesto(slug) : "/manifest.json";
}

const PADRAO = { titulo: "", iconeApple: "" };

function aplicarNoDocumento(marca: MarcaAcademia | null) {
  if (!PADRAO.titulo) {
    PADRAO.titulo = document.title;
    PADRAO.iconeApple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? "/apple-touch-icon.png";
  }

  let estilo = document.getElementById("marca-academia") as HTMLStyleElement | null;
  const cores = marca ? coresDaMarca(marca.cor) : null;
  if (cores) {
    if (!estilo) {
      estilo = document.createElement("style");
      estilo.id = "marca-academia";
      document.head.appendChild(estilo);
    }
    estilo.textContent = cssDaMarca(cores);
  } else {
    estilo?.remove();
  }

  apontarManifesto(marca?.slug ?? null);

  const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (apple) apple.setAttribute("href", marca?.icone192 ?? PADRAO.iconeApple);

  // O nome embaixo do ícone no iPhone, quando o aluno adiciona à tela de início.
  let tituloApple = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (marca) {
    if (!tituloApple) {
      tituloApple = document.createElement("meta");
      tituloApple.name = "apple-mobile-web-app-title";
      document.head.appendChild(tituloApple);
    }
    tituloApple.content = marca.nome;
  } else {
    tituloApple?.remove();
  }

  document.title = marca ? marca.nome : PADRAO.titulo;
}

function slugDaRotaPublica(pathname: string): string | null {
  const m = /^\/p\/([^/]+)/.exec(pathname);
  if (!m) return null;
  const s = decodeURIComponent(m[1]).toLowerCase();
  return slugValido(s) ? s : null;
}

/** Fica dentro do roteador: a marca depende da tela. */
export function MarcaAcademiaProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { organization, organizationRole, isLoading, isAuthenticated, rolesLoaded } = useAuth();

  const doAluno: MarcaAcademia | null =
    pathname.startsWith("/app") && organizationRole === "aluno" && organization
      ? {
          slug: organization.slug,
          nome: organization.nome,
          logoUrl: organization.logoUrl,
          cor: organization.corMarca,
          icone192: organization.icone192,
          icone512: organization.icone512,
        }
      : null;

  const daRota = slugDaRotaPublica(pathname);
  const slugBusca = doAluno ? null : (daRota ?? (pathname.startsWith("/auth/") ? lerEntrada() : null));

  useEffect(() => {
    if (daRota) guardarEntrada(daRota);
  }, [daRota]);

  const { data: publica, isPending } = useQuery({
    queryKey: ["marca-academia", slugBusca],
    queryFn: async (): Promise<MarcaAcademia | null> => {
      const { data, error } = await supabase.rpc("marca_academia", { _slug: slugBusca! });
      if (error) throw error;
      const m = data as { nome: string; slug: string; logo_url: string | null; cor_marca: string | null; icone_192: string | null; icone_512: string | null } | null;
      return m
        ? { slug: m.slug, nome: m.nome, logoUrl: m.logo_url, cor: m.cor_marca, icone192: m.icone_192, icone512: m.icone_512 }
        : null;
    },
    enabled: !!slugBusca,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const marca = doAluno ?? (slugBusca ? publica ?? null : null);

  // Enquanto a marca carrega, nada muda no documento. Voltar ao manifesto da
  // ArkeFit por um instante e depois ir ao da academia fazia o navegador às
  // vezes ficar com o do meio, e o app seria instalado com o nome errado; e
  // no app do aluno, as cores piscavam no amarelo antes da academia.
  const aguardando =
    (!!slugBusca && isPending) || (pathname.startsWith("/app") && (isLoading || (isAuthenticated && !rolesLoaded)));

  useEffect(() => {
    if (aguardando) return;
    aplicarNoDocumento(marca);
  }, [aguardando, marca?.slug, marca?.nome, marca?.cor, marca?.icone192]); // eslint-disable-line react-hooks/exhaustive-deps

  return <MarcaContext.Provider value={marca}>{children}</MarcaContext.Provider>;
}

/** Logo e nome da academia. Sem logo, só o nome. */
export function LogoAcademia({
  marca,
  className,
  tamanho = "md",
  soLogo = false,
}: {
  marca: MarcaAcademia;
  className?: string;
  tamanho?: "md" | "lg";
  soLogo?: boolean;
}) {
  const altura = tamanho === "lg" ? "h-14" : "h-8";
  return (
    <span className={cn("flex min-w-0 items-center gap-2", tamanho === "lg" && "flex-col gap-3", className)}>
      {marca.logoUrl ? (
        <img src={marca.logoUrl} alt={`Logo da ${marca.nome}`} className={cn(altura, "w-auto max-w-[9rem] shrink-0 object-contain")} />
      ) : soLogo ? (
        <span
          aria-hidden
          className={cn(altura, "flex aspect-square items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground")}
        >
          {marca.nome.trim().charAt(0).toUpperCase()}
        </span>
      ) : null}
      {!soLogo && (
        // font-sans: dentro de um h1 o app usaria a fonte serifada dos títulos.
        <span className={cn("truncate font-sans font-semibold text-foreground", tamanho === "lg" ? "text-xl" : "text-sm")}>{marca.nome}</span>
      )}
    </span>
  );
}

/** "com tecnologia ArkeFit", discreto, no rodapé do menu e na tela de entrar. */
export function ComTecnologiaArkeFit({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      {/* O símbolo em cinza: em amarelo competiria com a marca da academia, e em
          text-primary sairia na cor dela. */}
      com tecnologia <SimboloArkeFit className="h-3 w-auto text-muted-foreground" decorativo /> ArkeFit
    </span>
  );
}

/** O selo do Método ARKE nas telas do Método, para o aluno saber que ali o acompanhamento é da ArkeFit. */
export function SeloMetodoArke({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <img src="/logo.png" alt="" aria-hidden className="h-3.5 w-3.5" />
      Método ARKE
    </span>
  );
}
