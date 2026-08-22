/**
 * The executable entry. Sets an exit code and returns, rather than calling
 * `process.exit`, so the process drains its output before ending (stack.md §7).
 */
import { runCli } from './cli.ts';

process.exitCode = runCli(process.argv.slice(2));
