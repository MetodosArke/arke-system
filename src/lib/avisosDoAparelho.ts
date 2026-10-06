import { supabase } from "@/integrations/supabase/client";

/**
 * Os avisos no celular (push) pertencem à pessoa que está no aparelho.
 *
 * A assinatura de push é do navegador, e a linha em `push_subscriptions` liga
 * essa assinatura a uma pessoa. Até 06/10/2026 nada desfazia a ligação: quem
 * saía continuava recebendo, no aparelho, os avisos da conta de onde saiu, e a
 * próxima pessoa a usar o aparelho também. Na simulação de perfil era pior: o
 * aparelho da ArkeFit ficava registrado como destino dos avisos da pessoa
 * simulada.
 */

export interface InscricaoDoNavegador {
  endpoint: string;
  unsubscribe(): Promise<boolean>;
}

export interface DependenciasAvisos {
  /** A assinatura de push deste navegador, se houver. Nunca cria uma. */
  inscricaoAtual(): Promise<InscricaoDoNavegador | null>;
  /** Apaga a linha que liga a pessoa a esta assinatura. */
  apagarLinha(userId: string, endpoint: string): Promise<void>;
}

async function inscricaoDoNavegador(): Promise<InscricaoDoNavegador | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  if (typeof window === "undefined" || !("PushManager" in window)) return null;
  // `getRegistration`, e não `register`/`ready`: sair não pode instalar nada,
  // e esperar um service worker que não existe seguraria a saída.
  const registro = await navigator.serviceWorker.getRegistration();
  return (await registro?.pushManager.getSubscription()) ?? null;
}

async function apagarLinhaNoBanco(userId: string, endpoint: string): Promise<void> {
  const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
  if (error) throw error;
}

const PADRAO: DependenciasAvisos = { inscricaoAtual: inscricaoDoNavegador, apagarLinha: apagarLinhaNoBanco };

/**
 * Desliga este aparelho dos avisos de `userId`.
 *
 * A linha do banco sai primeiro, enquanto a sessão ainda vale (o RLS só deixa
 * a própria pessoa apagar). `cancelarNoNavegador` desfaz também a assinatura do
 * navegador: é o certo no "Sair". Na volta da simulação, não: a assinatura do
 * navegador é a mesma da conta da ArkeFit, que continua no aparelho.
 *
 * Um passo não depende do outro. Se a linha não sair, a assinatura cancelada
 * já basta, porque o serviço de push passa a recusar o endereço e o envio
 * apaga a inscrição morta.
 */
export async function esquecerAvisosDesteAparelho(
  userId: string | null,
  { cancelarNoNavegador }: { cancelarNoNavegador: boolean },
  deps: DependenciasAvisos = PADRAO,
): Promise<void> {
  const inscricao = await deps.inscricaoAtual();
  if (!inscricao) return;

  if (userId) {
    try {
      await deps.apagarLinha(userId, inscricao.endpoint);
    } catch (erro) {
      console.error("Não foi possível apagar a inscrição de avisos deste aparelho", erro);
    }
  }

  if (cancelarNoNavegador) {
    try {
      await inscricao.unsubscribe();
    } catch (erro) {
      console.error("Não foi possível cancelar a inscrição de avisos no navegador", erro);
    }
  }
}
