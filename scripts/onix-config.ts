/**
 * Apply the local configuration HQ-ION needs to a clone of ION's `ion-onix` repo (its `testnet` folder).
 *
 *   npm run onix:apply -- ../ion-onix/testnet            apply
 *   npm run onix:apply -- ../ion-onix/testnet --check    only report, change nothing (exit 1 if something is missing)
 *
 * Why a script: ION's own `configure.sh` rewrites placeholders inside these files, and re-running it needs
 * `git checkout .`, which erases hand edits. This script re-applies ours, and is safe to run twice.
 * Run it AFTER `./configure.sh`.
 *
 * What it changes, and why:
 *   - Redis host port 6380        (6379 is used by another project on this machine)
 *   - host.docker.internal        (so the adapter containers can reach apps running on the host)
 *   - seller routing -> :3102     (the HQ-ION seller app)
 *   - buyer routing  -> :3101     (the round-trip test buyer, scripts/roundtrip.ts)
 *   - /schema/* on the proxy      (serves our TEMPORARY stand-in schemas, deploy/onix/schemas)
 *   - schema host allow-list      (the adapter only downloads schemas from allow-listed hosts)
 */
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PatchStatus = 'applied' | 'already' | 'failed';

export interface PatchResult {
  name: string;
  status: PatchStatus;
  detail?: string;
}

interface Patch {
  name: string;
  file: string;
  /** True if the file already has this change. */
  isApplied: (text: string) => boolean;
  /** Returns the changed text, or throws if the file no longer looks like what we expect. */
  apply: (text: string) => string;
}

function replaceOnce(text: string, from: string, to: string, what: string): string {
  const count = text.split(from).length - 1;
  if (count !== 1) {
    throw new Error(`expected exactly one ${what}, found ${count}; ION may have changed this file`);
  }
  return text.replace(from, () => to);
}

const HOSTS_BLOCK = '    extra_hosts:\n      - "host.docker.internal:host-gateway"\n';
const BPP_COMMAND = '    command: [ "./server", "--config=/app/config/local-simple-bpp.yaml" ]\n';
const BAP_COMMAND = '    command: [ "./server", "--config=/app/config/local-simple-bap.yaml" ]\n';
const ALLOW_BEFORE = 'schema.beckn.io,schema.ion.id"';
const ALLOW_AFTER = 'schema.beckn.io,schema.ion.id,reverse-proxy,reverse-proxy:9000"';

export const PATCHES: Patch[] = [
  {
    name: 'redis host port 6380',
    file: 'docker-compose-testnet.yml',
    isApplied: (t) => t.includes('"6380:6379"'),
    apply: (t) =>
      replaceOnce(t, '      - "6379:6379"\n', '      - "6380:6379"\n', 'redis port mapping'),
  },
  {
    name: 'host.docker.internal for the seller adapter',
    file: 'docker-compose-testnet.yml',
    isApplied: (t) => t.includes(HOSTS_BLOCK + BPP_COMMAND),
    apply: (t) =>
      replaceOnce(t, BPP_COMMAND, HOSTS_BLOCK + BPP_COMMAND, 'seller adapter command line'),
  },
  {
    name: 'host.docker.internal for the buyer adapter',
    file: 'docker-compose-testnet.yml',
    isApplied: (t) => t.includes(HOSTS_BLOCK + BAP_COMMAND),
    apply: (t) =>
      replaceOnce(t, BAP_COMMAND, HOSTS_BLOCK + BAP_COMMAND, 'buyer adapter command line'),
  },
  {
    name: 'mount our schemas into the proxy',
    file: 'docker-compose-testnet.yml',
    isApplied: (t) => t.includes('./local-schemas:/srv/schema:ro'),
    apply: (t) =>
      replaceOnce(
        t,
        '      - ./data/beckn:/srv/beckn:ro\n',
        '      - ./data/beckn:/srv/beckn:ro\n      - ./local-schemas:/srv/schema:ro\n',
        'proxy catalog mount',
      ),
  },
  {
    name: 'serve /schema/* from the proxy',
    file: 'config/Caddyfile',
    isApplied: (t) => t.includes('handle /schema/*'),
    apply: (t) =>
      replaceOnce(
        t,
        '    handle /beckn/* {',
        '    handle /schema/* {\n        root * /srv/schema\n        uri strip_prefix /schema\n        file_server\n    }\n    handle /beckn/* {',
        'catalog route',
      ),
  },
  {
    name: 'seller routing -> HQ-ION app (:3102)',
    file: 'config/local-simple-routing-BPPReceiver.yaml',
    isApplied: (t) => t.includes('http://host.docker.internal:3102/api/webhook'),
    apply: (t) =>
      replaceOnce(
        t,
        'http://sandbox-bpp:3002/api/webhook',
        'http://host.docker.internal:3102/api/webhook',
        'seller webhook url',
      ),
  },
  {
    name: 'buyer routing -> test buyer (:3101)',
    file: 'config/local-simple-routing-BAPReceiver.yaml',
    isApplied: (t) => t.includes('http://host.docker.internal:3101/api/bap-webhook'),
    apply: (t) =>
      replaceOnce(
        t,
        'http://sandbox-bap:3001/api/bap-webhook',
        'http://host.docker.internal:3101/api/bap-webhook',
        'buyer webhook url',
      ),
  },
  ...['local-simple-bap.yaml', 'local-simple-bpp.yaml'].map((name): Patch => ({
    name: `schema host allow-list in ${name}`,
    file: `config/${name}`,
    isApplied: (t) => t.includes(ALLOW_AFTER) && !t.includes(ALLOW_BEFORE),
    apply: (t) => {
      if (!t.includes(ALLOW_BEFORE))
        throw new Error('allow-list line not found; ION may have changed this file');
      return t.split(ALLOW_BEFORE).join(ALLOW_AFTER);
    },
  })),
];

const SCHEMA_FILES = ['HqMsmeProfile', 'HqEligibilityResult', 'HqScheme'].flatMap((type) => [
  `${type}/v0/attributes.yaml`,
  `${type}/v0/context.jsonld`,
]);

async function sameFiles(from: string, to: string): Promise<boolean> {
  try {
    for (const f of SCHEMA_FILES) {
      if ((await readFile(join(from, f), 'utf8')) !== (await readFile(join(to, f), 'utf8')))
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function applyOnixConfig(
  testnetDir: string,
  options: { schemasDir?: string; check?: boolean } = {},
): Promise<PatchResult[]> {
  const results: PatchResult[] = [];

  for (const patch of PATCHES) {
    const path = join(testnetDir, patch.file);
    try {
      const text = await readFile(path, 'utf8');
      if (patch.file.endsWith('.yaml') && text.includes('{{')) {
        throw new Error('still has {{placeholders}}: run ./configure.sh first');
      }
      if (patch.isApplied(text)) {
        results.push({ name: patch.name, status: 'already' });
        continue;
      }
      if (options.check) {
        results.push({ name: patch.name, status: 'failed', detail: 'not applied yet' });
        continue;
      }
      await writeFile(path, patch.apply(text));
      results.push({ name: patch.name, status: 'applied' });
    } catch (err) {
      results.push({
        name: patch.name,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (options.schemasDir) {
    const target = join(testnetDir, 'local-schemas');
    if (options.check) {
      const same = await sameFiles(options.schemasDir, target);
      results.push({
        name: 'stand-in schemas copied',
        status: same ? 'already' : 'failed',
        ...(same ? {} : { detail: 'not applied yet' }),
      });
    } else {
      await cp(options.schemasDir, target, { recursive: true });
      results.push({ name: 'stand-in schemas copied', status: 'applied' });
    }
  }
  return results;
}

/** The command-line behaviour, separate from process.argv/stdout so it can be tested. */
export async function runCli(args: string[], write: (text: string) => void): Promise<number> {
  const check = args.includes('--check');
  const testnetDir = resolve(args.find((a) => !a.startsWith('--')) ?? '../ion-onix/testnet');
  const schemasDir = fileURLToPath(new URL('../deploy/onix/schemas', import.meta.url));

  const results = await applyOnixConfig(testnetDir, { schemasDir, check });
  const mark = { applied: '+ applied', already: '= already', failed: '! FAILED ' } as const;
  for (const r of results) {
    write(`${mark[r.status]}  ${r.name}${r.detail ? `  (${r.detail})` : ''}\n`);
  }
  if (results.some((r) => r.status === 'failed')) return 1;
  if (!check)
    write('\nDone. Restart the adapters: docker compose -f docker-compose-testnet.yml up -d\n');
  return 0;
}

async function main(): Promise<number> {
  return runCli(process.argv.slice(2), (text) => void process.stdout.write(text));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    },
  );
}
