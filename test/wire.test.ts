import { beforeAll, describe, expect, it } from 'vitest';
import { eligibleSchemes, stillUnknownFields } from '../src/eligibility/engine.js';
import type { Scheme } from '../src/eligibility/types.js';
import { buildOnSelectMessage, parseSelect } from '../src/wire/select.js';
import { NOTHING, WARUNG, realSchemes, selectMessage, testConfig } from './helpers.js';

let schemes: Scheme[];
beforeAll(async () => {
  schemes = await realSchemes();
});

describe('parseSelect', () => {
  it('reads a valid select and defaults the language to Bahasa', () => {
    const r = parseSelect(selectMessage(WARUNG));
    expect(r.ok && r.value.language).toBe('id');
    expect(r.ok && r.value.profile).toEqual(WARUNG);
  });

  it('honours an explicit language', () => {
    const r = parseSelect(selectMessage(WARUNG, 'en'));
    expect(r.ok && r.value.language).toBe('en');
  });

  it('accepts a partial profile', () => {
    expect(parseSelect(selectMessage({ hasNIB: true })).ok).toBe(true);
  });

  it('refuses extra personal fields and says which', () => {
    const r = parseSelect(selectMessage({ ...WARUNG, phone: '+628123456789' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problems.join(' ')).toContain('phone');
      expect(r.problems.join(' ')).not.toContain('628123456789'); // the value is never echoed
    }
  });

  it('refuses a wrong @type and a missing contract', () => {
    const msg = selectMessage(WARUNG);
    msg.contract.contractAttributes['@type'] = 'SomethingElse';
    expect(parseSelect(msg).ok).toBe(false);
    expect(parseSelect({}).ok).toBe(false);
  });

  it('refuses an unknown language', () => {
    expect(parseSelect(selectMessage(WARUNG, 'fr')).ok).toBe(false);
  });
});

describe('buildOnSelectMessage', () => {
  function build(profile: Parameters<typeof eligibleSchemes>[1], language?: string) {
    const parsed = parseSelect(selectMessage(profile, language));
    if (!parsed.ok) throw new Error('bad fixture');
    return buildOnSelectMessage({
      config: testConfig,
      request: parsed.value,
      eligible: eligibleSchemes(schemes, profile),
      stillUnknown: stillUnknownFields(schemes, profile),
    });
  }

  it('makes one commitment per eligible scheme, each with an offer (the schema requires one)', () => {
    const { contract } = build(WARUNG);
    expect(
      contract.commitments.map((c) => (c as { resources: { id: string }[] }).resources[0]?.id),
    ).toEqual(['FAKE-SCH-001', 'FAKE-SCH-002', 'FAKE-SCH-003']);
    expect(contract.commitments.every((c) => 'offer' in c)).toBe(true);
  });

  it('describes the result with a typed, linked block', () => {
    const { contract } = build(WARUNG);
    expect(contract.contractAttributes['@type']).toBe('HqEligibilityResult');
    expect(contract.contractAttributes['@context']).toBe(
      'http://schemas.test/schema/HqEligibilityResult/v0/context.jsonld',
    );
    expect(contract.contractAttributes.eligibility.eligibleCount).toBe(3);
  });

  it('carries reasons, documents and the next step for every scheme, in both languages', () => {
    const [first] = build(WARUNG).contract.contractAttributes.eligibility.schemes;
    expect(first?.why.length).toBeGreaterThan(0);
    expect(first?.documents.length).toBeGreaterThan(0);
    expect(first?.fulfillment.type).toBe('EXTERNAL_REDIRECT');
    expect(first?.name).toEqual({
      en: 'Fake Micro Loan Scheme',
      id: 'Skema Pinjaman Mikro (CONTOH)',
    });
  });

  it('shows the requested language as display text', () => {
    const en = build(WARUNG, 'en').contract.contractAttributes.eligibility.schemes[0];
    const id = build(WARUNG, 'id').contract.contractAttributes.eligibility.schemes[0];
    expect(en?.displayName).toBe('Fake Micro Loan Scheme');
    expect(id?.displayName).toBe('Skema Pinjaman Mikro (CONTOH)');
  });

  it('answers "nothing matched" with its own complete placeholder commitment and a count of zero', () => {
    const { contract } = build(NOTHING);
    expect(contract.commitments).toHaveLength(1);
    expect(contract.commitments[0]).toMatchObject({
      id: 'commitment-eligibility-check',
      status: { code: 'DRAFT' },
      resources: [{ id: 'HQ-ELIGIBILITY-CHECK', quantity: { unitQuantity: 1, unitCode: 'UNIT' } }],
      offer: { resourceIds: ['HQ-ELIGIBILITY-CHECK'] },
    });
    expect(contract.contractAttributes.eligibility.eligibleCount).toBe(0);
    expect(contract.contractAttributes.eligibility.schemes).toEqual([]);
  });

  it('REGRESSION: a minimal buyer commitment never leaks into the reply (the adapter requires `quantity`)', () => {
    // The Postman run sent a commitment with no quantity; echoing it made the adapter reject our reply.
    const message = selectMessage({ hasNIB: true });
    message.contract.commitments = [
      { id: 'c', resources: [{ id: 'x' }], offer: { id: 'o', resourceIds: ['x'] } },
    ] as never;
    const parsed = parseSelect(message);
    if (!parsed.ok) throw new Error('bad fixture');
    for (const eligible of [[], eligibleSchemes(schemes, WARUNG)]) {
      const { contract } = buildOnSelectMessage({
        config: testConfig,
        request: parsed.value,
        eligible,
        stillUnknown: [],
      });
      for (const c of contract.commitments as {
        status: unknown;
        resources: { id: string; descriptor: unknown; quantity: unknown }[];
        offer: { resourceIds: string[] };
      }[]) {
        expect(c.status).toBeDefined();
        expect(c.offer.resourceIds.length).toBeGreaterThan(0);
        for (const r of c.resources) {
          expect(r.id).toBeTruthy();
          expect(r.descriptor).toBeDefined();
          expect(r.quantity).toBeDefined();
        }
      }
    }
  });

  it('names the placeholder in the requested language', () => {
    const id = build(NOTHING, 'id').contract.commitments[0] as {
      resources: { descriptor: { name: string } }[];
    };
    expect(id.resources[0]?.descriptor.name).toBe('Pemeriksaan kelayakan skema');
  });

  it('lists what is still worth asking', () => {
    const { contract } = build({ hasNIB: false });
    const fields = contract.contractAttributes.eligibility.stillUnknownFields;
    expect(fields).toContain('sector');
    expect(fields).not.toContain('exportsOrPlansToExport');
  });
});
