# Scheme data

One JSON file per scheme. The seller loads this folder at start-up and checks every file; if any file is invalid it
refuses to start and names the file and the field. Check without starting anything:

```bash
npm run schemes:validate
```

**Everything in this folder is placeholder until the programme team delivers the 15 real schemes.** Placeholder files
carry `"placeholder": true`, and the publisher refuses to send them to the live network (`ION_ENV=live`).

## Format

```json
{
  "id": "FAKE-SCH-001",
  "name": { "en": "...", "id": "..." },
  "benefit": { "en": "...", "id": "..." },
  "eligibility": {
    "rules": [
      {
        "ruleId": "R1",
        "field": "annualTurnoverIdr",
        "operator": "<=",
        "value": 2000000000,
        "unit": "IDR",
        "label": { "en": "Annual turnover up to IDR 2 billion", "id": "Omzet tahunan hingga Rp2 miliar" }
      }
    ]
  },
  "documents": [{ "name": { "en": "NIB", "id": "NIB" }, "mandatory": true }],
  "fulfillment": {
    "type": "EXTERNAL_REDIRECT",
    "url": "https://...",
    "instructions": { "en": "...", "id": "..." }
  },
  "placeholder": true
}
```

- **All text is bilingual** (`en` and `id`). A file with a missing translation is refused.
- **Every rule must hold** for a scheme to match. `field` is one of: `businessType`, `sector`, `annualTurnoverIdr`,
  `province`, `workerCount`, `hasNIB`, `exportsOrPlansToExport`.
- **Operators:** `=`, `!=`, `>`, `>=`, `<`, `<=` (numbers only for the four ordering ones), `IN`, `NOT_IN` (value is a
  list). The value must have the same type as the field. For a range, use two rules (`>=` and `<=`).
- `fulfillment.type` is `EXTERNAL_REDIRECT` in Phase 1. More types slot in later.
- Unknown keys are refused, so a typo cannot silently drop a rule.
- `label` is what the buyer shows the user as the reason the scheme matched, and it is also what the catalog
  publishes as the scheme's public criteria. The rules themselves (operators and thresholds) are never published.

## Updating without a deploy

Edit the files, run `npm run schemes:validate`, then `kill -HUP <seller pid>`. A bad reload is refused and the
previous schemes stay active.
