import { isAbsolute, resolve } from "node:path";

/**
 * Where a relative path given to `pnpm validate:published <path>` is resolved from.
 * pnpm runs the script inside `packages/published` and records the directory the user typed the
 * command in as `INIT_CWD`; without it (running the file directly) the process cwd is the right base.
 */
export function resolveValidateTarget(arg: string, env: { INIT_CWD?: string | undefined } = process.env, cwd: string = process.cwd()): string {
  if (isAbsolute(arg)) return arg;
  return resolve(env.INIT_CWD || cwd, arg);
}
