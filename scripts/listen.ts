/**
 * A tiny buyer-side receiver for the local ION testnet. The ION buyer adapter delivers the seller's answers here
 * (`on_select`). A plain curl or Postman call only ever shows the immediate ACK; the answer arrives HERE.
 *
 *   npm run listen              prints one summary line per callback
 *   npm run listen -- --json    also prints the full message
 *
 * It also keeps the answers so that Postman (which cannot receive callbacks) can fetch them:
 *   GET http://localhost:3101/callbacks/<messageId>   the full on_select for that select (404 until it arrives)
 *   GET http://localhost:3101/latest                  the most recent callback
 *   GET http://localhost:3101/callbacks               the ids received so far
 *
 * The buyer adapter is routed to :3101 by `npm run onix:apply`.
 */
import { createServer } from 'node:http';
import { createCallbackStore } from './callback-store.js';

const port = Number(process.env.TEST_BUYER_PORT ?? 3101);
const showJson = process.argv.includes('--json');
const out = (text: string): void => void process.stdout.write(`${text}\n`);
const store = createCallbackStore();

interface Callback {
  context?: { action?: string; transactionId?: string; messageId?: string };
  message?: {
    contract?: {
      contractAttributes?: { eligibility?: { eligibleCount?: number; schemes?: { id: string }[] } };
    };
  };
}

createServer((req, res) => {
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body, null, 2));
  };

  // Reading what has arrived (used by Postman)
  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost');
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

  // Receiving a callback from the buyer adapter
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const time = new Date().toLocaleTimeString('en-GB');
    let messageId = '';
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Callback;
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
