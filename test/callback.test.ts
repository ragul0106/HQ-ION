import { describe, expect, it } from 'vitest';
import { CallbackError, createCallbackSender } from '../src/protocol/callback.js';
import { createLogger } from '../src/logger.js';
import type { Context } from '../src/protocol/context.js';
import { captureLogs, envelope, testConfig } from './helpers.js';

const requestContext = envelope('select').context as Context;

function setup(responses: (Response | Error)[]) {
  const calls: { url: string; body: { context: Record<string, string>; message: unknown } }[] = [];
  const sleeps: number[] = [];
  const cap = captureLogs();
  const fetchFn = ((url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const next = responses.shift() ?? new Response('{}', { status: 200 });
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as unknown as typeof fetch;
  const sender = createCallbackSender({
    config: testConfig,
    log: createLogger(testConfig, cap.stream),
    fetchFn,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { sender, calls, sleeps, cap };
}

const ok = () => new Response('{"message":{"status":"ACK"}}', { status: 200 });
const nack = (code: string, status = 400) =>
  new Response(JSON.stringify({ message: { status: 'NACK', error: { code } } }), { status });

describe('callback sender', () => {
  it('posts on_<action> to the adapter, keeping transactionId and messageId and refreshing the timestamp', async () => {
    const { sender, calls } = setup([ok()]);
    await sender.send('select', requestContext, { contract: {} });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:8082/bpp/caller/on_select');
    expect(calls[0]!.body.context).toMatchObject({
      action: 'on_select',
      transactionId: 'txn-0001',
      messageId: 'msg-0001',
    });
    expect(calls[0]!.body.context.timestamp).not.toBe(requestContext.timestamp);
    expect(calls[0]!.body.message).toEqual({ contract: {} });
  });

  it('retries a server error with growing waits, then succeeds', async () => {
    const { sender, calls, sleeps } = setup([
      new Response('', { status: 503 }),
      new Response('', { status: 502 }),
      ok(),
    ]);
    await sender.send('select', requestContext, {});
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('retries a network error', async () => {
    const { sender, calls } = setup([new Error('connection refused'), ok()]);
    await sender.send('select', requestContext, {});
    expect(calls).toHaveLength(2);
  });

  it('does NOT retry a 4xx: the adapter says the message itself is wrong', async () => {
    const { sender, calls, cap } = setup([nack('SCH_SCHEMA_VALIDATION_FAILED')]);
    await expect(sender.send('select', requestContext, {})).rejects.toBeInstanceOf(CallbackError);
    expect(calls).toHaveLength(1);
    const failed = cap.lines().find((l) => l.outcome === 'failed');
    expect(failed).toMatchObject({ errorCode: 'SCH_SCHEMA_VALIDATION_FAILED', httpStatus: 400 });
  });

  it('gives up after the maximum number of tries and says so', async () => {
    const { sender, calls, cap } = setup([
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
    ]);
    await expect(sender.send('select', requestContext, {})).rejects.toThrow(/after 4 tries/);
    expect(calls).toHaveLength(4);
    expect(cap.lines().filter((l) => l.outcome === 'retry')).toHaveLength(3);
    expect(cap.lines().some((l) => l.outcome === 'failed')).toBe(true);
  });

  it('logs every outgoing message with its ids, never the payload', async () => {
    const { sender, cap } = setup([ok()]);
    await sender.send('select', requestContext, { contract: { secret: 'PAYLOAD-VALUE' } });
    expect(cap.lines().find((l) => l.outcome === 'sent')).toMatchObject({
      direction: 'out',
      action: 'on_select',
      transactionId: 'txn-0001',
      messageId: 'msg-0001',
    });
    expect(cap.raw()).not.toContain('PAYLOAD-VALUE');
  });
});
