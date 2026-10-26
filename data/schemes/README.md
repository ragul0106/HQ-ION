# Scheme data

One JSON file per scheme. The seller loads this folder at start-up and checks every file; if any file is invalid it
refuses to start and names the file and the field. Check without starting anything:

```bash
npm run schemes:validate
```

**Everything in this folder is placeholder until the programme team delivers the 15 real schemes.** Placeholder files
carry `"placeholder": true`, and the publisher refuses to send them to the live network (`ION_ENV=live`).

## Format (the draft ION `SVC-social` pack)

Since 2026-10-16 a scheme file is the `resourceAttributes` block of the draft ION social-scheme pack
(`ion-services-social-schemes`, `services-extension/resource/v1/attributes.yaml`) plus a small `haqdarshak` block.
**The pack is a draft: not merged into `ion-specs`, and not yet confirmed as the government-benefits spec.**
Use `FAKE-SCH-004.json` as the template.

```text
{
  "id": "...", "placeholder": true,
  "resourceAttributes": {            // the pack's shape, text in Bahasa. Strict: no extra keys.
    "@context", "@type": "ion:IONSocialSchemeResource", "crc": "SVC-social",
    "schemeIdentity":  { schemeName, implementingAgency, schemeLevel, schemeType, fundingModel, ... },
    "eligibility":     { targetBeneficiaryTypes, demographicCriteria[], economicCriteria[],
                         occupationalCriteria[], geographicEligibility?, eligibilitySummary },
    "benefit":         { benefitForm, benefitDescription, benefitAmount?, ... },
    "requiredDocuments": [ { documentType, purpose, mandatory } ],
    "applicationChannel": { applicationMode: "SELF_SERVICE", governmentPortalUrl, ... },
    "validity"?, "fundingSource"?, "indonesianCompliance": { dataResidency: "DOMESTIC_ONLY", ... }
  },
  "haqdarshak": {                    // what the pack has no place for; never published
    "ruleFields":   { "<ruleId>": "<profile field>" },
    "translations": { "en": { schemeName, benefitDescription, eligibilitySummary,
                              ruleLabels: { "<ruleId>": "..." }, documentPurposes: [ ... ] } },
    "geographicLabel": { en, id },   // only when geographicEligibility.applicableProvinces is set
    "fulfillment": { "type": "EXTERNAL_REDIRECT", "instructions": { en, id } }
  }
}
```

- **A rule** is the pack's `{ruleId, label, operator, value, unit}` inside one of the three criteria lists.
  `haqdarshak.ruleFields` says which profile answer it reads: `businessType`, `sector`, `annualTurnoverIdr`, `province`,
  `workerCount`, `hasNIB`, `exportsOrPlansToExport`. Every rule needs a `ruleFields` entry and an English label.
- **Rule values** follow the pack: a string, a number, or a list of strings. A yes/no answer is written `"true"` or
  `"false"`; a list of numbers is written as strings. The loader reads them as the profile field's type.
- **Operators:** `=`, `!=`, `>`, `>=`, `<`, `<=` (numbers only for the four ordering ones), `IN`, `NOT_IN`. For a range use
  two rules. **Every rule must hold** for a scheme to match (no OR yet).
- **Province** is not a rule in the pack: list names in `geographicEligibility.applicableProvinces`; the loader makes a
  rule `geographic-province` from it. (The pack describes these as BPS province codes; our profile sends names.)
- **Language:** the pack text is Bahasa (`id`); English comes from `haqdarshak.translations.en`. A missing translation is
  refused. `requiredDocuments` and `documentPurposes` are matched by position.
- **The redirect:** Phase 1 is `applicationMode: "SELF_SERVICE"` and the link is `applicationChannel.governmentPortalUrl`.
  `FACILITATED` (a caseworker applies for the user) is refused.
- **Documents:** the pack has no `NIB` type; use `OTHER` with a clear `purpose`.
- Unknown keys are refused everywhere, so a typo cannot silently drop a rule. Errors name the file and the field, never
  the value.
- Public criteria for the catalog are the rule labels; the thresholds and operators are never published.

## Updating without a deploy

Edit the files, run `npm run schemes:validate`, then `kill -HUP <seller pid>`. A bad reload is refused and the
previous schemes stay active.
