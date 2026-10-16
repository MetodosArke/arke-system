import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BadgeCheck, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { useRascunho } from "@/hooks/useRascunho";
import { Turnstile } from "@/components/public/Turnstile";
import { MarcaArkeFit } from "@/components/marca/MarcaArkeFit";
import { cn } from "@/lib/utils";
import {
  BLOCOS,
  ESCALA,
  PERGUNTAS,
  VERSAO_QUESTIONARIO,
  chaveDoTexto,
  obrigatoria,
  validarContato,
  validarRespostas,
  visivel,
  type Pergunta,
  type Respostas,
} from "../../../supabase/functions/pesquisa-mercado/questionario";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

type ContatoDigitado = { email: string; resultado: boolean; conhecer: boolean; nome: string; academia: string };
type Estado = { respostas: Respostas; contato: ContatoDigitado };
const VAZIO: Estado = { respostas: {}, contato: { email: "", resultado: false, conhecer: false, nome: "", academia: "" } };

/** A opção de rádio ou de caixa, como um botão largo que se toca no celular. */
const OPCAO =
  "flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground transition-colors hover:border-primary/60 has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50";
const CAMPO =
  "w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const respondida = (v: string | string[] | undefined) => (Array.isArray(v) ? v.length > 0 : !!v);

function levarAte(id: string) {
  const alvo = document.getElementById(`p-${id}`);
  alvo?.scrollIntoView({ behavior: "smooth", block: "center" });
  alvo?.focus({ preventScroll: true });
}

function Cartao({ id, legenda, erro, children }: { id: string; legenda: ReactNode; erro: string | null; children: ReactNode }) {
  return (
    <fieldset
      id={`p-${id}`}
      tabIndex={-1}
      className={cn(
        "rounded-2xl border bg-card p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5",
        erro ? "border-destructive" : "border-border",
      )}
    >
      {/* float: o legend dentro do cartão, e não em cima da borda */}
      <legend className="float-left mb-3 w-full text-base font-semibold text-foreground">{legenda}</legend>
      <div className="clear-both space-y-2">{children}</div>
      {erro && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {erro}
        </p>
      )}
    </fieldset>
  );
}

function CampoDaPergunta({
  p,
  respostas,
  mudar,
  erro,
}: {
  p: Pergunta;
  respostas: Respostas;
  mudar: (chave: string, valor: string | string[] | undefined) => void;
  erro: string | null;
}) {
  const valor = respostas[p.id];
  const legenda = `${p.numero}. ${p.titulo}`;

  if (p.tipo === "texto") {
    return (
      <div id={`p-${p.id}`} tabIndex={-1} className="rounded-2xl border border-border bg-card p-4 focus:outline-none sm:p-5">
        <label htmlFor={`campo-${p.id}`} className="mb-3 block text-base font-semibold text-foreground">
          {legenda} <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <textarea
          id={`campo-${p.id}`}
          rows={3}
          maxLength={p.max}
          value={typeof valor === "string" ? valor : ""}
          onChange={(e) => mudar(p.id, e.target.value)}
          className={cn(CAMPO, "resize-y")}
        />
      </div>
    );
  }

  if (p.tipo === "varias") {
    const marcadas = Array.isArray(valor) ? valor : [];
    return (
      <Cartao id={p.id} erro={erro} legenda={<>{legenda} <span className="font-normal text-muted-foreground">(até {p.max})</span></>}>
        {p.opcoes.map((o) => {
          const marcada = marcadas.includes(o.id);
          return (
            <label key={o.id} className={OPCAO}>
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-primary"
                checked={marcada}
                disabled={!marcada && marcadas.length >= p.max}
                onChange={() => mudar(p.id, marcada ? marcadas.filter((m) => m !== o.id) : [...marcadas, o.id])}
              />
              {o.rotulo}
            </label>
          );
        })}
      </Cartao>
    );
  }

  if (p.tipo === "escala") {
    return (
      <Cartao id={p.id} erro={erro} legenda={legenda}>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {ESCALA.map((o) => (
            <label key={o.id} className={cn(OPCAO, "px-3 py-2")}>
              <input type="radio" name={p.id} className="h-4 w-4 shrink-0 accent-primary" checked={valor === o.id} onChange={() => mudar(p.id, o.id)} />
              {o.rotulo}
            </label>
          ))}
        </div>
      </Cartao>
    );
  }

  const chaveTexto = chaveDoTexto(p.id);
  return (
    <Cartao id={p.id} erro={erro} legenda={legenda}>
      {p.opcoes.map((o) => (
        <label key={o.id} className={OPCAO}>
          <input type="radio" name={p.id} className="h-4 w-4 shrink-0 accent-primary" checked={valor === o.id} onChange={() => mudar(p.id, o.id)} />
          {o.rotulo}
        </label>
      ))}
      {p.comTexto && valor === p.comTexto.opcao && (
        <label className="block pt-1 text-sm text-foreground">
          {p.comTexto.rotulo}
          <input
            maxLength={120}
            value={typeof respostas[chaveTexto] === "string" ? (respostas[chaveTexto] as string) : ""}
            onChange={(e) => mudar(chaveTexto, e.target.value)}
            className={cn(CAMPO, "mt-1.5")}
          />
        </label>
      )}
    </Cartao>
  );
}

/**
 * A pesquisa de mercado do site (`/pesquisa`, 15/10/2026): o que faz
 * diferença no sistema de quem toca uma academia. Pública, anônima e neutra:
 * não cita concorrente nem vende. As perguntas e a validação vêm do mesmo
 * módulo que a edge function `pesquisa-mercado` usa.
 */
export default function PesquisaMercado() {
  const [estado, setEstado] = useState<Estado>(VAZIO);
  const [erro, setErro] = useState<{ pergunta: string | null; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<ContatoDigitado | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [versaoCaptcha, setVersaoCaptcha] = useState(0);
  const { rascunhoDisponivel, descartar } = useRascunho(`pesquisa-mercado-v${VERSAO_QUESTIONARIO}`, estado, { ativo: !enviado });

  useEffect(() => {
    const anterior = document.title;
    document.title = "Pesquisa rápida para academias | ArkeFit";
    return () => {
      document.title = anterior;
    };
  }, []);

  const { respostas, contato } = estado;
  const exigidas = PERGUNTAS.filter((p) => obrigatoria(p, respostas));
  const feitas = exigidas.filter((p) => respondida(respostas[p.id])).length;

  const mudar = (chave: string, valor: string | string[] | undefined) => {
    setEstado((e) => ({ ...e, respostas: { ...e.respostas, [chave]: valor } as Respostas }));
    if (erro?.pergunta === chave) setErro(null);
  };
  const mudarContato = (parte: Partial<ContatoDigitado>) => {
    setEstado((e) => ({ ...e, contato: { ...e.contato, ...parte } }));
    if (erro?.pergunta === "contato") setErro(null);
  };

  const enviar = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setErro(null);
    // Sem o que ficou vazio ou escondido: a validação recusa chave sem valor.
    const limpas = Object.fromEntries(Object.entries(respostas).filter(([, v]) => respondida(v)));
    const r = validarRespostas(limpas);
    if (r.ok === false) {
      setErro({ pergunta: r.pergunta, texto: r.erro });
      if (r.pergunta) levarAte(r.pergunta);
      return;
    }
    const c = validarContato(contato);
    if (c.ok === false) {
      setErro({ pergunta: "contato", texto: c.erro });
      levarAte("contato");
      return;
    }
    setEnviando(true);
    try {
      const website = new FormData(ev.currentTarget).get("website");
      const { error } = await supabase.functions.invoke("pesquisa-mercado", {
        body: { versao: VERSAO_QUESTIONARIO, respostas: r.respostas, contato: c.contato, website, captcha_token: captcha },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível enviar agora. Tente de novo em instantes."));
      descartar();
      setEnviado(contato);
      window.scrollTo({ top: 0 });
    } catch (falha) {
      setErro({ pergunta: null, texto: falha instanceof Error ? falha.message : "Não foi possível enviar agora. Tente de novo em instantes." });
      // O token do captcha é de uso único.
      setCaptcha(null);
      setVersaoCaptcha((v) => v + 1);
    } finally {
      setEnviando(false);
    }
  };

  const erroDe = (id: string) => (erro?.pergunta === id ? erro.texto : null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center px-4 py-4">
          <a href="#/" aria-label="ArkeFit, página inicial" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MarcaArkeFit decorativo className="h-7 w-auto" />
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16 pt-8">
        {enviado ? (
          <div role="status" className="rounded-2xl border border-border bg-card p-8 text-center">
            <BadgeCheck className="mx-auto h-12 w-12 text-primary" aria-hidden />
            <h1 className="mt-4 text-2xl font-bold">Obrigado! Recebemos as suas respostas.</h1>
            <p className="mt-3 text-muted-foreground">
              {enviado.resultado && "Quando a pesquisa fechar, mandamos o resultado para o seu e-mail. "}
              {enviado.conhecer && "A equipe da ArkeFit vai escrever para você em breve."}
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold sm:text-3xl">Pesquisa rápida: o que faz diferença no sistema da sua academia (5 min)</h1>
            <p className="mt-3 text-muted-foreground">
              Queremos entender quais recursos de um sistema de gestão fazem diferença no dia a dia de quem toca uma academia. As respostas são
              anônimas.
            </p>

            {rascunhoDisponivel && (
              <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm">Você começou a responder antes. Quer continuar de onde parou?</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEstado(rascunhoDisponivel.dados);
                      descartar();
                    }}
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Continuar
                  </button>
                  <button
                    type="button"
                    onClick={descartar}
                    className="rounded-xl border border-border px-4 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Começar do zero
                  </button>
                </div>
              </div>
            )}

            <div className="sticky top-0 z-10 -mx-4 mt-6 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span id="progresso-rotulo">Progresso</span>
                <span>
                  {feitas} de {exigidas.length} respondidas
                </span>
              </div>
              <div
                role="progressbar"
                aria-labelledby="progresso-rotulo"
                aria-valuemin={0}
                aria-valuemax={exigidas.length}
                aria-valuenow={feitas}
                aria-valuetext={`${feitas} de ${exigidas.length} respondidas`}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${exigidas.length ? (feitas / exigidas.length) * 100 : 0}%` }} />
              </div>
            </div>

            <form onSubmit={(e) => void enviar(e)} noValidate className="mt-6 space-y-10">
              {BLOCOS.map((b) => (
                <section key={b.titulo} aria-labelledby={`bloco-${b.titulo}`} className="space-y-4">
                  <div>
                    <h2 id={`bloco-${b.titulo}`} className="text-lg font-bold text-primary">
                      {b.titulo}
                    </h2>
                    {b.ajuda && <p className="mt-1 text-sm text-muted-foreground">{b.ajuda}</p>}
                  </div>
                  {b.perguntas
                    .filter((p) => visivel(p, respostas))
                    .map((p) => (
                      <CampoDaPergunta key={p.id} p={p} respostas={respostas} mudar={mudar} erro={erroDe(p.id)} />
                    ))}
                </section>
              ))}

              <section aria-labelledby="bloco-resultado" className="space-y-4">
                <h2 id="bloco-resultado" className="text-lg font-bold text-primary">
                  O resultado
                </h2>
                <Cartao id="contato" erro={erroDe("contato")} legenda="30. Quer receber o resultado da pesquisa?">
                  <label className="block text-sm text-foreground">
                    E-mail (opcional)
                    <input
                      type="email"
                      autoComplete="email"
                      maxLength={200}
                      value={contato.email}
                      onChange={(e) => mudarContato({ email: e.target.value })}
                      className={cn(CAMPO, "mt-1.5")}
                    />
                  </label>
                  <label className={OPCAO}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={contato.resultado}
                      onChange={(e) => mudarContato({ resultado: e.target.checked })}
                    />
                    Autorizo usar o e-mail só para enviar o resultado
                  </label>
                  <label className={OPCAO}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-primary"
                      checked={contato.conhecer}
                      onChange={(e) => mudarContato({ conhecer: e.target.checked })}
                    />
                    Quero também conhecer o ArkeFit
                  </label>
                  {contato.conhecer && (
                    <div className="grid gap-3 pt-1 sm:grid-cols-2">
                      <label className="block text-sm text-foreground">
                        Seu nome
                        <input
                          required
                          autoComplete="name"
                          maxLength={120}
                          value={contato.nome}
                          onChange={(e) => mudarContato({ nome: e.target.value })}
                          className={cn(CAMPO, "mt-1.5")}
                        />
                      </label>
                      <label className="block text-sm text-foreground">
                        Nome da academia
                        <input
                          required
                          autoComplete="organization"
                          maxLength={160}
                          value={contato.academia}
                          onChange={(e) => mudarContato({ academia: e.target.value })}
                          className={cn(CAMPO, "mt-1.5")}
                        />
                      </label>
                    </div>
                  )}
                </Cartao>
              </section>

              {/* Campo-isca: invisível para gente; robô preenche. */}
              <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />

              {TURNSTILE_SITE_KEY && <Turnstile key={versaoCaptcha} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptcha} />}

              <div className="space-y-3">
                {erro && !erro.pergunta && (
                  <p role="alert" className="text-sm text-destructive">
                    {erro.texto}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={enviando || (!!TURNSTILE_SITE_KEY && !captcha)}
                  className="w-full rounded-xl bg-primary px-6 py-3.5 font-semibold text-primary-foreground transition-opacity hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                >
                  {enviando ? "Enviando…" : "Enviar respostas"}
                </button>
                <p role="status" className="sr-only">
                  {enviando ? "Enviando as respostas…" : ""}
                </p>
              </div>
            </form>
          </>
        )}

        <aside className="mt-10 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p>
            Guardamos as respostas, a versão do questionário e a data, sem nome e sem o seu endereço de internet: as respostas são anônimas. O
            e-mail é opcional e fica separado das respostas, só para o que você marcar: receber o resultado e, se pedir, o contato da equipe da
            ArkeFit, com o seu nome e o da academia. Veja a{" "}
            <a href="#/privacidade" target="_blank" rel="noopener" className="text-primary underline-offset-2 hover:underline">
              Política de Privacidade
            </a>
            .
          </p>
        </aside>
      </main>
    </div>
  );
}
