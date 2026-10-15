import { beforeAll, describe, expect, it } from 'vitest';
import { buildCatalog } from '../src/catalog/build.js';
import { assertPublishable, publishCatalog, summarise } from '../src/catalog/publish.js';
import type { Scheme } from '../src/eligibility/types.js';
import { realSchemes, testConfig } from './helpers.js';

let schemes: Scheme[];
beforeAll(async () => {
  schemes = await realSchemes();
});

describe('buildCatalog', () => {
  it('makes one catalog with one resource and one offer per scheme', () => {
    const { message } = buildCatalog(testConfig, schemes);
    const [catalog] = message.catalogs;
    expect(catalog?.id).toBe('bpp.test/HQ-MSME-SCHEMES');
    expect(catalog?.bppId).toBe('bpp.test');
    expect(catalog?.resources.map((r) => r.id)).toEqual(schemes.map((s) => s.id));
    expect(catalog?.offers.map((o) => o.resourceIds[0])).toEqual(schemes.map((s) => s.id));
  });

  it('puts Bahasa in the descriptor and both languages in the typed block', () => {
    const [first] = buildCatalog(testConfig, schemes).message.catalogs[0]!.resources;
    expect(first?.descriptor.name).toBe('Skema Pinjaman Mikro (CONTOH)');
    expect(first?.resourceAttributes['@type']).toBe('HqScheme');
    expect(first?.resourceAttributes['@context']).toBe(
      'http://schemas.test/schema/HqScheme/v0/context.jsonld',
    );
    expect(first?.resourceAttributes.name).toEqual({
      en: 'Fake Micro Loan Scheme',
      id: 'Skema Pinjaman Mikro (CONTOH)',
    });
  });

  it('publishes readable criteria only, never the matching rules', () => {
    const json = JSON.stringify(buildCatalog(testConfig, schemes));
    expect(json).toContain('Annual turnover up to IDR 2 billion');
    expect(json).not.toContain('"operator"');
    expect(json).not.toContain('"ruleId"');
    expect(json).not.toContain('2000000000'); // the threshold lives only inside the rules engine
  });

  it('is deterministic, so republishing an unchanged catalog changes nothing', () => {
    expect(JSON.stringify(buildCatalog(testConfig, schemes))).toBe(
      JSON.stringify(buildCatalog(testConfig, schemes)),
    );
  });

  it('is visible on the configured network', () => {
    const { publishDirectives } = buildCatalog(testConfig, schemes).message;
    expect(publishDirectives[0]).toMatchObject({
      visibleTo: ['ion.id/staging'],
      catalogType: 'REGULAR',
    });
  });
});

describe('assertPublishable', () => {
  it('lets placeholders go to the sandbox and the pilot', () => {
    expect(() => assertPublishable({ ION_ENV: 'sandbox' }, schemes)).not.toThrow();
    expect(() => assertPublishable({ ION_ENV: 'pilot' }, schemes)).not.toThrow();
  });

  it('refuses to put placeholder schemes on the live network', () => {
    expect(() => assertPublishable({ ION_ENV: 'live' }, schemes)).toThrow(/placeholder/);
  });

  it('allows real schemes on the live network', () => {
    const real = schemes.map((s) => ({ ...s, placeholder: false }));
    expect(() => assertPublishable({ ION_ENV: 'live' }, real)).not.toThrow();
  });
});

describe('publishCatalog', () => {
  it('posts the catalog to the adapter and returns what it said', async () => {
    let seen: { url: string; body: { context: { action: string } } } | undefined;
    const fetchFn = ((url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return Promise.resolve(
        new Response(
          '{"status":"COMPLETED","results":[{"catalogId":"c","status":"REJECTED","reason":"no public host"}]}',
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    const outcome = await publishCatalog(buildCatalog(testConfig, schemes), {
      config: testConfig,
      fetchFn,
    });
    expect(seen?.url).toBe('http://localhost:8082/catalog/publish');
    expect(seen?.body.context.action).toBe('catalog/publish');
    expect(outcome.httpStatus).toBe(200);
    expect(summarise(outcome).join('\n')).toContain('REJECTED (no public host)');
  });
});
