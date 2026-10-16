# HQ-ION

Haqdarshak on the **Indonesia Open Network (ION)**, built on Beckn 2.0. This repo holds the **seller (BPP)
application** for Phase 1: it publishes Haqdarshak's MSME government schemes and answers a buyer's request with
only the schemes that MSME qualifies for.

- Plan, milestones, decisions and open questions: [docs/PLAN.md](docs/PLAN.md)
- Run it against the local ION testnet: [docs/LOCAL_TESTNET.md](docs/LOCAL_TESTNET.md)
- How it works (the journey, the two scheme lists, the eligibility engine): [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)
- Test the APIs with curl or Postman: [docs/API_TESTING.md](docs/API_TESTING.md) (Postman collection in `docs/postman/`)
- Scheme file format: [data/schemes/README.md](data/schemes/README.md)
- Status: **M0 (foundations) and M1 (local seller) done.** The seller answers `select` with the eligible schemes and
  can publish its catalog, verified live on the ION testnet. Still placeholder: the scheme data and the message
  schemas (see the plan's open questions).

## How it fits together

```
ION ──► ONIX seller adapter (Docker) ──► this app  POST /api/webhook/<action>
ION ◄── ONIX seller adapter ◄────────── this app  POST <adapter>/bpp/caller/on_<action>
```

The ONIX adapter (ION's software) verifies signatures and schemas and signs our replies. This app never holds
signing keys.

## Requirements

- Node.js **22.12 or newer** (`.nvmrc` says 22; run `nvm use`)
- npm

## Quick start

```bash
nvm use                      # picks Node 22
npm install
cp .env.example .env         # then edit; .env is git-ignored
npm run dev                  # http://localhost:3102/health
```

Checks (run before every commit):

```bash
npm run check                # typecheck + lint + format check + tests
```

Other scripts:

| Command                                                               | What it does                                                                                                                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`, `npm run test:watch`                                      | tests                                                                                                                                                                                                                                   |
| `npm run build`, `npm start`                                          | compile and run the seller app                                                                                                                                                                                                          |
| `npm run schemes:validate`                                            | check the files in `data/schemes`                                                                                                                                                                                                       |
| `npm run catalog:publish [-- --dry-run]`                              | build the catalog from the scheme files and publish it via the adapter                                                                                                                                                                  |
| `npm run onix:apply -- <testnet dir> [--check]`                       | apply our local config to a clone of ION's `ion-onix`                                                                                                                                                                                   |
| `npm run listen [-- --json]`                                          | buyer-side server on :3101. `POST /check` returns the matching schemes in one call, `GET /catalog` returns every scheme we publish, and it catches `on_select` answers for curl or Postman ([docs/API_TESTING.md](docs/API_TESTING.md)) |
| `npm run doctor`                                                      | check the seller app, adapters, schema proxy and listener are up, and say what to start if not                                                                                                                                          |
| `npm run ask -- --sector food --province "Jawa Tengah" --nib yes ...` | ask the seller, as a buyer, which schemes your answers qualify for (`--help` lists every answer)                                                                                                                                        |
| `npm run roundtrip -- [warung\|exporter\|nothing\|partial\|all]`      | live round trip through the ION testnet                                                                                                                                                                                                 |

## Configuration

All configuration is environment variables (see [.env.example](.env.example)). The app refuses to start if
required ones are missing, and never prints a rejected value.

| Variable                                    | Meaning                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `ION_ENV`                                   | `sandbox`, `pilot` or `live`. **Required, no default.**             |
| `DATA_REGION`                               | Where personal data would live. **Required.** Logged on every line. |
| `PORT`, `HOST`                              | Where this app listens (default `3102`, `127.0.0.1`)                |
| `LOG_LEVEL`                                 | `info` by default                                                   |
| `NETWORK_ID`, `BPP_ID`, `BPP_URI`           | Our identity on the network                                         |
| `ADAPTER_CALLER_URL`, `ADAPTER_PUBLISH_URL` | The ONIX seller adapter endpoints this app calls                    |
| `SCHEMES_DIR`                               | Folder of scheme JSON files                                         |

## Layout

```
src/
  main.ts            entry point (loads schemes, starts the NestJS server, SIGHUP reloads schemes)
  config.ts          env validation
  logger.ts          pino logger with personal-data scrubbing
  app.ts             builds the NestJS app (on the Fastify adapter); app.module.ts wires it; app.tokens.ts names what is injected
  http/              webhook.controller.ts (POST /api/webhook/:action), webhook.service.ts (checks, picks the handler,
                     one log line per message), health.controller.ts (GET /health), pino-nest-logger.ts
  handlers/          one handler per action (select is real; the rest answer "unsupported")
  protocol/          Beckn context, ACK/NACK, action lists, protocol logger, callback sender with retries
  eligibility/       scheme and profile types, loader (validates files), rules engine
  wire/              the ONLY place that knows the message shapes (changes when ION's schema is confirmed)
  catalog/           catalog builder and publisher
  cli/               schemes:validate and catalog:publish
scripts/             onix-config (apply our config to ion-onix) and roundtrip (live test buyer)
data/schemes/        one JSON file per scheme
deploy/onix/schemas/ TEMPORARY stand-in schemas served to the ONIX adapter
test/                vitest tests
docs/                plan and runbook
```

## Rules for this repo

- **No secrets in git.** Signing keys belong to the ONIX adapter. `.env` and key files are git-ignored.
- **No personal data in logs or in the repo.** Log ids and outcomes with `logProtocol`; never a payload. The
  logger also scrubs known personal-data keys as a safety net.
- **Scheme data in `data/schemes/` is placeholder** until the programme team delivers the 15 real schemes.
