import { z } from 'zod';
import {
  PROFILE_FIELD_TYPES,
  PROFILE_FIELDS,
  type ProfileField,
  type Rule,
  type Scheme,
} from './types.js';

/**
 * The scheme FILE format: the `resourceAttributes` block of the draft ION social-scheme pack (`SVC-social`, from
 * `ion-services-social-schemes`, resource/v1/attributes.yaml), plus a small `haqdarshak` block for what the pack
 * has no place for. The loader turns a file into the internal `Scheme` the engine reads.
 *
 * What comes from the pack, and why it is not changed: the pack is the network's shape for a scheme, and the
 * pack's blocks are `additionalProperties: false`. So nothing of ours may sit inside `resourceAttributes`.
 * The pack is single-language (text in Bahasa) and its rule `value` is a string, number or list of strings.
 *
 * What the `haqdarshak` block holds:
 *   ruleFields    which profile answer each pack rule reads (the pack's rules do not say)
 *   translations  the English text (Bahasa is the pack text)
 *   fulfillment   the Phase 1 `EXTERNAL_REDIRECT` block; its URL is `applicationChannel.governmentPortalUrl`
 *
 * DRAFT: the pack is not merged into ion-specs and its owner has not confirmed it is the government-benefits spec.
 */

const SCHEME_LEVELS = ['CENTRAL', 'PROVINCIAL', 'DISTRICT', 'VILLAGE'] as const;
const AGENCY_LEVELS = [
  'NATIONAL_MINISTRY',
  'PROVINCIAL_AGENCY',
  'DISTRICT_AGENCY',
  'VILLAGE_BODY',
  'SOE',
  'NGO_PARTNER',
] as const;
const SCHEME_TYPES = [
  'CASH_TRANSFER',
  'SUBSIDY',
  'PENSION',
  'SCHOLARSHIP',
  'INSURANCE_PROTECTION',
  'DOCUMENT_ISSUANCE',
  'LOAN_INTEREST_SUBSIDY',
  'IN_KIND_BENEFIT',
  'SKILL_TRAINING',
  'LEGAL_AID',
  'HEALTHCARE_BENEFIT',
  'HOUSING_BENEFIT',
  'FOOD_ASSISTANCE',
  'DISABILITY_SUPPORT',
  'OTHER',
] as const;
const FUNDING_MODELS = [
  'APBN_CENTRAL_BUDGET',
  'APBD_REGIONAL_BUDGET',
  'CENTRALLY_SPONSORED_COFUNDED',
  'SOE_CSR',
  'NGO_PHILANTHROPIC',
  'MULTILATERAL_GRANT',
] as const;
const SECTOR_TAGS = [
  'AGRICULTURE',
  'HEALTH',
  'EDUCATION',
  'HOUSING',
  'EMPLOYMENT',
  'MSME',
  'FISHERIES',
  'DISABILITY',
  'ELDERLY',
  'WOMEN_AND_CHILDREN',
] as const;
const BENEFICIARY_TYPES = [
  'INDIVIDUAL',
  'HOUSEHOLD',
  'FAMILY',
  'MICRO_ENTERPRISE',
  'FARMER_GROUP',
  'FISHERFOLK_GROUP',
  'SELF_HELP_GROUP',
  'COOPERATIVE',
  'EDUCATIONAL_INSTITUTION',
  'VILLAGE_INSTITUTION',
] as const;
const BENEFIT_FORMS = [
  'CASH',
  'VOUCHER',
  'IN_KIND_GOODS',
  'SERVICE_DELIVERY',
  'DOCUMENT',
  'PREMIUM_SUBSIDY',
  'INTEREST_SUBSIDY',
  'FEE_WAIVER',
] as const;
const DOCUMENT_TYPES = [
  'KTP',
  'KARTU_KELUARGA',
  'NIK',
  'SURAT_DOMISILI',
  'SURAT_KETERANGAN_TIDAK_MAMPU',
  'BUKU_TABUNGAN',
  'AKTA_KELAHIRAN',
  'SERTIFIKAT_TANAH',
  'KARTU_PENYANDANG_DISABILITAS',
  'KARTU_KELUARGA_SEJAHTERA',
  'NPWP',
  'IJAZAH',
  'SURAT_NIKAH',
  'FOTO_RUMAH',
  'OTHER',
] as const;
const OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT_IN'] as const;

/** The pack's `EligibilityRule`: `value` is a string, a number or a list of strings (never a boolean). */
const PackRuleSchema = z
  .object({
    ruleId: z.string().min(1),
    label: z.string().min(1),
    operator: z.enum(OPERATORS),
    value: z.union([z.string(), z.number(), z.array(z.string()).min(1)]),
    unit: z.string().optional(),
  })
  .strict();
type PackRule = z.infer<typeof PackRuleSchema>;

const PackResourceAttributesSchema = z
  .object({
    '@context': z.string().min(1),
    '@type': z.literal('ion:IONSocialSchemeResource'),
    crc: z.literal('SVC-social'),
    schemeIdentity: z
      .object({
        schemeName: z.string().min(1),
        schemeCode: z.string().optional(),
        implementingAgency: z.string().min(1),
        implementingAgencyLevel: z.enum(AGENCY_LEVELS).optional(),
        schemeLevel: z.enum(SCHEME_LEVELS),
        schemeType: z.enum(SCHEME_TYPES),
        fundingModel: z.enum(FUNDING_MODELS),
        sectorTags: z.array(z.enum(SECTOR_TAGS)).optional(),
        officialReferenceUrl: z.url().optional(),
      })
      .strict(),
    eligibility: z
      .object({
        targetBeneficiaryTypes: z.array(z.enum(BENEFICIARY_TYPES)).min(1),
        demographicCriteria: z.array(PackRuleSchema).default([]),
        economicCriteria: z.array(PackRuleSchema).default([]),
        occupationalCriteria: z.array(PackRuleSchema).default([]),
        geographicEligibility: z
          .object({
            residencyRequired: z.boolean(),
            applicableProvinces: z.array(z.string().min(1)).optional(),
            applicableKabupatenKota: z.array(z.string().min(1)).optional(),
            domicileMatchBasis: z.enum(['KTP', 'KARTU_KELUARGA', 'SURAT_DOMISILI']).optional(),
          })
          .strict()
          .optional(),
        priorityGroups: z.array(z.string()).optional(),
        eligibilitySummary: z.string().min(1),
      })
      .strict(),
    benefit: z
      .object({
        benefitForm: z.enum(BENEFIT_FORMS),
        benefitAmount: z
          .object({ value: z.number().min(0), currency: z.string().min(1) })
          .strict()
          .optional(),
        benefitAmountBasis: z
          .enum([
            'FIXED',
            'MEANS_TESTED',
            'TIERED_BY_HOUSEHOLD_SIZE',
            'PERCENT_OF_COST',
            'PER_COMPONENT',
          ])
          .optional(),
        disbursementFrequency: z
          .enum([
            'ONE_TIME',
            'MONTHLY',
            'QUARTERLY',
            'SEMIANNUAL',
            'ANNUAL',
            'PER_ACADEMIC_YEAR',
            'ON_CLAIM',
          ])
          .optional(),
        benefitDescription: z.string().min(1),
      })
      .strict(),
    requiredDocuments: z.array(
      z
        .object({
          documentType: z.enum(DOCUMENT_TYPES),
          purpose: z.string().min(1),
          mandatory: z.boolean(),
          conditionRuleId: z.string().optional(),
        })
        .strict(),
    ),
    applicationChannel: z
      .object({
        applicationMode: z.enum(['FACILITATED', 'SELF_SERVICE', 'HYBRID']),
        governmentPortalUrl: z.url(),
        applicationWindow: z.enum(['ROLLING', 'FIXED_WINDOW', 'ANNUAL_REVERIFICATION']).optional(),
        processingTimeEstimate: z.string().optional(),
      })
      .strict(),
    validity: z
      .object({
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        effectiveUntil: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        requiresAnnualReverification: z.boolean().optional(),
      })
      .strict()
      .optional(),
    fundingSource: z
      .object({
        budgetLineReference: z.string().optional(),
        fiscalYear: z.string().optional(),
        cofundingAgencies: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    indonesianCompliance: z
      .object({
        dtksReference: z.boolean().optional(),
        dtksDecileRequirement: z.array(z.number().int().min(1).max(10)).optional(),
        nikVerificationRequired: z.boolean().optional(),
        kksRequired: z.boolean().optional(),
        disbursementChannel: z
          .enum([
            'BANK_HIMBARA_ACCOUNT',
            'KARTU_KOMBO_KKS',
            'KANTOR_POS',
            'AGEN_BRILINK_SEJENIS',
            'IN_KIND_DELIVERY',
            'DIRECT_SERVICE',
          ])
          .optional(),
        dataResidency: z.literal('DOMESTIC_ONLY'),
        regulatoryBasis: z
          .array(
            z
              .object({
                instrumentType: z.enum([
                  'UU',
                  'PP',
                  'PERPRES',
                  'PERMENSOS',
                  'PERMEN',
                  'PERDA',
                  'KEPMEN',
                ]),
                reference: z.string().min(1),
                title: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();

export type PackResourceAttributes = z.infer<typeof PackResourceAttributesSchema>;

const I18n = z.object({ en: z.string().min(1), id: z.string().min(1) }).strict();

const HaqdarshakBlockSchema = z
  .object({
    /** ruleId (as in the pack block) to the profile answer the rule reads. */
    ruleFields: z.record(z.string(), z.enum(PROFILE_FIELDS)),
    /** Used for the rule made from `geographicEligibility.applicableProvinces` (the pack gives that rule no label). */
    geographicLabel: I18n.optional(),
    translations: z
      .object({
        en: z
          .object({
            schemeName: z.string().min(1),
            benefitDescription: z.string().min(1),
            eligibilitySummary: z.string().min(1),
            ruleLabels: z.record(z.string(), z.string().min(1)),
            /** One entry per `requiredDocuments` entry, same order. */
            documentPurposes: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),
    fulfillment: z.object({ type: z.literal('EXTERNAL_REDIRECT'), instructions: I18n }).strict(),
  })
  .strict();

export const GEOGRAPHIC_RULE_ID = 'geographic-province';

export const SchemeFileSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only'),
    placeholder: z.boolean().default(false),
    resourceAttributes: PackResourceAttributesSchema,
    haqdarshak: HaqdarshakBlockSchema,
  })
  .strict()
  .transform((file, ctx): Scheme => {
    const { resourceAttributes: pack, haqdarshak: hq } = file;
    const en = hq.translations.en;
    const fail = (path: (string | number)[], message: string): never => {
      ctx.addIssue({ code: 'custom', path, message });
      return z.NEVER;
    };

    const rules: Rule[] = [];
    const criteria = [
      ['demographicCriteria', pack.eligibility.demographicCriteria],
      ['economicCriteria', pack.eligibility.economicCriteria],
      ['occupationalCriteria', pack.eligibility.occupationalCriteria],
    ] as const;
    const usedRuleIds = new Set<string>();
    for (const [group, list] of criteria) {
      list.forEach((r, i) => {
        const at = ['resourceAttributes', 'eligibility', group, i];
        const field: ProfileField | undefined = hq.ruleFields[r.ruleId];
        if (!field) fail([...at, 'ruleId'], `no entry for ${r.ruleId} in haqdarshak.ruleFields`);
        const label = en.ruleLabels[r.ruleId];
        if (!label) fail([...at, 'ruleId'], `no English label for ${r.ruleId} in translations`);
        const value = coerceValue(r, field as ProfileField);
        if (value === undefined) {
          fail(
            [...at, 'value'],
            `${field} is a ${PROFILE_FIELD_TYPES[field as ProfileField]}; the rule value cannot be read as one`,
          );
        }
        if (usedRuleIds.has(r.ruleId)) fail([...at, 'ruleId'], `duplicate ruleId ${r.ruleId}`);
        usedRuleIds.add(r.ruleId);
        rules.push({
          ruleId: r.ruleId,
          field: field as ProfileField,
          operator: r.operator,
          value: value as Rule['value'],
          ...(r.unit ? { unit: r.unit } : {}),
          label: { id: r.label, en: label as string },
        });
      });
    }
    for (const ruleId of Object.keys(hq.ruleFields)) {
      if (!usedRuleIds.has(ruleId)) {
        fail(['haqdarshak', 'ruleFields', ruleId], 'does not match any rule in resourceAttributes');
      }
    }

    // The pack puts "which provinces" in `geographicEligibility`, not in a rule. The engine needs a rule.
    const provinces = pack.eligibility.geographicEligibility?.applicableProvinces ?? [];
    if (provinces.length > 0) {
      if (!hq.geographicLabel) {
        fail(['haqdarshak', 'geographicLabel'], 'needed because applicableProvinces is set');
      }
      rules.push({
        ruleId: GEOGRAPHIC_RULE_ID,
        field: 'province',
        operator: 'IN',
        value: provinces,
        label: hq.geographicLabel as { en: string; id: string },
      });
    }

    if (rules.length === 0) {
      fail(['resourceAttributes', 'eligibility'], 'a scheme needs at least one eligibility rule');
    }

    if (en.documentPurposes.length !== pack.requiredDocuments.length) {
      fail(
        ['haqdarshak', 'translations', 'en', 'documentPurposes'],
        'needs one English purpose per entry in requiredDocuments, in the same order',
      );
    }
    for (const [i, d] of pack.requiredDocuments.entries()) {
      if (d.conditionRuleId && !usedRuleIds.has(d.conditionRuleId)) {
        fail(['resourceAttributes', 'requiredDocuments', i, 'conditionRuleId'], 'unknown ruleId');
      }
    }

    if (pack.applicationChannel.applicationMode !== 'SELF_SERVICE') {
      fail(
        ['resourceAttributes', 'applicationChannel', 'applicationMode'],
        'Phase 1 is a redirect to the official site, so this must be SELF_SERVICE',
      );
    }

    const { validity } = pack;
    return {
      id: file.id,
      name: { id: pack.schemeIdentity.schemeName, en: en.schemeName },
      benefit: { id: pack.benefit.benefitDescription, en: en.benefitDescription },
      eligibility: { rules },
      documents: pack.requiredDocuments.map((d, i) => ({
        name: { id: d.purpose, en: en.documentPurposes[i] as string },
        mandatory: d.mandatory,
      })),
      fulfillment: {
        type: hq.fulfillment.type,
        url: pack.applicationChannel.governmentPortalUrl,
        instructions: hq.fulfillment.instructions,
      },
      ...(validity
        ? {
            validity: {
              from: `${validity.effectiveFrom}T00:00:00Z`,
              to: `${validity.effectiveUntil ?? '2099-12-31'}T23:59:59Z`,
            },
          }
        : {}),
      placeholder: file.placeholder,
      resourceAttributes: pack,
    };
  });

/**
 * The pack's rule values are strings, numbers or lists of strings. Our profile answers are typed, so read the value
 * as the profile field's type: "true"/"false" for a yes/no field, a number (or numeric string) for a number field.
 * Returns undefined when it cannot be read.
 */
function coerceValue(rule: PackRule, field: ProfileField): Rule['value'] | undefined {
  const type = PROFILE_FIELD_TYPES[field];
  const one = (v: string | number): string | number | boolean | undefined => {
    if (type === 'string') return typeof v === 'string' ? v : undefined;
    if (type === 'number') {
      const n = typeof v === 'number' ? v : v.trim() === '' ? NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    if (v === 'true' || v === 'false') return v === 'true';
    return undefined;
  };
  if (Array.isArray(rule.value)) {
    const out = rule.value.map(one);
    return out.every((v) => typeof v === 'string' || typeof v === 'number')
      ? (out as (string | number)[])
      : undefined;
  }
  return one(rule.value);
}
