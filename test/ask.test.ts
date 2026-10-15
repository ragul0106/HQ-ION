import { describe, expect, it } from 'vitest';
import { AskArgError, formatReply, parseAskArgs } from '../scripts/ask-lib.js';
import type { OnSelect } from '../scripts/buyer-client.js';

describe('parseAskArgs', () => {
  it('turns flags into a profile', () => {
    const a = parseAskArgs([
      '--business-type',
      'individual',
      '--sector',
      'food',
      '--turnover',
      '300000000',
      '--province',
      'Jawa Tengah',
      '--workers',
      '3',
      '--nib',
      'yes',
      '--export',
      'no',
    ]);
    expect(a.profile).toEqual({
      businessType: 'individual',
      sector: 'food',
      annualTurnoverIdr: 300_000_000,
      province: 'Jawa Tengah',
      workerCount: 3,
      hasNIB: true,
      exportsOrPlansToExport: false,
    });
    expect(a.language).toBe('id');
  });

  it('accepts no answers at all: everything unknown', () => {
    expect(parseAskArgs([]).profile).toEqual({});
  });

  it('understands yes/no in a few spellings', () => {
    expect(parseAskArgs(['--nib', 'Y']).profile.hasNIB).toBe(true);
    expect(parseAskArgs(['--nib', 'false']).profile.hasNIB).toBe(false);
    expect(parseAskArgs(['--export', 'No']).profile.exportsOrPlansToExport).toBe(false);
  });

  it('says what is wrong in plain words', () => {
    expect(() => parseAskArgs(['--nib', 'maybe'])).toThrow(/--nib needs yes or no/);
    expect(() => parseAskArgs(['--workers', '3.5'])).toThrow(/--workers needs a whole number/);
    expect(() => parseAskArgs(['--turnover', '3e9'])).toThrow(/--turnover needs a whole number/);
    expect(() => parseAskArgs(['--turnover', '-5'])).toThrow(/whole number/);
    expect(() => parseAskArgs(['--business-type', 'alien'])).toThrow(
      /one of: individual, CV, PT, cooperative/,
    );
    expect(() => parseAskArgs(['--lang', 'fr'])).toThrow(/--lang needs en or id/);
  });

  it('refuses a flag it does not know, such as a phone number', () => {
    expect(() => parseAskArgs(['--phone', '+628123'])).toThrow(AskArgError);
  });

  it('reads --lang, --json and --help', () => {
    const a = parseAskArgs(['--lang', 'en', '--json', '--help']);
    expect(a).toMatchObject({ language: 'en', json: true, help: true });
  });
});

describe('formatReply', () => {
  const text = (en: string, id: string) => ({ en, id });
  const reply = (schemes: unknown[], stillUnknown: string[] = []): OnSelect =>
    ({
      context: { messageId: 'm', transactionId: 't', action: 'on_select' },
      message: {
        contract: {
          commitments: [],
          contractAttributes: {
            '@type': 'HqEligibilityResult',
            eligibility: {
              eligibleCount: schemes.length,
              language: 'en',
              schemes,
              stillUnknownFields: stillUnknown,
            },
          },
        },
      },
    }) as unknown as OnSelect;

  const scheme = {
    id: 'S-1',
    displayName: 'x',
    name: text('Micro Loan', 'Pinjaman Mikro'),
    benefit: text('A loan', 'Sebuah pinjaman'),
    why: [text('Small turnover', 'Omzet kecil'), text('Has NIB', 'Punya NIB')],
    documents: [
      { name: text('NIB', 'NIB'), mandatory: true },
      { name: text('Photo', 'Foto'), mandatory: false },
    ],
    fulfillment: {
      type: 'EXTERNAL_REDIRECT',
      url: 'https://example.invalid/x',
      instructions: text('Apply online', 'Ajukan daring'),
    },
  };

  it('shows each scheme in the chosen language with reasons, documents and the next step', () => {
    const en = formatReply(reply([scheme]), 'en', 7).join('\n');
    expect(en).toContain('Eligible for 1 scheme:');
    expect(en).toContain('Micro Loan  [S-1]');
    expect(en).toContain('Small turnover; Has NIB');
    expect(en).toContain('NIB; Photo (optional)');
    expect(en).toContain('Apply online  https://example.invalid/x  [EXTERNAL_REDIRECT]');
    expect(formatReply(reply([scheme]), 'id', 7).join('\n')).toContain('Pinjaman Mikro');
  });

  it('treats zero results as a normal, kind answer', () => {
    const lines = formatReply(reply([]), 'en', 7).join('\n');
    expect(lines).toContain('No matching schemes (based on 7 answered questions)');
    expect(lines).toContain('does not mean');
  });

  it('turns "still worth asking" into the flags to use', () => {
    const lines = formatReply(reply([], ['sector', 'annualTurnoverIdr']), 'en', 1).join('\n');
    expect(lines).toContain('Answer these to see more schemes: --sector --turnover');
    expect(lines).toContain('1 answered question)');
  });
});
