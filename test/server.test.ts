import { afterEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/app.js';
import { UNSUPPORTED_IN_PHASE_1 } from '../src/protocol/actions.js';
import { envelope, makeDeps } from './helpers.js';

let app: NestFastifyApplication | undefined;

async function setup() {
  const made = await makeDeps();
  app = await createApp(made.deps);
  return { app, cap: made.cap, sent: made.sent, flush: made.flush };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const post = (a: NestFastifyApplication, action: string, payload: unknown) =>
  a
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'POST', url: `/api/webhook/${action}`, payload: payload as object });

describe('GET /health', () => {
  it('reports the environment and region', async () => {
    const { app } = await setup();
    const res = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', ionEnv: 'sandbox', region: 'test-region' });
  });
});

describe('POST /api/webhook/:action', () => {
  it.each(UNSUPPORTED_IN_PHASE_1)('refuses %s clearly, never silently', async (action) => {
    const { app } = await setup();
    const res = await post(app, action, envelope(action));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      message: { status: 'NACK', messageId: 'msg-0001', error: { code: 'UNSUPPORTED_IN_PHASE_1' } },
    });
  });

  it('acknowledges on_publish and records only its key names', async () => {
    const { app, cap } = await setup();
    const res = await post(
      app,
      'on_publish',
      envelope('on_publish', { secretLookingValue: 'abc123' }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().message.status).toBe('ACK');
    expect(cap.raw()).toContain('secretLookingValue');
    expect(cap.raw()).not.toContain('abc123');
  });

  it('rejects a body without a valid context, echoing the messageId when it can', async () => {
    const { app } = await setup();
    const res = await post(app, 'select', { context: { messageId: 'only-this' }, message: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatchObject({ status: 'NACK', messageId: 'only-this' });
    expect(res.json().message.error.code).toBe('BAD_REQUEST');
  });

  it('rejects an empty body', async () => {
    const { app } = await setup();
    const res = await post(app, 'select', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message.messageId).toBe('unknown');
  });

  it('rejects a context.action that does not match the endpoint', async () => {
    const { app } = await setup();
    const res = await post(app, 'select', envelope('init'));
    expect(res.statusCode).toBe(400);
    expect(res.json().message.error.code).toBe('ACTION_MISMATCH');
  });

  it('answers 404 for an action we have never heard of', async () => {
    const { app } = await setup();
    const res = await post(app, 'teleport', envelope('teleport'));
    expect(res.statusCode).toBe(404);
    expect(res.json().message.error.code).toBe('UNKNOWN_ACTION');
  });

  it('logs one protocol line per message, keyed by transaction and message id, without the payload', async () => {
    const { app, cap } = await setup();
    await post(app, 'init', envelope('init', { msmeProfile: { province: 'Bali' } }));
    const protocolLines = cap.lines().filter((l) => l.event === 'protocol');
    expect(protocolLines.length).toBeGreaterThanOrEqual(2); // received + nack
    expect(
      protocolLines.every((l) => l.transactionId === 'txn-0001' && l.messageId === 'msg-0001'),
    ).toBe(true);
    expect(cap.raw()).not.toContain('Bali');
  });
});
