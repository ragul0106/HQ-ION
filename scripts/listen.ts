/**
 * A small buyer-side server for the local ION testnet. The ION buyer adapter delivers the seller's answers here
 * (`on_select`). A plain curl or Postman call to the adapter only shows the immediate ACK; the answer arrives HERE.
 *
 *   npm run listen              prints one summary line per callback
 *   npm run listen -- --json    also prints the full message
 *
 * Endpoints on http://localhost:3101
 *
 *   ONE CALL, THE SCHEMES IN THE RESPONSE (what a buyer app's backend does for its front end):
 *     POST /check          {"profile": {...}, "language": "en"}  sends a select through ION, waits for the answer
 *                          and returns the matching schemes
 *     GET  /catalog        every scheme we publish (?lang=en|id)
 *
 *   READING WHAT HAS ARRIVED (when you send with curl or Postman yourself):
 *     GET  /callbacks/<messageId>   the full on_select for that select (404 until it arrives)
 *     GET  /latest                  the most recent callback
 *     GET  /callbacks               the ids received so far
 *
 * The buyer adapter is routed to :3101 by `npm run onix:apply`.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { CATALOG_NAME } from '../src/catalog/build.js';
import { loadConfig } from '../src/config.js';
import { buildSelect, buyerEnv, postSelect, type OnSelect } from './buyer-client.js';
import { createCallbackStore } from './callback-store.js';
import { parseCheckBody, shapeAnswer, shapeCatalog, type CatalogFile } from './demo-api.js';

const port = Number(process.env.TEST_BUYER_PORT ?? 3101);
const proxyUrl = process.env.PROXY_URL ?? 'http://localhost:9000';
const ANSWER_WAIT_MS = 30_000;
const showJson = process.argv.includes('--json');
const out = (text: string): void => void process.stdout.write(`${text}\n`);
const store = createCallbackStore();

type Send = (status: number, body: unknown) => void;

interface Callback {
  context?: { action?: string; transactionId?: string; messageId?: string };
  message?: {
    contract?: {
      contractAttributes?: { eligibility?: { eligibleCount?: number; schemes?: { id: string }[] } };
    };
  };
}

/** POST /check: one call in, the matching schemes out. */
async function handleCheck(raw: string, send: Send): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return send(400, { error: 'the body is not valid JSON' });
  }
  const request = parseCheckBody(body);
  if (!request.ok) return send(400, { error: request.error });

  let config;
  try {
    config = loadConfig();
  } catch {
    return send(500, {
      error:
        'seller settings not loaded: start this with `npm run listen` from HQ-ION (it reads .env)',
    });
  }

  const bap = buyerEnv();
  const messageId = randomUUID();
  let ack;
  try {
    ack = await postSelect(
      bap,
      buildSelect(request.profile, config, bap, messageId, request.language),
    );
  } catch {
    return send(502, {
      error: `cannot reach the buyer adapter at ${bap.callerUrl}`,
      hint: 'run `npm run doctor`',
    });
  }
  if (ack.json.message?.status !== 'ACK') {
    return send(502, {
      error: 'ION refused the request',
      code: ack.json.message?.error?.code,
      message: ack.json.message?.error?.message,
    });
  }

  // The ACK carries the id the answer will be filed under. Our own id and the ACK id are the same here, but the
  // ACK is what to trust (see the Postman note in docs/API_TESTING.md).
  const answerId = ack.json.message.messageId ?? messageId;
  const started = Date.now();
  const got = await store.waitFor(answerId, ANSWER_WAIT_MS);
  if (!got) {
    return send(504, {
      error: `ACK received, but no answer within ${ANSWER_WAIT_MS / 1000} seconds`,
      messageId: answerId,
      hint: 'the first call after a restart can be slow while the adapters download schemas; try again, or run `npm run doctor`',
    });
  }
  send(200, {
    messageId: answerId,
    answeredInMs: Date.now() - started,
    language: request.language,
    ...shapeAnswer(got.body as OnSelect, request.language),
  });
}

/** GET /catalog: every scheme in the catalog our seller adapter published. */
async function handleCatalog(language: string | null, send: Send): Promise<void> {
  const lang = language === 'id' ? 'id' : 'en';
  const url = `${proxyUrl}/beckn/catalogs/${CATALOG_NAME}.latest.json.gz`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return send(502, {
      error: `cannot reach the proxy at ${proxyUrl}`,
      hint: 'run `npm run doctor`',
    });
  }
  if (!res.ok) {
    return send(404, {
      error: 'no catalog has been published yet',
      hint: 'run `npm run catalog:publish`',
    });
  }
  const file = JSON.parse(
    gunzipSync(Buffer.from(await res.arrayBuffer())).toString(),
  ) as CatalogFile;
  send(200, shapeCatalog(file, lang));
}

createServer((req, res) => {
  const send: Send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body, null, 2));
  };
  const url = new URL(req.url ?? '/', 'http://localhost');

  // Reading things
  if (req.method === 'GET') {
    if (url.pathname === '/catalog') return void handleCatalog(url.searchParams.get('lang'), send);
    if (url.pathname === '/callbacks') return send(200, { received: store.list() });
    if (url.pathname === '/latest') {
      const last = store.latest();
      return last ? send(200, last.callback.body) : send(404, { status: 'nothing received yet' });
    }
    const m = /^\/callbacks\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const found = store.get(decodeURIComponent(m[1] ?? ''));
      return found
        ? send(200, found.body)
        : send(404, {
            status: 'pending',
            hint: 'no answer for that messageId yet; try again in a moment',
          });
    }
    return send(404, { status: 'unknown path' });
  }

  // POSTs: either a question from you (/check) or a callback from the buyer adapter
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    if (req.method === 'POST' && url.pathname === '/check') return void handleCheck(raw, send);

    const time = new Date().toLocaleTimeString('en-GB');
    let messageId = '';
    try {
      const body = JSON.parse(raw) as Callback;
      messageId = body.context?.messageId ?? '';
      if (messageId) store.add(messageId, body);
      const eligibility = body.message?.contract?.contractAttributes?.eligibility;
      const detail = eligibility
        ? `  eligibleCount=${eligibility.eligibleCount}  [${(eligibility.schemes ?? []).map((s) => s.id).join(', ')}]`
        : '';
      out(
        `${time}  ${req.url}  action=${body.context?.action}  txn=${body.context?.transactionId?.slice(0, 8)}  msg=${messageId.slice(0, 8)}${detail}`,
      );
      if (showJson) out(JSON.stringify(body, null, 2));
    } catch {
      out(`${time}  ${req.url}  (body was not JSON)`);
    }
    send(200, { message: { status: 'ACK', messageId } });
  });
}).listen(port, '0.0.0.0', () => out(`listening for callbacks on :${port} ...`));
