import type { Config } from '../config.js';

/**
 * The "wire" module is the only place that knows the shape of the messages we exchange. When ION confirms the
 * government-benefits schema (see docs/PLAN.md, open questions 1 and 2) this folder changes and nothing else does.
 *
 * TEMPORARY: the three types below are our own stand-in schemas, served from deploy/onix/schemas.
 */
export const WIRE_TYPES = {
  /** The MSME profile a buyer sends in `select`. Attaches to Contract.contractAttributes. */
  profile: 'HqMsmeProfile',
  /** The seller's answer in `on_select`. Attaches to Contract.contractAttributes. */
  result: 'HqEligibilityResult',
  /** A government scheme as a catalog item. Attaches to Resource.resourceAttributes. */
  scheme: 'HqScheme',
} as const;

export type WireType = keyof typeof WIRE_TYPES;

export function contextUrl(config: Pick<Config, 'SCHEMA_BASE_URL'>, type: WireType): string {
  return `${config.SCHEMA_BASE_URL.replace(/\/$/, '')}/${WIRE_TYPES[type]}/v0/context.jsonld`;
}

/** The one placeholder item a buyer "selects" when it only wants an eligibility check (Beckn needs >= 1 commitment). */
export const ELIGIBILITY_CHECK_RESOURCE_ID = 'HQ-ELIGIBILITY-CHECK';

export type Language = 'en' | 'id';
/** PRD recommendation: Bahasa Indonesia by default for the pilot. */
export const DEFAULT_LANGUAGE: Language = 'id';
