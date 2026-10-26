# HQ-ION handoff: the project memory

Last updated: 2026-10-16 (scheme files reshaped to the draft SVC-social pack). Written so a new teammate, or a fresh Claude chat, can continue without the original
conversation. Everything here was checked on a real machine unless marked **inferred** (reasoned from specs, not yet seen on
the real network) or **unverified** (not checked).

## 0. How to use this file

- **Read sections 1 to 3 first** (five minutes). Section 5 gets it running on a new machine.
- **Continuing with Claude Code:** open this repo and start `claude`. The root `CLAUDE.md` loads this file automatically.
  A good first message: _"Read docs/HANDOFF.md. Run `npm run doctor`, tell me what is up, then continue with section 11."_
- **Keep it true:** when you learn or change something a future person needs, edit the relevant section and the date above.
  Mark each new claim verified, inferred or unverified. Never put keys, tokens or personal data in this file.

## 1. The project in brief

- **Haqdarshak** helps citizens and small businesses find government schemes (in India: Know Your Schemes). **Phase 1** puts
  Haqdarshak's scheme discovery on the **Indonesia Open Network (ION)**, which is built on **Beckn 2.0**, for **15 Indonesian
  MSME schemes**. **Demo day: 17 November 2026**, on a phone, in Bahasa Indonesia, on the live ION pilot environment.
- Three parts (from the PRD, "Haqdarshak on ION, Phase 1 build note"): **(A)** a seller app (BPP) that answers with the schemes an
  MSME qualifies for; **(B)** a buyer app (BAP) and web front end "KYS Indonesia" (phone, questionnaire, results, official link);
  **(C)** they must talk **over the network**, not around it (front end, then BAP, then ION, then our own seller).
- **This repo is part A only.** The buyer app and front end are **not started** here (an old Python prototype exists outside the repo).
- **PRD rules that shape the code:** two layers of eligibility (a coarse profile on the wire, the full rules inside the seller); every
  scheme has a `fulfillment` block, and Phase 1 has one type, `EXTERNAL_REDIRECT` (an official link); `select`, `init`, `confirm` and
  `status` are scaffolded, and only `select` is real; **all text bilingual** (English and Bahasa Indonesia); settings only from
  environment variables; **personal data isolated and minimal** (Indonesian data may not stay in India long term).
- **Out of scope for Phase 1:** ministry integrations, applications and tracking, OTP, payments, document upload, the partner API (Phase 2),
  citizen schemes, an agent app, an admin portal.
- **PRD timeline:** W1 13 to 17 Oct (ION onboarding, keys, schema, India-reuse decision); W2 20 to 24 Oct (seller answers, rules, first signed
  round trip on the sandbox); W3 27 to 31 Oct (buyer app, full round trip); W4 3 to 7 Nov (bilingual content, **feature freeze**);
  W5 10 to 14 Nov (pilot testing, demo rehearsal); 17 Nov demo.

## 2. Where things stand

| Area                                                                                                           | Status                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Seller app: `select` to eligibility engine to `on_select`, through ION's adapters                              | **Done**, verified live on the local test network                                               |
| Other actions (`init`, `confirm`, `status`, `track`, `update`, `cancel`, `rate`, `support`, `discover`)        | Answer `400 UNSUPPORTED_IN_PHASE_1` (by design); `on_publish` is acknowledged                   |
| Eligibility engine, scheme loader, bilingual scheme files                                                      | **Done**; **4 placeholder schemes**, now in the draft `SVC-social` pack shape (not the real 15) |
| Catalog build and publish (signed files)                                                                       | **Done locally**; the ION Discovery Service has never read it                                   |
| Test tools: `ask`, `listen` (with one-call `/check` and `/catalog`), `roundtrip`, `doctor`, Postman collection | **Done**                                                                                        |
| Tests                                                                                                          | **134** unit and handler tests pass; typecheck, lint, formatting and `npm audit` are clean      |
| Web layer                                                                                                      | **NestJS 12** on the Fastify adapter (moved from plain Fastify on 2026-10-16)                   |
| **Real Haqdarshak identity on ION** (Devlabs seller profile, sandbox keys, public address)                     | **Not done**                                                                                    |
| ION's Discovery Service listing our catalog                                                                    | **Not done** (needs the identity above)                                                         |
| ION's real schema for the message shapes                                                                       | **Not available**: `src/wire/` uses our own temporary stand-ins                                 |
| The 15 real schemes with structured rules                                                                      | **Not delivered** (programme team)                                                              |
| Buyer app, front end, phone capture, i18n UI, questionnaire                                                    | **Not started** in this repo                                                                    |
| Personal-data store, hosting, migration script, GitHub CI run                                                  | **Not done**                                                                                    |

## 3. How it works

### The parts

```
 BUYER SIDE (any ION buyer)                                   OUR SIDE
┌──────────┐   ┌──────────────┐        ┌────────────────┐   ┌─────────────────────┐
│ buyer app│──►│ buyer adapter│───────►│ seller adapter │──►│ THIS REPO: seller   │
│          │◄──│ (onix-bap)   │◄───────│ (onix-bpp)     │◄──│ app, port 3102      │
└──────────┘   └──────┬───────┘        └───────┬────────┘   └──────────┬──────────┘
                      │ discover               │ key lookup            │ reads
              ION Discovery Service        ION registry         data/schemes/*.json
```

- **The ONIX adapters are ION's software** (Docker image `fidedocker/onix-adapter`). They sign and verify messages, look up keys in the
  registry, check message shapes and download schemas, and route. **Our app holds no keys.**
- **Our seller app** decides which schemes match. It is a NestJS server: it receives each request at a **webhook**
  (`POST /api/webhook/<action>`), answers `ACK` at once, runs the engine in the background, and sends the answer back to the adapter.

### The two-step pattern (the thing that confuses everyone first)

Every Beckn request gets only an immediate `ACK`. The real answer is a **separate message** (`on_<action>`) sent later to the buyer's callback
address (`bapUri`), with the same `messageId`. So a curl or Postman call to `/select` shows only `{"status":"ACK"}`. To see the schemes you
need something listening: `npm run listen`, then `POST :3101/check` (one call, schemes in the response) or `GET :3101/callbacks/<messageId>`.
**Always use the `messageId` from the ACK**, because Postman's "copy as curl" generates fresh random ids each time.

### The journey

```
① we publish catalog files ─────────────► ION Discovery Service crawls them        (inferred; never run)
② buyer ── discover ──► buyer adapter ──► Discovery Service, never our app          (verified: routing config)
③ Discovery Service ── on_discover ─────► buyer: the CATALOG, every scheme, same for all   (inferred)
④ buyer ── select + MSME profile ──► buyer adapter ──► seller adapter ──► our webhook      (verified)
⑤ our engine ── on_select ──► seller adapter ──► buyer adapter ──► buyer: the MATCHING schemes (verified)
```

- The buyer adapter's routing file sends `discover` to `https://discover.infra.ion.id/beckn` and `select`, `init`, `confirm` and the rest
  straight to the seller. **The seller never sees `discover`** (so far as we can tell).
- **A request is never matched against the published catalog.** At `select`, our app reads `data/schemes/*.json`. The catalog is only a shop
  window for being found.
- **Two scheme lists:** `on_discover` (from ION, the whole catalog) and `on_select` (from us, only what this MSME qualifies for).

### The four seller-side "doors"

| Door     | Address (local)                         | Who calls it                                  | Our code                     |
| -------- | --------------------------------------- | --------------------------------------------- | ---------------------------- |
| Webhook  | `our app :3102 /api/webhook/<action>`   | The seller adapter, after verifying a request | We implement it: `src/http/` |
| Caller   | `onix-bpp :8082 /bpp/caller/on_select`  | Our app                                       | `src/protocol/callback.ts`   |
| Publish  | `onix-bpp :8082 /catalog/publish`       | Our app                                       | `src/catalog/publish.ts`     |
| Receiver | `onix-bpp :8082 /bpp/receiver/<action>` | The network                                   | Never called by us           |

They find each other through two settings: the target URL in ION's `local-simple-routing-BPPReceiver.yaml` (where the adapter sends requests:
our webhook) and `ADAPTER_CALLER_URL` and `ADAPTER_PUBLISH_URL` in our `.env`.

### The eligibility engine (`src/eligibility/engine.ts`)

Pure functions: a profile and the scheme files in, matching schemes and reasons out. No database, network or memory. Each rule gives **met**,
**failed** or **unknown** (not answered yet). A scheme is **eligible** (all rules met; only these are returned), **excluded** (a rule failed) or
**possible** (nothing failed, answers missing). The **unknown** outcome produces the list of questions still worth asking. **Limit:** every rule
must hold; there is no "this OR that" yet. The real 15 schemes may need it (provincial variation, turnover bands, validity dates).

## 4. Repo map

```
src/
  main.ts            entry: loads config and schemes, starts NestJS; SIGHUP reloads schemes
  app.ts             createApp(): NestFactory + Fastify adapter    app.module.ts / app.tokens.ts: wiring
  http/              webhook.controller (POST /api/webhook/:action), webhook.service (checks, picks handler, one log line per message),
                     health.controller, pino-nest-logger
  handlers/          select.ts (the real one), index.ts (stubs for the other actions)
  eligibility/       types.ts (profile + scheme schemas), loader.ts (validates files), engine.ts
  wire/              THE ONLY place that knows message shapes: parse select, build on_select (TEMPORARY stand-in schemas)
  protocol/          Beckn context, ACK/NACK, action lists, protocol logger, callback sender (retries)
  catalog/           build.ts, publish.ts      cli/  publish-catalog, validate-schemes
  config.ts          environment validation (ION_ENV and DATA_REGION required, no defaults)    logger.ts   pino + personal-data scrubbing
scripts/             onix-config (apply our changes to ION's test network), ask, listen, roundtrip, doctor, demo-api, buyer-client
data/schemes/        one JSON file per scheme (4 placeholders, pack shape)       deploy/onix/schemas/   TEMPORARY stand-in schemas
test/                14 test files, 134 tests                         docs/postman/         collection + environment (30 requests)
docs/                PLAN, HOW_IT_WORKS, LOCAL_TESTNET, API_TESTING, this file
```

## 5. Set up on a new machine

**Needs:** Docker with `docker compose` v2, Node **22** (use nvm), git. Optional: `jq`, the Postman CLI.

```bash
git clone https://github.com/ragul0106/HQ-ION.git && cd HQ-ION
nvm use                                   # reads .nvmrc (22). Do NOT use Node 23: vitest and eslint do not support it
npm install
cp .env.example .env                      # defaults match the local test network

git clone https://github.com/indonesiaopennetwork/ion-onix.git ../ion-onix    # must sit next to HQ-ION
(cd ../ion-onix/testnet && ./configure.sh)             # ION's own script, default mode: shared DEMO identities
npm run onix:apply -- ../ion-onix/testnet              # our changes to ION's config (safe to repeat; --check only reports)
(cd ../ion-onix/testnet && docker compose -f docker-compose-testnet.yml up -d)

npm run build && npm start                # the seller app, port 3102
npm run doctor                            # every line should say "ok"
npm run roundtrip -- all                  # expect 7/7 checks
```

- The first message after a restart can take about 10 seconds or fail while the adapters download schemas. Retry.
- `configure.sh` rewrites placeholders inside ION's files, which erases our edits. To redo it: `git checkout .` in `ion-onix/testnet`, run
  `./configure.sh`, then `npm run onix:apply` again. **Never edit ION's config by hand: change `scripts/onix-config.ts`.**
- The processes are **not supervised**. After a reboot or a new session, start the containers and the seller again. A `502 Bad Gateway`
  from `:8081` almost always means the seller app is not running.
- Redis is moved to host port 6380 by `onix:apply` (6379 is often taken). `host.docker.internal` is added for the adapters (Linux needs it).

## 6. Everyday commands

| I want to                                     | Command                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check everything is up, with fixes            | `npm run doctor`                                                                                                                                  |
| Ask as a buyer and read the schemes           | `npm run ask -- --sector food --province "Jawa Tengah" --workers 3 --turnover 300000000 --nib yes --export no`                                    |
| One call, schemes in the response (for demos) | `npm run listen`, then `POST localhost:3101/check` (`{"language":"en","profile":{...}}`)                                                          |
| Every scheme we publish                       | `GET localhost:3101/catalog` (`?lang=id`)                                                                                                         |
| See answers from curl or Postman              | `npm run listen`, then `GET localhost:3101/callbacks/<messageId from the ACK>`                                                                    |
| All live checks                               | `npm run roundtrip -- all`                                                                                                                        |
| Postman collection                            | `postman collection run docs/postman/HQ-ION.postman_collection.json -e docs/postman/HQ-ION.postman_environment.json` (30 requests, 32 assertions) |
| Validate scheme files                         | `npm run schemes:validate`                                                                                                                        |
| Reload schemes without a restart              | edit `data/schemes/`, validate, then `kill -HUP <seller pid>` (a bad reload is refused)                                                           |
| Publish the catalog                           | `npm run catalog:publish` (`-- --dry-run` prints it)                                                                                              |
| Read messages in Docker                       | `docker logs onix-bap` / `onix-bpp`, or Dozzle at `http://localhost:8080`                                                                         |
| Everything before committing                  | `npm run check` (typecheck, lint, formatting, 134 tests)                                                                                          |

**Port 3101 is shared** by `listen`, `ask` and `roundtrip`: run one at a time. More in [API_TESTING.md](API_TESTING.md) and [LOCAL_TESTNET.md](LOCAL_TESTNET.md).

## 7. Verified technical facts

**Beckn and ION**

- Beckn 2.0 uses `discover` and `on_discover`. The PRD still says `search` and `on_search`.
- The adapter checks every message against Beckn's base schema: `select` needs at least one commitment; **every commitment needs an `offer`**; every
  resource needs a `quantity`; every `...Attributes` block needs `@context` and `@type`. The adapter then **downloads the schema** from the
  `@context` URL, but **only from allow-listed hosts** (`raw.githubusercontent.com`, `schema.beckn.io`, `schema.ion.id`, plus our `reverse-proxy`
  entries added by `onix:apply`). Others fail with `SCH_INVALID_JSONLD_CONTEXT`.
- A reply with an **empty commitments list is invalid**. For "nothing matched" the seller sends its own complete placeholder commitment and
  `eligibleCount: 0`. (Open question for ION: the proper signal, perhaps `BIZ_NO_RESULTS_FOUND`.)
- Error codes seen: `SCH_FIELD_NOT_ALLOWED`, `SCH_REQUIRED_FIELD_MISSING`, `SCH_INVALID_JSONLD_CONTEXT`, `AUT_SIGNATURE_MISSING`, `AUT_SIGNATURE_INVALID`.
- **Signing** (reproduced by hand, matches the adapter): Ed25519; digest = BLAKE2b (64-byte) of the exact body, base64, **prefix `BLAKE-512=`** (the
  spec text says `BLAKE2b-512=`); signing string = `(created): <t>`, `(expires): <t>`, `digest: BLAKE-512=<b64>` joined by newlines; keyId =
  `<subscriberId>|<keyId>|ed25519`. Callback (4-line) signing was not reproduced.
- The demo identities `dc-bap.ion.id` and `dc-bpp.ion.id` are **shared ION test identities**: fine locally, **never for Haqdarshak**.
  `dc-bpp.ion.id`'s registry record points at `https://dc-bpp.ion.id`, and links no catalog index.

**Catalog**

- `catalog:publish` makes the adapter write signed files to `../ion-onix/testnet/data/beckn/` (owned by root, written by the container):
  `catalogs/HQ-MSME-SCHEMES.v1.json.gz`, `...latest.json.gz`, `index/becknCatalogs.index.json`, also served at `http://localhost:9000/beckn/`.
  The index digest is the SHA-256 of the **decompressed** catalog; the signature verifies over the file minus its `signature` field.
- Locally the adapter says `REJECTED (crawler: refusing private/loopback host)`: its self-check refuses private addresses. The files are still written.
- The index carries `next_update` 14 days ahead, so the catalog needs refreshing before then (**inferred** expectation).
- The catalog holds readable criteria only. **The thresholds and operators never leave the engine.**

**Drafts and sources**

- `ion-specs` Release 1 is **Trade only**; there is no government-benefits domain in it. A separate draft pack, `ion-services-social-schemes`
  (CRC `SVC-social`, sector `ion:services`, unknown origin, not merged), models schemes and says the seller evaluates a profile at `select`, which matches
  our design. But its applicant profile **requires `nik` and `fullName`** and has no business fields. It is **citizen**-centric; the PRD is MSME-only.

## 8. Known bugs, gotchas, risks

| Item                                                                                                         | Detail and what to do                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ONIX bug: republishing an unchanged catalog**                                                              | The adapter writes the refreshed file as `latest.json` but the index still points at `latest.json.gz`, so size and digest mismatch and a verifying crawler would reject it. Publish once; to recover: `docker exec onix-bpp sh -c 'rm -rf /beckn/catalogs/* /beckn/index/*'`, then publish again. The same path refreshes `next_update`: **raise with ION**. |
| **Privacy: the adapters log whole bodies** at info level, including the MSME profile. Our app logs ids only. | Conflicts with the PRD's "no personal data in logs". Raise with ION; keep adapter logs short-lived and access-controlled.                                                                                                                                                                                                                                    |
| Slow or failed first message after a restart                                                                 | Schemas are downloaded at validation time. Warm the cache before demos; consider mirroring schemas.                                                                                                                                                                                                                                                          |
| Echoed commitment bug (fixed)                                                                                | An empty or incomplete commitment in a reply is rejected after the ACK, so **an ACK proves nothing about the reply**. Always confirm the callback arrives. Through ION the buyer adapter refuses an incomplete commitment first; only a direct webhook call reaches the seller.                                                                              |
| Node version                                                                                                 | Use Node 22. TypeScript is pinned to 6.x (`typescript-eslint` does not support 7 yet). `fastify` is pinned to exactly `5.12.5` so there is one copy beside NestJS's.                                                                                                                                                                                         |
| NestJS and decorators                                                                                        | Nest 12 is an ES module that still uses classic decorators: `experimentalDecorators` is on, and dependencies use explicit `@Inject(token)` (no `emitDecoratorMetadata`), which keeps it working under vitest and tsx.                                                                                                                                        |
| `502` from `:8081`                                                                                           | The seller is not running. `npm run doctor`.                                                                                                                                                                                                                                                                                                                 |
| Postman "copy as curl"                                                                                       | Regenerates `{{$guid}}` values, so the pasted ids are not what was sent. Use the ACK's `messageId`.                                                                                                                                                                                                                                                          |
| A background process started by an assistant cannot be stopped with Ctrl+C by you                            | Find it with `ss -ltnp \| grep :3101` and `kill <pid>`.                                                                                                                                                                                                                                                                                                      |
| Pasting npm's `> hq-ion@0.1.0 ask` banner into a shell                                                       | Creates empty files named `hq-ion@0.1.0` and `tsx` in the repo. Delete them; do not commit them.                                                                                                                                                                                                                                                             |
| Any `ngrok` or public tunnel                                                                                 | It exposes the adapter publicly. Ask first, and stop it afterwards.                                                                                                                                                                                                                                                                                          |

## 9. Open questions (blockers for the data model)

Send these to the project lead or the ION team. They are also in [PLAN.md](PLAN.md) section 5.

1. Is the draft `SVC-social` pack the government-benefits spec the PRD says is coming? If not, where is that spec?
2. Will an **MSME applicant profile** exist? The draft's profile needs a national ID and full name, and has no NIB, turnover, sector or workers.
3. Does the ION Discovery Service **ever call the seller**, or answer only from crawled catalogs? What does `on_discover` contain for our catalog?
4. What is the proper **"no results"** signal?
5. **India reuse:** can the India scheme database and rules engine hold NIB, business class, provincial variation and turnover bands? (PRD asks for the decision in week 1.)
6. What is `on_publish` (it appears in the seller's routing)?
7. How should a catalog be **refreshed**, given the republish bug above? Can adapter **body logging** be turned off or redacted?
8. **Devlabs:** the org has two buyer profiles and **no Seller App profile**. A seller profile and sandbox keys are needed. Which sector and category fit a scheme catalog?
9. From the programme team: the **15 schemes** with structured rules, documents and official links.

## 10. Decisions log

| Date       | Decision                                                                                                                                                           | Why                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 2026-10    | Learn on the Beckn starter kit, then the ION testnet                                                                                                               | Same architecture; the testnet is ION's own                                                      |
| 2026-10-15 | **TypeScript on Node 22** for the real seller (a Python prototype came first)                                                                                      | Typed message shapes; same language as the front end                                             |
| 2026-10-15 | Use ION's **ONIX adapter**, never our own signing                                                                                                                  | It does signing, verification, schema checks and routing                                         |
| 2026-10-15 | Scheme store = **validated JSON files**, reloadable                                                                                                                | PRD: a reviewed JSON import is enough for 15 schemes                                             |
| 2026-10-15 | Seller is **stateless**: the profile is used and dropped, never stored or logged                                                                                   | PRD data-residency and minimal-PII rules                                                         |
| 2026-10-15 | The MSME profile travels in **`select`**, strict (unknown fields refused)                                                                                          | Matches the draft ION pack's design; `discover` is catalog-first                                 |
| 2026-10-15 | The catalog publishes **readable criteria only**                                                                                                                   | The network carries the question and answer, not the logic                                       |
| 2026-10-15 | Placeholder schemes are flagged and **refused on `live`**                                                                                                          | Sample data must never reach the live network                                                    |
| 2026-10-16 | Scheme files use the **draft `SVC-social` pack** shape (`resourceAttributes` + a `haqdarshak` block); the loader converts to the internal scheme, engine unchanged | The dev lead shared the pack; the catalog and `on_select` still use stand-in shapes until step 4 |
| 2026-10-16 | Web layer moved to **NestJS 12** (Fastify adapter)                                                                                                                 | Requested by the project owner; business logic untouched                                         |

## 11. Next steps

1. **Send the open questions** (section 9) to the ION team and the project lead. A message has not been drafted yet.
2. **Real identity (M2):** Devlabs seller profile and sandbox keys, put in `../ion-onix/testnet/settings.env` yourself (never in git or chat), then
   `git checkout .`, `./configure.sh`, `npm run onix:apply`, set `BPP_ID` and `BPP_URI` in `.env`, a public address (ask before ngrok), register the
   catalog index URL in Devlabs, and watch for the first real crawl.
3. **Adopt ION's real schema** in `src/wire/` and retire `deploy/onix/schemas/` (the stand-ins are not reachable by ION's adapters: they sit on a Docker-internal address).
4. **Load the 15 real schemes** in the pack shape (see `data/schemes/README.md`); check whether the engine needs OR groups, province variations, turnover bands or validity dates.
5. A `catalog:verify` command (fetch the index and files over HTTP, check every digest and size), and **contract tests** that validate our replies
   against Beckn's own schema offline, so a bad reply is caught before the live adapter rejects it.
6. **Buyer app and front end (PRD part B):** `discover` first, then `select`; phone capture, a branching questionnaire (the engine already reports what is
   still worth asking), results, Bahasa and English, a language toggle.
7. Personal-data store, hosting and migration script; run CI on GitHub; the India-reuse decision.

## 12. Working rules

- **Explain simply** (the team is new to Beckn) and use real payloads and logs. Say what is **verified**, **inferred** or **unverified**; never present a guess about ION as fact.
- **Do not commit or push** unless asked. **Never print or commit keys or tokens.** The demo keys are shared test keys and are not for Haqdarshak.
- Run `npm run check` before finishing. After changing anything the adapters read, restart them. For anything that sends a callback, **confirm the callback arrives**.
- Use `docker compose` v2. Stop processes by PID, not by pattern. Do not stop containers that belong to other projects on the machine.

## 13. Glossary

| Term                       | Meaning                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| **ION**                    | Indonesia Open Network, built on Beckn 2.0                                                              |
| **BAP / CN**               | Buyer app / consumer node: asks. **BPP / PN:** seller app / provider node: answers. This repo is a BPP. |
| **ONIX**                   | ION's adapter software (`onix-bap`, `onix-bpp`) that signs, verifies, checks and routes                 |
| **Registry**               | ION's phonebook of participants and their public keys                                                   |
| **Discovery Service (DS)** | ION's search service; it crawls published catalogs                                                      |
| **Catalog**                | Our published list of schemes, as signed files; the shop window                                         |
| **ACK / NACK**             | The immediate "got it" or "refused" reply to every request                                              |
| **Callback**               | The later `on_<action>` message that carries the real answer                                            |
| **Webhook**                | A URL on your server that another system calls when something happens                                   |
| **Devlabs / ION Central**  | ION's developer portal for profiles and keys                                                            |
| **MSME**                   | Micro, small or medium enterprise                                                                       |
| **NIB**                    | Nomor Induk Berusaha, the Indonesian business registration number                                       |

## 14. Where else to look

- Repo docs: [PLAN.md](PLAN.md), [HOW_IT_WORKS.md](HOW_IT_WORKS.md), [LOCAL_TESTNET.md](LOCAL_TESTNET.md), [API_TESTING.md](API_TESTING.md), [../data/schemes/README.md](../data/schemes/README.md).
- External repos (public): `github.com/indonesiaopennetwork/ion-onix` (adapters and the test network), `github.com/indonesiaopennetwork/ion-specs`
  (ION's specs), `github.com/beckn/protocol-specifications-v2` (Beckn 2.0 specs).
- The PRD (`Haqdarshak-ION-Phase1-Build-Note.docx`) and the draft `ion-services-social-schemes` pack are **not in this repo**: ask the project lead.
