# Running the seller against the local ION testnet

This runs ION's whole test network on your laptop (Docker) with the HQ-ION seller app plugged in. It uses ION's
**shared demo identities** (`dc-bap.ion.id`, `dc-bpp.ion.id`). They are fine for local testing and must never be
used for Haqdarshak's real identity.

```
test buyer (scripts/roundtrip.ts :3101) ──► buyer adapter :8081 ──► seller adapter :8082 ──► HQ-ION seller :3102
                                       ◄── buyer adapter       ◄── seller adapter       ◄── (on_select via :8082)
```

## One-time setup

You need Docker (with `docker compose` v2), Node 22 (`nvm use`), and a clean clone of ION's repo next to this one:

```bash
git clone https://github.com/indonesiaopennetwork/ion-onix.git ../ion-onix
cd ../ion-onix/testnet
./configure.sh                       # ION's script, default mode: fills in the shared demo identities
cd ../../HQ-ION
npm install
cp .env.example .env
npm run onix:apply -- ../ion-onix/testnet   # our changes to ION's config (idempotent; see the script header)
cd ../ion-onix/testnet && docker compose -f docker-compose-testnet.yml up -d
```

`onix:apply` changes ION's files only as listed in [scripts/onix-config.ts](../scripts/onix-config.ts): Redis on host
port 6380, `host.docker.internal` for both adapters, routing to this seller (`:3102`) and the test buyer (`:3101`), and
a `/schema/*` route that serves our **temporary** stand-in schemas ([deploy/onix/schemas](../deploy/onix/schemas)).
`npm run onix:apply -- ../ion-onix/testnet --check` reports what is missing and writes nothing.

## Every time

```bash
npm run build && npm start           # the seller app, on :3102 (reads .env)
npm run roundtrip -- all             # live round trip for every sample profile + the personal-data check
npm run ask -- --help                 # ask the seller yourself: your answers in, the matching schemes out
npm run catalog:publish              # build the catalog from data/schemes and publish it through the adapter
npm run schemes:validate             # check data/schemes without starting anything
```

Update schemes without a deploy: edit the files in `data/schemes/`, run `npm run schemes:validate`, then
`kill -HUP <seller pid>`. A bad reload is refused and the previous schemes stay active.

## What to expect

| What                          | Expected                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roundtrip -- all`            | 5/5 checks pass: warung 3 schemes, exporter 2, nothing 0, partial 0 plus the list of questions still worth asking, and a profile with a phone number is refused                                                                                                                                |
| `catalog:publish`             | `COMPLETED`, but the catalog shows `REJECTED (crawler: refusing private/loopback host)`. That is the adapter's self-check refusing a private address; it passes only with a public address and a registered index URL. The signed files are still written under `ion-onix/testnet/data/beckn/` |
| First message after a restart | May fail or time out while the adapter downloads schemas for the first time (about 10 s). The script retries                                                                                                                                                                                   |

## Troubleshooting

| Symptom                                                                                 | Cause and fix                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bind ... 6379 ... already allocated`                                                   | Another project uses host port 6379. `onix:apply` moves Redis to 6380                                                                                                                                                                                                                  |
| `SCH_INVALID_JSONLD_CONTEXT ... domain not allowed`                                     | The adapter only fetches schemas from allow-listed hosts. Run `onix:apply` and restart the adapters                                                                                                                                                                                    |
| `SCH_SCHEMA_ADAPTATION_FAILED ... invalid character 'o'`                                | A stand-in `attributes.yaml` is not valid YAML. An unquoted `": "` inside a `description:` is the usual cause                                                                                                                                                                          |
| Seller never receives anything                                                          | Is the seller running on :3102? Does `docker exec onix-bpp cat /etc/hosts` show `host.docker.internal`? Is the seller routing URL `http://host.docker.internal:3102/api/webhook`?                                                                                                      |
| `callback ... refused by the adapter (HTTP 400, SCH_...)`                               | Our reply failed the adapter's schema check. It is not retried (a 4xx cannot fix itself). Read `docker logs onix-bpp` for the field                                                                                                                                                    |
| After republishing an UNCHANGED catalog, the index size/digest no longer match the file | Adapter bug (found 2026-10-15): it writes the refreshed file as `latest.json` but the index still points at `latest.json.gz`. Don't republish an unchanged catalog. To recover: `docker exec onix-bpp sh -c 'rm -rf /beckn/catalogs/* /beckn/index/*'`, then `npm run catalog:publish` |
| Config edits lost after re-running `configure.sh`                                       | `configure.sh` rewrites these files. Run `git checkout .` in `ion-onix/testnet`, `./configure.sh`, then `npm run onix:apply`                                                                                                                                                           |

## Config changes you make by hand

Don't. Put them in `scripts/onix-config.ts` so they are repeatable and tested.
