import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const valid = {
  ION_ENV: 'sandbox',
  DATA_REGION: 'id-jakarta',
  NETWORK_ID: 'ion.id/staging',
  BPP_ID: 'bpp.example',
  BPP_URI: 'https://bpp.example/bpp/receiver',
  ADAPTER_CALLER_URL: 'http://localhost:8082/bpp/caller',
  ADAPTER_PUBLISH_URL: 'http://localhost:8082/catalog/publish',
};

const without = (key: keyof typeof valid): Record<string, string> =>
  Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));

describe('loadConfig', () => {
  it('accepts a complete environment and applies defaults', () => {
    const c = loadConfig(valid);
    expect(c.PORT).toBe(3102);
    expect(c.HOST).toBe('127.0.0.1');
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.SCHEMES_DIR).toBe('./data/schemes');
    expect(c.SCHEMA_BASE_URL).toBe('http://reverse-proxy:9000/schema');
  });

  it('converts PORT from text', () => {
    expect(loadConfig({ ...valid, PORT: '4000' }).PORT).toBe(4000);
  });

  it('refuses to start without ION_ENV, so a live run is never an accident', () => {
    expect(() => loadConfig(without('ION_ENV'))).toThrow(ConfigError);
  });

  it('rejects an unknown ION_ENV', () => {
    expect(() => loadConfig({ ...valid, ION_ENV: 'production' })).toThrow(/ION_ENV/);
  });

  it('requires DATA_REGION to be stated explicitly', () => {
    expect(() => loadConfig(without('DATA_REGION'))).toThrow(/DATA_REGION/);
  });

  it('lists every problem at once', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).problems.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('never echoes a rejected value (it could be a secret)', () => {
    const secret = 'not-a-url-s3cr3t-value';
    try {
      loadConfig({ ...valid, ADAPTER_CALLER_URL: secret });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });
});
