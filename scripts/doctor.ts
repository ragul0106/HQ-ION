/**
 * Check that everything the local setup needs is running, and say what to do if not.
 *   npm run doctor
 *
 * A "502 Bad Gateway" from the buyer adapter (:8081) almost always means the seller app (:3102) is not running: the
 * adapter accepted your message but could not deliver it to the next hop.
 */
const env = process.env;
const sellerUrl = env.SELLER_URL ?? `http://localhost:${env.PORT ?? 3102}`;

interface Check {
  name: string;
  url: string;
  /** Accept any HTTP answer (the adapters answer 404 on `/`, which still proves they are up). */
  anyAnswer?: boolean;
  optional?: boolean;
  fix: string;
}

const CHECKS: Check[] = [
  {
    name: 'seller app (:3102)',
    url: `${sellerUrl}/health`,
    fix: 'cd HQ-ION && npm run build && npm start      (this is what a 502 from :8081 usually means)',
  },
  {
    name: 'seller adapter (onix-bpp, :8082)',
    url: 'http://localhost:8082/',
    anyAnswer: true,
    fix: 'cd ../ion-onix/testnet && docker compose -f docker-compose-testnet.yml up -d',
  },
  {
    name: 'buyer adapter (onix-bap, :8081)',
    url: 'http://localhost:8081/',
    anyAnswer: true,
    fix: 'cd ../ion-onix/testnet && docker compose -f docker-compose-testnet.yml up -d',
  },
  {
    name: 'proxy serving our stand-in schemas (:9000)',
    url: 'http://localhost:9000/schema/HqMsmeProfile/v0/attributes.yaml',
    fix: 'npm run onix:apply -- ../ion-onix/testnet, then restart the testnet',
  },
  {
    name: 'listener that catches answers (:3101)',
    url: 'http://localhost:3101/callbacks',
    optional: true,
    fix: 'npm run listen      (needed to SEE answers from curl or Postman; stop it before `npm run ask`)',
  },
];

async function probe(check: Check): Promise<boolean> {
  try {
    const res = await fetch(check.url, { signal: AbortSignal.timeout(3000) });
    return check.anyAnswer ? true : res.ok;
  } catch {
    return false;
  }
}

const out = (text: string): void => void process.stdout.write(`${text}\n`);

const results = await Promise.all(CHECKS.map(async (c) => ({ c, up: await probe(c) })));
let failed = 0;
for (const { c, up } of results) {
  if (up) {
    out(`  ok       ${c.name}`);
  } else {
    out(`  ${c.optional ? 'not up  ' : 'DOWN    '} ${c.name}${c.optional ? '  (optional)' : ''}`);
    out(`           fix: ${c.fix}`);
    if (!c.optional) failed++;
  }
}
out(failed === 0 ? '\nEverything needed is up.' : `\n${failed} required piece(s) down.`);
process.exit(failed === 0 ? 0 : 1);
