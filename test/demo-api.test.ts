import { describe, expect, it } from 'vitest';
import {
  parseCheckBody,
  shapeAnswer,
  shapeCatalog,
  type CatalogFile,
} from '../scripts/demo-api.js';
import type { OnSelect } from '../scripts/buyer-client.js';

const t = (en: string, id: string) => ({ en, id });

describe('parseCheckBody', () => {
  it('reads a profile and defaults the language to English', () => {
    const r = parseCheckBody({ profile: { sector: 'food', workerCount: 3 } });
    expect(r).toEqual({ ok: true, profile: { sector: 'food', workerCount: 3 }, language: 'en' });
  });

  it('accepts no profile at all (everything unknown)', () => {
    expect(parseCheckBody({})).toMatchObject({ ok: true, profile: {} });
  });

  it('honours language en and id, and refuses others', () => {
    expect(parseCheckBody({ language: 'id' })).toMatchObject({ ok: true, language: 'id' });
    expect(parseCheckBody({ language: 'fr' })).toMatchObject({ ok: false });
  });

  it('refuses personal data and wrong values, naming the field but not the value', () => {
    const phone = parseCheckBody({ profile: { phone: '+628123456789' } });
    expect(phone.ok).toBe(false);
    expect(!phone.ok && phone.error).toContain('phone');
    expect(JSON.stringify(phone)).not.toContain('628123456789');
    const bad = parseCheckBody({ profile: { workerCount: -2 } });
    expect(!bad.ok && bad.error).toContain('profile.workerCount');
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'x', 5, [1]]) expect(parseCheckBody(body).ok).toBe(false);
  });
});

const reply = {
  context: { messageId: 'm', transactionId: 't', action: 'on_select' },
  message: {
    contract: {
      commitments: [],
      contractAttributes: {
        '@type': 'HqEligibilityResult',
        eligibility: {
          eligibleCount: 1,
          language: 'en',
          stillUnknownFields: ['sector'],
          schemes: [
            {
              id: 'S-1',
              displayName: 'x',
              name: t('Micro Loan', 'Pinjaman Mikro'),
              benefit: t('A loan', 'Sebuah pinjaman'),
              why: [t('Small turnover', 'Omzet kecil')],
              documents: [{ name: t('NIB', 'NIB'), mandatory: true }],
              fulfillment: {
                type: 'EXTERNAL_REDIRECT',
                url: 'https://example.invalid/x',
                instructions: t('Apply online', 'Ajukan daring'),
              },
            },
          ],
        },
      },
    },
  },
} as unknown as OnSelect;

describe('shapeAnswer', () => {
  it('flattens one language into plain fields', () => {
    expect(shapeAnswer(reply, 'en')).toEqual({
      eligibleCount: 1,
      schemes: [
        {
          id: 'S-1',
          name: 'Micro Loan',
          benefit: 'A loan',
          whyYouQualify: ['Small turnover'],
          documents: [{ name: 'NIB', mandatory: true }],
          nextStep: {
            type: 'EXTERNAL_REDIRECT',
            url: 'https://example.invalid/x',
            instructions: 'Apply online',
          },
        },
      ],
      stillWorthAsking: ['sector'],
    });
  });

  it('uses Bahasa when asked', () => {
    const a = shapeAnswer(reply, 'id');
    expect(a.schemes[0]?.name).toBe('Pinjaman Mikro');
    expect(a.schemes[0]?.nextStep.instructions).toBe('Ajukan daring');
  });
});

describe('shapeCatalog', () => {
  const file: CatalogFile = {
    catalog: {
      id: 'seller/CAT',
      resources: [
        {
          id: 'S-1',
          resourceAttributes: {
            name: t('Micro Loan', 'Pinjaman Mikro'),
            benefit: t('A loan', 'Sebuah pinjaman'),
            eligibilityCriteria: [t('Small turnover', 'Omzet kecil')],
            documents: [{ name: t('NIB', 'NIB'), mandatory: false }],
            fulfillment: { type: 'EXTERNAL_REDIRECT', url: 'https://example.invalid/x' },
          },
        },
      ],
    },
  };

  it('lists every scheme with a count, in the chosen language', () => {
    const c = shapeCatalog(file, 'id');
    expect(c).toMatchObject({ catalogId: 'seller/CAT', count: 1 });
    expect(c.schemes[0]).toMatchObject({
      id: 'S-1',
      name: 'Pinjaman Mikro',
      criteria: ['Omzet kecil'],
    });
    expect(c.schemes[0]?.nextStep.instructions).toBeUndefined();
  });

  it('says honestly where the list comes from', () => {
    expect(shapeCatalog(file, 'en').source).toContain('catalog our seller adapter published');
  });
});
