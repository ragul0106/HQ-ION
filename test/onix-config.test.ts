import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyOnixConfig, runCli } from '../scripts/onix-config.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** Minimal stand-ins for the parts of ION's testnet files that we patch. */
const FILES: Record<string, string> = {
  'docker-compose-testnet.yml': [
    '  redis:',
    '    ports:',
    '      - "6379:6379"',
    '  onix-bap:',
    '    command: [ "./server", "--config=/app/config/local-simple-bap.yaml" ]',
    '  onix-bpp:',
    '    command: [ "./server", "--config=/app/config/local-simple-bpp.yaml" ]',
    '  reverse-proxy:',
    '    volumes:',
    '      - ./data/beckn:/srv/beckn:ro',
    '',
  ].join('\n'),
  'config/Caddyfile': ':9000 {\n    handle /bap/* {\n    }\n    handle /beckn/* {\n    }\n}\n',
  'config/local-simple-routing-BPPReceiver.yaml':
    '      url: "http://sandbox-bpp:3002/api/webhook"\n',
  'config/local-simple-routing-BAPReceiver.yaml':
    '      url: "http://sandbox-bap:3001/api/bap-webhook"\n',
  'config/local-simple-bap.yaml':
    'a: "extendedSchema_allowedDomains": "raw.githubusercontent.com,schema.beckn.io,schema.ion.id"\n',
  'config/local-simple-bpp.yaml':
    'extendedSchema_allowedDomains: "raw.githubusercontent.com,schema.beckn.io,schema.ion.id"\n',
};

async function fixture(overrides: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hq-ion-testnet-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries({ ...FILES, ...overrides })) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return dir;
}

describe('applyOnixConfig', () => {
  it('applies every change to a clean testnet', async () => {
    const dir = await fixture();
    const results = await applyOnixConfig(dir);
    expect(results.every((r) => r.status === 'applied')).toBe(true);

    const compose = await readFile(join(dir, 'docker-compose-testnet.yml'), 'utf8');
    expect(compose).toContain('"6380:6379"');
    expect(compose).not.toContain('"6379:6379"');
    expect(compose.match(/host\.docker\.internal:host-gateway/g)).toHaveLength(2);
    expect(compose).toContain('./local-schemas:/srv/schema:ro');
    expect(
      await readFile(join(dir, 'config/local-simple-routing-BPPReceiver.yaml'), 'utf8'),
    ).toContain(':3102/');
    expect(
      await readFile(join(dir, 'config/local-simple-routing-BAPReceiver.yaml'), 'utf8'),
    ).toContain(':3101/');
    expect(await readFile(join(dir, 'config/Caddyfile'), 'utf8')).toContain('handle /schema/*');
    expect(await readFile(join(dir, 'config/local-simple-bpp.yaml'), 'utf8')).toContain(
      'reverse-proxy:9000',
    );
  });

  it('is safe to run twice: the second run changes nothing', async () => {
    const dir = await fixture();
    await applyOnixConfig(dir);
    const before = await readFile(join(dir, 'docker-compose-testnet.yml'), 'utf8');
    const second = await applyOnixConfig(dir);
    expect(second.every((r) => r.status === 'already')).toBe(true);
    expect(await readFile(join(dir, 'docker-compose-testnet.yml'), 'utf8')).toBe(before);
  });

  it('copes with a testnet that already has some of the changes', async () => {
    const dir = await fixture({
      'config/local-simple-routing-BPPReceiver.yaml':
        '      url: "http://host.docker.internal:3102/api/webhook"\n',
    });
    const results = await applyOnixConfig(dir);
    expect(results.find((r) => r.name.startsWith('seller routing'))?.status).toBe('already');
    expect(results.find((r) => r.name.startsWith('buyer routing'))?.status).toBe('applied');
  });

  it('--check reports what is missing and writes nothing', async () => {
    const dir = await fixture();
    const results = await applyOnixConfig(dir, { check: true });
    expect(results.some((r) => r.status === 'failed')).toBe(true);
    expect(await readFile(join(dir, 'docker-compose-testnet.yml'), 'utf8')).toBe(
      FILES['docker-compose-testnet.yml'],
    );
  });

  it('fails loudly, and changes nothing in that file, when ION has changed a line we rely on', async () => {
    const dir = await fixture({ 'config/Caddyfile': ':9000 {\n}\n' });
    const results = await applyOnixConfig(dir);
    const caddy = results.find((r) => r.name.includes('/schema/*'));
    expect(caddy?.status).toBe('failed');
    expect(caddy?.detail).toMatch(/ION may have changed/);
    expect(await readFile(join(dir, 'config/Caddyfile'), 'utf8')).toBe(':9000 {\n}\n');
  });

  it('tells you to run configure.sh first when placeholders remain', async () => {
    const dir = await fixture({
      'config/local-simple-bpp.yaml': 'subscriberId: {{BPP_SUBSCRIBER_ID}}\n',
    });
    const results = await applyOnixConfig(dir);
    expect(results.find((r) => r.name.includes('local-simple-bpp.yaml'))?.detail).toMatch(
      /configure\.sh/,
    );
  });
});

describe('runCli', () => {
  it('--check never writes, and exits 1 while something is missing', async () => {
    const dir = await fixture();
    const lines: string[] = [];
    const code = await runCli([dir, '--check'], (t) => lines.push(t));
    expect(code).toBe(1);
    expect(lines.join('')).toContain('not applied yet');
    expect(lines.join('')).not.toContain('+ applied');
    expect(await readFile(join(dir, 'docker-compose-testnet.yml'), 'utf8')).toBe(
      FILES['docker-compose-testnet.yml'],
    );
    expect(await readFile(join(dir, 'config/local-simple-routing-BPPReceiver.yaml'), 'utf8')).toBe(
      FILES['config/local-simple-routing-BPPReceiver.yaml'],
    );
  });

  it('applies, then --check passes with exit 0', async () => {
    const dir = await fixture();
    expect(await runCli([dir], () => undefined)).toBe(0);
    const lines: string[] = [];
    expect(await runCli([dir, '--check'], (t) => lines.push(t))).toBe(0);
    expect(lines.join('')).not.toContain('FAILED');
  });
});
