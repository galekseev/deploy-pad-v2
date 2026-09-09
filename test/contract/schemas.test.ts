/**
 * The schemas moved out of the docs folder and into the package that publishes
 * them, so nothing has two copies to keep in sync. What that move can break is
 * every path pointing at them — a modeline that no longer resolves costs an
 * author their editor completion silently.
 *
 * Validating the examples *against* their schemas is a different test, and
 * arrives with the ajv wiring.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_FORMAT_VERSION, SCHEMA_NAMES } from '@deploy-pad/schemas';
import { MOUNT_FILES } from '../../packages/engine/src/phases/phase-2/index.ts';
import { REPO_ROOT, repoPath } from '../support/paths.ts';

const SCHEMA_DIR = repoPath('packages/schemas/src');
const EXAMPLE_DIR = repoPath('docs/specs/examples');

const MODELINE = /^#\s*yaml-language-server:\s*\$schema=(?<target>\S+)\s*$/mu;

function markdownFiles(from: string): string[] {
  return readdirSync(from, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => resolve(entry.parentPath, entry.name));
}

describe('the schemas package', () => {
  it('holds one authored schema per config file, and no others', () => {
    const onDisk = readdirSync(SCHEMA_DIR)
      .filter((name) => name.endsWith('.schema.yaml'))
      .map((name) => name.replace('.schema.yaml', ''))
      .sort();

    expect(onDisk).toEqual([...SCHEMA_NAMES].sort());
  });

  it('is the only copy — the docs folder no longer carries one', () => {
    expect(existsSync(repoPath('docs/specs/schemas'))).toBe(false);
  });

  it('covers every file the engine reads out of a mount, and `plans` besides', () => {
    // `plans` is the one schema whose documents are a directory rather than a
    // single file, which is why the config source lists the other six and reaches
    // plan files through their own call.
    expect([...MOUNT_FILES, 'plans'].sort()).toEqual([...SCHEMA_NAMES].sort());
  });
});

describe('every example file resolves its schema', () => {
  const examples = readdirSync(EXAMPLE_DIR).filter((name) => name.endsWith('.yml'));

  it('finds examples to check', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  for (const name of examples) {
    it(`${name} points at a schema that exists`, () => {
      const file = resolve(EXAMPLE_DIR, name);
      const modeline = MODELINE.exec(readFileSync(file, 'utf8'));

      expect(modeline?.groups, `${name} carries no yaml-language-server modeline`).toBeDefined();

      const target = resolve(dirname(file), modeline?.groups?.['target'] as string);
      expect(existsSync(target), `${name} points at ${relative(REPO_ROOT, target)}`).toBe(true);
      expect(relative(SCHEMA_DIR, target).startsWith('..')).toBe(false);
    });
  }
});

describe('every documented schema link resolves', () => {
  const links = markdownFiles(repoPath('docs')).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/\]\((?<target>[^)\s]*\.schema\.yaml)\)/gu)].map((match) => ({
      file,
      target: match.groups?.['target'] as string,
    }));
  });

  it('finds links to check', () => {
    expect(links.length).toBeGreaterThan(0);
  });

  for (const { file, target } of links) {
    it(`${relative(REPO_ROOT, file)} → ${target}`, () => {
      expect(existsSync(resolve(dirname(file), target))).toBe(true);
    });
  }
});

describe('the editor settings', () => {
  const settings = JSON.parse(readFileSync(repoPath('.vscode/settings.json'), 'utf8')) as {
    'yaml.schemas': Record<string, readonly string[]>;
  };

  it('maps every schema, so a live workspace config needs no modeline', () => {
    const mapped = Object.keys(settings['yaml.schemas'])
      .map((target) => target.replace('./packages/schemas/src/', '').replace('.schema.yaml', ''))
      .sort();

    expect(mapped).toEqual([...SCHEMA_NAMES].sort());
  });

  it('points at files that exist', () => {
    for (const target of Object.keys(settings['yaml.schemas'])) {
      expect(existsSync(repoPath(target)), target).toBe(true);
    }
  });
});

describe('the config format version', () => {
  it('is the one every worked example declares', () => {
    const declared = readdirSync(EXAMPLE_DIR)
      .filter((name) => name.endsWith('.yml'))
      .map((name) => ({
        name,
        version: /^version:\s*(?<value>\d+)\s*$/mu.exec(readFileSync(resolve(EXAMPLE_DIR, name), 'utf8'))
          ?.groups?.['value'],
      }))
      .filter((entry) => entry.version !== undefined);

    expect(declared.length).toBeGreaterThan(0);
    for (const entry of declared) {
      expect(Number(entry.version), entry.name).toBe(CONFIG_FORMAT_VERSION);
    }
  });
});
