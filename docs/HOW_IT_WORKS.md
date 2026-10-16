# How it works: the journey, the answers, and the eligibility engine

Status words used below: **verified** = run or read on this machine; **inferred** = reasoned from the specs and
ION's repos, not yet seen on the real network.

## The two scheme lists

There are two different lists of schemes, produced in two different places:

| Message       | Produced by                      | Contains                                                                                                                  |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `on_discover` | ION's **Discovery Service** (DS) | The **catalog**: every scheme we published, the same for everyone, plus where to send a request (our `bppUri`). Inferred. |
| `on_select`   | **Our seller app**               | The schemes **this MSME qualifies for**, with reasons, documents and the official link. Verified.                         |

## The journey

```
 ① WE PUBLISH    our catalog files ─────────────────────────► the DS crawls them             (inferred)

 ② BUYER ASKS    buyer app ─► buyer adapter ── discover ───► the DS, never our app          (verified: routing config)

 ③ DS ANSWERS    DS ── on_discover ─────────────────────────► buyer: the catalog             (inferred)

 ④ BUYER CHOOSES buyer ── select + MSME profile ────────────► OUR seller adapter ─► our app  (verified: routing config)

 ⑤ WE ANSWER     eligibility engine ── on_select ───────────► buyer: the qualifying schemes  (verified)
```

The buyer adapter's routing file (`local-simple-routing-BAPCaller.yaml`) sends `discover` to
`https://discover.infra.ion.id/beckn` and sends `select`, `init`, `confirm` and the rest to the seller (`targetType: bpp`).
So the seller never sees `discover`. Whether the real DS ever forwards anything to a seller is open question 3 in
[PLAN.md](PLAN.md). If it did forward a `discover`, our app would answer `400 UNSUPPORTED_IN_PHASE_1`.

**A request is not matched against the published catalog.** The adapters never consult it at request time, and
neither does the seller app: at `select` it reads `data/schemes/*.json`, the source the catalog was built from. The
catalog is a shop window for being found. `select` is the conversation after a buyer has chosen to talk to us.

### What the buyer side must do

The BAP and web journey will need **both calls**: `discover` first (to see what exists and learn where to send the
request), then `select` with the profile (to get the personalised schemes). The test buyer here only does the second
step, because `discover` needs a public address.

### How this maps to the PRD's two layers (inferred)

| PRD layer                                | In ION                                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Layer 1: coarse profile in the search    | `discover` to the DS, which can filter the catalog (the testnet's `discover` uses a JSONPath filter) |
| Layer 2: full rules engine in the seller | `select` to us; our engine decides exactly                                                           |

The catalog carries only readable labels, never thresholds, so the DS cannot pre-filter by exact numbers. If coarse
filtering at discovery is wanted, a few structured attributes could be added to the catalog. That depends on the ION
team's answers to open questions 1 to 3.

## What happens inside the seller app on a `select`

1. The seller adapter (`onix-bpp`) verifies the signature and the message shape, and forwards the request to our webhook.
2. [`src/http/webhook.service.ts`](../src/http/webhook.service.ts) (called by the NestJS controller) checks it is a well-formed Beckn message and picks the handler.
3. [`src/handlers/select.ts`](../src/handlers/select.ts) checks the profile strictly: unknown fields (a phone number) are refused.
4. The app replies **ACK** straight away.
5. In the background the **eligibility engine** runs.
6. [`src/wire/select.ts`](../src/wire/select.ts) builds the `on_select` message, and the app posts it to `onix-bpp`, which signs it and delivers it.

## The eligibility engine

[`src/eligibility/engine.ts`](../src/eligibility/engine.ts) is a set of pure functions: no database, no network, no memory.
It takes a profile and the scheme files and returns which schemes match and why.

Each scheme has a list of rules. For each rule the engine gives one of three outcomes:

| Outcome     | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| **met**     | The MSME answered this question and the answer satisfies the rule |
| **failed**  | The MSME answered and the answer does not satisfy the rule        |
| **unknown** | The MSME has not answered this question yet                       |

A scheme is then **eligible** (every rule met; only these are returned), **excluded** (at least one rule failed) or
**possible** (nothing failed, but some answers are missing).

Real output for a food stall that answered everything:

```
FAKE-SCH-001  ELIGIBLE   met R1 annualTurnoverIdr   Annual turnover up to IDR 2 billion
                         met R2 hasNIB              Has a business registration number (NIB)
FAKE-SCH-002  ELIGIBLE   met R1 sector, R2 workerCount, R3 workerCount
FAKE-SCH-003  ELIGIBLE   met R1 province, R2 businessType
FAKE-SCH-004  EXCLUDED   failed R1 turnover, met R2 hasNIB, failed R3 exportsOrPlansToExport
RETURNED to the buyer: [FAKE-SCH-001, FAKE-SCH-002, FAKE-SCH-003]
```

Real output for someone who only said "no NIB":

```
FAKE-SCH-001  EXCLUDED   unknown R1 turnover, failed R2 hasNIB
FAKE-SCH-002  POSSIBLE   all unknown
FAKE-SCH-003  POSSIBLE   all unknown
FAKE-SCH-004  EXCLUDED   unknown R1, failed R2 hasNIB, unknown R3
RETURNED: []     still worth asking: [sector, workerCount, province, businessType]
```

"Unknown" is what makes a questionnaire efficient: "no NIB" already rules out schemes 1 and 4, so the engine never
asks about turnover or exports. It asks only about schemes that are still possible.

### What the engine does not do

- **Every rule must hold.** There is no "this OR that" inside one scheme yet. A value list (`IN`) covers "food or
  beverage", but not richer logic. The real 15 schemes may need it (province variations, turnover bands, validity
  dates); check this when the programme team delivers them.
- **No scoring or ranking.** A scheme matches or it does not. Results come in file order.
- **No memory.** The profile is used and dropped. The same input always gives the same output.

The scheme file format is in [data/schemes/README.md](../data/schemes/README.md).
