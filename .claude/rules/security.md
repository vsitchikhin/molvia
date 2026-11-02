---
paths:
  - 'deploy/Caddyfile'
  - 'deploy/README.md'
  - 'docker-compose.prod.yml'
  - '.env.prod.example'
  - '.github/workflows/*.yml'
  - '.github/dependabot.yml'
  - '*/Dockerfile'
  - 'services/*/Dockerfile'
  - 'deploy/*/Dockerfile'
  - 'backend/src/routes/{auth,client-errors,catalogue,receipts,internal-auth,feedback}.ts'
  - 'backend/src/{purs,open-food-facts,rates}/*.ts'
  - 'backend/src/usecases/{start-login,propose-item,receipts}.ts'
---

# Security: what a stranger must not get, and what holds it

The audit before `v0.2.0` (MOL-287, 03.11.2026; the report and its probes in `.scratch/tasks/security/`) went
over everything with an attacker's eyes for the first time. What was clean is held by the areas' own rules —
IDOR by `resource.ts` and ownership in every `WHERE`, the cookie by `auth.md`, the copy by `privacy.md`; this
file holds what belongs to no single area, and what the audit found missing.

## Who may write how much

- **A write that grows what everybody shares, or what the server keeps on its disk, has a quota per person**
  (MOL-287, owner's В-3 «а»: a cheap way to bring the service down — one request without a session, or one
  account within a minute — is a blocker of the release). The audit found three without one: the login's
  quota was the whole database's, so one `curl` held the door shut for everyone (Ф-1, MOL-359: five a minute
  an address, three hundred in all); a receipt's photos had none, and one account filled some 12 GB an hour
  against 51 GB free (Ф-2, MOL-360: forty a day, twenty not recorded at once); «Предложить товар» had none,
  and some nine thousand names an hour went into everybody's search (Ф-4, MOL-362: sixty a day). **A new write path
  names its quota in its task**, or says why it needs none — a person's own rows of money are bounded by the
  body and the person.
- **What answers without a session is limited by the address Caddy names**, never by anything the client
  sends: the last `X-Forwarded-For` only from a peer inside, an IPv6 address by its `/48` (`networkOf`,
  `/client-errors`, MOL-144). A forged header changes nothing — the audit sent sixty under sixty addresses
  and was refused at the sixty-first. **The address is a key of a count, never a column or a line of the
  log** (`privacy.md`).
- **The money of the owner is the model's alone, and only a column the owner writes opens it**:
  `receipts_model_until`, set by hand, and no route writes it. Within it there is no share per person yet
  (MOL-367).

## What the server asks of others

- **A host the server asks is the code's, never the request's** (SSRF): a Serbian receipt's link is
  checked and rebuilt on `SERBIAN_RECEIPT_HOST`, a code is asked of Open Food Facts as digits, the banks'
  addresses are constants. A new outgoing request keeps the same shape — the input is a parameter, never a
  URL — and has a timeout. The size of an answer is not limited yet (MOL-368).

## Secrets

- **Every secret of production is a row of «Rotating the secrets» in `deploy/README.md`**: where it lives,
  how it is changed, and what stops meanwhile. A new secret comes with its row and its line in
  `.env.prod.example`, in the same pull request. **The database's password lives in its volume too**, so
  changing the line alone breaks the API (drilled, MOL-287).
- **The images are public** (ghcr, pulled anonymously): nothing secret goes into a layer, a build argument
  or the PWA's bundle — the audit read all five images and the bundle. A secret reaches a container only
  through compose's environment from `.env.prod` on the machine.
- **The repository is public, its history and every pull request's ref included**: a token committed is
  read before it is removed, and a force push removes nothing (`CLAUDE.md`). A secret found there is
  rotated, never rewritten out. gitleaks over the whole history found none (MOL-287); a guard in CI is
  MOL-369.
- **CI's secrets stand in the environment `production`, which admits `master` alone**, and a job holding
  one has `permissions: contents: read`. Actions are pinned by tag, not yet by sha (MOL-364).

## The edges

- **`/internal/*` is closed twice**: Caddy answers 404 for `/api/internal` and below, and the API asks
  `BOT_API_SECRET` — 43 characters, compared in constant time — of every route in its scope. A new route
  of the bot goes into that scope, never beside it. The audit's seventeen spellings of the path (`//`,
  `/./`, `..`, `%69`, the case, `%2F`, `;`, `%00`) all ended in a 404.
- **Caddy sends no CSP, HSTS or `frame-ancestors` yet** (MOL-363); until then nothing on a page may build
  HTML from a person's text — no `v-html`, no `innerHTML`, the bot with no `parse_mode` — as is the case.

## Checking it again

The probes of the audit are scripts against a working copy (`.scratch/tasks/security/MOL-287/probes/`,
`stand.mts` first): IDOR by path and by body, the login's hijack and quota, the flood of receipts and of
proposals, the threshold of three, search timing, the rotation drills on the production stack run locally.
A change to an area they touch runs its probe before the merge; a finding is a probe that shows it, on a
copy, never on production.
