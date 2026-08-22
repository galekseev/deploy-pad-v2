/**
 * The invocation wrapper's one job (FR-CLI-003): make the config mount's `.env`
 * available in the environment before anything resolves `${env.VAR}` or follows
 * a vault pointer into it.
 *
 * Node loads a `.env` natively, so this needs no `dotenv` and — using
 * `process.loadEnvFile` rather than the `--env-file` process flag — no second
 * process either. That is why the wrapper shrank to a function the CLI calls
 * first rather than a script that re-execs node (stack.md §1).
 *
 * The file is optional: CI exports the same variables in the job step instead.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const DEFAULT_CONFIGS_DIR = 'workspace/configs';
export const ENV_FILE_NAME = '.env';

export interface EnvFileOutcome {
  /** The absolute path considered, whether or not it existed. */
  readonly path: string;
  readonly loaded: boolean;
}

export interface EnvFileIo {
  readonly cwd?: string | undefined;
  readonly exists?: ((path: string) => boolean) | undefined;
  readonly load?: ((path: string) => void) | undefined;
}

export function envFilePath(configsDir: string, cwd: string = process.cwd()): string {
  const root = isAbsolute(configsDir) ? configsDir : resolve(cwd, configsDir);
  return resolve(root, ENV_FILE_NAME);
}

export function loadWorkspaceEnv(configsDir: string, io: EnvFileIo = {}): EnvFileOutcome {
  const path = envFilePath(configsDir, io.cwd ?? process.cwd());
  const exists = io.exists ?? existsSync;

  if (!exists(path)) return { path, loaded: false };

  (io.load ?? ((target: string): void => { process.loadEnvFile(target); }))(path);
  return { path, loaded: true };
}
