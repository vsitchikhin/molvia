---
paths:
  - 'deploy/Caddyfile'
  - 'frontend/vite.config.ts'
  - 'frontend/src/zodJitless.ts'
  - 'e2e/csp*.ts'
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
  - 'backend/src/{env,secret,login-config}.ts'
  - 'bot/src/env.ts'
  - 'packages/model/src/entities/receipt-link.ts'
  - 'deploy/deploy.sh'
  - 'deploy/backup/*'
  - 'deploy/watch/**'
---

# Security: what a stranger must not get, and what holds it

The audit before `v0.2.0` (MOL-287, 03.11.2026; the report and its probes in `.scratch/tasks/security/`) went
over everything with an attacker's eyes for the first time. What was clean is held by the areas' own rules —
IDOR by `resource.ts` and ownership in every `WHERE`, the cookie by `auth.md`, the copy by `privacy.md`; this
file holds what belongs to no single area, and what the audit found missing.

## Who may write how much

- **A write that grows what everybody shares, or what the server keeps on its disk, has a quota per person**
  (MOL-287, owner's В-3 «а»: a cheap way to bring the service down — one request without a session, or one
  account within a minute — is a blocker of the release). **Three have none yet, each a blocker of
  `v0.2.0`**: the login's quota is the whole database's, so one `curl` holds the door shut for everyone
  (Ф-1, MOL-359: five a minute an address, three hundred in all); a receipt's photos have none, and one
  account fills some 12 GB an hour against 51 GB free (Ф-2, MOL-360: forty a day, twenty not recorded at
  once); «Предложить товар» has none, and some nine thousand names an hour go into everybody's search
  (Ф-4, MOL-362: sixty a day). Each task, merged, rewrites its line here. **A new write path names its
  quota in its task**, or says why it needs none. **A person's own rows of money have none either, and
  that is a price, not a reason** (self-review №5): the bodies are small and bounded, but nothing bounds
  their number, and how fast one account fills the disk with them was not measured — the disk alarm of
  MOL-360 is what would say it first.
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
  changing the line alone breaks the API, and it takes only what a URL takes bare — compose puts it into
  `DATABASE_URL` as it is (drilled and attacked, MOL-287). **A secret never goes on a command line**: argv
  is everybody's in `ps`, and the history keeps it on the machine that leaked. Typed at `read -rs`, it goes
  into a pipe, a heredoc, a shell builtin or a command's environment — never its arguments, a variable's
  expansion included (MOL-287, adversarial Р2-А2).
- **The images are public** (ghcr, pulled anonymously): nothing secret goes into a layer, a build argument
  or the PWA's bundle — the audit read all six images and the bundle. A secret reaches a container only
  through compose's environment from `.env.prod` on the machine. **The machine has no login to the
  registry**, so a new image's package is made public before its first rollout — GitHub creates it
  private.
- **The repository is public, its history and every pull request's ref included**: a token committed is
  read before it is removed, and a force push removes nothing (`CLAUDE.md`). A secret found there is
  rotated, never rewritten out. gitleaks over the whole history found none (MOL-287); a guard in CI is
  MOL-369.
- **CI's secrets stand in the environment `production`, which admits `master` alone**, and a job holding
  one has `permissions: contents: read` — all but `HC_CERT_URL` of `watch.yml`, a repository secret to be
  moved there (MOL-368). Actions are pinned by tag, not yet by sha (MOL-364).

## The edges

- **`/internal/*` is closed twice**: Caddy answers 404 for `/api/internal` and below, and the API asks
  `BOT_API_SECRET` — 43 characters, compared in constant time — of every route in its scope. A new route
  of the bot goes into that scope, never beside it. The audit's seventeen spellings of the path (`//`,
  `/./`, `..`, `%69`, the case, `%2F`, `;`, `%00`) all ended in a 404.
- **Nothing on a page builds HTML from a person's text** — no `v-html`, no `innerHTML`, the bot with no
  `parse_mode` — as is the case (MOL-287); the policy below is the second line, never a licence for the first.

## The page's headers (MOL-363)

- **The page's Content Security Policy is a meta of the built `index.html`, never a header** (owner's В-1 «а»):
  the installed app is answered for every address by its worker's copy of `index.html` — `createHandlerBoundToURL`
  — with the headers of the day it was cached, and that copy changes only with the file. A policy in Caddy's
  header, made looser after something broke on a phone, would never reach the phones that had it: `index.html`
  the same, the worker keeps the old answer. In the file, the policy comes with the version. **One statement,
  `CONTENT_SECURITY_POLICY` in `frontend/vite.config.ts`**, put first after the charset by the build alone
  (`apply: 'build'`) — a script before it would run under no policy, and the build fails if one stands there.
  The dev server has none: it puts styles in by `<style>` and talks over a websocket, a policy of its own that
  would prove nothing of production's.
- **No `'unsafe-inline'`, no `'unsafe-eval'`**: `default-src 'self'`; the three scripts of `index.html` by their
  `sha256`, counted by the build from the HTML as shipped — the last plugin, after `outdatedLines` writes into one
  and after the PWA's — every `<script>` without `src`, with attributes or in capitals, none inside a comment
  (review 1, №1, adversarial Г1), so a script added or changed needs no hand; `style-src 'self'`
  (no `<style>` from a script, no `style=""` in the bundle — `el.style` is the CSSOM, which no policy holds);
  `img-src 'self' blob:` (a receipt's photo, a picture to the developer — `data:` is in no build); `font-src`,
  `connect-src`, `worker-src 'self'`; `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`. A source let
  in is let in by name, with its reason here, never `'unsafe-*'` to quiet a violation.
- **`'wasm-unsafe-eval'` stands for an engine whose worker takes its page's policy** (owner's В-5 «а» of review 1):
  zxing compiles its wasm in the scanner's and the QR's workers alone, and in the Chromium and WebKit of the run a
  worker has no policy from the meta — taken out, the scanner read its code there all the same (adversarial А2).
  Whether an engine of the floor (Safari 16.4, Chrome 111, Firefox 125) gives a worker its page's policy was not
  tried, and there the scanner at the shelf would refuse to read. **The price, named:** on the engines of the run it
  lets the page alone compile wasm, which no line of its bundle does — a script injected could, a little past what
  it can do already.
- **Zod is told it may not compile** (`frontend/src/zodJitless.ts`, the first import of `main.ts`): Zod 4 asks
  `Function('')` in a `try` as it builds an object schema — the model's are built as its modules load, and
  `@/catchers` pulls them in first, so the config stands before it, not merely before the first parse — and under
  a policy with no `eval` the browser reports the question itself as a violation. The answer is the same; the
  report went away.
- **What a meta cannot say is Caddy's**: `Content-Security-Policy "frame-ancestors 'none'"` — «Удалить мои
  данные» in another site's frame is a click taken — and `Strict-Transport-Security "max-age=31536000"`, with no
  `preload` and no `includeSubDomains`, each a decision of its own. **Never for `localhost`** (`@public not host
localhost`): HSTS holds by the host's name, not its port, and the production stack tried on a laptop would turn
  every dev server of that browser on `localhost` to https for a year. No `X-Frame-Options`: every engine of the
  floor of the build knows `frame-ancestors`. `backend/tests/caddyfile.integration.test.ts` holds the file as
  text, the three headers before it too.
- **The proof is the built app's end-to-end, with no violation** (owner's В-2 «а», `e2e.md`): every spec of a
  build comes through `e2e/csp.ts`, which fails it on any; `csp-built.spec` holds the meta and its hashes and walks
  what a directive decides. **Production reports nothing** (В-3 «а»): a policy that blocks the bundle leaves nobody
  to report, and the walk covers the rest, signed in on both engines — WebKit by the test making the page's requests to
  the API with the seam's session (adversarial А1, `e2e.md`), with no worker there. **WebKit refuses its own inline style of every `<select>`** (`style-src-attr` —
  a bare `createElement('select')` too), on six screens signed in, with nothing seen to change on the screen;
  `e2e/csp.ts` lets go every `style-src-attr` report at a `<select>` on WebKit and one line of its console for each,
  and the policy stays strict (owner's В-4 «а»). No field of a report tells the engine's style from ours — `sample` is
  empty for both, the policy asking none (adversarial Б1 of review 2). Whether Safari on a phone reports it too was not
  tried. **The prices, named:** an inline style of ours on a `<select>` is let go on WebKit — Chromium, walking the
  same screens, fails on it, and no screen has a branch of iOS alone that could set one; Firefox never ran under the
  policy — Playwright's Firefox does not start in the sandbox of the sessions — so which engine of the floor gives a
  worker its page's policy rests on none tried; the
  scanner is walked on Chromium alone (WebKit has no fake camera), and the QR's worker of a Serbian receipt on
  neither, sharing the scanner's sources; a worker has no policy of its own
  — a meta binds its document, a worker's script comes with Caddy's headers alone — and runs only our code over
  frames, never a person's text; a `report-uri` cannot be said in a meta.

## Checking it again

The probes of the audit are scripts against a working copy (`.scratch/tasks/security/MOL-287/probes/`,
`stand.mts` first): IDOR by path and by body, the login's hijack and quota, the flood of receipts and of
proposals, the threshold of three, search timing, the rotation drills on the production stack run locally.
A change to an area they touch runs its probe before the merge; a finding is a probe that shows it, on a
copy, never on production.
