/**
 * One ordered scale for console output (FR-CLI-004). `-v` and `-q` are sugar
 * that collapses into it before a `RunContext` exists, so nothing downstream
 * ever sees three ways to say the same thing.
 */
export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** A level a line can actually carry — `silent` is a threshold, never a line. */
export type EmittedLevel = Exclude<LogLevel, 'silent'>;

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Whether a line at `level` reaches a console set to `threshold`. */
export function levelPasses(threshold: LogLevel, level: EmittedLevel): boolean {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(threshold);
}
