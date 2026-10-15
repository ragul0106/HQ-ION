import { describe, expect, it } from 'vitest';
import { ProfileSchema, RuleSchema, SchemeSchema } from '../src/eligibility/types.js';

const label = { en: 'x', id: 'x' };

describe('ProfileSchema', () => {
  it('accepts a partial profile and an empty one', () => {
    expect(ProfileSchema.safeParse({ hasNIB: true }).success).toBe(true);
    expect(ProfileSchema.safeParse({}).success).toBe(true);
  });

  it('refuses anything we did not ask for, such as a phone number or national ID', () => {
    expect(ProfileSchema.safeParse({ phone: '+628123456789' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ nik: '3171000000000001' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ fullName: 'A B' }).success).toBe(false);
  });

  it('refuses wrong types and values', () => {
    expect(ProfileSchema.safeParse({ workerCount: -1 }).success).toBe(false);
    expect(ProfileSchema.safeParse({ workerCount: 2.5 }).success).toBe(false);
    expect(ProfileSchema.safeParse({ annualTurnoverIdr: '300' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ hasNIB: 'yes' }).success).toBe(false);
    expect(ProfileSchema.safeParse({ businessType: 'alien' }).success).toBe(false);
  });
});

describe('RuleSchema', () => {
  const ok = { ruleId: 'R1', field: 'workerCount', operator: '<=', value: 19, label };

  it('accepts a valid rule', () => {
    expect(RuleSchema.safeParse(ok).success).toBe(true);
  });

  it('IN needs a list and = needs a single value', () => {
    expect(
      RuleSchema.safeParse({ ...ok, field: 'sector', operator: 'IN', value: 'food' }).success,
    ).toBe(false);
    expect(RuleSchema.safeParse({ ...ok, operator: '=', value: [1, 2] }).success).toBe(false);
  });

  it('the value must have the type of the field it reads', () => {
    expect(RuleSchema.safeParse({ ...ok, value: 'many' }).success).toBe(false);
    expect(
      RuleSchema.safeParse({ ...ok, field: 'hasNIB', operator: '=', value: 'yes' }).success,
    ).toBe(false);
  });

  it('ordering operators only make sense for numbers', () => {
    expect(
      RuleSchema.safeParse({ ...ok, field: 'sector', operator: '>=', value: 'food' }).success,
    ).toBe(false);
  });

  it('refuses an unknown field or operator', () => {
    expect(RuleSchema.safeParse({ ...ok, field: 'shoeSize' }).success).toBe(false);
    expect(RuleSchema.safeParse({ ...ok, operator: '~' }).success).toBe(false);
  });
});

describe('SchemeSchema', () => {
  const scheme = {
    id: 'S-1',
    name: label,
    benefit: label,
    eligibility: { rules: [{ ruleId: 'R1', field: 'hasNIB', operator: '=', value: true, label }] },
    documents: [{ name: label, mandatory: true }],
    fulfillment: {
      type: 'EXTERNAL_REDIRECT',
      url: 'https://example.invalid/x',
      instructions: label,
    },
  };

  it('accepts a valid scheme and defaults placeholder to false', () => {
    const parsed = SchemeSchema.safeParse(scheme);
    expect(parsed.success && parsed.data.placeholder).toBe(false);
  });

  it('refuses duplicate rule ids', () => {
    const dup = {
      ...scheme,
      eligibility: { rules: [scheme.eligibility.rules[0], scheme.eligibility.rules[0]] },
    };
    expect(SchemeSchema.safeParse(dup).success).toBe(false);
  });

  it('refuses a missing translation', () => {
    expect(SchemeSchema.safeParse({ ...scheme, name: { en: 'only english' } }).success).toBe(false);
  });

  it('refuses a fulfillment type we do not support yet', () => {
    const f = { ...scheme.fulfillment, type: 'API_SUBMISSION' };
    expect(SchemeSchema.safeParse({ ...scheme, fulfillment: f }).success).toBe(false);
  });

  it('refuses unknown keys, so a typo does not silently drop a rule', () => {
    expect(SchemeSchema.safeParse({ ...scheme, eligibilty: {} }).success).toBe(false);
  });
});
