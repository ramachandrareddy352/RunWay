/** Blank variables (`NAME=` in a .env file) count as unset, so optional settings stay optional. */
export function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
}
