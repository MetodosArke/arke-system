// Limite de tentativas em memória para endpoints sensíveis de autenticação
// (login, recuperação de senha, aceite de convite) — hoje não existia
// nenhuma camada de defesa contra força bruta além da entropia dos tokens.
//
// Não substitui um rate limiter distribuído (Redis/Upstash): cada instância
// do servidor tem sua própria contagem, e ela reinicia a zero a cada cold
// start em serverless. Ainda assim, é a primeira barreira que hoje não
// existe, e cobre o caso comum de um único IP tentando repetidamente.
import { TRPCError } from "@trpc/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Evita crescimento sem limite da memória se muitos IPs distintos baterem
// no mesmo intervalo — limpa tudo e recomeça a contagem (pior caso: uma
// janela de tolerância extra, nunca um vazamento de memória).
const MAX_BUCKETS = 5000;

export function assertRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > max) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
  }
}

// req.ip depende de `app.set("trust proxy", 1)` em _core/index.ts — com
// isso, Express já resolve o IP real do cliente a partir de
// X-Forwarded-For (o valor mais à direita, posto pela Vercel), ignorando
// qualquer prefixo que o próprio cliente tenha forjado no header. Ler o
// header aqui direto (como era antes) confiava no primeiro valor, que é
// justamente o que o cliente controla — deixava o rate limit ser burlado
// trocando o header a cada tentativa.
export function rateLimitKey(req: { ip?: string }, bucket: string) {
  return `${bucket}:${req.ip || "unknown"}`;
}
