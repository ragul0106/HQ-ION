import { describe, expect, it } from 'vitest';
import { createLogger, scrub } from '../src/logger.js';
import { logProtocol } from '../src/protocol/log.js';
import { captureLogs, testConfig } from './helpers.js';

describe('scrub', () => {
  it('replaces personal data at any depth', () => {
    const out = scrub({
      a: { b: { msmeProfile: { province: 'Bali' }, ok: 1 } },
      list: [{ phone: '+628123456789' }],
      NIK: '3171000000000001',
    }) as {
      a: { b: { msmeProfile: unknown; ok: number } };
      list: { phone: unknown }[];
      NIK: unknown;
    };
    expect(out.a.b.msmeProfile).toBe('[REDACTED]');
    expect(out.a.b.ok).toBe(1);
    expect(out.list[0]?.phone).toBe('[REDACTED]');
    expect(out.NIK).toBe('[REDACTED]');
  });

  it('does not mutate its input', () => {
    const input = { profile: { x: 1 } };
    scrub(input);
    expect(input.profile).toEqual({ x: 1 });
  });
});

describe('logger', () => {
  it('writes JSON lines carrying service, environment and region', () => {
    const cap = captureLogs();
    createLogger(testConfig, cap.stream).info('hello');
    const [line] = cap.lines();
    expect(line).toMatchObject({
      service: 'hq-ion-seller',
      ionEnv: 'sandbox',
      region: 'test-region',
    });
  });

  it('redacts a profile even if someone logs one by mistake', () => {
    const cap = captureLogs();
    createLogger(testConfig, cap.stream).info(
      { msmeProfile: { province: 'Jawa Tengah', hasNIB: true } },
      'oops',
    );
    expect(cap.raw()).not.toContain('Jawa Tengah');
    expect(cap.raw()).toContain('[REDACTED]');
  });
});

describe('logProtocol', () => {
  it('logs ids and outcome, keyed by transactionId and messageId', () => {
    const cap = captureLogs();
    logProtocol(createLogger(testConfig, cap.stream), {
      direction: 'in',
      action: 'select',
      transactionId: 'txn-1',
      messageId: 'msg-1',
      outcome: 'ack',
      httpStatus: 200,
    });
    expect(cap.lines()[0]).toMatchObject({
      event: 'protocol',
      direction: 'in',
      action: 'select',
      transactionId: 'txn-1',
      messageId: 'msg-1',
      outcome: 'ack',
    });
  });

  it('logs refusals at warn level so they stand out', () => {
    const cap = captureLogs();
    logProtocol(createLogger(testConfig, cap.stream), {
      direction: 'in',
      action: 'init',
      outcome: 'nack',
    });
    expect(cap.lines()[0]?.level).toBe(40);
  });
});
