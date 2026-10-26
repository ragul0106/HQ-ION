import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SchemeFileSchema } from './scheme-file.js';
import type { Scheme } from './types.js';

export interface LoadProblem {
  file: string;
  /** Dotted path inside the file, or '' for the whole file. */
  path: string;
  message: string;
}

export type LoadResult = { ok: true; schemes: Scheme[] } | { ok: false; problems: LoadProblem[] };

/**
 * Read every `*.json` file in a folder as one scheme and validate it (PRD: "a reviewed JSON import"). All or
 * nothing: if any file is invalid the whole load fails and says exactly where, so a half-valid catalog can never
 * go live. Never includes a rejected value in a message.
 */
export async function loadSchemes(dir: string): Promise<LoadResult> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return { ok: false, problems: [{ file: dir, path: '', message: 'folder cannot be read' }] };
  }
  if (names.length === 0) {
    return {
      ok: false,
      problems: [{ file: dir, path: '', message: 'no scheme files (*.json) found' }],
    };
  }

  const problems: LoadProblem[] = [];
  const schemes: Scheme[] = [];
  const idOwner = new Map<string, string>();

  for (const name of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, name), 'utf8'));
    } catch {
      problems.push({ file: name, path: '', message: 'not valid JSON' });
      continue;
    }
    const parsed = SchemeFileSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push({ file: name, path: issue.path.join('.'), message: issue.message });
      }
      continue;
    }
    const other = idOwner.get(parsed.data.id);
    if (other) {
      problems.push({
        file: name,
        path: 'id',
        message: `duplicate scheme id, already used by ${other}`,
      });
      continue;
    }
    idOwner.set(parsed.data.id, name);
    schemes.push(parsed.data);
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, schemes };
}

export function formatProblems(problems: readonly LoadProblem[]): string {
  return problems
    .map((p) => `  - ${p.file}${p.path ? ` [${p.path}]` : ''}: ${p.message}`)
    .join('\n');
}

/** The current scheme set. Reloading never leaves the app without schemes: a bad reload keeps the old set. */
export interface SchemeStore {
  all(): readonly Scheme[];
  reload(): Promise<LoadResult>;
}

export class FileSchemeStore implements SchemeStore {
  private current: readonly Scheme[] = [];

  constructor(private readonly dir: string) {}

  all(): readonly Scheme[] {
    return this.current;
  }

  async reload(): Promise<LoadResult> {
    const result = await loadSchemes(this.dir);
    if (result.ok) this.current = result.schemes;
    return result;
  }
}

/** A fixed store, for tests. */
export class StaticSchemeStore implements SchemeStore {
  constructor(private readonly schemes: readonly Scheme[]) {}
  all(): readonly Scheme[] {
    return this.schemes;
  }
  reload(): Promise<LoadResult> {
    return Promise.resolve({ ok: true, schemes: [...this.schemes] });
  }
}
