/**
 * A saída do aluno anonimiza o cliente dele no Asaas, sem esperar o Asaas.
 *
 * `anonimizar-aluno` e `excluir-aluno` chamam `anonimizarClienteNaSaida`
 * depois de encerrar as cobranças e antes de apagar o banco (o CPF ainda
 * está no perfil). Se o Asaas falha, a saída segue — o direito da pessoa não
 * espera o gateway — e a pendência fica em `asaas_saida_pendente`; a rotina
 * `retentar-saida-asaas` chama `retentarPendentes` de hora em hora até dar
 * certo. A regra do que se toca em cada conta mora em `clienteAsaas.ts`.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anonimizarAlunoNoAsaas, type EntradaAnonimizacao, type ResultadoAnonimizacao } from "./clienteAsaas.ts";

export type AlunoQueSai = { id: string; user_id: string | null; organization_id: string };

export type DesfechoSaidaAsaas =
  | { situacao: "anonimizado"; resultado: Extract<ResultadoAnonimizacao, { ok: true }> }
  /** Ficou para a rotina tentar de novo. */
  | { situacao: "pendente"; erro: string }
  /** Falhou, e nem a pendência foi gravada: só o log e a resposta dizem. */
  | { situacao: "sem_registro"; erro: string };

const descrever = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "erro inesperado");

/** O que a anonimização no Asaas precisa ler do banco. Lança se a leitura falhar. */
async function entradaDoAluno(admin: SupabaseClient, aluno: AlunoQueSai, outrosVinculos: boolean): Promise<EntradaAnonimizacao> {
  const [org, chave, perfil, outras] = await Promise.all([
    admin.from("organizations").select("status").eq("id", aluno.organization_id).maybeSingle(),
    admin.rpc("ler_chave_subconta_asaas", { _organization_id: aluno.organization_id }),
    aluno.user_id
      ? admin.from("profiles").select("cpf").eq("user_id", aluno.user_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    aluno.user_id
      ? admin.from("alunos").select("id").eq("user_id", aluno.user_id).neq("id", aluno.id).limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (org.error) throw new Error(`organização: ${org.error.code ?? org.error.message}`);
  if (chave.error) throw new Error(`chave da academia: ${chave.error.code ?? chave.error.message}`);
  if (perfil.error) throw new Error(`perfil: ${perfil.error.code ?? perfil.error.message}`);
  if (outras.error) throw new Error(`matrículas: ${outras.error.code ?? outras.error.message}`);
  return {
    alunoId: aluno.id,
    statusOrganizacao: (org.data as { status?: string } | null)?.status ?? null,
    cpf: (perfil.data as { cpf?: string | null } | null)?.cpf ?? null,
    chaveDaAcademia: typeof chave.data === "string" && chave.data ? chave.data : null,
    outrosVinculos,
    outrasMatriculas: ((outras.data ?? []) as { id: string }[]).map((a) => a.id),
  };
}

/**
 * Anonimiza o cliente do aluno no Asaas. Nunca lança e nunca trava a saída:
 * o desfecho diz se deu certo ou se ficou pendente.
 */
export async function anonimizarClienteNaSaida(
  admin: SupabaseClient,
  aluno: AlunoQueSai,
  outrosVinculos: boolean,
  env: (nome: string) => string | undefined,
): Promise<DesfechoSaidaAsaas> {
  let r: ResultadoAnonimizacao;
  try {
    r = await anonimizarAlunoNoAsaas(await entradaDoAluno(admin, aluno, outrosVinculos), env);
  } catch (e) {
    r = { ok: false, erro: descrever(e) };
  }

  if (r.ok) {
    // A pendência de uma tentativa anterior sai junto.
    const { error } = await admin.from("asaas_saida_pendente").delete().eq("aluno_id", aluno.id);
    if (error) console.error("saída no Asaas: a pendência não saiu", error.code);
    return { situacao: "anonimizado", resultado: r };
  }

  const erro = "erro" in r ? r.erro : "erro inesperado";
  console.error("saída no Asaas: ficou pendente");
  const { error } = await admin.rpc("registrar_saida_asaas_pendente", {
    _aluno_id: aluno.id,
    _organization_id: aluno.organization_id,
    _user_id: aluno.user_id,
    _outros_vinculos: outrosVinculos,
    _erro: erro,
  });
  if (error) {
    console.error("saída no Asaas: a pendência não foi gravada", error.code);
    return { situacao: "sem_registro", erro };
  }
  return { situacao: "pendente", erro };
}

/**
 * A nova tentativa das pendências, das mais antigas para as mais novas.
 * Quem tinha outro vínculo na hora da saída continua tratado assim: depois
 * da exclusão, o banco já não sabe responder.
 */
export async function retentarPendentes(
  admin: SupabaseClient,
  env: (nome: string) => string | undefined,
  limite = 50,
): Promise<{ tentadas: number; concluidas: number; pendentes: number }> {
  const { data, error } = await admin
    .from("asaas_saida_pendente")
    .select("aluno_id, organization_id, user_id, outros_vinculos")
    .order("atualizado_em")
    .limit(limite);
  if (error) throw new Error(`pendências: ${error.code ?? error.message}`);
  let concluidas = 0;
  for (const p of (data ?? []) as { aluno_id: string; organization_id: string; user_id: string | null; outros_vinculos: boolean }[]) {
    const d = await anonimizarClienteNaSaida(admin, { id: p.aluno_id, user_id: p.user_id, organization_id: p.organization_id }, p.outros_vinculos, env);
    if (d.situacao === "anonimizado") concluidas++;
  }
  const tentadas = (data ?? []).length;
  return { tentadas, concluidas, pendentes: tentadas - concluidas };
}
