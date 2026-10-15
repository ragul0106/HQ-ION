import { z } from 'zod';
import type { Config } from '../config.js';
import type { SchemeResult } from '../eligibility/engine.js';
import {
  ProfileSchema,
  type Profile,
  type ProfileField,
  type Scheme,
} from '../eligibility/types.js';
import {
  contextUrl,
  DEFAULT_LANGUAGE,
  ELIGIBILITY_CHECK_RESOURCE_ID,
  WIRE_TYPES,
  type Language,
} from './constants.js';

/** What we need from a buyer's `select`. */
const SelectContractSchema = z.looseObject({
  id: z.string().optional(),
  participants: z.array(z.unknown()).optional(),
  contractAttributes: z.looseObject({
    '@type': z.literal(WIRE_TYPES.profile),
    language: z.enum(['en', 'id']).optional(),
    msmeProfile: ProfileSchema,
  }),
});

export interface ParsedSelect {
  contractId: string | undefined;
  participants: unknown[];
  language: Language;
  profile: Profile;
}

export type SelectParseResult =
  { ok: true; value: ParsedSelect } | { ok: false; problems: string[] };

/** Validate a `select` message. Problems name fields and rules, never the values a buyer sent. */
export function parseSelect(message: Record<string, unknown>): SelectParseResult {
  const parsed = z.object({ contract: SelectContractSchema }).safeParse(message);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((i) => `${i.path.join('.') || '(message)'}: ${i.message}`),
    };
  }
  const { contract } = parsed.data;
  return {
    ok: true,
    value: {
      contractId: contract.id,
      participants: contract.participants ?? [],
      language: contract.contractAttributes.language ?? DEFAULT_LANGUAGE,
      profile: contract.contractAttributes.msmeProfile,
    },
  };
}

/** One scheme as it appears inside the eligibility result. */
export function schemeForResult(result: SchemeResult, language: Language) {
  const { scheme } = result;
  return {
    id: scheme.id,
    // Both languages travel, so a front end can switch language without another call.
    name: scheme.name,
    benefit: scheme.benefit,
    why: result.rules.map((r) => r.label),
    documents: scheme.documents,
    fulfillment: scheme.fulfillment,
    // The text in the requested language, for buyers that just want to display it.
    displayName: scheme.name[language],
  };
}

export interface OnSelectInput {
  config: Pick<Config, 'SCHEMA_BASE_URL'>;
  request: ParsedSelect;
  eligible: SchemeResult[];
  stillUnknown: ProfileField[];
}

/** Build the `message` of the `on_select` callback. */
export function buildOnSelectMessage({ config, request, eligible, stillUnknown }: OnSelectInput) {
  const { language } = request;
  const commitments =
    eligible.length > 0
      ? eligible.map((r) => commitmentFor(r.scheme, language))
      : // Beckn requires at least one commitment, so "nothing matched" cannot be an empty list. We send our own
        // placeholder commitment (the eligibility check itself) and say 0 in the result block. It is built here,
        // not echoed from the buyer's request: a buyer may send a minimal commitment, and our reply must be valid
        // on its own (a bug caught by the Postman run: an echoed commitment had no `quantity`).
        // OPEN QUESTION for ION: is there a proper "no results" signal (e.g. BIZ_NO_RESULTS_FOUND)?
        [eligibilityCheckCommitment(language)];

  return {
    contract: {
      id: request.contractId ?? 'eligibility-check',
      status: { code: 'DRAFT' },
      participants: request.participants,
      commitments,
      contractAttributes: {
        '@context': contextUrl(config, 'result'),
        '@type': WIRE_TYPES.result,
        eligibility: {
          eligibleCount: eligible.length,
          language,
          schemes: eligible.map((r) => schemeForResult(r, language)),
          stillUnknownFields: stillUnknown,
        },
      },
    },
  };
}

function commitmentFor(scheme: Scheme, language: Language) {
  return {
    id: `commitment-${scheme.id}`,
    status: { code: 'DRAFT' },
    resources: [
      {
        id: scheme.id,
        descriptor: {
          name: scheme.name[language],
          shortDesc: scheme.benefit[language],
          code: scheme.id,
        },
        quantity: { unitQuantity: 1, unitCode: 'UNIT' },
      },
    ],
    // The Beckn schema requires an offer on every commitment.
    offer: { id: `offer-${scheme.id}`, resourceIds: [scheme.id] },
  };
}

const CHECK_NAME: Record<Language, string> = {
  en: 'Scheme eligibility check',
  id: 'Pemeriksaan kelayakan skema',
};

/** The commitment that stands for the eligibility check itself, used when no scheme matched. */
function eligibilityCheckCommitment(language: Language) {
  return {
    id: 'commitment-eligibility-check',
    status: { code: 'DRAFT' },
    resources: [
      {
        id: ELIGIBILITY_CHECK_RESOURCE_ID,
        descriptor: { name: CHECK_NAME[language], code: ELIGIBILITY_CHECK_RESOURCE_ID },
        quantity: { unitQuantity: 1, unitCode: 'UNIT' },
      },
    ],
    offer: { id: 'offer-eligibility-check', resourceIds: [ELIGIBILITY_CHECK_RESOURCE_ID] },
  };
}
