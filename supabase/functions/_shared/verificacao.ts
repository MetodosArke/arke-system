/**
 * O papel da ArkeFit (Super Admin e Admin ARKE) só vale numa sessão
 * verificada em duas etapas — `aal2` no token, depois do código do
 * aplicativo autenticador. Sem isso uma senha vazada abriria todas as
 * academias, inclusive a entrada como qualquer perfil. O banco exige o mesmo
 * em `has_role` (migration 20261283010000); aqui é o espelho para as edge
 * functions, que conferem o papel pela tabela com a service_role.
 * `verificacao.guarda.test.ts` confere que toda função que decide pelo papel
 * da ArkeFit passa por aqui.
 */
export const verificada = (claims: { aal?: unknown } | null | undefined): boolean => claims?.aal === "aal2";
