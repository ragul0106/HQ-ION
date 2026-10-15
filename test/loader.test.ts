import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSchemeStore, loadSchemes } from '../src/eligibility/loader.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'hq-ion-schemes-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function validScheme(id: string) {
  const sample = JSON.parse(await readFile('./data/schemes/FAKE-SCH-001.json', 'utf8')) as Record<
    string,
    unknown
  >;
  return { ...sample, id };
}

describe('loadSchemes', () => {
  it('loads the shipped sample schemes', async () => {
    const r = await loadSchemes('./data/schemes');
    expect(r.ok && r.schemes.map((s) => s.id)).toEqual([
      'FAKE-SCH-001',
      'FAKE-SCH-002',
      'FAKE-SCH-003',
      'FAKE-SCH-004',
    ]);
  });

  it('fails clearly on a missing folder and an empty one', async () => {
    const missing = await loadSchemes('/nonexistent/folder');
    expect(!missing.ok && missing.problems[0]?.message).toMatch(/cannot be read/);
    const empty = await loadSchemes(await tempDir());
    expect(!empty.ok && empty.problems[0]?.message).toMatch(/no scheme files/);
  });

  it('names the file and the field of every problem, all at once', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'broken.json'), '{ not json');
    const bad = await validScheme('BAD-1');
    await writeFile(
      join(dir, 'bad-rule.json'),
      JSON.stringify({ ...bad, eligibility: { rules: [] } }),
    );
    const r = await loadSchemes(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.some((p) => p.file === 'broken.json')).toBe(true);
      expect(
        r.problems.some((p) => p.file === 'bad-rule.json' && p.path.startsWith('eligibility')),
      ).toBe(true);
    }
  });

  it('rejects two files with the same scheme id', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.json'), JSON.stringify(await validScheme('SAME')));
    await writeFile(join(dir, 'b.json'), JSON.stringify(await validScheme('SAME')));
    const r = await loadSchemes(dir);
    expect(!r.ok && r.problems[0]?.message).toMatch(/duplicate scheme id/);
  });

  it('is all or nothing: one bad file fails the whole load', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'good.json'), JSON.stringify(await validScheme('GOOD')));
    await writeFile(join(dir, 'bad.json'), '[]');
    expect((await loadSchemes(dir)).ok).toBe(false);
  });

  it('never repeats a rejected value in its messages', async () => {
    const dir = await tempDir();
    const secret = 'SUPER-SECRET-VALUE';
    await writeFile(
      join(dir, 'x.json'),
      JSON.stringify({ ...(await validScheme('X')), benefit: secret }),
    );
    expect(JSON.stringify(await loadSchemes(dir))).not.toContain(secret);
  });
});

describe('FileSchemeStore', () => {
  it('keeps the previous schemes when a reload fails', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'one.json'), JSON.stringify(await validScheme('ONE')));
    const store = new FileSchemeStore(dir);
    expect((await store.reload()).ok).toBe(true);
    expect(store.all().map((s) => s.id)).toEqual(['ONE']);

    await writeFile(join(dir, 'oops.json'), '{ broken');
    expect((await store.reload()).ok).toBe(false);
    expect(store.all().map((s) => s.id)).toEqual(['ONE']); // unchanged

    await rm(join(dir, 'oops.json'));
    await writeFile(join(dir, 'two.json'), JSON.stringify(await validScheme('TWO')));
    expect((await store.reload()).ok).toBe(true);
    expect(store.all().map((s) => s.id)).toEqual(['ONE', 'TWO']);
  });
});
