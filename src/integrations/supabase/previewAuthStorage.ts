// Chave que guarda a preferência "manter-me conectado" da pessoa — sempre
// em localStorage (é só uma flag, não a sessão em si), pra sobreviver ao
// fechamento da aba mesmo quando a sessão escolhida é a temporária.
const PREF_KEY = "arkefit_manter_conectado";

// Sem preferência salva ainda (primeiro acesso, ou deploy antigo): mantém
// o comportamento histórico (sessão persistente), pra não deslogar quem
// já estava usando o app antes desta opção existir.
export function getManterConectado(): boolean {
  if (typeof window === "undefined") return true;
  const valor = window.localStorage.getItem(PREF_KEY);
  return valor !== "0";
}

export function setManterConectado(manter: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREF_KEY, manter ? "1" : "0");
}

// Storage adapter do Supabase Auth: quando "manter-me conectado" está
// ligado, a sessão vai pro localStorage (sobrevive a fechar o
// navegador/app, como sempre foi). Quando está desligado, vai pro
// sessionStorage — some ao fechar a aba, e principalmente NÃO é
// compartilhada entre abas/páginas novas no mesmo navegador, que é
// exatamente o cenário que confundia os testes (abrir uma aba nova pra
// entrar como Super Admin e cair direto na conta de aluno testada
// antes). Decide a cada chamada, então funciona mesmo trocando a
// preferência entre um login e outro.
export function brokeredPreviewStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  const persistente = window.localStorage;
  const temporario = window.sessionStorage;
  return {
    get length() {
      return getManterConectado() ? persistente.length : temporario.length;
    },
    clear() {
      (getManterConectado() ? persistente : temporario).clear();
    },
    getItem(key: string) {
      return (getManterConectado() ? persistente : temporario).getItem(key);
    },
    key(index: number) {
      return (getManterConectado() ? persistente : temporario).key(index);
    },
    removeItem(key: string) {
      (getManterConectado() ? persistente : temporario).removeItem(key);
    },
    setItem(key: string, value: string) {
      (getManterConectado() ? persistente : temporario).setItem(key, value);
    },
  };
}
