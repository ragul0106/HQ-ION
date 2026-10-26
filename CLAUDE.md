# HQ-ION: Haqdarshak seller (BPP) on the Indonesia Open Network

NestJS (Fastify adapter) + TypeScript on **Node 22**. It receives a buyer's `select` with an MSME profile through ION's ONIX
adapter, runs an eligibility engine over bilingual scheme files, and sends back the schemes the MSME qualifies for.

**Read the full project memory first: the file below holds the current state, how it works, setup, verified facts, bugs, open questions
and next steps.**

@docs/HANDOFF.md

## Rules for working here

- Explain simply: the team is new to Beckn. Use real payloads and logs. Label claims **verified**, **inferred** or **unverified**.
- Before starting work, run `npm run doctor`. Before finishing, run `npm run check`.
- Use Node 22 (`nvm use`). Do not commit or push unless asked. Never print, store or commit keys, tokens or personal data.
- The ONIX adapters are ION's software. Never edit their config by hand: change `scripts/onix-config.ts`, then run `npm run onix:apply`.
- An ACK proves nothing about the reply. For anything that sends a callback, confirm the callback arrives (`npm run listen`, `npm run ask`).
- Ask before starting a public tunnel (ngrok). Stop processes by PID. Use `docker compose` v2.
- Keep `docs/HANDOFF.md` true: when something a future person needs changes, edit it and its date.
