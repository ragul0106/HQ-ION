import type { Config } from '../config.js';
import type { Scheme } from '../eligibility/types.js';
import { contextUrl, WIRE_TYPES } from '../wire/constants.js';

export const CATALOG_NAME = 'HQ-MSME-SCHEMES';

/** Used for offers of schemes that declare no validity. PLACEHOLDER until the programme team gives real dates. */
const DEFAULT_VALIDITY = { startDate: '2026-11-01T00:00:00Z', endDate: '2027-12-31T23:59:59Z' };

const PROVIDER = {
  id: 'PROV-HAQDARSHAK',
  descriptor: { name: 'Haqdarshak Empowerment Solutions Pvt Ltd' },
};

type CatalogConfig = Pick<Config, 'BPP_ID' | 'BPP_URI' | 'NETWORK_ID' | 'SCHEMA_BASE_URL'>;

/**
 * The shop window: our schemes as a Beckn catalog, built from the same scheme files the rules engine reads, so
 * the two cannot drift apart.
 *
 * Only human-readable criteria go in (the same text a government scheme page shows). The matching logic stays
 * inside this service: the network carries the question and the answer, not the logic (PRD, two layers of
 * eligibility). Deterministic: the same files always give the same catalog, so republishing changes nothing.
 */
export function buildCatalog(config: CatalogConfig, schemes: readonly Scheme[]) {
  const catalogId = `${config.BPP_ID}/${CATALOG_NAME}`;
  return {
    context: { action: 'catalog/publish' },
    message: {
      catalogs: [
        {
          id: catalogId,
          bppId: config.BPP_ID,
          bppUri: config.BPP_URI,
          isActive: true,
          descriptor: {
            name: 'Haqdarshak MSME schemes',
            shortDesc: 'Government schemes for micro, small and medium businesses',
          },
          provider: PROVIDER,
          resources: schemes.map((s) => ({
            id: s.id,
            // Bahasa first, as the PRD recommends for the pilot. Both languages are in resourceAttributes.
            descriptor: { name: s.name.id, shortDesc: s.benefit.id },
            provider: PROVIDER,
            resourceAttributes: {
              '@context': contextUrl(config, 'scheme'),
              '@type': WIRE_TYPES.scheme,
              name: s.name,
              benefit: s.benefit,
              eligibilityCriteria: s.eligibility.rules.map((r) => r.label),
              documents: s.documents,
              fulfillment: s.fulfillment,
            },
          })),
          offers: schemes.map((s) => ({
            id: `OFFER-${s.id}`,
            descriptor: { name: s.name.id },
            resourceIds: [s.id],
            provider: PROVIDER,
            validity: s.validity
              ? { startDate: s.validity.from, endDate: s.validity.to }
              : DEFAULT_VALIDITY,
          })),
        },
      ],
      publishDirectives: [{ catalogId, visibleTo: [config.NETWORK_ID], catalogType: 'REGULAR' }],
    },
  };
}

export type CatalogRequest = ReturnType<typeof buildCatalog>;
