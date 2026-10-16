# Testing the APIs with curl

Every command below was run against the local ION testnet and gave the output described. You need the testnet
running (see [LOCAL_TESTNET.md](LOCAL_TESTNET.md)) and the seller app running (`npm run build && npm start`).

## The one-call way: see the schemes in the response

A Beckn request returns only an **ACK**. The schemes arrive later in a separate message (`on_select`), so a call to
`{{bap_caller_url}}/select` never shows them, and it never returns the whole catalog either. For demos there are two
endpoints on the listener (`npm run listen`, port 3101) that give you the schemes in the response itself:

| I want                              | Call                                                                        | Returns                                                            |
| ----------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The schemes this MSME qualifies for | `POST http://localhost:3101/check` with `{"language":"en","profile":{...}}` | `eligibleCount`, and each scheme with why, documents and next step |
| Every scheme we publish             | `GET http://localhost:3101/catalog` (`?lang=id` for Bahasa)                 | All 4 schemes in the published catalog                             |

```bash
npm run listen          # keep this running in its own terminal

curl -s -X POST localhost:3101/check -H 'content-type: application/json' -d '{
  "language": "en",
  "profile": {"businessType":"CV","sector":"craft","province":"Bali","workerCount":25,
              "annualTurnoverIdr":1500000000,"hasNIB":true,"exportsOrPlansToExport":true}}'
# {"eligibleCount": 2, "schemes": [ {"id":"FAKE-SCH-001", ...}, {"id":"FAKE-SCH-004", ...} ], ...}

curl -s localhost:3101/catalog
# {"catalogId":"...HQ-MSME-SCHEMES","count":4,"schemes":[ ... ]}
```

`/check` really goes through ION: it sends a `select` through the buyer adapter, waits for the seller's `on_select`,
and returns it. This is what a buyer app's backend does for its front end. Bad input is refused with a 400 that names
the field (a phone number is refused, and the value is never echoed back).

`/catalog` is **our published catalog** (what ION's Discovery Service will index once our identity is registered),
not the Discovery Service itself. In Postman, use folder **4 One call** in the collection.

## 0. Before you start

Not working? Run `npm run doctor`: it checks the seller app, both adapters, the schema proxy and the listener, and says what to start. A `502 Bad Gateway` from `:8081` almost always means the seller app (`:3102`) is not running.

**Terminal 1: the listener.** A Beckn request returns only an ACK. The answer (the schemes) is a **separate message**
(`on_select`) sent later to the buyer's callback address, so curl and Postman never see it in the response. The
listener is that callback address: it prints each answer and also keeps it, so you can fetch it by id:

```bash
npm run listen              # add  -- --json  for the full message in the terminal
```

```bash
# after sending a select, use the messageId from the ACK:
curl -s localhost:3101/callbacks/<messageId>     # the full on_select, with the schemes (404 "pending" until it arrives)
curl -s localhost:3101/latest                    # the most recent answer
curl -s localhost:3101/callbacks                 # ids received so far
```

```bash
npm run listen              # add  -- --json  for the full message
```

**Terminal 2:** set up the values every message needs. A `messageId` must be new for every request, so run `fresh`
again before each curl:

```bash
fresh() { TX=$(uuidgen); MSG=$(uuidgen); TS=$(date -u +%Y-%m-%dT%H:%M:%S.000Z); }
fresh
```

## 1. The seller app directly (port 3102)

This is the door the ONIX seller adapter calls. Calling it yourself skips ION's signature checks, so it is for
testing our own logic only.

**Health**

```bash
curl -s localhost:3102/health
# {"status":"ok","service":"hq-ion-seller","version":"0.1.0","ionEnv":"sandbox","region":"in-local-dev"}
```

**`select` with a valid profile.** Expect an immediate ACK; a moment later the listener prints
`on_select ... eligibleCount=3 [FAKE-SCH-001, FAKE-SCH-002, FAKE-SCH-003]`:

```bash
fresh; curl -s -X POST localhost:3102/api/webhook/select -H 'content-type: application/json' -d '{
 "context":{"action":"select","version":"2.0.0","networkId":"ion.id/staging",
  "bapId":"dc-bap.ion.id","bapUri":"http://reverse-proxy:9000/bap/receiver",
  "bppId":"dc-bpp.ion.id","bppUri":"http://reverse-proxy:9000/bpp/receiver",
  "transactionId":"'$TX'","messageId":"'$MSG'","timestamp":"'$TS'","ttl":"PT30S"},
 "message":{"contract":{"id":"check-1",
  "participants":[{"id":"buyer-1","descriptor":{"code":"buyer"}}],
  "commitments":[{"id":"commitment-1","resources":[{"id":"HQ-ELIGIBILITY-CHECK"}],
    "offer":{"id":"offer-eligibility","resourceIds":["HQ-ELIGIBILITY-CHECK"]}}],
  "contractAttributes":{"@context":"http://reverse-proxy:9000/schema/HqMsmeProfile/v0/context.jsonld",
   "@type":"HqMsmeProfile","language":"en",
   "msmeProfile":{"businessType":"individual","sector":"food","province":"Jawa Tengah",
    "workerCount":3,"annualTurnoverIdr":300000000,"hasNIB":true,"exportsOrPlansToExport":false}}}}}'
# {"message":{"status":"ACK","messageId":"..."}}
```

Change only the `msmeProfile` part to try the other cases. Everything else stays the same:

| `msmeProfile`                                                                                                                                          | Result                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `{"workerCount":-3}`                                                                                                                                   | `400` NACK `BAD_REQUEST` ... `workerCount: Too small`                                |
| `{"sector":"food","phone":"+628111222333"}`                                                                                                            | `400` NACK `BAD_REQUEST` ... `Unrecognized key: "phone"` (the value is never echoed) |
| `{"hasNIB":true}`                                                                                                                                      | ACK; the answer has 0 schemes and a list of questions still worth asking             |
| `{"businessType":"CV","sector":"craft","province":"Bali","workerCount":25,"annualTurnoverIdr":1500000000,"hasNIB":true,"exportsOrPlansToExport":true}` | ACK; answer has 2 schemes (`FAKE-SCH-001`, `FAKE-SCH-004`)                           |

**Actions we do not build in Phase 1.** Use any of `init confirm status track update cancel rate support discover`:

```bash
fresh; curl -s -X POST localhost:3102/api/webhook/init -H 'content-type: application/json' -d '{
 "context":{"action":"init","version":"2.0.0","transactionId":"'$TX'","messageId":"'$MSG'","timestamp":"'$TS'"},
 "message":{}}'
# 400  {"message":{"status":"NACK",...,"error":{"code":"UNSUPPORTED_IN_PHASE_1","message":"Haqdarshak Phase 1 does not implement 'init'. Supported: select."}}}
```

**Malformed requests**

```bash
curl -s -X POST localhost:3102/api/webhook/select -H 'content-type: application/json' -d '{"hello":"world"}'
# 400  BAD_REQUEST   (not a Beckn message)

fresh; curl -s -X POST localhost:3102/api/webhook/select -H 'content-type: application/json' -d '{
 "context":{"action":"init","version":"2.0.0","transactionId":"'$TX'","messageId":"'$MSG'","timestamp":"'$TS'"},"message":{}}'
# 400  ACTION_MISMATCH   (the URL says select, the message says init)

fresh; curl -s -X POST localhost:3102/api/webhook/teleport -H 'content-type: application/json' -d '{
 "context":{"action":"teleport","version":"2.0.0","transactionId":"'$TX'","messageId":"'$MSG'","timestamp":"'$TS'"},"message":{}}'
# 404  UNKNOWN_ACTION
```

## 2. Through ION: the real path

Send a `select` to the **buyer adapter** (port 8081). It signs the message, checks it, sends it to the seller
adapter, which calls the seller app. You get only the ACK here; the answer goes to the listener:

```bash
fresh; curl -s -X POST http://localhost:8081/bap/caller/select -H 'content-type: application/json' -d '{
 "context":{"networkId":"ion.id/staging","action":"select","version":"2.0.0",
  "bapId":"dc-bap.ion.id","bapUri":"http://reverse-proxy:9000/bap/receiver",
  "bppId":"dc-bpp.ion.id","bppUri":"http://reverse-proxy:9000/bpp/receiver",
  "transactionId":"'$TX'","messageId":"'$MSG'","timestamp":"'$TS'","ttl":"PT30S","schemaContext":[]},
 "message":{"contract":{"id":"check-1",
  "participants":[{"id":"buyer-1","descriptor":{"code":"buyer"}}],
  "commitments":[{"id":"commitment-1","status":{"code":"DRAFT"},
    "resources":[{"id":"HQ-ELIGIBILITY-CHECK","descriptor":{"name":"Scheme eligibility check"},"quantity":{"unitQuantity":1,"unitCode":"UNIT"}}],
    "offer":{"id":"offer-eligibility","resourceIds":["HQ-ELIGIBILITY-CHECK"]}}],
  "contractAttributes":{"@context":"http://reverse-proxy:9000/schema/HqMsmeProfile/v0/context.jsonld",
   "@type":"HqMsmeProfile","language":"en",
   "msmeProfile":{"businessType":"CV","sector":"craft","province":"Bali","workerCount":25,
    "annualTurnoverIdr":1500000000,"hasNIB":true,"exportsOrPlansToExport":true}}}}}'
# {"message":{"status":"ACK","messageId":"..."}}
# listener:  ... action=on_select ... eligibleCount=2  [FAKE-SCH-001, FAKE-SCH-004]
```

The same request with `"phone":"+628100000000"` inside `msmeProfile` is refused by the buyer adapter itself:
`400 SCH_FIELD_NOT_ALLOWED  property "phone" is unsupported`.

**Security check: call the seller adapter directly, unsigned.** It refuses, which is what protects the network:

```bash
fresh; curl -s -X POST http://localhost:8082/bpp/receiver/select -H 'content-type: application/json' -d '{
 "context":{"action":"select","version":"2.0.0","messageId":"x","transactionId":"y","timestamp":"'$TS'"},"message":{}}'
# 401  AUT_SIGNATURE_MISSING
```

## 3. The catalog

**What the adapter wrote**, fetched the way a crawler would (through the proxy on port 9000):

```bash
curl -s localhost:9000/beckn/index/becknCatalogs.index.json | python3 -m json.tool | head -30

curl -s localhost:9000/beckn/catalogs/HQ-MSME-SCHEMES.latest.json.gz | gunzip | python3 -m json.tool | head -60
```

**The stand-in schemas the adapter downloads while validating our messages:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" localhost:9000/schema/HqMsmeProfile/v0/attributes.yaml     # 200
```

**Publish the catalog.** The easy way is `npm run catalog:publish`. The same thing with curl:

```bash
npm run -s catalog:publish -- --dry-run | curl -s -X POST http://localhost:8082/catalog/publish \
  -H 'content-type: application/json' --data-binary @-
```

> **Run this once on a fresh catalog.** The testnet adapter has a bug: republishing an **unchanged** catalog leaves
> the index inconsistent with its files. See [LOCAL_TESTNET.md](LOCAL_TESTNET.md) for the recovery command. The
> adapter may answer `REJECTED (crawler: refusing private/loopback host ...)`. That is its self-check refusing a
> private address, and the signed files are still written.

## Postman

Curl is awkward to import because of the shell variables. Import the ready-made collection instead:

1. In Postman: **Import** and choose both files in [`docs/postman/`](postman/):
   `HQ-ION.postman_collection.json` and `HQ-ION.postman_environment.json`.
2. Pick the environment **HQ-ION local testnet** (top right).
3. Run requests one at a time, or the whole collection (right-click it, **Run**). Each request has a test, so
   the runner shows pass or fail.
4. Keep `npm run listen` running. Postman cannot receive the `on_select` callback, so the listener catches it, and the
   requests named **→ the ANSWER to the select above** fetch it from there. **That is where you see the schemes.**

Message ids use Postman's `{{$guid}}` and `{{$isoTimestamp}}`, so every send is new. The collection has 22 requests:
the seller app directly (valid, invalid and refused cases), the real path through the ION adapters, five **ANSWER**
requests that fetch the schemes each select produced, and the catalog and schema files. All 22 pass against the
local testnet, and the ANSWER requests prove the callbacks really arrive.

To import a single request from curl instead: **Import**, **Raw text**, paste a curl command. Replace the shell
variables first: use `{{$guid}}` for `$TX` and `$MSG`, and `{{$isoTimestamp}}` for `$TS`.

Run the collection from the command line (no Postman account needed for this):

```bash
cd docs/postman
postman collection run HQ-ION.postman_collection.json -e HQ-ION.postman_environment.json
```

## Seeing it through Docker

The ONIX adapters run in Docker and log every message they handle, including its body. That is a second way to see
the answer, without Postman or the listener. Use the `messageId` from the ACK (`$MSG` below). `jq` is needed.

**The answer, as the buyer adapter received it** (the schemes, with reasons):

```bash
docker logs onix-bap 2>&1 | grep '"url":"/bap/receiver/on_select"' | grep "$MSG" | tail -1 \
  | jq '.body | fromjson | .message.contract.contractAttributes.eligibility
        | {eligibleCount, schemes: [.schemes[] | {id, name: .name.en, benefit: .benefit.en, why: [.why[].en]}]}'
```

Without `$MSG`, drop the second `grep` to get the most recent answer. For the whole message, use just
`... | jq '.body | fromjson'`.

**Watch answers arrive live:**

```bash
docker logs -f --since 0s onix-bap 2>&1 | grep --line-buffered '/bap/receiver/on_select'
```

**Follow one message through the buyer adapter** (sign, validate, forward, verify the answer, deliver it):

```bash
docker logs onix-bap 2>&1 | grep "$MSG" \
  | jq -r 'select(.message != null) | select(.message|test("Signature generated|Forwarding request|Looking up|validation passed")) | "\(.time[11:19])  \(.module_id)  \(.message[0:95])"'
```

**The same exchange on the seller side:**

```bash
docker logs onix-bpp 2>&1 | grep '"url":"/bpp/receiver/select"' | grep "$MSG" | tail -1 | jq '.body | fromjson'   # the request
docker logs onix-bpp 2>&1 | grep '"url":"/bpp/caller/on_select"' | grep "$MSG" | tail -1 | jq '.body | fromjson'   # the answer it sent
```

**In a browser:** open Dozzle at http://localhost:8080 (this machine only), click `onix-bap` or `onix-bpp`, and search for
`on_select` or for the messageId.

> **The adapters log whole message bodies, which include the MSME profile.** Our seller app never logs a profile, but
> `docker logs` shows one. See the risks in [PLAN.md](PLAN.md).

## Quick reference

| What                            | Command                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Seller app up?                  | `curl -s localhost:3102/health`                                                      |
| Ask as a buyer, readable output | `npm run ask -- --help`                                                              |
| See callbacks arrive            | `npm run listen`                                                                     |
| Seller app logs                 | the terminal running `npm start` (one JSON line per message, ids only)               |
| Adapter logs                    | `docker logs onix-bpp` and `docker logs onix-bap`, or http://localhost:8080 (Dozzle) |
