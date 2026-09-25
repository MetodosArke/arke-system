import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CreditCard,
  DoorOpen,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  HeartPulse,
  LineChart,
  ListChecks,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserX,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { FONTES } from "@/lib/landing";
import { decimal } from "@/lib/numeros";
import { Turnstile } from "@/components/public/Turnstile";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const APP_HOST = import.meta.env.VITE_APP_HOST as string | undefined;
/** Link para uma tela do app: no endereço do app, quando ele já existe. */
const noApp = (rota: string) => (APP_HOST ? `https://${APP_HOST}/#${rota}` : `#${rota}`);

const ESTILO = `
.lp{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:hsl(var(--background));color:hsl(var(--foreground))}
.lp h1,.lp h2,.lp h3,.lp .lp-display{font-family:"Plus Jakarta Sans",Inter,ui-sans-serif,sans-serif;letter-spacing:-.02em}
.lp-grade{background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 75% 55% at 50% 0%,#000 35%,transparent 100%);mask-image:radial-gradient(ellipse 75% 55% at 50% 0%,#000 35%,transparent 100%)}
.lp-foco{background:radial-gradient(700px circle at var(--x,50%) var(--y,20%),hsl(var(--primary) / .10),transparent 45%)}
.lp-gradiente{background:linear-gradient(90deg,hsl(43 74% 55%) 0%,hsl(43 74% 65%) 55%,hsl(43 60% 78%) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
@property --lp-a{syntax:"<angle>";inherits:false;initial-value:0deg}
.lp-feixe{position:relative;isolation:isolate}
.lp-feixe::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:conic-gradient(from var(--lp-a),transparent 0 68%,hsl(var(--primary) / .9) 80%,hsl(43 60% 72% / .9) 88%,transparent 96%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:lp-giro 7s linear infinite;z-index:-1}
@keyframes lp-giro{to{--lp-a:360deg}}
.lp-cartao{position:relative;overflow:hidden}
.lp-cartao::after{content:"";position:absolute;inset:0;background:radial-gradient(380px circle at var(--mx,-200px) var(--my,-200px),hsl(var(--primary) / .08),transparent 45%);opacity:0;transition:opacity .3s;pointer-events:none}
.lp-cartao:hover::after{opacity:1}
.lp-faixa{animation:lp-faixa 45s linear infinite}
@keyframes lp-faixa{to{transform:translateX(-50%)}}
.lp-campo{width:100%;border-radius:.75rem;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);padding:.7rem .9rem;color:hsl(var(--foreground));font-size:.95rem;outline:none;transition:border-color .2s,box-shadow .2s}
.lp-campo::placeholder{color:hsl(var(--muted-foreground))}
.lp-campo:focus{border-color:hsl(var(--primary) / .6);box-shadow:0 0 0 3px hsl(var(--primary) / .15)}
.lp select.lp-campo option{background:hsl(var(--card));color:hsl(var(--foreground))}
@media (prefers-reduced-motion:reduce){.lp-feixe::before,.lp-faixa{animation:none}}
`;

/**
 * Link para uma seção desta página. O app usa HashRouter: um href "#contato"
 * viraria a rota "/contato" e tiraria a pessoa da página. A rolagem é feita
 * aqui, e o endereço não muda.
 */
function Ancora({ para, className, children, ...resto }: { para: string; className?: string; children: ReactNode; "aria-label"?: string }) {
  return (
    <a
      {...resto}
      href={`#${para}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        document.getElementById(para)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {children}
    </a>
  );
}

/** O brilho que segue o ponteiro nos cartões. */
function acompanharPonteiro(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

function Aparecer({ children, atraso = 0, className }: { children: ReactNode; atraso?: number; className?: string }) {
  const reduzir = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduzir ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay: atraso, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Selo({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.14em] text-primary">
      {children}
    </span>
  );
}

// ——— Topo ———

function Nav() {
  const [rolou, setRolou] = useState(false);
  useEffect(() => {
    const aoRolar = () => setRolou(window.scrollY > 12);
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);
  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${rolou ? "border-b border-white/5 bg-background/80 backdrop-blur-xl" : ""}`}>
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6" aria-label="Principal">
        <Ancora para="topo" className="flex items-center gap-2.5" aria-label="ARKE, início da página">
          <img src="/logo.png" alt="" className="h-8 w-8 rounded-md" />
          <span className="lp-display text-lg font-bold tracking-wide text-foreground">ARKE</span>
        </Ancora>
        <div className="hidden items-center gap-7 text-sm text-foreground/65 md:flex">
          <Ancora para="como-funciona" className="transition-colors hover:text-foreground">Como funciona</Ancora>
          <Ancora para="recursos" className="transition-colors hover:text-foreground">Recursos</Ancora>
          <Ancora para="metodo" className="transition-colors hover:text-foreground">Método ARKE</Ancora>
          <Ancora para="perguntas" className="transition-colors hover:text-foreground">Perguntas</Ancora>
        </div>
        <div className="flex items-center gap-2">
          <a href={noApp("/auth/login")} className="rounded-lg px-3 py-2 text-sm text-foreground/80 transition-colors hover:text-foreground">
            Entrar
          </a>
          <Ancora
            para="contato"
            className="rounded-lg bg-primary hover:bg-primary/90 px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/.22)] transition-transform hover:scale-[1.03]"
          >
            Agendar demonstração
          </Ancora>
        </div>
      </nav>
    </header>
  );
}

type Evento = { icone: typeof UserX; titulo: string; detalhe: string; tom: "marca" | "erro" | "ok" | "alerta" };
const EVENTOS: Evento[] = [
  { icone: UserX, titulo: "Marina não aparece há 6 dias", detalhe: "Risco de evasão · prazo de 4 h · com a recepção", tom: "alerta" },
  { icone: HeartPulse, titulo: "Pedro relatou dor no joelho", detalhe: "Revisão do treino antes do próximo · professor", tom: "erro" },
  { icone: CreditCard, titulo: "Mensalidade de Lucas paga no cartão", detalhe: "Cobrança automática · acesso liberado", tom: "ok" },
  { icone: Smartphone, titulo: "Gustavo ainda não entrou no app", detalhe: "Ativação · convite de primeiro acesso reenviado", tom: "marca" },
  { icone: ListChecks, titulo: "Fernanda: ajuste de treino feito", detalhe: "Encerrada com desfecho registrado", tom: "ok" },
  { icone: DoorOpen, titulo: "Catraca da entrada sem internet", detalhe: "Seguindo pelo cadastro local · nada se perde", tom: "marca" },
  { icone: Wallet, titulo: "Thiago: mensalidade vencida", detalhe: "5 dias de tolerância · tarefa de cobrança aberta", tom: "alerta" },
];
const TOM: Record<Evento["tom"], string> = {
  marca: "text-foreground/80 bg-white/[0.06] ring-white/10",
  erro: "text-red-400 bg-red-500/10 ring-red-500/20",
  ok: "text-success bg-success/10 ring-success/25",
  alerta: "text-warning bg-warning/10 ring-warning/25",
};

/** A fila "ao vivo" do topo: exemplo ilustrativo, com nomes inventados. */
function PainelAoVivo() {
  const reduzir = useReducedMotion();
  const [inicio, setInicio] = useState(0);
  useEffect(() => {
    if (reduzir) return;
    const t = window.setInterval(() => setInicio((i) => (i + 1) % EVENTOS.length), 2600);
    return () => window.clearInterval(t);
  }, [reduzir]);
  // O mais novo entra no topo e o mais antigo sai por baixo, como numa fila de verdade.
  const visiveis = Array.from({ length: 4 }, (_, i) => EVENTOS[(inicio - i + EVENTOS.length * 4) % EVENTOS.length]);
  return (
    <div className="lp-feixe rounded-2xl">
      <div className="rounded-2xl border border-white/10 bg-card/90 p-4 shadow-2xl shadow-black/60 backdrop-blur sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
            </span>
            <span className="text-sm font-semibold text-foreground">Fila de hoje</span>
          </div>
          <span className="text-[11px] text-muted-foreground">exemplo ilustrativo</span>
        </div>
        <ul className="relative space-y-2.5 overflow-hidden" aria-live="off">
          <AnimatePresence initial={false} mode="popLayout">
            {visiveis.map((e) => (
              <motion.li
                key={e.titulo}
                layout
                initial={{ opacity: 0, y: -14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3"
              >
                <span className={`mt-0.5 rounded-lg p-2 ring-1 ${TOM[e.tom]}`}>
                  <e.icone className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{e.titulo}</span>
                  <span className="block text-xs text-foreground/65">{e.detalhe}</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Tarefas com dono", "100%"],
            ["Fechadas com desfecho", "100%"],
            ["Esquecidas", "0"],
          ].map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2">
              <div className="lp-display text-base font-bold text-foreground">{valor}</div>
              <div className="text-[10px] leading-tight text-muted-foreground">{rotulo}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduzir = useReducedMotion();
  return (
    <section
      id="topo"
      ref={ref}
      onPointerMove={(e) => {
        if (reduzir || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        ref.current.style.setProperty("--x", `${e.clientX - r.left}px`);
        ref.current.style.setProperty("--y", `${e.clientY - r.top}px`);
      }}
      className="lp-foco relative overflow-hidden pb-20 pt-28 sm:pt-36"
    >
      <div className="lp-grade pointer-events-none absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <Aparecer>
            <Selo>
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Retenção e cobrança para academias
            </Selo>
          </Aparecer>
          <Aparecer atraso={0.05}>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] text-foreground sm:text-6xl">
              O aluno não some de uma vez.
              <br />
              <span className="lp-gradiente">Ele vai parando.</span>
            </h1>
          </Aparecer>
          <Aparecer atraso={0.12}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/65">
              O ARKE percebe os sinais — dias sem vir, treino sem registro, dor relatada, mensalidade que não entrou — e coloca cada um na fila
              certa, com prazo e responsável. E a cobrança automática no cartão tira a inadimplência do esquecimento.
            </p>
          </Aparecer>
          <Aparecer atraso={0.18}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Ancora
                para="contato"
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 px-6 py-3.5 font-semibold text-primary-foreground shadow-[0_0_40px_hsl(var(--primary)/.22)] transition-transform hover:scale-[1.02]"
              >
                Quero ver na minha academia
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Ancora>
              <Ancora
                para="como-funciona"
                className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3.5 font-medium text-foreground/90 transition-colors hover:border-white/25"
              >
                Como funciona
              </Ancora>
            </div>
          </Aparecer>
          <Aparecer atraso={0.24}>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground/65">
              {["Banco de dados em São Paulo", "Nota fiscal automática", "Funciona com a sua catraca"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </Aparecer>
        </div>
        <Aparecer atraso={0.15}>
          <PainelAoVivo />
        </Aparecer>
      </div>
    </section>
  );
}

// ——— Números com fonte ———

/**
 * Panorama Setorial (FONTES.panorama): academias com até 25% dos alunos em
 * cobrança automática contra as com mais de 76%. A fonte não diz o período da
 * evasão, então a página também não diz.
 */
const PANORAMA = { evasao: { pouca: 12.72, muita: 9.68 }, permanencia: { pouca: 7.93, muita: 10.36 } };
const REDUCAO_EVASAO = Math.round((1 - PANORAMA.evasao.muita / PANORAMA.evasao.pouca) * 100);
const GANHO_PERMANENCIA = decimal(PANORAMA.permanencia.muita - PANORAMA.permanencia.pouca, 1);

function Barra({ rotulo, valor, maximo, texto, destaque = false }: { rotulo: string; valor: number; maximo: number; texto: string; destaque?: boolean }) {
  const reduzir = useReducedMotion();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={destaque ? "text-foreground" : "text-foreground/65"}>{rotulo}</span>
        <span className={`shrink-0 font-semibold tabular-nums ${destaque ? "text-primary" : "text-foreground/80"}`}>{texto}</span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-full bg-white/[0.06]">
        <motion.div
          className={`h-full rounded-full ${destaque ? "bg-primary" : "bg-foreground/30"}`}
          style={{ width: `${(valor / maximo) * 100}%`, transformOrigin: "left" }}
          initial={reduzir ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

function CartaoNumero({ rotulo, titulo, texto, fonte, children }: { rotulo: string; titulo: ReactNode; texto: string; fonte: { titulo: string; url: string }; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{rotulo}</div>
      <div className="lp-display mt-3 text-4xl font-extrabold text-foreground">{titulo}</div>
      <p className="mt-2 text-foreground/80">{texto}</p>
      <div className="mt-6 flex-1">{children}</div>
      <a href={fonte.url} target="_blank" rel="noopener noreferrer" className="mt-6 block text-xs text-muted-foreground underline-offset-2 hover:underline">
        Fonte: {fonte.titulo}
      </a>
    </div>
  );
}

function Numeros() {
  return (
    <section className="relative border-y border-white/5 bg-card/60 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <h2 className="max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">
            Os três primeiros meses decidem se o aluno fica. <span className="text-foreground/65">E quem paga no automático fica mais.</span>
          </h2>
        </Aparecer>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Aparecer className="h-full">
            <CartaoNumero
              rotulo="Alunos novos"
              titulo={
                <>
                  <span className="text-primary">63</span> de cada 100
                </>
              }
              texto="saem antes do terceiro mês. Menos de 4 passam de um ano."
              fonte={FONTES.sperandei}
            >
              <div className="grid max-w-[220px] grid-cols-10 gap-1.5" role="img" aria-label="63 de cada 100 alunos novos saem antes do terceiro mês">
                {Array.from({ length: 100 }, (_, i) => (
                  <span key={i} className={`aspect-square rounded-full ${i < 63 ? "bg-foreground/15" : "bg-primary"}`} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/65">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-foreground/15" /> saem antes do 3º mês
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" /> continuam
                </span>
              </div>
            </CartaoNumero>
          </Aparecer>
          <Aparecer atraso={0.08} className="h-full">
            <CartaoNumero
              rotulo="Evasão"
              titulo={<span className="text-primary">{REDUCAO_EVASAO}% menor</span>}
              texto="nas academias com a maioria dos alunos em cobrança automática."
              fonte={FONTES.panorama}
            >
              <div className="space-y-4">
                <Barra rotulo="Até 25% no automático" valor={PANORAMA.evasao.pouca} maximo={PANORAMA.evasao.pouca} texto={`${decimal(PANORAMA.evasao.pouca, 2)}%`} />
                <Barra rotulo="Mais de 76% no automático" valor={PANORAMA.evasao.muita} maximo={PANORAMA.evasao.pouca} texto={`${decimal(PANORAMA.evasao.muita, 2)}%`} destaque />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Taxa de evasão das academias, pela parcela dos alunos em cobrança automática.</p>
            </CartaoNumero>
          </Aparecer>
          <Aparecer atraso={0.16} className="h-full">
            <CartaoNumero
              rotulo="Permanência"
              titulo={<span className="text-primary">+{GANHO_PERMANENCIA} meses</span>}
              texto="de permanência média do aluno, na mesma comparação."
              fonte={FONTES.panorama}
            >
              <div className="space-y-4">
                <Barra rotulo="Até 25% no automático" valor={PANORAMA.permanencia.pouca} maximo={PANORAMA.permanencia.muita} texto={`${decimal(PANORAMA.permanencia.pouca, 2)} meses`} />
                <Barra rotulo="Mais de 76% no automático" valor={PANORAMA.permanencia.muita} maximo={PANORAMA.permanencia.muita} texto={`${decimal(PANORAMA.permanencia.muita, 2)} meses`} destaque />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Tempo médio que o aluno fica, pela parcela dos alunos em cobrança automática.</p>
            </CartaoNumero>
          </Aparecer>
        </div>
      </div>
    </section>
  );
}

// ——— Como funciona ———

const PASSOS = [
  {
    icone: BellRing,
    titulo: "Percebe",
    texto:
      "Sinais automáticos: aluno que não entrou no app em 48 horas, dois treinos previstos sem registro, dor relatada, dias sem aparecer, mensalidade vencida.",
  },
  {
    icone: ListChecks,
    titulo: "Organiza",
    texto: "Cada sinal vira uma tarefa na fila, com responsável, prioridade e prazo. Se ninguém agir a tempo, ela sobe para o gestor.",
  },
  {
    icone: BadgeCheck,
    titulo: "Fecha com registro",
    texto: "Nenhuma tarefa termina com um clique: só com o desfecho escrito. Meses depois, você sabe o que foi feito com cada aluno.",
  },
];

function ComoFunciona() {
  return (
    <section id="como-funciona" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Como funciona</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">Ninguém precisa lembrar de olhar cada aluno. A fila mostra quem precisa de atenção.</h2>
        </Aparecer>
        <div className="relative mt-14 grid gap-6 md:grid-cols-3">
          <div className="pointer-events-none absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent md:block" aria-hidden />
          {PASSOS.map((p, i) => (
            <Aparecer key={p.titulo} atraso={i * 0.1}>
              <div className="relative">
                <div className="relative z-10 flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-primary/25 bg-card shadow-[0_0_30px_hsl(var(--primary)/.12)]">
                  <p.icone className="h-7 w-7 text-primary" aria-hidden />
                </div>
                <div className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Passo {i + 1}</div>
                <h3 className="mt-2 text-xl font-bold text-foreground">{p.titulo}</h3>
                <p className="mt-2 leading-relaxed text-foreground/65">{p.texto}</p>
              </div>
            </Aparecer>
          ))}
        </div>
      </div>
    </section>
  );
}

// ——— Recursos (bento) ———

function Cartao({ icone: Icone, titulo, children, className = "" }: { icone: typeof Wallet; titulo: string; children: ReactNode; className?: string }) {
  return (
    <div onPointerMove={acompanharPonteiro} className={`lp-cartao h-full rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 ${className}`}>
      <Icone className="h-6 w-6 text-primary" aria-hidden />
      <h3 className="mt-4 text-lg font-bold text-foreground">{titulo}</h3>
      <div className="mt-2 text-sm leading-relaxed text-foreground/65">{children}</div>
    </div>
  );
}

function Recursos() {
  return (
    <section id="recursos" className="scroll-mt-20 border-t border-white/5 bg-card/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Recursos</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">O que a operação da academia precisa, num sistema só.</h2>
        </Aparecer>
        <div className="mt-12 grid auto-rows-fr gap-4 md:grid-cols-6">
          <Aparecer className="md:col-span-4 md:row-span-2">
            <div onPointerMove={acompanharPonteiro} className="lp-cartao flex h-full flex-col justify-between rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.09] via-transparent to-primary/[0.03] p-7">
              <div>
                <CreditCard className="h-7 w-7 text-primary" aria-hidden />
                <h3 className="mt-4 text-2xl font-bold text-foreground">Cobrança automática, direto na conta da academia</h3>
                <p className="mt-3 max-w-xl leading-relaxed text-foreground/80">
                  O aluno cadastra o cartão uma vez e a mensalidade é cobrada todo mês, sem ele precisar lembrar. Quem prefere recebe a fatura com PIX ou
                  boleto. A parte da academia cai direto na conta dela, no ato do pagamento.
                </p>
              </div>
              <ul className="mt-6 grid gap-3 text-sm text-foreground/80 sm:grid-cols-2">
                {[
                  "Conferência diária com o Asaas: pagamento confirmado libera o aluno mesmo se um aviso se perder",
                  "Inadimplente com 5 dias de tolerância, com aviso no app",
                  "Taxa de matrícula e cobranças avulsas na mesma ficha",
                  "Pausar, retomar e cancelar o plano em um clique",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </Aparecer>
          <Aparecer atraso={0.05} className="md:col-span-2">
            <Cartao icone={Smartphone} titulo="App do aluno, incluso">
              Treino série a série, dieta, check-in do dia, pagamentos e a evolução, que só o aluno vê. Todo aluno em dia usa, sem custo extra.
            </Cartao>
          </Aparecer>
          <Aparecer atraso={0.1} className="md:col-span-2">
            <Cartao icone={FileText} titulo="Nota fiscal automática">
              Cada pagamento confirmado vira nota fiscal no CNPJ da academia, e o aluno recebe por e-mail.
            </Cartao>
          </Aparecer>
          <Aparecer className="md:col-span-2">
            <Cartao icone={DoorOpen} titulo="Catraca que não trava a recepção">
              Control iD e Topdata. Sem internet, continua liberando pelo cadastro local, e as entradas sobem quando a conexão volta.
            </Cartao>
          </Aparecer>
          <Aparecer atraso={0.05} className="md:col-span-2">
            <Cartao icone={QrCode} titulo="Check-in por QR Code">
              Para quem não tem catraca: o aluno aponta o celular para a tela da recepção. O código muda a cada 10 minutos.
            </Cartao>
          </Aparecer>
          <Aparecer atraso={0.1} className="md:col-span-2">
            <Cartao icone={FileSpreadsheet} titulo="Traga a sua base">
              Planilhas do EVO, Tecnofit, Next Fit e Pacto são reconhecidas. Parou no meio? A importação retoma de onde estava.
            </Cartao>
          </Aparecer>
          <Aparecer className="md:col-span-3">
            <Cartao icone={LineChart} titulo="Gestão com número que se explica">
              DRE do mês, retenção e alunos em risco, e um resumo da semana toda segunda às 8h. Cada número diz, na tela, como é calculado.
            </Cartao>
          </Aparecer>
          <Aparecer atraso={0.05} className="md:col-span-3">
            <Cartao icone={ShieldCheck} titulo="LGPD levada a sério">
              Banco de dados em São Paulo. Digital na catraca só com autorização do aluno. Inteligência artificial só com consentimento, por finalidade,
              processada no Brasil. A academia exporta tudo quando quiser.
            </Cartao>
          </Aparecer>
        </div>
        <div className="relative mt-10 overflow-hidden" aria-hidden>
          <div className="lp-faixa flex w-max gap-10 whitespace-nowrap text-sm text-muted-foreground">
            {[0, 1].map((k) => (
              <div key={k} className="flex gap-10">
                {["Asaas", "PIX, boleto e cartão", "Control iD", "Topdata", "EVO", "Tecnofit", "Next Fit", "Pacto", "Nota fiscal de serviço"].map((t) => (
                  <span key={`${k}-${t}`} className="flex items-center gap-10">
                    {t}
                    <span className="h-1 w-1 rounded-full bg-border" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ——— Método ARKE ———

function Metodo() {
  return (
    <section id="metodo" className="scroll-mt-20 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <Aparecer>
          <Selo>Método ARKE</Selo>
          <h2 className="mt-5 text-3xl font-bold text-foreground sm:text-4xl">Uma receita a mais, sem aumentar a equipe.</h2>
          <p className="mt-5 leading-relaxed text-foreground/65">
            Além do app incluso, a academia pode oferecer o Método ARKE aos alunos, nos níveis Integrado e Elite: acolhimento, fases da jornada, plano
            alimentar e uma célula de mentoria da ArkeFit acompanhando cada aluno à distância.
          </p>
          <ul className="mt-6 space-y-3 text-foreground/80">
            {[
              "A academia define o preço e recebe a parte dela direto na conta.",
              "O acompanhamento digital é da ArkeFit; para a academia sobra o que é presencial.",
              "Uma tela de prestação de contas mostra cada atendimento e o desfecho dele.",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </Aparecer>
        <Aparecer atraso={0.1}>
          <div className="grid gap-3">
            {[
              ["M.A.P.A.®", "Acolhimento: rotina, objetivos, saúde e o que já tentou antes."],
              ["B.A.S.E.®", "Adaptação, com constância medida contra a meta do próprio aluno."],
              ["R.O.T.A.®", "Check-ins semanais e ajustes antes da desistência."],
              ["A.P.E.X.® e L.E.G.A.D.O.®", "Evolução de longo prazo, individual e privada."],
            ].map(([fase, texto], i) => (
              <div key={fase} className="flex items-start gap-4 rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <span className="lp-display mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <div className="font-semibold text-foreground">{fase}</div>
                  <div className="text-sm text-foreground/65">{texto}</div>
                </div>
              </div>
            ))}
          </div>
        </Aparecer>
      </div>
    </section>
  );
}

// ——— Implantação ———

function Implantacao() {
  const passos: [typeof Building2, string, string][] = [
    [Building2, "Configuração guiada", "Seis etapas no painel: dados, conta de recebimentos, planos, equipe, alunos e contrato. O CNPJ preenche o resto."],
    [FileSpreadsheet, "Sua base importada", "A planilha do sistema atual entra com as colunas reconhecidas, e o CPF é conferido linha a linha."],
    [QrCode, "Alunos no app", "Um QR Code para a academia inteira: cada aluno digita o e-mail ou o celular e cria a própria senha."],
    [Fingerprint, "Catraca ligada", "Com catraca, um técnico instala o Gateway Local seguindo o manual. A digital entra só com a autorização do aluno."],
    [CalendarClock, "Equipe no ritmo", "A Central de Ajuda dentro do sistema responde as dúvidas do dia a dia, tela por tela."],
  ];
  return (
    <section className="border-y border-white/5 bg-card/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Implantação</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">Da assinatura ao primeiro aluno no app, passo a passo.</h2>
        </Aparecer>
        <div className="mt-12 grid gap-4 md:grid-cols-5">
          {passos.map(([Icone, titulo, texto], i) => (
            <Aparecer key={titulo} atraso={i * 0.06} className="h-full">
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between">
                  <Icone className="h-5 w-5 text-primary" aria-hidden />
                  <span className="lp-display text-sm font-bold text-muted-foreground/70">0{i + 1}</span>
                </div>
                <h3 className="mt-4 font-bold text-foreground">{titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/65">{texto}</p>
              </div>
            </Aparecer>
          ))}
        </div>
      </div>
    </section>
  );
}

// ——— Perguntas ———

const PERGUNTAS: [string, string][] = [
  ["Preciso trocar de catraca?", "Control iD e Topdata funcionam com o ARKE. Outras marcas são avaliadas e integradas na implantação, conforme o equipamento."],
  [
    "Como trago os alunos do sistema que uso hoje?",
    "Exporte a planilha de alunos do seu sistema. As do EVO, Tecnofit, Next Fit e Pacto são reconhecidas; o ARKE confere o CPF de cada linha, e a importação pode ser retomada se parar no meio.",
  ],
  ["O aluno paga para usar o app?", "Não. Todo aluno matriculado e em dia usa o app. O Método ARKE é opcional, vendido pela própria academia, com o preço que ela define."],
  [
    "Como recebo as mensalidades?",
    "Pelo Asaas, numa conta da própria academia. No momento do pagamento, a parte da academia cai direto na conta dela; o ARKE não segura o seu dinheiro.",
  ],
  [
    "Onde ficam os dados dos alunos?",
    "O banco de dados fica em São Paulo. A academia é a responsável pelos dados dos alunos perante eles e pode exportar tudo a qualquer momento. Dado de saúde tem acesso restrito a quem atende o aluno.",
  ],
  ["E se eu quiser sair?", "O contrato tem aviso prévio de 30 dias e, depois do término, mais 30 dias para você baixar todos os dados. As cobranças dos alunos são encerradas no término."],
];

function Perguntas() {
  return (
    <section id="perguntas" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Perguntas</Selo>
          <h2 className="mt-5 text-3xl font-bold text-foreground sm:text-4xl">O que as academias perguntam primeiro.</h2>
        </Aparecer>
        <div className="mt-10 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.02]">
          {PERGUNTAS.map(([p, r]) => (
            <details key={p} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground">
                {p}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="mt-3 leading-relaxed text-foreground/65">{r}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ——— Contato ———

const FAIXAS: [string, string][] = [
  ["ate_150", "Até 150 alunos"],
  ["151_500", "151 a 500"],
  ["501_1000", "501 a 1.000"],
  ["mais_1000", "Mais de 1.000"],
];

function origemDaVisita(): string | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const partes = ["utm_source", "utm_medium", "utm_campaign"].map((k) => q.get(k)).filter(Boolean);
    if (partes.length) return partes.join(" / ").slice(0, 200);
    return document.referrer ? new URL(document.referrer).hostname.slice(0, 200) : null;
  } catch {
    return null;
  }
}

function Contato() {
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [versaoCaptcha, setVersaoCaptcha] = useState(0);

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErro(null);
    const dados = Object.fromEntries(new FormData(e.currentTarget).entries());
    setEnviando(true);
    try {
      const { error } = await supabase.functions.invoke("lead-site", {
        body: { ...dados, origem: origemDaVisita(), captcha_token: captcha },
      });
      if (error) throw new Error(await mensagemDeErroEdge(error, "Não foi possível enviar agora. Tente de novo."));
      setEnviado(true);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível enviar agora. Tente de novo.");
      // O token do captcha é de uso único.
      setCaptcha(null);
      setVersaoCaptcha((v) => v + 1);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <section id="contato" className="scroll-mt-20 border-t border-white/5 bg-card/60 py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <Aparecer>
          <Selo>Demonstração</Selo>
          <h2 className="mt-5 text-3xl font-bold text-foreground sm:text-4xl">Veja o ARKE com a cara da sua academia.</h2>
          <p className="mt-5 leading-relaxed text-foreground/65">
            Conte um pouco da sua operação. A equipe da ArkeFit responde pelo WhatsApp ou pelo e-mail para marcar uma demonstração, com a fila, a cobrança e
            o app do aluno funcionando.
          </p>
          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-foreground/65">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p>
              Usamos estes dados só para responder ao seu contato e apresentar o ARKE. Ninguém além da equipe da ArkeFit os recebe. Veja a{" "}
              <a href="#/privacidade" target="_blank" rel="noopener" className="text-primary underline-offset-2 hover:underline">
                Política de Privacidade
              </a>
              .
            </p>
          </div>
        </Aparecer>
        <Aparecer atraso={0.1}>
          <div className="lp-feixe rounded-2xl">
            <div className="rounded-2xl border border-white/10 bg-card p-6 sm:p-8">
              {enviado ? (
                <div className="py-10 text-center" role="status">
                  <BadgeCheck className="mx-auto h-12 w-12 text-primary" aria-hidden />
                  <h3 className="mt-4 text-2xl font-bold text-foreground">Recebemos o seu contato.</h3>
                  <p className="mt-2 text-foreground/65">A equipe da ArkeFit fala com você em breve.</p>
                </div>
              ) : (
                <form onSubmit={(e) => void enviar(e)} className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm text-foreground/80">
                    Seu nome
                    <input name="nome" required minLength={2} maxLength={120} autoComplete="name" className="lp-campo" />
                  </label>
                  <label className="grid gap-1.5 text-sm text-foreground/80">
                    Academia
                    <input name="academia" required minLength={2} maxLength={160} autoComplete="organization" className="lp-campo" />
                  </label>
                  <label className="grid gap-1.5 text-sm text-foreground/80">
                    WhatsApp
                    <input name="telefone" required inputMode="tel" autoComplete="tel" placeholder="(11) 98888-7777" className="lp-campo" />
                  </label>
                  <label className="grid gap-1.5 text-sm text-foreground/80">
                    E-mail
                    <input name="email" type="email" required maxLength={200} autoComplete="email" className="lp-campo" />
                  </label>
                  <label className="grid gap-1.5 text-sm text-foreground/80">
                    Cidade
                    <input name="cidade" maxLength={120} autoComplete="address-level2" className="lp-campo" />
                  </label>
                  <div className="grid grid-cols-[5rem_1fr] gap-3">
                    <label className="grid gap-1.5 text-sm text-foreground/80">
                      UF
                      <input name="uf" maxLength={2} autoComplete="address-level1" className="lp-campo uppercase" />
                    </label>
                    <label className="grid gap-1.5 text-sm text-foreground/80">
                      Alunos ativos
                      <select name="alunos_faixa" defaultValue="" className="lp-campo">
                        <option value="">Selecione</option>
                        {FAIXAS.map(([v, r]) => (
                          <option key={v} value={v}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-1.5 text-sm text-foreground/80 sm:col-span-2">
                    Sistema que usa hoje (opcional)
                    <input name="sistema_atual" maxLength={80} className="lp-campo" placeholder="EVO, Tecnofit, planilha…" />
                  </label>
                  <label className="grid gap-1.5 text-sm text-foreground/80 sm:col-span-2">
                    Mensagem (opcional)
                    <textarea name="mensagem" rows={3} maxLength={2000} className="lp-campo resize-none" />
                  </label>
                  {/* Campo-isca: invisível para gente; robô preenche. */}
                  <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
                  {TURNSTILE_SITE_KEY && (
                    <div className="sm:col-span-2">
                      <Turnstile key={versaoCaptcha} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptcha} tema="dark" />
                    </div>
                  )}
                  {erro && (
                    <p className="text-sm text-rose-300 sm:col-span-2" role="alert">
                      {erro}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={enviando || (!!TURNSTILE_SITE_KEY && !captcha)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 px-6 py-3.5 font-semibold text-primary-foreground transition-opacity disabled:opacity-50 sm:col-span-2"
                  >
                    {enviando ? "Enviando…" : "Quero uma demonstração"}
                    {!enviando && <ArrowRight className="h-4 w-4" aria-hidden />}
                  </button>
                </form>
              )}
            </div>
          </div>
        </Aparecer>
      </div>
    </section>
  );
}

function Rodape() {
  return (
    <footer className="py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-7 w-7 rounded" />
          <span>METODOS ARKE LTDA · CNPJ 68.456.606/0001-70 · São Paulo/SP</span>
        </div>
        <nav className="flex flex-wrap gap-5" aria-label="Rodapé">
          <a href="#/termos" className="hover:text-foreground/80">Termos de Uso</a>
          <a href="#/privacidade" className="hover:text-foreground/80">Privacidade</a>
          <a href={noApp("/auth/login")} className="hover:text-foreground/80">Entrar</a>
        </nav>
      </div>
    </footer>
  );
}

const TITULO = "ARKE — Retenção e cobrança automática para academias";
const DESCRICAO =
  "Sinais de evasão viram tarefas com prazo e responsável, e a cobrança automática no cartão tira a inadimplência do esquecimento. Com app do aluno, catraca e nota fiscal.";

/** A página de vendas, na raiz de arkefit.com.br para quem chega de fora. */
export default function Landing() {
  useEffect(() => {
    const anterior = document.title;
    document.title = TITULO;
    document.querySelector('meta[name="description"]')?.setAttribute("content", DESCRICAO);
    const fontes = document.createElement("link");
    fontes.rel = "stylesheet";
    fontes.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap";
    document.head.appendChild(fontes);
    const corAnterior = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "hsl(0 0% 6%)";
    return () => {
      document.title = anterior;
      fontes.remove();
      document.body.style.backgroundColor = corAnterior;
    };
  }, []);

  return (
    <div className="lp dark min-h-screen overflow-x-hidden antialiased">
      <style>{ESTILO}</style>
      <Nav />
      <main>
        <Hero />
        <Numeros />
        <ComoFunciona />
        <Recursos />
        <Metodo />
        <Implantacao />
        <Perguntas />
        <Contato />
      </main>
      <Rodape />
    </div>
  );
}
