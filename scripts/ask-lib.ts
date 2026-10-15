/** Pure helpers for the `ask` tool: command-line flags to a profile, and a reply to readable text. */
import { parseArgs } from 'node:util';
import {
  BUSINESS_TYPES,
  ProfileSchema,
  type Profile,
  type ProfileField,
} from '../src/eligibility/types.js';
import type { Language } from '../src/wire/constants.js';
import type { OnSelect } from './buyer-client.js';

export class AskArgError extends Error {}

export interface AskArgs {
  profile: Profile;
  language: Language;
  json: boolean;
  help: boolean;
}

/** The question a profile field answers, and the flag you use to answer it. */
export const FLAGS: Record<ProfileField, string> = {
  businessType: '--business-type',
  sector: '--sector',
  annualTurnoverIdr: '--turnover',
  province: '--province',
  workerCount: '--workers',
  hasNIB: '--nib',
  exportsOrPlansToExport: '--export',
};

export const HELP = `Ask the Haqdarshak seller which schemes an MSME qualifies for, through the ION buyer adapter.

  npm run ask -- [answers] [options]

Answers (every one is optional; a skipped question is "unknown", not "no"):
  --business-type <individual|CV|PT|cooperative>
  --sector <text>                 e.g. food, beverage, craft, retail
  --turnover <IDR per year>       whole number, e.g. 300000000
  --province <text>               e.g. "Jawa Tengah"
  --workers <number>
  --nib <yes|no>                  does the business have an NIB?
  --export <yes|no>               exports, or plans to?

Options:
  --lang <en|id>                  language of the printed text (default: id)
  --json                          also print the raw on_select message
  --help

Example:
  npm run ask -- --sector food --province "Jawa Tengah" --workers 3 --turnover 300000000 --nib yes --export no
`;

function yesNo(flag: string, value: string): boolean {
  const v = value.toLowerCase();
  if (['yes', 'y', 'true'].includes(v)) return true;
  if (['no', 'n', 'false'].includes(v)) return false;
  throw new AskArgError(`${flag} needs yes or no`);
}

function wholeNumber(flag: string, value: string): number {
  if (!/^\d+$/.test(value))
    throw new AskArgError(`${flag} needs a whole number (digits only), e.g. 300000000`);
  return Number(value);
}

export function parseAskArgs(argv: string[]): AskArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'business-type': { type: 'string' },
        sector: { type: 'string' },
        turnover: { type: 'string' },
        province: { type: 'string' },
        workers: { type: 'string' },
        nib: { type: 'string' },
        export: { type: 'string' },
        lang: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      allowPositionals: false,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A value that starts with "-" (such as -5) looks like another option to the parser; say what is really wrong.
    const flag = /Option '(--[a-z-]+)/.exec(message)?.[1];
    if (flag && message.includes('ambiguous')) {
      const numeric = flag === '--turnover' || flag === '--workers';
      throw new AskArgError(
        `${flag} needs ${numeric ? 'a whole number (digits only)' : 'a value'}`,
      );
    }
    throw new AskArgError(`${message}. Try --help`);
  }

  const lang = values.lang ?? 'id';
  if (lang !== 'en' && lang !== 'id') throw new AskArgError('--lang needs en or id');

  const raw: Record<string, unknown> = {};
  if (values['business-type'] !== undefined) raw.businessType = values['business-type'];
  if (values.sector !== undefined) raw.sector = values.sector;
  if (values.turnover !== undefined)
    raw.annualTurnoverIdr = wholeNumber('--turnover', values.turnover);
  if (values.province !== undefined) raw.province = values.province;
  if (values.workers !== undefined) raw.workerCount = wholeNumber('--workers', values.workers);
  if (values.nib !== undefined) raw.hasNIB = yesNo('--nib', values.nib);
  if (values.export !== undefined) raw.exportsOrPlansToExport = yesNo('--export', values.export);

  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const bad = parsed.error.issues[0];
    const field = String(bad?.path[0] ?? '');
    const hint = field === 'businessType' ? ` (one of: ${BUSINESS_TYPES.join(', ')})` : '';
    throw new AskArgError(`${FLAGS[field as ProfileField] ?? field} is not valid${hint}`);
  }
  return {
    profile: parsed.data,
    language: lang,
    json: values.json === true,
    help: values.help === true,
  };
}

/** Turn an on_select into lines a person can read. */
export function formatReply(reply: OnSelect, language: Language, answered: number): string[] {
  const { eligibility } = reply.message.contract.contractAttributes;
  const t = (text: { en: string; id: string }) => text[language];
  const lines: string[] = [];

  if (eligibility.eligibleCount === 0) {
    lines.push(
      `No matching schemes (based on ${answered} answered question${answered === 1 ? '' : 's'}).`,
    );
    lines.push(
      'This does not mean the business is not entitled to support: schemes and their conditions change.',
    );
  } else {
    lines.push(
      `Eligible for ${eligibility.eligibleCount} scheme${eligibility.eligibleCount === 1 ? '' : 's'}:`,
    );
    eligibility.schemes.forEach((s, i) => {
      lines.push('', `${i + 1}. ${t(s.name)}  [${s.id}]`);
      lines.push(`   Benefit:   ${t(s.benefit)}`);
      lines.push(`   Why:       ${s.why.map(t).join('; ')}`);
      lines.push(
        `   Documents: ${s.documents.map((d) => `${t(d.name)}${d.mandatory ? '' : ' (optional)'}`).join('; ') || 'none'}`,
      );
      const f = s.fulfillment;
      lines.push(
        `   Next step: ${f.instructions ? t(f.instructions) : f.type}${f.url ? `  ${f.url}` : ''}  [${f.type}]`,
      );
    });
  }

  if (eligibility.stillUnknownFields.length > 0) {
    const flags = eligibility.stillUnknownFields
      .map((f) => FLAGS[f as ProfileField] ?? f)
      .join(' ');
    lines.push('', `Answer these to see more schemes: ${flags}`);
  }
  return lines;
}
