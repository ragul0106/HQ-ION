import { Writable } from 'node:stream';
import type { Config } from '../src/config.js';
import type { AppDeps } from '../src/deps.js';
import { StaticSchemeStore, loadSchemes } from '../src/eligibility/loader.js';
import type { Profile, Scheme } from '../src/eligibility/types.js';
import { createLogger } from '../src/logger.js';
import type { CallbackSender, Scheduler } from '../src/protocol/callback.js';
import type { Context } from '../src/protocol/context.js';

export const testConfig: Config = {
  ION_ENV: 'sandbox',
  DATA_REGION: 'test-region',
  PORT: 3102,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'info',
  NETWORK_ID: 'ion.id/staging',
  BPP_ID: 'bpp.test',
  BPP_URI: 'http://bpp.test/bpp/receiver',
  ADAPTER_CALLER_URL: 'http://localhost:8082/bpp/caller',
  ADAPTER_PUBLISH_URL: 'http://localhost:8082/catalog/publish',
  SCHEMES_DIR: './data/schemes',
  SCHEMA_BASE_URL: 'http://schemas.test/schema',
};

/** The four sample schemes shipped in data/schemes. */
export async function realSchemes(): Promise<Scheme[]> {
  const result = await loadSchemes('./data/schemes');
  if (!result.ok) throw new Error(`sample schemes are invalid: ${JSON.stringify(result.problems)}`);
  return result.schemes;
}

/** A log destination that keeps every line, so tests can assert on what was (not) written. */
export function captureLogs(): {
  stream: Writable;
  lines: () => Record<string, unknown>[];
  raw: () => string;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  const raw = () => chunks.join('');
  return {
    stream,
    raw,
    lines: () =>
      raw()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

export interface SentCallback {
  action: string;
  requestContext: Context;
  // The reply is checked field by field in tests; its exact shape is the wire module's business.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: any;
}

/** Everything a handler needs, with the network replaced by in-memory fakes. */
export async function makeDeps(schemes?: Scheme[]) {
  const cap = captureLogs();
  const sent: SentCallback[] = [];
  const pending: Promise<void>[] = [];
  const sender: CallbackSender = {
    send(action, requestContext, message) {
      sent.push({ action, requestContext, message });
      return Promise.resolve();
    },
  };
  const schedule: Scheduler = (task) => {
    pending.push(task());
  };
  const deps: AppDeps = {
    config: testConfig,
    logger: createLogger(testConfig, cap.stream),
    schemes: new StaticSchemeStore(schemes ?? (await realSchemes())),
    sender,
    schedule,
  };
  return { deps, cap, sent, flush: () => Promise.all(pending).then(() => undefined) };
}

export function envelope(action: string, extra: Record<string, unknown> = {}) {
  return {
    context: {
      action,
      version: '2.0.0',
      networkId: 'ion.id/staging',
      bapId: 'bap.test',
      bapUri: 'http://bap.test/bap/receiver',
      bppId: 'bpp.test',
      bppUri: 'http://bpp.test/bpp/receiver',
      transactionId: 'txn-0001',
      messageId: 'msg-0001',
      timestamp: '2026-10-15T10:00:00.000Z',
      ttl: 'PT30S',
    },
    message: { ...extra },
  };
}

/** A buyer's `select` message carrying a profile. */
export function selectMessage(profile: unknown, language?: string) {
  return {
    contract: {
      id: 'check-1',
      participants: [{ id: 'buyer-1', descriptor: { code: 'buyer' } }],
      commitments: [
        {
          id: 'commitment-1',
          resources: [{ id: 'HQ-ELIGIBILITY-CHECK' }],
          offer: { id: 'offer-eligibility', resourceIds: ['HQ-ELIGIBILITY-CHECK'] },
        },
      ],
      contractAttributes: {
        '@context': 'http://schemas.test/schema/HqMsmeProfile/v0/context.jsonld',
        '@type': 'HqMsmeProfile',
        ...(language ? { language } : {}),
        msmeProfile: profile,
      },
    },
  };
}

// Three made-up MSME owners used across tests.
export const WARUNG: Profile = {
  businessType: 'individual',
  sector: 'food',
  annualTurnoverIdr: 300_000_000,
  province: 'Jawa Tengah',
  workerCount: 3,
  hasNIB: true,
  exportsOrPlansToExport: false,
};
export const EXPORTER: Profile = {
  businessType: 'CV',
  sector: 'craft',
  annualTurnoverIdr: 1_500_000_000,
  province: 'Bali',
  workerCount: 25,
  hasNIB: true,
  exportsOrPlansToExport: true,
};
export const NOTHING: Profile = {
  businessType: 'PT',
  sector: 'mining',
  annualTurnoverIdr: 9_000_000_000,
  province: 'Bali',
  workerCount: 200,
  hasNIB: false,
  exportsOrPlansToExport: false,
};
