# Plan: Haqdarshak seller (BPP) on ION

Last updated: 2026-10-15. Demo day: **17 November 2026**. Source: the "Haqdarshak on ION, Phase 1 build note" (PRD).

## 1. What we are building

The PRD's **A. Haqdarshak BPP** (seller side). The buyer app (B) follows once the seller works.

**Done when:** a buyer on the ION sandbox (later the pilot) can find Haqdarshak's 15 MSME schemes, send an MSME
profile, and get back only the schemes that profile qualifies for, each with the reasons, the documents and an
official link. Every message is signed by the ONIX adapter, logged by transaction ID, and visible in the logs.

**Out of scope (PRD section 05):** ministry integrations, application submission or tracking, `init` / `confirm` /
`status` flows (routes are scaffolded and answer "unsupported"), OTP, the partner API (Phase 2), citizen schemes,
payments, document upload, admin portal.

## 2. Architecture

```
ION network ──► ONIX seller adapter (Docker, ION's software) ──webhook──► THIS APP  /api/webhook/<action>
                  verifies signature, validates schema                        │ ACK now, work after
ION network ◄── ONIX seller adapter ◄── POST /bpp/caller/on_<action> ◄────────┘
                  signs the reply
catalog:  THIS APP ── POST /catalog/publish ──► ONIX adapter ──► signed catalog files ──► crawled by ION
```

- The adapter does signing, verification, schema checks and routing. We never touch keys.
- This app is **stateless**: it stores no profile and logs none (PRD data-residency rule).
- Scheme data is a set of JSON files, validated on load.

## 3. Decisions

| Area          | Decision                                                                              | Why                                                            |
| ------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Language      | **TypeScript on Node 22 LTS**, **NestJS** (on the Fastify adapter), zod, pino, vitest | Typed message shapes; same language as the front end           |
| Adapter       | ION's **ONIX adapter** in Docker, unchanged, version pinned                           | Do not reimplement signing and validation                      |
| Scheme store  | Versioned **JSON files**, validated on load, reloadable without a deploy              | PRD: a reviewed CSV/JSON import is enough for 15 schemes       |
| Personal data | None stored, none logged; scrubbed by key name as a safety net                        | PRD W5                                                         |
| Config        | Environment variables only; `ION_ENV` and `DATA_REGION` required, no default          | PRD W1/W5; a live run must be deliberate                       |
| Logging       | One JSON line per protocol message (`logProtocol`), ids and outcome, no payload       | PRD W1: "on demo day this is the only thing that will save us" |

## 4. Milestones

| When             | Milestone                    | Done means                                                                                                                          |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Wk 1 (to 17 Oct) | **M0 Foundations**           | Repo scaffolded, config and logging, stub routes, tests and lint, CI, open questions sent                                           |
| Wk 2 (20-24 Oct) | **M1 Local seller**          | Rules engine over scheme files, `select` handler, catalog build and publish locally, first signed round trip on the ION **testnet** |
| Wk 3 (27-31 Oct) | **M2 On the ION sandbox**    | Own Devlabs seller profile and keys, public address, real registry and catalog crawl, confirmed ION schema adopted                  |
| Wk 4 (3-7 Nov)   | **M3 Content and hardening** | The 15 real schemes in Bahasa and English, retries and timeouts, error handling, **feature freeze at the end of the week**          |
| Wk 5 (10-14 Nov) | **M4 Pilot rehearsal**       | Tested on the pilot environment, demo run twice on the real environment                                                             |
| 17 Nov           | Demo                         |                                                                                                                                     |

### M0 checklist

- [x] Repo scaffold: TypeScript, ESLint, Prettier, vitest, `npm run check`
- [x] Env-validated config (`ION_ENV`, `DATA_REGION` required)
- [x] Structured logging with personal-data scrubbing and a protocol logger
- [x] Webhook route with envelope validation, ACK/NACK, stub answers for every action we do not implement
- [x] Tests for config, logging and the server
- [x] CI workflow (`.github/workflows/ci.yml`; not yet run on GitHub)
- [ ] Open questions sent to the project lead / ION team (section 6)

### M1 checklist

- [x] Scheme files (one JSON per scheme, bilingual, `placeholder` flag) with a validating loader: all-or-nothing, names file and field, never echoes values
- [x] Rules engine with reasons: per-rule met / failed / unknown; scheme eligible / possible / excluded; "still worth asking" list
- [x] Real `select` handler: validate, ACK at once, evaluate, send `on_select` through the adapter; profile never stored or logged
- [x] Callback sender: retries network errors and 5xx with backoff, never 4xx; keeps the request's transactionId and messageId
- [x] Catalog builder and publisher (deterministic; public criteria only; placeholders refused on `live`)
- [x] `scripts/onix-config.ts`: our changes to ION's testnet config, repeatable and tested
- [x] Live round trip on the ION testnet: `npm run roundtrip -- all` passes 5/5 (3 / 2 / 0 / 0 schemes, personal data refused)
- [x] Catalog files verified as a crawler would: digest matches, signature valid
- [ ] Real schema: swap the `src/wire/` stand-ins for ION's government-benefits schema (blocked on open questions 1 and 2)
- [ ] The 15 real schemes (blocked on the programme team)

M1 findings worth remembering:

- The adapter checks every message against the Beckn base schema: `select` needs at least one commitment, and every commitment needs an `offer`.
- Every `...Attributes` block needs `@context` and `@type`; the adapter downloads the schema from an allow-listed host.
- An empty commitments list is invalid in a reply, so "no results" sends the seller's own complete placeholder commitment and carries `eligibleCount: 0` (open question 4). It must not echo the buyer's commitment: a minimal one lacks `quantity` and the adapter rejects the reply (found by the Postman run, which calls the webhook directly; through ION the buyer adapter already refuses an incomplete commitment, so the seller only meets one on a direct call. Guarded by a unit test and by `npm run roundtrip -- all`).
- The buyer adapter's schema check already refuses unknown profile fields (`SCH_FIELD_NOT_ALLOWED`); the seller refuses them again (defence in depth).

## 5. Open questions (blockers for the data model)

1. **Is `ion-services-social-schemes` (CRC `SVC-social`, sector `ion:services`) the government-benefits spec the PRD
   says is coming?** If not, where is that spec?
2. **MSME applicant profile.** That draft's applicant profile requires a national ID number and full name and has
   no business fields (NIB, turnover, sector, workers). The PRD is MSME-only with minimal personal data. Will an MSME
   profile exist?
3. **How discovery reaches the seller.** Does the ION Discover service answer only from crawled catalogs, or does it
   ever call the seller? (Decides where the rules engine can run.)
4. **"No results" signal.** The reply schema rejects an empty commitment list. What is the proper way to say "nothing
   matched" (for example `BIZ_NO_RESULTS_FOUND`)?
5. **India reuse decision (PRD, week 1):** can the India scheme database and rules engine hold NIB, business class,
   provincial variation and turnover bands without contortion?
6. **What is `on_publish`?** It appears in the adapter's seller routing. Presumably a catalog publish or crawl
   notification; unconfirmed.
7. **Devlabs:** a Seller App profile and sandbox keys are needed (only buyer profiles exist today).
8. **Programme team:** the 15 schemes with structured rules, documents and official links (due week 1).

9. **Catalog refresh.** The index carries a `next_update` (14 days by default). Refreshing it means republishing an unchanged catalog, which in
   the testnet adapter leaves the index's `latest` entry pointing at a stale file (digest mismatch). Is that a known issue, and what is the intended refresh path?

## 6. Risks

| Risk                                                                                                                  | Mitigation                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec arrives late or differs from our assumptions                                                                     | Keep the data model behind one mapping module so a schema change touches one place                                                                                                                                                                  |
| The adapter downloads domain schemas at validation time (first call about 10 s)                                       | Cache or mirror schemas; warm the cache before the demo                                                                                                                                                                                             |
| A callback fails validation on demo day                                                                               | Contract tests against the real schemas; the log line by transaction ID                                                                                                                                                                             |
| Five weeks is tight                                                                                                   | M0 and M1 need nothing external                                                                                                                                                                                                                     |
| The ONIX adapters log whole message bodies (info level), including the MSME profile and the answers, in `docker logs` | Our seller app logs ids only, but the adapters do not. PRD W5: no personal data in logs. Raise with ION: can body logging be turned off or redacted? Until then keep adapter logs short-lived, access-controlled and in the same region as the data |
| ONIX adapter changes                                                                                                  | Pin the image version                                                                                                                                                                                                                               |

## 7. Testing

- **Unit:** rules engine, loader and validators (boundaries, partial profiles, zero results).
- **Contract:** every payload we send validated against the Beckn and ION schemas.
- **Round trip:** a scripted signed `select` through the testnet before every merge.
- **Security:** bad signature, replayed `messageId`, and a check that no key or personal data is committed.
