/**
 * Ciclo de vida da assinatura no Asaas: cancelar, pausar, retomar, alterar valor.
 *
 * Sem Deno e sem Supabase de propósito, para `npm run sandbox:ciclo` exercitar
 * este código e não uma cópia dele — mesmo critério do `fluxo.ts` do cartão e
 * da conta da academia.
 *
 * O que o sandbox ensinou, e que a documentação não deixa claro:
 *
 *   * `DELETE /subscriptions/{id}` **apaga as cobranças pendentes junto** e
 *     dispara um `PAYMENT_DELETED` para cada. É idempotente: chamar de novo
 *     responde 200 com `deleted: true`.
 *   * `PUT {status:"INACTIVE"}` pausa a emissão futura mas **mantém** o que já
 *     foi emitido. Pausar sem tratar isso deixa o aluno devendo justamente
 *     pelo período em que estava pausado.
 *   * `PUT {value}` só vale para o futuro; com `updatePendingPayments: true` o
 *     Asaas atualiza as pendentes e **não toca nas já pagas**, que é o certo.
 *   * valor e split podem ir no mesmo `PUT`, e o split das cobranças pendentes
 *     acompanha. Isso importa: mudar o varejo sem mudar o split deixaria a
 *     divisão errada, porque a parte da academia é valor fixo.
 *   * split maior que o **líquido** é recusado com 400.
 */

export type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string; status: number };

type CobrancaAsaas = { id: string; status: string; dueDate: string; value: number };

const cabecalhos = (chave: string) => ({
  "Content-Type": "application/json",
  access_token: chave,
  "User-Agent": "arke-system",
});

async function chamar(url: string, chave: string, metodo = "GET", corpo?: unknown) {
  const resposta = await fetch(url, {
    method: metodo,
    headers: cabecalhos(chave),
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const dados = await resposta.json().catch(() => ({}));
  return { status: resposta.status, ok: resposta.ok, dados } as {
    status: number;
    ok: boolean;
    dados: Record<string, unknown> & { errors?: { description?: string }[] };
  };
}

const primeiroErro = (dados: { errors?: { description?: string }[] }, padrao: string) =>
  dados.errors?.[0]?.description ?? padrao;

/** As cobranças da assinatura, da mais recente para a mais antiga. */
export async function cobrancasDaAssinatura(
  api: string,
  chave: string,
  subscriptionId: string,
): Promise<CobrancaAsaas[] | null> {
  const r = await chamar(`${api}/subscriptions/${subscriptionId}/payments?limit=100`, chave);
  if (!r.ok) return null;
  return ((r.dados.data as CobrancaAsaas[]) ?? []).map((c) => ({
    id: c.id,
    status: c.status,
    dueDate: c.dueDate,
    value: Number(c.value),
  }));
}

/**
 * Encerra a assinatura. O Asaas remove as cobranças pendentes junto e manda um
 * `PAYMENT_DELETED` de cada — é por isso que o webhook precisa tratar esse
 * evento como cobrança **cancelada** e não como estorno: não há o que pagar.
 *
 * Idempotente por natureza: cancelar de novo responde 200.
 */
export async function cancelarAssinatura(
  api: string,
  chave: string,
  subscriptionId: string,
): Promise<Resultado<{ jaEstavaCancelada: boolean }>> {
  const atual = await chamar(`${api}/subscriptions/${subscriptionId}`, chave);
  if (atual.status === 404) {
    // Some do gateway: para o ARKE o efeito desejado já está valendo.
    return { ok: true, jaEstavaCancelada: true };
  }
  const jaEstavaCancelada = atual.ok && atual.dados.deleted === true;

  const r = await chamar(`${api}/subscriptions/${subscriptionId}`, chave, "DELETE");
  if (!r.ok) {
    return { ok: false, erro: primeiroErro(r.dados, "Não foi possível cancelar a assinatura no gateway."), status: 502 };
  }
  return { ok: true, jaEstavaCancelada };
}

/**
 * Pausa a emissão e limpa o que foi emitido para **o futuro**.
 *
 * A cobrança já vencida fica: é dívida de um período que o aluno usou, e
 * apagá-la seria perdoar dinheiro sem ninguém decidir isso. A que ainda não
 * venceu sai, porque é de um período que o aluno não vai usar — mantê-la faria
 * a pausa cobrar por nada e, pior, bloquearia o aluno quando ela vencesse.
 *
 * @param hoje data de Brasília (`YYYY-MM-DD`), injetada para ser testável.
 */
export async function pausarAssinatura(
  api: string,
  chave: string,
  subscriptionId: string,
  hoje: string,
): Promise<Resultado<{ cobrancasRemovidas: string[]; cobrancasVencidasMantidas: string[] }>> {
  const r = await chamar(`${api}/subscriptions/${subscriptionId}`, chave, "PUT", { status: "INACTIVE" });
  if (!r.ok) {
    return { ok: false, erro: primeiroErro(r.dados, "Não foi possível pausar a assinatura no gateway."), status: 502 };
  }

  const cobrancas = await cobrancasDaAssinatura(api, chave, subscriptionId);
  if (cobrancas === null) {
    // A pausa valeu; não saber o que sobrou é pior que não avisar.
    return {
      ok: false,
      erro: "A assinatura foi pausada, mas não foi possível conferir as cobranças já emitidas. Verifique no painel do Asaas.",
      status: 502,
    };
  }

  const removidas: string[] = [];
  const vencidasMantidas: string[] = [];
  for (const c of cobrancas) {
    if (c.status !== "PENDING" && c.status !== "OVERDUE") continue;
    if (c.dueDate < hoje) {
      vencidasMantidas.push(c.id);
      continue;
    }
    const d = await chamar(`${api}/payments/${c.id}`, chave, "DELETE");
    if (d.ok) removidas.push(c.id);
  }
  return { ok: true, cobrancasRemovidas: removidas, cobrancasVencidasMantidas: vencidasMantidas };
}

/** Volta a emitir. A próxima cobrança segue o ciclo de onde parou. */
export async function retomarAssinatura(
  api: string,
  chave: string,
  subscriptionId: string,
): Promise<Resultado<Record<string, never>>> {
  const r = await chamar(`${api}/subscriptions/${subscriptionId}`, chave, "PUT", { status: "ACTIVE" });
  if (!r.ok) {
    return { ok: false, erro: primeiroErro(r.dados, "Não foi possível retomar a assinatura no gateway."), status: 502 };
  }
  return { ok: true };
}

/**
 * Altera quanto o aluno paga — e, junto, quanto fica com a academia.
 *
 * Os dois andam sempre juntos porque a parte da academia é **valor fixo** no
 * split: mudar o varejo sem mudar o split mudaria em silêncio a divisão
 * combinada. Por isso esta função recebe o repasse já calculado pela mesma
 * conta da criação (custo do nível + taxa sobre o valor cobrado) e deriva a
 * parte da academia dele.
 *
 * Cobrança já emitida e **ainda não vencida** acompanha o valor novo; cobrança
 * já vencida não, porque aumentar retroativamente uma dívida que o aluno já
 * devia não se defende. Como o `updatePendingPayments` do Asaas é tudo-ou-nada,
 * havendo vencida em aberto a atualização não é pedida, e a resposta diz quais
 * ficaram no valor antigo em vez de deixar a diferença invisível.
 */
export async function alterarValorAssinatura(
  api: string,
  chave: string,
  subscriptionId: string,
  dados: { valorCobrado: number; valorRepasseArke: number; walletAcademia: string; hoje: string },
): Promise<Resultado<{ valorAcademia: number; pendentesAtualizadas: boolean; vencidasNoValorAntigo: string[] }>> {
  const valorAcademia = Math.round((dados.valorCobrado - dados.valorRepasseArke) * 100) / 100;
  if (valorAcademia < 0) {
    return {
      ok: false,
      erro: `O valor cobrado (${dados.valorCobrado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}) é menor que o repasse ARKE (${dados.valorRepasseArke.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}).`,
      status: 400,
    };
  }

  const cobrancas = await cobrancasDaAssinatura(api, chave, subscriptionId);
  if (cobrancas === null) {
    return { ok: false, erro: "Não foi possível conferir as cobranças da assinatura no gateway.", status: 502 };
  }
  const vencidasEmAberto = cobrancas
    .filter((c) => (c.status === "PENDING" || c.status === "OVERDUE") && c.dueDate < dados.hoje)
    .map((c) => c.id);
  const atualizarPendentes = vencidasEmAberto.length === 0;

  const r = await chamar(`${api}/subscriptions/${subscriptionId}`, chave, "PUT", {
    value: dados.valorCobrado,
    updatePendingPayments: atualizarPendentes,
    split: valorAcademia > 0 ? [{ walletId: dados.walletAcademia, fixedValue: valorAcademia }] : [],
  });
  if (!r.ok) {
    return { ok: false, erro: primeiroErro(r.dados, "Não foi possível alterar o valor da assinatura."), status: 502 };
  }
  return {
    ok: true,
    valorAcademia,
    pendentesAtualizadas: atualizarPendentes,
    vencidasNoValorAntigo: vencidasEmAberto,
  };
}
