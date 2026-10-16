/**
 * Pure helpers for the one-call demo endpoints served by `npm run listen`:
 *   POST /check   one call in, the matching schemes out (what a buyer app's backend does for its front end)
 *   GET  /catalog every scheme we publish
 */
import { ProfileSchema, type Profile } from '../src/eligibility/types.js';
import type { Language } from '../src/wire/constants.js';
import type { OnSelect } from './buyer-client.js';

export type CheckRequest =
  { ok: true; profile: Profile; language: Language } | { ok: false; error: string };

/** Read the body of POST /check. Errors name the field and the rule, never the value that was sent. */
export function parseCheckBody(body: unknown): CheckRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'send a JSON object like {"profile": {"sector": "food"}}' };
  }
  const { profile, language } = body as { profile?: unknown; language?: unknown };
  if (language !== undefined && language !== 'en' && language !== 'id') {
    return { ok: false, error: 'language must be "en" or "id"' };
  }
  const parsed = ProfileSchema.safeParse(profile ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `profile.${issue.path.join('.')}` : 'profile';
    return { ok: false, error: `${where}: ${issue?.message ?? 'invalid'}` };
  }
  return { ok: true, profile: parsed.data, language: language ?? 'en' };
}

interface Text {
  en: string;
  id: string;
}

/** The answer from the seller, flattened into the chosen language so it reads well in Postman. */
export function shapeAnswer(reply: OnSelect, language: Language) {
  const e = reply.message.contract.contractAttributes.eligibility;
  return {
    eligibleCount: e.eligibleCount,
    schemes: e.schemes.map((s) => ({
      id: s.id,
      name: s.name[language],
      benefit: s.benefit[language],
      whyYouQualify: s.why.map((w) => w[language]),
      documents: s.documents.map((d) => ({ name: d.name[language], mandatory: d.mandatory })),
      nextStep: {
        type: s.fulfillment.type,
        url: s.fulfillment.url,
        instructions: s.fulfillment.instructions?.[language],
      },
    })),
    stillWorthAsking: e.stillUnknownFields,
  };
}

/** The part of the published catalog file that we show. */
export interface CatalogFile {
  catalog: {
    id: string;
    resources: {
      id: string;
      resourceAttributes: {
        name: Text;
        benefit: Text;
        eligibilityCriteria: Text[];
        documents: { name: Text; mandatory: boolean }[];
        fulfillment: { type: string; url?: string; instructions?: Text };
      };
    }[];
  };
}

/** Every scheme in the published catalog: the shop window, the same for everyone. */
export function shapeCatalog(file: CatalogFile, language: Language) {
  return {
    source:
      'the catalog our seller adapter published: what ION Discovery Service will index once our identity is registered',
    catalogId: file.catalog.id,
    count: file.catalog.resources.length,
    schemes: file.catalog.resources.map((r) => ({
      id: r.id,
      name: r.resourceAttributes.name[language],
      benefit: r.resourceAttributes.benefit[language],
      criteria: r.resourceAttributes.eligibilityCriteria.map((c) => c[language]),
      documents: r.resourceAttributes.documents.map((d) => ({
        name: d.name[language],
        mandatory: d.mandatory,
      })),
      nextStep: {
        type: r.resourceAttributes.fulfillment.type,
        url: r.resourceAttributes.fulfillment.url,
        instructions: r.resourceAttributes.fulfillment.instructions?.[language],
      },
    })),
  };
}
