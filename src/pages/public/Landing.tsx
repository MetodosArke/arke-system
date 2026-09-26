import { useEffect, useRef, useState, type FormEvent, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
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
  MessageCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  UserX,
  Wallet,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemDeErroEdge } from "@/lib/erroEdge";
import { FONTES } from "@/lib/landing";
import { decimal, reais } from "@/lib/numeros";
import { Turnstile } from "@/components/public/Turnstile";
import { MarcaArkeFit, SimboloArkeFit } from "@/components/marca/MarcaArkeFit";

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const APP_HOST = import.meta.env.VITE_APP_HOST as string | undefined;
/** Link para uma tela do app: no endereço do app, quando ele já existe. */
const noApp = (rota: string) => (APP_HOST ? `https://${APP_HOST}/#${rota}` : `#${rota}`);

const ESTILO = `
.lp{font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:hsl(var(--background));color:hsl(var(--foreground))}
.lp h1,.lp h2,.lp h3,.lp .lp-display{font-family:"Plus Jakarta Sans",Inter,ui-sans-serif,sans-serif;letter-spacing:-.02em}
.lp-grade{background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 75% 55% at 50% 0%,#000 35%,transparent 100%);mask-image:radial-gradient(ellipse 75% 55% at 50% 0%,#000 35%,transparent 100%)}
.lp-foco{background:radial-gradient(700px circle at var(--x,50%) var(--y,20%),hsl(var(--primary) / .10),transparent 45%)}
.lp-gradiente{background:linear-gradient(90deg,hsl(47 100% 52%) 0%,hsl(47 100% 64%) 55%,hsl(48 100% 80%) 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
@property --lp-a{syntax:"<angle>";inherits:false;initial-value:0deg}
.lp-feixe{position:relative;isolation:isolate}
.lp-feixe::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:conic-gradient(from var(--lp-a),transparent 0 68%,hsl(var(--primary) / .9) 80%,hsl(48 100% 72% / .9) 88%,transparent 96%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:lp-giro 7s linear infinite;z-index:-1}
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
        <Ancora para="topo" className="flex items-center" aria-label="ArkeFit, início da página">
          <MarcaArkeFit brilho decorativo className="h-7 w-auto" />
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
            className="rounded-lg bg-primary hover:bg-primary/90 px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/.3)] transition-transform hover:scale-[1.03]"
          >
            <span className="sm:hidden">Demonstração</span>
            <span className="hidden sm:inline">Agendar demonstração</span>
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
              O ArkeFit percebe quando ele começa a parar e põe cada sinal na fila certa, com prazo e responsável. A mensalidade cai sozinha no
              cartão.
            </p>
          </Aparecer>
          <Aparecer atraso={0.18}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Ancora
                para="contato"
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 px-6 py-3.5 font-semibold text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/.3)] transition-transform hover:scale-[1.02]"
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
 * Panorama Setorial (FONTES.panorama): academias com recorrência acima de 76%
 * contra as com recorrência até 25%. A fonte não diz o período da evasão,
 * então a página também não diz.
 */
const PANORAMA = {
  evasao: { pouca: 12.72, muita: 9.68 },
  permanencia: { pouca: 7.93, muita: 10.36 },
  ltv: { pouca: 1093.74, muita: 1521.25 },
};
const REDUCAO_EVASAO = Math.round((1 - PANORAMA.evasao.muita / PANORAMA.evasao.pouca) * 100);
const GANHO_PERMANENCIA = decimal(PANORAMA.permanencia.muita - PANORAMA.permanencia.pouca, 1);
const GANHO_LTV = Math.round((PANORAMA.ltv.muita / PANORAMA.ltv.pouca - 1) * 100);

function Barra({ rotulo, valor, maximo, texto, destaque = false }: { rotulo: string; valor: number; maximo: number; texto: string; destaque?: boolean }) {
  const reduzir = useReducedMotion();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={destaque ? "text-foreground" : "text-foreground/65"}>{rotulo}</span>
        <span className={`shrink-0 font-semibold tabular-nums ${destaque ? "text-primary" : "text-foreground/80"}`}>{texto}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-white/[0.06]">
        <motion.div
          className={`h-full rounded-full ${destaque ? "bg-primary" : "bg-foreground/30"}`}
          style={{ width: `${(valor / maximo) * 100}%`, transformOrigin: "left" }}
          initial={reduzir ? false : { scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          // Só na vertical: encolhida, a barra tem largura zero e fica colada
          // na borda do cartão. Com folga nas laterais, no celular ela nunca
          // "entrava" na tela e ficava vazia.
          viewport={{ once: true, margin: "-60px 0px" }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

function Destaque({ rotulo, numero, unidade, texto, children }: { rotulo: string; numero: string; unidade?: string; texto: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/[0.02] p-6 sm:p-7">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{rotulo}</div>
      <div className="lp-display mt-3 whitespace-nowrap text-5xl font-extrabold text-primary sm:text-6xl">
        {numero}
        {unidade && <span className="ml-2 text-2xl font-bold sm:text-3xl">{unidade}</span>}
      </div>
      <p className="mt-2 text-foreground/80">{texto}</p>
      <div className="mt-auto space-y-3 pt-6">{children}</div>
    </div>
  );
}

function Numeros() {
  const ate = "Recorrência até 25%";
  const acima = "Acima de 76%";
  return (
    <section className="relative border-y border-white/5 bg-card/60 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <h2 className="max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">
            Mensalidade no automático segura o aluno. <span className="text-foreground/65">E cada aluno passa a valer mais.</span>
          </h2>
        </Aparecer>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <Aparecer className="h-full">
            <Destaque rotulo="Valor por aluno" numero={`+${GANHO_LTV}%`} texto="de receita por aluno, ao longo da matrícula.">
              <Barra rotulo={ate} valor={PANORAMA.ltv.pouca} maximo={PANORAMA.ltv.muita} texto={reais(PANORAMA.ltv.pouca)} />
              <Barra rotulo={acima} valor={PANORAMA.ltv.muita} maximo={PANORAMA.ltv.muita} texto={reais(PANORAMA.ltv.muita)} destaque />
            </Destaque>
          </Aparecer>
          <Aparecer atraso={0.08} className="h-full">
            <Destaque rotulo="Evasão" numero={`−${REDUCAO_EVASAO}%`} texto="de alunos saindo da academia.">
              <Barra rotulo={ate} valor={PANORAMA.evasao.pouca} maximo={PANORAMA.evasao.pouca} texto={`${decimal(PANORAMA.evasao.pouca, 2)}%`} />
              <Barra rotulo={acima} valor={PANORAMA.evasao.muita} maximo={PANORAMA.evasao.pouca} texto={`${decimal(PANORAMA.evasao.muita, 2)}%`} destaque />
            </Destaque>
          </Aparecer>
          <Aparecer atraso={0.16} className="h-full">
            <Destaque rotulo="Permanência" numero={`+${GANHO_PERMANENCIA}`} unidade="meses" texto="de permanência média do aluno.">
              <Barra rotulo={ate} valor={PANORAMA.permanencia.pouca} maximo={PANORAMA.permanencia.muita} texto={`${decimal(PANORAMA.permanencia.pouca, 2)} meses`} />
              <Barra rotulo={acima} valor={PANORAMA.permanencia.muita} maximo={PANORAMA.permanencia.muita} texto={`${decimal(PANORAMA.permanencia.muita, 2)} meses`} destaque />
            </Destaque>
          </Aparecer>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
          Academias com recorrência acima de 76%, comparadas às com recorrência até 25%. Fonte:{" "}
          <a href={FONTES.panorama.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {FONTES.panorama.titulo}
          </a>
          .
        </p>
      </div>
    </section>
  );
}

// ——— Fotos da página ———
//
// As fotos de academia são do Unsplash, licença do Unsplash (uso comercial
// livre, sem pedir permissão e sem crédito obrigatório). Foram escolhidas sem
// rosto e sem marca visível: não podem parecer clientes da ArkeFit, e a
// página não tem depoimento.
//   academia-halteres.webp — Rick Barrett (Ambitious Studio), unsplash.com/photos/1RNQ11ZODJM
//   academia-ambar.webp    — Mohamed Fareed, unsplash.com/photos/rbSNsoXk-3A (recorte sem o cartaz nem a marca do aparelho)

function FaixaAcademia() {
  return (
    <section aria-label="Uma academia de verdade" className="relative isolate overflow-hidden">
      <img
        src="/site/fotos/academia-halteres.webp"
        alt=""
        width={2000}
        height={1334}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-background via-background/55 to-background" aria-hidden />
      <div className="mx-auto max-w-6xl px-4 py-28 sm:px-6 sm:py-40">
        <Aparecer>
          <p className="lp-display max-w-2xl text-3xl font-bold leading-tight text-foreground sm:text-5xl">
            Todo mês, alguns alunos começam a parar. <span className="lp-gradiente">O ArkeFit mostra quem são.</span>
          </p>
        </Aparecer>
      </div>
    </section>
  );
}

// ——— Como funciona: os primeiros 90 dias de uma aluna ———

type Cena = { icone: typeof UserX; texto: string; detalhe: string; tom: Evento["tom"] };

/**
 * Exemplo ilustrativo, com uma aluna inventada. Cada momento é uma regra que o
 * sistema tem de verdade: primeiro acesso pelo QR Code, a pergunta do
 * check-in, dois treinos sem registro, a cobrança no cartão, a dor relatada
 * no treino e a constância medida contra a meta da própria aluna.
 */
const JORNADA: { quando: string; titulo: string; app: Cena; fila: Cena }[] = [
  {
    quando: "Dia 1",
    titulo: "Entra pelo QR Code da recepção",
    app: { icone: Smartphone, texto: "Seu Treino A está pronto", detalhe: "Próxima ação · hoje", tom: "marca" },
    fila: { icone: BadgeCheck, texto: "Ana entrou no app", detalhe: "Primeiro acesso concluído", tom: "ok" },
  },
  {
    quando: "Semana 2",
    titulo: "Falta dois treinos seguidos",
    app: { icone: MessageCircle, texto: "Como está sendo seguir seu plano?", detalhe: "Funcionando bem · Preciso de ajuste", tom: "marca" },
    fila: { icone: UserX, texto: "Ana: 2 treinos sem registro", detalhe: "Recepção · prazo de 4 h", tom: "alerta" },
  },
  {
    quando: "Dia 30",
    titulo: "A mensalidade vence",
    app: { icone: CreditCard, texto: "Mensalidade paga no cartão", detalhe: "Nota fiscal no app", tom: "ok" },
    fila: { icone: Wallet, texto: "Nenhuma cobrança para fazer", detalhe: "A parte da academia já caiu na conta", tom: "ok" },
  },
  {
    quando: "Semana 6",
    titulo: "Sente dor no joelho",
    app: { icone: HeartPulse, texto: "Dor registrada no treino", detalhe: "Ao terminar a série", tom: "erro" },
    fila: { icone: HeartPulse, texto: "Revisar o treino de Ana", detalhe: "Professor · antes do próximo treino", tom: "erro" },
  },
  {
    quando: "Dia 90",
    titulo: "Continua treinando",
    app: { icone: Target, texto: "Semana cumprida: 3 de 3", detalhe: "100% da meta dela", tom: "ok" },
    fila: { icone: ListChecks, texto: "Nada pendente sobre Ana", detalhe: "Cada tarefa fechada com desfecho", tom: "ok" },
  },
];

function CenaCartao({ lado, cena }: { lado: string; cena: Cena }) {
  return (
    <div className="h-full rounded-2xl border border-white/10 bg-card/90 p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{lado}</div>
      <div className="mt-2.5 flex items-start gap-3">
        <span className={`rounded-lg p-2 ring-1 ${TOM[cena.tom]}`}>
          <cena.icone className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{cena.texto}</span>
          <span className="block text-xs text-foreground/65">{cena.detalhe}</span>
        </span>
      </div>
    </div>
  );
}

function Jornada() {
  return (
    <section id="como-funciona" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Como funciona</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">
            Os primeiros 90 dias de uma aluna. <span className="text-foreground/65">O que ela vê, e o que a academia vê.</span>
          </h2>
        </Aparecer>
        <div className="relative mt-14">
          <div className="pointer-events-none absolute bottom-8 left-[7px] top-2 w-px bg-gradient-to-b from-primary/70 via-primary/25 to-transparent" aria-hidden />
          <ol className="space-y-6">
            {JORNADA.map((m, i) => (
              <li key={m.quando} className="relative pl-9">
                <span
                  className="absolute left-0 top-1.5 h-[15px] w-[15px] rounded-full border-2 border-primary bg-background shadow-[0_0_12px_hsl(var(--primary)/.55)]"
                  aria-hidden
                />
                <Aparecer atraso={i * 0.04}>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                    <div>
                      <div className="lp-display text-sm font-bold text-primary">{m.quando}</div>
                      <h3 className="mt-1 text-lg font-bold text-foreground">{m.titulo}</h3>
                    </div>
                    <CenaCartao lado="No app da Ana" cena={m.app} />
                    <CenaCartao lado="Na fila da academia" cena={m.fila} />
                  </div>
                </Aparecer>
              </li>
            ))}
          </ol>
        </div>
        <Aparecer>
          <p className="mt-10 max-w-3xl text-foreground/65">
            Cada sinal vira tarefa com responsável e prazo, e só fecha com o desfecho escrito.{" "}
            <span className="text-muted-foreground">Exemplo ilustrativo, com uma aluna inventada.</span>
          </p>
        </Aparecer>
      </div>
    </section>
  );
}

// ——— Telas reais ———

/**
 * Telas do sistema publicado, com a academia de demonstração da Central de
 * Ajuda (nomes inventados). Mostram os dois lados da página: a fila da
 * academia e o app do aluno. Quando as telas mudarem, a Central de Ajuda
 * tira as imagens de novo e estas acompanham (public/site/telas).
 */
function PorDentro() {
  return (
    <section id="telas" className="scroll-mt-20 border-t border-white/5 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Por dentro</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">
            Telas reais do sistema. <span className="text-foreground/65">Sem maquete.</span>
          </h2>
        </Aparecer>
        <div className="mt-12 grid items-end gap-10 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
          <Aparecer className="order-2 lg:order-1">
            <figure>
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-card shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]">
                <div className="border-b border-white/10 px-4 py-2 text-xs font-medium text-muted-foreground">Painel da academia</div>
                <img
                  src="/site/telas/fila.webp"
                  width={1280}
                  height={800}
                  loading="lazy"
                  decoding="async"
                  alt="Tela Minha Fila do painel da academia: tarefas de dor relatada, mensalidade vencida e aluno que ainda não entrou no app, cada uma com prioridade e prazo"
                  className="block h-auto w-full"
                />
              </div>
              <figcaption className="mt-4 text-sm text-foreground/65">
                <span className="font-semibold text-foreground">Minha Fila.</span> Cada sinal vira tarefa com prioridade e prazo, e só fecha com o
                desfecho escrito.
              </figcaption>
            </figure>
          </Aparecer>
          {/* No celular o app vem primeiro: ali a tela do painel fica pequena demais para ler. */}
          <Aparecer atraso={0.1} className="order-1 lg:order-2">
            <figure className="mx-auto w-full max-w-[280px]">
              <div className="rounded-[2.2rem] border border-white/15 bg-black p-2.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,.9),0_0_40px_hsl(var(--primary)/.08)]">
                <img
                  src="/site/telas/app-home.webp"
                  width={780}
                  height={1560}
                  loading="lazy"
                  decoding="async"
                  alt="Tela inicial do app do aluno, com a próxima ação em destaque: abrir o treino de hoje"
                  className="block h-auto w-full rounded-[1.75rem]"
                />
              </div>
              <figcaption className="mt-4 text-sm text-foreground/65">
                <span className="font-semibold text-foreground">App do aluno.</span> A próxima ação vem primeiro.
              </figcaption>
            </figure>
          </Aparecer>
        </div>
        <p className="mt-10 text-sm text-muted-foreground">Telas da academia de demonstração, com nomes inventados.</p>
      </div>
    </section>
  );
}

// ——— Recursos ———

const RECURSOS: [typeof Wallet, string, string][] = [
  [CreditCard, "Cobrança automática", "Cartão, PIX ou boleto, direto na conta da academia."],
  [Smartphone, "App do aluno incluso", "Treino, dieta, check-in e pagamentos."],
  [FileText, "Nota fiscal automática", "No CNPJ da academia, a cada pagamento."],
  [DoorOpen, "Catraca que não trava", "Control iD e Topdata, mesmo sem internet."],
  [QrCode, "Check-in por QR Code", "Para quem não tem catraca."],
  [FileSpreadsheet, "Traga a sua base", "Planilhas do EVO, Tecnofit, Next Fit e Pacto."],
  [LineChart, "Gestão que se explica", "DRE, retenção e o resumo da semana."],
  [ShieldCheck, "LGPD levada a sério", "Dados em São Paulo e IA só com consentimento."],
];

function Recursos() {
  return (
    <section id="recursos" className="scroll-mt-20 border-t border-white/5 bg-card/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Recursos</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">O que a operação precisa, num sistema só.</h2>
        </Aparecer>
        <div className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {RECURSOS.map(([Icone, titulo, texto], i) => (
            <Aparecer key={titulo} atraso={(i % 4) * 0.05} className="h-full">
              <div
                onPointerMove={acompanharPonteiro}
                className="lp-cartao h-full rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition-colors hover:border-primary/30 sm:p-5"
              >
                <span className="inline-flex rounded-xl bg-primary/10 p-2.5 ring-1 ring-primary/20">
                  <Icone className="h-5 w-5 text-primary" aria-hidden />
                </span>
                <h3 className="mt-4 font-bold text-foreground">{titulo}</h3>
                <p className="mt-1 text-sm text-foreground/65">{texto}</p>
              </div>
            </Aparecer>
          ))}
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
            Além do app incluso, a academia pode vender o Método ARKE: acolhimento, fases da jornada e uma mentoria da ArkeFit que acompanha cada aluno à
            distância.
          </p>
          <ul className="mt-6 space-y-3 text-foreground/80">
            {["A academia define o preço e recebe na conta dela.", "O digital fica com a ArkeFit; o presencial, com a academia.", "Cada atendimento aparece para a academia, com o desfecho."].map(
              (t) => (
                <li key={t} className="flex gap-3">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden /> {t}
                </li>
              ),
            )}
          </ul>
        </Aparecer>
        <Aparecer atraso={0.1}>
          <div className="grid gap-3">
            {[
              ["M.A.P.A.®", "Acolhimento"],
              ["B.A.S.E.®", "Adaptação, contra a meta do próprio aluno"],
              ["R.O.T.A.®", "Check-ins semanais e ajustes"],
              ["A.P.E.X.® e L.E.G.A.D.O.®", "Evolução de longo prazo"],
            ].map(([fase, texto], i) => (
              <div key={fase} className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.025] p-4">
                <span className="lp-display flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary">{i + 1}</span>
                <div className="min-w-0">
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
    [Building2, "Configuração guiada", "O CNPJ preenche o resto."],
    [FileSpreadsheet, "Base importada", "A planilha atual, conferida."],
    [QrCode, "Alunos no app", "Um QR Code para todos."],
    [Fingerprint, "Catraca ligada", "Gateway local na recepção."],
    [CalendarClock, "Equipe no ritmo", "Ajuda dentro de cada tela."],
  ];
  return (
    <section className="border-y border-white/5 bg-card/60 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer>
          <Selo>Implantação</Selo>
          <h2 className="mt-5 max-w-3xl text-3xl font-bold text-foreground sm:text-4xl">Da assinatura ao primeiro aluno no app.</h2>
        </Aparecer>
        <div className="relative mt-12">
          <div className="pointer-events-none absolute left-[10%] right-[10%] top-6 hidden h-px bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10 md:block" aria-hidden />
          <ol className="grid gap-6 md:grid-cols-5 md:gap-4">
          {passos.map(([Icone, titulo, texto], i) => (
            <li key={titulo} className="relative">
              <Aparecer atraso={i * 0.06}>
                <div className="flex items-center gap-4 md:flex-col md:text-center">
                  <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-card shadow-[0_0_24px_hsl(var(--primary)/.12)]">
                    <Icone className="h-5 w-5 text-primary" aria-hidden />
                  </span>
                  <div>
                    <div className="lp-display text-xs font-bold text-muted-foreground/70">0{i + 1}</div>
                    <h3 className="font-bold text-foreground">{titulo}</h3>
                    <p className="text-sm text-foreground/65">{texto}</p>
                  </div>
                </div>
              </Aparecer>
            </li>
          ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

// ——— Fundadores ———

// Moldura redonda, recortada no rosto e na camiseta: o fundo do escritório
// aparece pouco, e a foto não fica com cara de montagem.
const FUNDADORES = [
  { nome: "Jean Ramos", cargo: "CEO e fundador", foto: "/site/fundadores/jean.webp" },
  { nome: "André Aquino", cargo: "CTO e fundador", foto: "/site/fundadores/andre.webp" },
];

function Fundadores() {
  return (
    <section id="fundadores" className="scroll-mt-20 py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Aparecer className="text-center">
          <Selo>Fundadores</Selo>
          <h2 className="mt-5 text-3xl font-bold text-foreground sm:text-4xl">Quem está por trás da ArkeFit.</h2>
        </Aparecer>
        <div className="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-6 sm:gap-10">
          {FUNDADORES.map((f, i) => (
            <Aparecer key={f.nome} atraso={i * 0.08}>
              <figure className="flex flex-col items-center text-center">
                <span className="rounded-full bg-gradient-to-b from-primary/70 via-primary/25 to-white/10 p-[3px] shadow-[0_0_40px_hsl(var(--primary)/.18)]">
                  <img
                    src={f.foto}
                    width={480}
                    height={480}
                    loading="lazy"
                    decoding="async"
                    alt={`${f.nome}, ${f.cargo} da ArkeFit`}
                    className="block h-32 w-32 rounded-full border-4 border-background object-cover sm:h-48 sm:w-48"
                  />
                </span>
                <figcaption className="mt-5">
                  <div className="lp-display text-lg font-bold text-foreground sm:text-xl">{f.nome}</div>
                  <div className="mt-0.5 text-sm text-primary">{f.cargo}</div>
                </figcaption>
              </figure>
            </Aparecer>
          ))}
        </div>
      </div>
    </section>
  );
}

// ——— Perguntas ———

const PERGUNTAS: [string, string][] = [
  ["Preciso trocar de catraca?", "Control iD e Topdata funcionam com o ArkeFit. Outras marcas são avaliadas e integradas na implantação, conforme o equipamento."],
  [
    "Como trago os alunos do sistema que uso hoje?",
    "Exporte a planilha de alunos do seu sistema. As do EVO, Tecnofit, Next Fit e Pacto são reconhecidas; o ArkeFit confere o CPF de cada linha, e a importação pode ser retomada se parar no meio.",
  ],
  ["O aluno paga para usar o app?", "Não. Todo aluno matriculado e em dia usa o app. O Método ARKE é opcional, vendido pela própria academia, com o preço que ela define."],
  [
    "Como recebo as mensalidades?",
    "Pelo Asaas, numa conta da própria academia. No momento do pagamento, a parte da academia cai direto na conta dela; o ArkeFit não segura o seu dinheiro.",
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
    <section id="contato" className="relative isolate scroll-mt-20 overflow-hidden border-t border-white/5 py-24">
      <img
        src="/site/fotos/academia-ambar.webp"
        alt=""
        width={1800}
        height={1120}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 -z-20 h-full w-full object-cover opacity-50"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/85 to-background/55" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
        <Aparecer>
          <Selo>Demonstração</Selo>
          <h2 className="mt-5 text-3xl font-bold text-foreground sm:text-4xl">Veja o ArkeFit com a cara da sua academia.</h2>
          <p className="mt-5 leading-relaxed text-foreground/65">
            Conte um pouco da sua operação. A equipe da ArkeFit responde pelo WhatsApp ou pelo e-mail para marcar uma demonstração, com a fila, a cobrança e
            o app do aluno funcionando.
          </p>
          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-sm text-foreground/65">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <p>
              Usamos estes dados só para responder ao seu contato e apresentar o ArkeFit. Ninguém além da equipe da ArkeFit os recebe. Veja a{" "}
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
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary/90 px-6 py-3.5 font-semibold text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/.3)] transition-opacity disabled:opacity-50 disabled:shadow-none sm:col-span-2"
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
          <SimboloArkeFit decorativo className="h-6 w-6" />
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

const TITULO = "ArkeFit — Retenção e cobrança automática para academias";
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
        <FaixaAcademia />
        <Jornada />
        <PorDentro />
        <Recursos />
        <Metodo />
        <Implantacao />
        <Fundadores />
        <Perguntas />
        <Contato />
      </main>
      <Rodape />
    </div>
  );
}
