import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { EXPORTER, NOTHING, WARUNG, envelope, makeDeps, selectMessage } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function setup() {
  const made = await makeDeps();
  app = buildServer(made.deps);
  const select = (message: unknown, overrides: Record<string, unknown> = {}) => {
    const body = envelope('select');
    return app!.inject({
      method: 'POST',
      url: '/api/webhook/select',
      payload: { context: { ...body.context, ...overrides }, message } as object,
    });
  };
  return { ...made, select };
}

describe('select', () => {
  it('ACKs at once, then sends on_select with the eligible schemes', async () => {
    const { select, sent, flush } = await setup();
    const res = await select(selectMessage(WARUNG));
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toEqual({ status: 'ACK', messageId: 'msg-0001' });

    await flush();
    expect(sent).toHaveLength(1);
    const reply = sent[0]!;
    expect(reply.action).toBe('select');
    const { eligibility } = reply.message.contract.contractAttributes;
    expect(eligibility.schemes.map((s: { id: string }) => s.id)).toEqual([
      'FAKE-SCH-001',
      'FAKE-SCH-002',
      'FAKE-SCH-003',
    ]);
  });

  it('answers a different profile differently', async () => {
    const { select, sent, flush } = await setup();
    await select(selectMessage(EXPORTER));
    await flush();
    const ids = sent[0]!.message.contract.contractAttributes.eligibility.schemes.map(
      (s: { id: string }) => s.id,
    );
    expect(ids).toEqual(['FAKE-SCH-001', 'FAKE-SCH-004']);
  });

  it('handles zero results as a normal answer', async () => {
    const { select, sent, flush } = await setup();
    const res = await select(selectMessage(NOTHING));
    expect(res.statusCode).toBe(200);
    await flush();
    expect(sent[0]!.message.contract.contractAttributes.eligibility.eligibleCount).toBe(0);
  });

  it('replies with the same transactionId and messageId (the buyer matches on these)', async () => {
    const { select, sent, flush } = await setup();
    await select(selectMessage(WARUNG), { transactionId: 'T-42', messageId: 'M-42' });
    await flush();
    expect(sent[0]!.requestContext).toMatchObject({ transactionId: 'T-42', messageId: 'M-42' });
  });

  it('refuses a malformed profile immediately and sends no callback', async () => {
    const { select, sent, flush } = await setup();
    const res = await select(selectMessage({ workerCount: -3 }));
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatchObject({ status: 'NACK', error: { code: 'BAD_REQUEST' } });
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('refuses personal data we never asked for, without echoing it', async () => {
    const { select, sent, flush, cap } = await setup();
    const res = await select(selectMessage({ ...WARUNG, phone: '+628111222333' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().message.error.message).toContain('phone');
    expect(JSON.stringify(res.json())).not.toContain('628111222333');
    await flush();
    expect(sent).toHaveLength(0);
    expect(cap.raw()).not.toContain('628111222333');
  });

  it('refuses a select with no contract', async () => {
    const { select } = await setup();
    expect((await select({})).statusCode).toBe(400);
  });

  it('never writes the profile to the logs, only how many questions were answered', async () => {
    const { select, flush, cap } = await setup();
    await select(selectMessage(WARUNG));
    await flush();
    expect(cap.raw()).not.toContain('Jawa Tengah');
    expect(cap.raw()).not.toContain('300000000');
    const evaluated = cap.lines().find((l) => l.event === 'select.evaluated');
    expect(evaluated).toMatchObject({ eligibleCount: 3, answeredFields: 7, schemesChecked: 4 });
  });

  it('uses the schemes that are loaded now, so a reload changes the answer', async () => {
    const { deps, select, sent, flush } = await setup();
    const all = [...deps.schemes.all()];
    deps.schemes.all = () => all.filter((s) => s.id === 'FAKE-SCH-001');
    await select(selectMessage(WARUNG));
    await flush();
    expect(sent[0]!.message.contract.contractAttributes.eligibility.eligibleCount).toBe(1);
  });
});
