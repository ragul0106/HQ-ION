import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { SchemeFileSchema } from '../src/eligibility/scheme-file.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let sample: Json;
const fresh = (): Json => structuredClone(sample);
const problems = (file: Json) => {
  const r = SchemeFileSchema.safeParse(file);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

beforeAll(async () => {
  sample = JSON.parse(await readFile('./data/schemes/FAKE-SCH-004.json', 'utf8')) as Json;
});

describe('SchemeFileSchema (the SVC-social pack shape)', () => {
  it('turns a pack-shaped file into the scheme the engine reads', () => {
    const r = SchemeFileSchema.safeParse(sample);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const turnover = r.data.eligibility.rules.find((x) => x.field === 'annualTurnoverIdr');
    expect(turnover).toMatchObject({ operator: '>=', value: 500000000, unit: 'IDR' });
    // The pack writes a yes/no value as the string "true"; the engine gets a real boolean.
    expect(r.data.eligibility.rules.find((x) => x.field === 'hasNIB')?.value).toBe(true);
    // Bahasa is the pack text, English comes from translations.
    expect(r.data.name.id).toBe(sample.resourceAttributes.schemeIdentity.schemeName);
    expect(r.data.name.en).toBe(sample.haqdarshak.translations.en.schemeName);
    // The redirect URL is the pack's governmentPortalUrl.
    expect(r.data.fulfillment.url).toBe(
      sample.resourceAttributes.applicationChannel.governmentPortalUrl,
    );
    expect(r.data.resourceAttributes?.crc).toBe('SVC-social');
  });

  it('makes the province rule from geographicEligibility', async () => {
    const file = JSON.parse(await readFile('./data/schemes/FAKE-SCH-003.json', 'utf8')) as Json;
    const r = SchemeFileSchema.safeParse(file);
    expect(r.success && r.data.eligibility.rules.map((x) => x.field)).toContain('province');
  });

  it('refuses a value the pack does not allow, naming the field', () => {
    const f = fresh();
    f.resourceAttributes.schemeIdentity.schemeType = 'MAGIC';
    expect(problems(f).join('\n')).toMatch(/resourceAttributes\.schemeIdentity\.schemeType/);
  });

  it('refuses keys the pack does not define (our own fields cannot hide inside the block)', () => {
    const f = fresh();
    f.resourceAttributes.eligibility.economicCriteria[0].field = 'annualTurnoverIdr';
    expect(problems(f).length).toBeGreaterThan(0);
  });

  it('needs a profile field for every rule, and no stray ones', () => {
    const f = fresh();
    delete f.haqdarshak.ruleFields.R1;
    f.haqdarshak.ruleFields.R99 = 'sector';
    const p = problems(f).join('\n');
    expect(p).toMatch(/no entry for R1/);
    expect(p).toMatch(/ruleFields\.R99/);
  });

  it('needs an English label, document purpose and rule value of the right type', () => {
    const f = fresh();
    delete f.haqdarshak.translations.en.ruleLabels.R1;
    f.haqdarshak.translations.en.documentPurposes.pop();
    f.resourceAttributes.eligibility.occupationalCriteria[0].value = 'maybe';
    const p = problems(f).join('\n');
    expect(p).toMatch(/no English label for R1/);
    expect(p).toMatch(/one English purpose per entry/);
    expect(p).toMatch(/cannot be read as one/);
  });

  it('refuses a facilitated scheme (Phase 1 is a redirect) and never echoes a value', () => {
    const f = fresh();
    f.resourceAttributes.applicationChannel.applicationMode = 'FACILITATED';
    f.resourceAttributes.eligibility.occupationalCriteria[0].value = 'SECRET-VALUE-123';
    const p = problems(f).join('\n');
    expect(p).toMatch(/SELF_SERVICE/);
    expect(p).not.toMatch(/SECRET-VALUE-123/);
  });
});
