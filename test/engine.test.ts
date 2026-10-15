import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkRule,
  eligibleSchemes,
  evaluate,
  stillUnknownFields,
} from '../src/eligibility/engine.js';
import type { Rule, Scheme } from '../src/eligibility/types.js';
import { EXPORTER, NOTHING, WARUNG, realSchemes } from './helpers.js';

let schemes: Scheme[];
beforeAll(async () => {
  schemes = await realSchemes();
});

const ids = (profile: Parameters<typeof eligibleSchemes>[1]) =>
  eligibleSchemes(schemes, profile).map((r) => r.scheme.id);

describe('eligibility on the sample schemes', () => {
  it('gives a food stall the loan, the training and the rural grant', () => {
    expect(ids(WARUNG)).toEqual(['FAKE-SCH-001', 'FAKE-SCH-002', 'FAKE-SCH-003']);
  });

  it('gives an exporter the loan and the export support', () => {
    expect(ids(EXPORTER)).toEqual(['FAKE-SCH-001', 'FAKE-SCH-004']);
  });

  it('returns an empty list, not an error, when nothing matches', () => {
    expect(ids(NOTHING)).toEqual([]);
  });

  it('respects boundaries exactly', () => {
    expect(ids({ ...WARUNG, workerCount: 19 })).toContain('FAKE-SCH-002');
    expect(ids({ ...WARUNG, workerCount: 20 })).not.toContain('FAKE-SCH-002');
    expect(ids({ ...WARUNG, workerCount: 1 })).toContain('FAKE-SCH-002');
    expect(ids({ ...WARUNG, workerCount: 0 })).not.toContain('FAKE-SCH-002');
    expect(ids({ ...WARUNG, annualTurnoverIdr: 2_000_000_000 })).toContain('FAKE-SCH-001');
    expect(ids({ ...WARUNG, annualTurnoverIdr: 2_000_000_001 })).not.toContain('FAKE-SCH-001');
  });

  it('explains every match with its rules', () => {
    for (const r of eligibleSchemes(schemes, WARUNG)) {
      expect(r.rules.length).toBeGreaterThan(0);
      expect(r.rules.every((x) => x.outcome === 'met')).toBe(true);
      expect(r.rules.every((x) => x.label.en && x.label.id)).toBe(true);
    }
  });
});

describe('partial profiles', () => {
  it('marks a scheme possible, not eligible, while answers are missing', () => {
    const byId = Object.fromEntries(
      evaluate(schemes, { hasNIB: true }).map((r) => [r.scheme.id, r.status]),
    );
    expect(byId['FAKE-SCH-001']).toBe('possible'); // turnover unknown
    expect(byId['FAKE-SCH-004']).toBe('possible');
    expect(eligibleSchemes(schemes, { hasNIB: true })).toEqual([]);
  });

  it('treats an empty profile as all possible, none excluded', () => {
    expect(evaluate(schemes, {}).every((r) => r.status === 'possible')).toBe(true);
  });

  it('does not ask questions for schemes that are already excluded', () => {
    // no NIB: schemes 1 and 4 are out, so the export question (scheme 4 only) is pointless
    const need = stillUnknownFields(schemes, { hasNIB: false });
    expect(need).not.toContain('exportsOrPlansToExport');
    expect(need).toContain('sector'); // scheme 2 is still possible
  });

  it('asks nothing when the profile is complete', () => {
    expect(stillUnknownFields(schemes, WARUNG)).toEqual([]);
  });
});

describe('operators', () => {
  const base = {
    ruleId: 'R',
    label: { en: 'x', id: 'x' },
  };
  const rule = (r: Partial<Rule> & Pick<Rule, 'field' | 'operator' | 'value'>): Rule => ({
    ...base,
    ...r,
  });

  it('= and !=', () => {
    expect(checkRule(rule({ field: 'hasNIB', operator: '=', value: true }), { hasNIB: true })).toBe(
      'met',
    );
    expect(
      checkRule(rule({ field: 'hasNIB', operator: '=', value: true }), { hasNIB: false }),
    ).toBe('failed');
    expect(
      checkRule(rule({ field: 'sector', operator: '!=', value: 'mining' }), { sector: 'food' }),
    ).toBe('met');
    expect(
      checkRule(rule({ field: 'sector', operator: '!=', value: 'mining' }), { sector: 'mining' }),
    ).toBe('failed');
  });

  it('IN and NOT_IN', () => {
    const inRule = rule({ field: 'province', operator: 'IN', value: ['Bali', 'Jawa Timur'] });
    expect(checkRule(inRule, { province: 'Bali' })).toBe('met');
    expect(checkRule(inRule, { province: 'Aceh' })).toBe('failed');
    const notIn = rule({ field: 'province', operator: 'NOT_IN', value: ['Bali'] });
    expect(checkRule(notIn, { province: 'Aceh' })).toBe('met');
    expect(checkRule(notIn, { province: 'Bali' })).toBe('failed');
  });

  it('ordering operators are strict where they say so', () => {
    const gt = rule({ field: 'workerCount', operator: '>', value: 5 });
    expect(checkRule(gt, { workerCount: 6 })).toBe('met');
    expect(checkRule(gt, { workerCount: 5 })).toBe('failed');
    const lt = rule({ field: 'workerCount', operator: '<', value: 5 });
    expect(checkRule(lt, { workerCount: 4 })).toBe('met');
    expect(checkRule(lt, { workerCount: 5 })).toBe('failed');
  });

  it('an unanswered question is unknown, never failed', () => {
    expect(checkRule(rule({ field: 'workerCount', operator: '>', value: 5 }), {})).toBe('unknown');
  });
});
