/**
 * The packed-artifact smoke test.
 *
 * Packs both packages, installs the tarballs into a clean directory **outside**
 * the workspace, and drives the installed binary. Outside matters: inside the
 * monorepo everything resolves through the workspace, so an undeclared
 * dependency, a file missing from `files`, or a broken `exports` map is
 * invisible until a consumer's first install (test-strategy.md → The packed
 * artifact).
 *
 * Set DEPLOY_PAD_SMOKE_DIR to install somewhere other than the system temp
 * directory. Anywhere inside the repository defeats the point — Node's
 * resolution walks up into the workspace `node_modules`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { styleText } from 'node:util';
import { CONFIG_FORMAT_VERSION } from '@deploy-pad/schemas';

const REPO_ROOT = join(import.meta.dirname, '..');
const PACKAGES = ['schemas', 'engine'] as const;

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(command: string, args: readonly string[], cwd: string): RunResult {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', shell: false });
  if (result.error !== undefined) throw result.error;
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function must(command: string, args: readonly string[], cwd: string): RunResult {
  const result = run(command, args, cwd);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

const failures: string[] = [];

function check(description: string, assertion: () => void): void {
  try {
    assertion();
    console.log(`${styleText('green', 'ok')}  ${description}`);
  } catch (cause) {
    failures.push(description);
    console.log(`${styleText('red', 'fail')}  ${description}`);
    console.log(`      ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function expect(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function contains(haystack: string, needle: string, what: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${what}: expected to contain ${JSON.stringify(needle)}, got ${JSON.stringify(haystack)}`);
  }
}

const root = mkdtempSync(join(process.env['DEPLOY_PAD_SMOKE_DIR'] ?? tmpdir(), 'deploy-pad-smoke-'));
const consumer = join(root, 'consumer');

try {
  console.log(`Building, then packing into ${root}`);
  must('pnpm', ['-r', 'run', 'build'], REPO_ROOT);

  const tarballs = PACKAGES.map((name) => {
    const destination = join(root, name);
    mkdirSync(destination, { recursive: true });
    must('pnpm', ['pack', '--pack-destination', destination], join(REPO_ROOT, 'packages', name));

    const packed = readdirSync(destination).filter((entry) => entry.endsWith('.tgz'));
    if (packed.length !== 1) {
      throw new Error(`expected one tarball for ${name}, found ${String(packed.length)}`);
    }
    return join(destination, packed[0] as string);
  });

  console.log(`Installing into ${consumer}\n`);
  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'deploy-pad-smoke-consumer', private: true, type: 'module' }, null, 2)}\n`,
  );
  must('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error', ...tarballs], consumer);

  const bin = join(consumer, 'node_modules', '.bin', 'deploy-pad');

  check('the workspace protocol became an exact version in the published manifest', () => {
    const manifest = must(
      'node',
      [
        '--eval',
        "import('node:fs').then(fs => process.stdout.write(fs.readFileSync('node_modules/@deploy-pad/engine/package.json', 'utf8')))",
      ],
      consumer,
    ).stdout;
    const declared = (JSON.parse(manifest) as { dependencies: Record<string, string> }).dependencies;
    expect(declared['@deploy-pad/schemas'], '2.0.0', 'the schemas dependency range');
  });

  check('deploy-pad --help runs from the installed tarball', () => {
    const result = run(bin, ['--help'], consumer);
    expect(result.status, 0, 'exit code');
    contains(result.stdout, 'Usage: deploy-pad', 'help output');
  });

  check('the installed engine reports the config format it speaks', () => {
    const result = run(bin, ['--version'], consumer);
    expect(result.status, 0, 'exit code');
    contains(result.stdout, `(config format ${String(CONFIG_FORMAT_VERSION)})`, 'version output');
  });

  check('the exit-code contract survives packaging', () => {
    expect(run(bin, [], consumer).status, 1, 'exit code for a missing command');
    expect(run(bin, ['--no-such-flag'], consumer).status, 1, 'exit code for an unknown flag');
  });

  check("the engine's exports map resolves", () => {
    const result = must(
      'node',
      [
        '--eval',
        "import('@deploy-pad/engine').then(m => process.stdout.write(String(m.ExitCode.MultisigWaiting)))",
      ],
      consumer,
    );
    expect(result.stdout.trim(), '10', 'ExitCode.MultisigWaiting through the published entry');
  });

  check("the schemas package's exports map resolves, entry and every subpath", () => {
    const result = must(
      'node',
      [
        '--eval',
        `const { readFileSync } = await import('node:fs');
         const { CONFIG_FORMAT_VERSION, SCHEMA_NAMES } = await import('@deploy-pad/schemas');
         const seen = [];
         for (const name of SCHEMA_NAMES) {
           for (const extension of ['yaml', 'json']) {
             const specifier = '@deploy-pad/schemas/' + name + '.schema.' + extension;
             const path = import.meta.resolve(specifier);
             seen.push(readFileSync(new URL(path), 'utf8').length > 0);
           }
         }
         process.stdout.write(JSON.stringify({ CONFIG_FORMAT_VERSION, files: seen.length, ok: seen.every(Boolean) }));`,
      ],
      consumer,
    );
    const resolved = JSON.parse(result.stdout) as {
      CONFIG_FORMAT_VERSION: number;
      files: number;
      ok: boolean;
    };
    expect(resolved.CONFIG_FORMAT_VERSION, CONFIG_FORMAT_VERSION, 'the exported format version');
    expect(resolved.files, 14, 'schema files reachable by subpath (7 yaml + 7 json)');
    expect(resolved.ok, true, 'every schema file readable');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.log(styleText('red', `\n${String(failures.length)} packed-artifact check(s) failed.`));
  process.exitCode = 1;
} else {
  console.log(styleText('green', '\nPacked-artifact smoke test passed.'));
}
