import { z } from 'zod';

/**
 * The MSME profile a buyer sends (PRD "layer 1": a coarse, structured profile). Every field is optional: a
 * missing field means "not answered yet", which is different from a wrong answer.
 *
 * `.strict()` is deliberate: anything we did not ask for (a phone number, a national ID) is refused, not stored
 * or ignored. That keeps personal data out of this service by construction.
 */
export const PROFILE_FIELD_TYPES = {
  businessType: 'string',
  sector: 'string',
  annualTurnoverIdr: 'number',
  province: 'string',
  workerCount: 'number',
  hasNIB: 'boolean',
  exportsOrPlansToExport: 'boolean',
} as const;

export type ProfileField = keyof typeof PROFILE_FIELD_TYPES;
export const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_TYPES) as [ProfileField, ...ProfileField[]];

export const BUSINESS_TYPES = ['individual', 'CV', 'PT', 'cooperative'] as const;

export const ProfileSchema = z
  .object({
    businessType: z.enum(BUSINESS_TYPES),
    sector: z.string().min(1).max(80),
    annualTurnoverIdr: z.number().int().min(0),
    province: z.string().min(1).max(80),
    workerCount: z.number().int().min(0),
    hasNIB: z.boolean(),
    exportsOrPlansToExport: z.boolean(),
  })
  .partial()
  .strict();

export type Profile = z.infer<typeof ProfileSchema>;

/** Text in both languages (PRD W4: scheme content is bilingual in the catalog model, not just the UI). */
export const I18nSchema = z.object({ en: z.string().min(1), id: z.string().min(1) });
export type I18n = z.infer<typeof I18nSchema>;

export const OPERATORS = ['=', '!=', '>', '>=', '<', '<=', 'IN', 'NOT_IN'] as const;
export type Operator = (typeof OPERATORS)[number];

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/**
 * One eligibility condition. Shape follows the draft ION social-scheme pack (`ruleId`, `operator`, `value`, `unit`,
 * `label`) plus `field`, which says which profile answer the rule reads.
 */
export const RuleSchema = z
  .object({
    ruleId: z.string().min(1),
    field: z.enum(PROFILE_FIELDS),
    operator: z.enum(OPERATORS),
    value: z.union([scalar, z.array(z.union([z.string(), z.number()])).min(1)]),
    unit: z.string().optional(),
    label: I18nSchema,
  })
  .strict()
  .superRefine((rule, ctx) => {
    const fieldType = PROFILE_FIELD_TYPES[rule.field];
    const isList = rule.operator === 'IN' || rule.operator === 'NOT_IN';
    const isOrdering = ['>', '>=', '<', '<='].includes(rule.operator);

    if (isList !== Array.isArray(rule.value)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: isList ? `${rule.operator} needs a list` : `${rule.operator} needs a single value`,
      });
      return;
    }
    const values = Array.isArray(rule.value) ? rule.value : [rule.value];
    if (values.some((v) => typeof v !== fieldType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `${rule.field} is a ${fieldType}; the rule value has a different type`,
      });
    }
    if (isOrdering && fieldType !== 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['operator'],
        message: `${rule.operator} only makes sense for numbers, but ${rule.field} is a ${fieldType}`,
      });
    }
  });

export type Rule = z.infer<typeof RuleSchema>;

export const SchemeSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only'),
    name: I18nSchema,
    benefit: I18nSchema,
    eligibility: z.object({ rules: z.array(RuleSchema).min(1) }).strict(),
    documents: z.array(z.object({ name: I18nSchema, mandatory: z.boolean() }).strict()),
    /** Phase 1 has one type. ASSISTED_APPLICATION / API_SUBMISSION slot in beside it later. */
    fulfillment: z
      .object({
        type: z.literal('EXTERNAL_REDIRECT'),
        url: z.url(),
        instructions: I18nSchema,
      })
      .strict(),
    validity: z
      .object({ from: z.string().min(1), to: z.string().min(1) })
      .strict()
      .optional(),
    /** Marks sample data. The publisher refuses to publish placeholders to the live network. */
    placeholder: z.boolean().default(false),
  })
  .strict()
  .superRefine((scheme, ctx) => {
    const seen = new Set<string>();
    scheme.eligibility.rules.forEach((rule, i) => {
      if (seen.has(rule.ruleId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['eligibility', 'rules', i, 'ruleId'],
          message: `duplicate ruleId ${rule.ruleId}`,
        });
      }
      seen.add(rule.ruleId);
    });
  });

export type Scheme = z.infer<typeof SchemeSchema>;
