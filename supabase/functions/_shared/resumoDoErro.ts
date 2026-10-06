/**
 * O erro reduzido ao que pode ir para o log das funções: o nome, o código e o
 * status. Nunca a mensagem nem o objeto inteiro.
 *
 * A mensagem do Auth, do PostgREST e do Asaas pode trazer dado pessoal: o
 * e-mail de quem já tem conta, o valor que violou uma restrição única
 * (`Key (cpf)=(...) already exists`), a descrição do Asaas sobre o cliente. O
 * log das funções fica no painel do Supabase, fora do controle de acesso do
 * produto, e não é lugar de dado pessoal (auditoria de prontidão, 06/10/2026;
 * `logsSemDadoPessoal.guarda`). O código basta para achar o defeito: o do
 * Postgres (`23505`), o do Auth (`email_exists`) ou o status HTTP.
 */
export function resumoDoErro(erro: unknown): string {
  if (erro === null || erro === undefined) return "sem detalhe";
  if (typeof erro !== "object") return typeof erro;
  const e = erro as { name?: unknown; code?: unknown; status?: unknown };
  const partes: string[] = [];
  if (typeof e.name === "string" && e.name) partes.push(e.name);
  if (typeof e.code === "string" || typeof e.code === "number") partes.push(`código ${String(e.code).slice(0, 40)}`);
  if (typeof e.status === "number") partes.push(`status ${e.status}`);
  return partes.length ? partes.join(", ") : "erro sem código";
}
