/**
 * A minimal test BUYER for the local ION testnet, shared by `roundtrip` (pass/fail checks) and `ask` (explore by hand).
 *
 * A real buyer app does exactly this: it sends a `select` through ITS adapter (the BAP adapter), gets an immediate
 * ACK, and later receives the seller's `on_select` on a webhook of its own. This file is that webhook plus the sender.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Config } from '../src/config.js';
import {
  contextUrl,
  ELIGIBILITY_CHECK_RESOURCE_ID,
  WIRE_TYPES,
  type Language,
} from '../src/wire/constants.js';

export interface BuyerEnv {
  /** The buyer adapter's "caller" door: where a buyer app posts what it wants to send. */
  callerUrl: string;
  bapId: string;
  /** Where the seller's answer must be delivered, as the adapters see it (inside Docker). */
  bapUri: string;
  /** The port our test buyer listens on for callbacks. The routing patch points the buyer adapter here. */
  port: number;
}

export function buyerEnv(env: NodeJS.ProcessEnv = process.env): BuyerEnv {
  return {
    callerUrl: env.BAP_CALLER_URL ?? 'http://localhost:8081/bap/caller',
    bapId: env.BAP_ID ?? 'dc-bap.ion.id',
    bapUri: env.BAP_URI ?? 'http://reverse-proxy:9000/bap/receiver',
    port: Number(env.TEST_BUYER_PORT ?? 3101),
  };
}

export interface OnSelect {
  context: { messageId: string; transactionId: string; action: string };
  message: {
    contract: {
      commitments: unknown[];
      contractAttributes: {
        '@type': string;
        eligibility: {
          eligibleCount: number;
          language: string;
          schemes: EligibleScheme[];
          stillUnknownFields: string[];
        };
      };
    };
  };
}

interface Text {
  en: string;
  id: string;
}

export interface EligibleScheme {
  id: string;
  displayName: string;
  name: Text;
  benefit: Text;
  why: Text[];
  documents: { name: Text; mandatory: boolean }[];
  fulfillment: { type: string; url?: string; instructions?: Text };
}

export interface Buyer {
  server: Server;
  /** Resolves with the callback for this messageId, or undefined after `ms`. */
  wait: (messageId: string, ms: number) => Promise<OnSelect | undefined>;
  close: () => void;
}

/** Collects `on_select` callbacks by messageId (that is how a buyer matches an answer to its question). */
export function startBuyer(): Buyer {
  const waiting = new Map<string, (cb: OnSelect) => void>();
  const early = new Map<string, OnSelect>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let messageId = '';
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as OnSelect;
        messageId = body.context.messageId;
        const resolve = waiting.get(messageId);
        if (resolve) resolve(body);
        else early.set(messageId, body);
      } catch {
        /* ignore anything that is not a callback */
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { status: 'ACK', messageId } }));
    });
  });
  return {
    server,
    close: () => void server.close(),
    wait: (messageId, ms) =>
      new Promise((resolve) => {
        const done = early.get(messageId);
        if (done) return resolve(done);
        const timer = setTimeout(() => {
          waiting.delete(messageId);
          resolve(undefined);
        }, ms);
        waiting.set(messageId, (cb) => {
          clearTimeout(timer);
          resolve(cb);
        });
      }),
  };
}

export function listen(buyer: Buyer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    buyer.server.once('error', reject);
    buyer.server.listen(port, '0.0.0.0', () => resolve());
  });
}

export function buildSelect(
  profile: unknown,
  config: Config,
  bap: BuyerEnv,
  messageId: string,
  language: Language = 'en',
  options: { minimalCommitment?: boolean } = {},
) {
  return {
    context: {
      networkId: config.NETWORK_ID,
      action: 'select',
      version: '2.0.0',
      bapId: bap.bapId,
      bapUri: bap.bapUri,
      bppId: config.BPP_ID,
      bppUri: config.BPP_URI,
      transactionId: randomUUID(),
      messageId,
      timestamp: new Date().toISOString(),
      ttl: 'PT30S',
      schemaContext: [],
    },
    message: {
      contract: {
        id: `eligibility-check-${messageId.slice(0, 8)}`,
        participants: [
          { id: 'participant-buyer-001', descriptor: { name: 'MSME owner', code: 'buyer' } },
        ],
        commitments: [
          options.minimalCommitment
            ? // The least a buyer could send. Our reply must stay valid even then.
              {
                id: 'commitment-1',
                resources: [{ id: ELIGIBILITY_CHECK_RESOURCE_ID }],
                offer: { id: 'offer-eligibility', resourceIds: [ELIGIBILITY_CHECK_RESOURCE_ID] },
              }
            : {
                id: 'commitment-1',
                status: { code: 'DRAFT' },
                resources: [
                  {
                    id: ELIGIBILITY_CHECK_RESOURCE_ID,
                    descriptor: { name: 'Scheme eligibility check' },
                    quantity: { unitQuantity: 1, unitCode: 'UNIT' },
                  },
                ],
                offer: { id: 'offer-eligibility', resourceIds: [ELIGIBILITY_CHECK_RESOURCE_ID] },
              },
        ],
        contractAttributes: {
          '@context': contextUrl(config, 'profile'),
          '@type': WIRE_TYPES.profile,
          language,
          msmeProfile: profile,
        },
      },
    },
  };
}

export interface AdapterReply {
  status: number;
  json: {
    message?: { status?: string; messageId?: string; error?: { code?: string; message?: string } };
  };
}

/** POST a `select` to the buyer adapter. The reply is only the ACK or NACK; the answer comes later. */
export async function postSelect(bap: BuyerEnv, body: unknown): Promise<AdapterReply> {
  const res = await fetch(`${bap.callerUrl}/select`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as AdapterReply['json'] };
}

export type AskResult =
  { ok: true; reply: OnSelect; ms: number; attempt: number } | { ok: false; reason: string };

export interface AskOptions {
  profile: unknown;
  language?: Language;
  config: Config;
  bap: BuyerEnv;
  buyer: Buyer;
  attempts?: number;
  waitMs?: number;
  /** Called with a note each time an attempt fails, so a CLI can show progress. */
  onNote?: (note: string) => void;
}

/**
 * Ask the seller for the schemes a profile qualifies for. Retries, because the first message after a restart can
 * fail or time out while the adapter downloads schemas for the first time (about 10 s).
 */
export async function askSeller(options: AskOptions): Promise<AskResult> {
  const {
    profile,
    language = 'en',
    config,
    bap,
    buyer,
    attempts = 3,
    waitMs = 30_000,
    onNote,
  } = options;
  let last = 'no attempt made';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const messageId = randomUUID();
    const started = Date.now();
    const ack = await postSelect(bap, buildSelect(profile, config, bap, messageId, language));
    if (ack.json.message?.status !== 'ACK') {
      last =
        `refused (HTTP ${ack.status} ${ack.json.message?.error?.code ?? ''} ${ack.json.message?.error?.message ?? ''})`.trim();
      onNote?.(`attempt ${attempt}: ${last}`);
      continue;
    }
    const reply = await buyer.wait(messageId, waitMs);
    if (!reply) {
      last = `ACK received, but no on_select within ${waitMs / 1000} s`;
      onNote?.(`attempt ${attempt}: ${last} (the adapter may still be warming its schema cache)`);
      continue;
    }
    return { ok: true, reply, ms: Date.now() - started, attempt };
  }
  return { ok: false, reason: `${last}, after ${attempts} attempts` };
}
