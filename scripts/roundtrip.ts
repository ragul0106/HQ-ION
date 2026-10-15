/**
 * Live round trip against the local ION testnet: a test buyer sends a `select` with an MSME profile through ION's
 * buyer adapter and waits for our seller's `on_select` callback to come back through the buyer adapter.
 *
 *   npm run roundtrip                     the "warung" profile
 *   npm run roundtrip -- exporter         also: nothing | partial
 *   npm run roundtrip -- all              every profile, plus the personal-data refusal check
 *
 * To explore by hand with your own answers, use `npm run ask` instead.
 * Needs: the testnet running, `npm run onix:apply` done, and the seller app running (npm start).
 */
import { randomUUID } from 'node:crypto';
import { loadConfig, type Config } from '../src/config.js';
import type { Profile } from '../src/eligibility/types.js';
import {
  askSeller,
  buildSelect,
  buyerEnv,
  listen,
  postSelect,
  startBuyer,
  type Buyer,
  type BuyerEnv,
} from './buyer-client.js';

interface Case {
  profile: Profile;
  expect: string[];
}

const CASES: Record<string, Case> = {
  warung: {
    profile: {
      businessType: 'individual',
      sector: 'food',
      annualTurnoverIdr: 300_000_000,
      province: 'Jawa Tengah',
      workerCount: 3,
      hasNIB: true,
      exportsOrPlansToExport: false,
    },
    expect: ['FAKE-SCH-001', 'FAKE-SCH-002', 'FAKE-SCH-003'],
  },
  exporter: {
    profile: {
      businessType: 'CV',
      sector: 'craft',
      annualTurnoverIdr: 1_500_000_000,
      province: 'Bali',
      workerCount: 25,
      hasNIB: true,
      exportsOrPlansToExport: true,
    },
    expect: ['FAKE-SCH-001', 'FAKE-SCH-004'],
  },
  nothing: {
    profile: {
      businessType: 'PT',
      sector: 'mining',
      annualTurnoverIdr: 9_000_000_000,
      province: 'Bali',
      workerCount: 200,
      hasNIB: false,
      exportsOrPlansToExport: false,
    },
    expect: [],
  },
  partial: { profile: { hasNIB: true }, expect: [] },
};

const out = (text: string): void => void process.stdout.write(`${text}\n`);

async function runCase(
  name: string,
  c: Case,
  config: Config,
  bap: BuyerEnv,
  buyer: Buyer,
): Promise<boolean> {
  const result = await askSeller({
    profile: c.profile,
    config,
    bap,
    buyer,
    onNote: (note) => out(`  [${name}] ${note}`),
  });
  if (!result.ok) {
    out(`  [${name}] FAIL: ${result.reason}`);
    return false;
  }
  const { eligibility, '@type': type } = result.reply.message.contract.contractAttributes;
  const ids = eligibility.schemes.map((s) => s.id);
  const ok = JSON.stringify(ids) === JSON.stringify(c.expect);
  out(
    `  [${name}] on_select in ${result.ms} ms, ${type}, eligibleCount=${eligibility.eligibleCount}`,
  );
  for (const s of eligibility.schemes) {
    out(
      `      - ${s.id}  "${s.displayName}"  why=${s.why.length} rule(s), next step=${s.fulfillment.type}`,
    );
  }
  if (eligibility.stillUnknownFields.length > 0) {
    out(`      still worth asking: ${eligibility.stillUnknownFields.join(', ')}`);
  }
  out(`  [${name}] ${ok ? 'PASS' : `FAIL (expected ${JSON.stringify(c.expect)})`}`);
  return ok;
}

/** Personal data we never asked for must be refused, not accepted. */
async function runPersonalDataCheck(config: Config, bap: BuyerEnv): Promise<boolean> {
  const profile = { ...CASES.warung!.profile, phone: '+628100000000' };
  const res = await postSelect(bap, buildSelect(profile, config, bap, randomUUID()));
  const refused = res.json.message?.status === 'NACK';
  out(
    `  [personal data] a profile with a phone number was ${refused ? 'REFUSED' : 'ACCEPTED'}: HTTP ${res.status} ${res.json.message?.error?.code ?? ''}`,
  );
  out(`  [personal data] ${refused ? 'PASS' : 'FAIL'}`);
  return refused;
}

/**
 * Through ION, a buyer that sends an incomplete commitment is refused up front by ITS OWN adapter, so the request never
 * reaches our seller. This documents that behaviour (and fails if ION ever starts letting such requests through).
 */
async function runMinimalCommitmentThroughIon(config: Config, bap: BuyerEnv): Promise<boolean> {
  const body = buildSelect({ hasNIB: true }, config, bap, randomUUID(), 'en', {
    minimalCommitment: true,
  });
  const res = await postSelect(bap, body);
  const code = res.json.message?.error?.code;
  const ok = res.json.message?.status === 'NACK' && code === 'SCH_REQUIRED_FIELD_MISSING';
  out(
    `  [incomplete commitment via ION] ${ok ? 'refused by the buyer adapter' : 'NOT refused'}: HTTP ${res.status} ${code ?? ''}`,
  );
  out(`  [incomplete commitment via ION] ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

/**
 * REGRESSION GUARD, straight at the seller's webhook (bypassing the adapters' request checks): even when the request
 * carries an incomplete commitment, the zero-result reply must be valid on its own. The proof is that the callback
 * ARRIVES: an ACK alone proves nothing, because the adapter checks the reply afterwards. (This once failed: the seller
 * echoed the buyer's commitment, which had no `quantity`, and the adapter rejected the reply.)
 */
async function runMinimalCommitmentAtSeller(
  config: Config,
  bap: BuyerEnv,
  buyer: Buyer,
): Promise<boolean> {
  const url = `http://localhost:${config.PORT}/api/webhook/select`;
  const messageId = randomUUID();
  const body = buildSelect({ hasNIB: true }, config, bap, messageId, 'en', {
    minimalCommitment: true,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const ack = (await res.json().catch(() => ({}))) as { message?: { status?: string } };
  if (ack.message?.status !== 'ACK') {
    out(
      `  [incomplete commitment at seller] FAIL: the seller answered HTTP ${res.status}, not ACK`,
    );
    return false;
  }
  const reply = await buyer.wait(messageId, 30_000);
  const count = reply?.message.contract.contractAttributes.eligibility.eligibleCount;
  const ok = count === 0;
  out(
    `  [incomplete commitment at seller] ${reply ? `zero-result on_select arrived, eligibleCount=${count}` : 'no on_select arrived (the adapter probably rejected the seller reply)'}`,
  );
  out(`  [incomplete commitment at seller] ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function main(): Promise<number> {
  const config = loadConfig();
  const bap = buyerEnv();
  const arg = process.argv[2] ?? 'warung';
  const names = arg === 'all' ? Object.keys(CASES) : [arg];
  for (const n of names) {
    if (!CASES[n]) {
      process.stderr.write(
        `unknown profile "${n}". Choose: ${Object.keys(CASES).join(', ')}, all\n`,
      );
      return 2;
    }
  }

  const buyer = startBuyer();
  await listen(buyer, bap.port);
  out(`test buyer listening on :${bap.port}; sending through ${bap.callerUrl}`);

  const results: boolean[] = [];
  for (const n of names) results.push(await runCase(n, CASES[n]!, config, bap, buyer));
  if (arg === 'all') results.push(await runPersonalDataCheck(config, bap));
  if (arg === 'all') results.push(await runMinimalCommitmentThroughIon(config, bap));
  if (arg === 'all') results.push(await runMinimalCommitmentAtSeller(config, bap, buyer));

  buyer.close();
  const passed = results.filter(Boolean).length;
  out(`\n${passed}/${results.length} checks passed`);
  return passed === results.length ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
