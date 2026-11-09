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
  - 'bin/check-pins*'
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
  account within a minute — is a blocker of the release). **The login's is an address's** (Ф-1,
  MOL-359): five starts a minute from an address, three hundred from everybody — `auth.md`. **Two have
  none yet, each a blocker of `v0.2.0`**: a receipt's photos have none, and one
  account fills some 12 GB an hour against 51 GB free (Ф-2, MOL-360: forty a day, twenty not recorded at
  once); «Предложить товар» has none, and some nine thousand names an hour go into everybody's search
  (Ф-4, MOL-362: sixty a day). Each task, merged, rewrites its line here. **A new write path names its
  quota in its task**, or says why it needs none. **A person's own rows of money have none either, and
  that is a price, not a reason** (self-review №5): the bodies are small and bounded, but nothing bounds
  their number, and how fast one account fills the disk with them was not measured — the disk alarm of
  MOL-360 is what would say it first.
- **What answers without a session is limited by the address Caddy names**, never by anything the client
  sends: the last `X-Forwarded-For` only from a peer inside, an IPv6 address by its `/48` (`addressOf`,
  `/client-errors`, MOL-144, and the login's start, MOL-359), counted in the API's memory
  (`addressMinute`). A forged header changes nothing — the audit sent sixty under sixty addresses
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
  `DATABASE_URL` as it is (drilled and attacked, MOL-287). **What reads the database for counters has a role of
  its own, never the owner's password** (MOL-366): postgres_exporter is `molvia_metrics`, `pg_monitor` and no
  table, its password `METRICS_DB_PASSWORD` set by the API at its start (`observability.md`). **A secret never
  goes on a command line**: argv is everybody's in `ps`, and the history keeps it on the machine that leaked.
  Typed at `read -rs`, it goes into a pipe, a heredoc, a shell builtin or a command's environment — never its
  arguments, a variable's expansion included (MOL-287, adversarial Р2-А2).
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
  moved there (MOL-368).

## What CI runs is pinned

- **Every `uses:` is a full commit sha with its release in a comment, every base image an exact tag and its
  digest** (MOL-364, owner's В-1 «а»): `actions/checkout@3d3c…90b1 # v7.0.1`,
  `FROM caddy:2.11.9-alpine@sha256:…`. A tag is a pointer whoever publishes it can move, and the next run
  takes what it points at then — the way secrets of CI leaked through `tj-actions` in 2025; `release.yml`
  holds the deploy key and Cloudflare's token beside its actions. A floating image tag, besides, built
  something nobody saw: under `caddy:2-alpine` the audit found 2.11.7, three days later it was 2.11.9.
  `bin/check-pins.mjs` in `npm run lint` refuses either form left out — in a workflow and in an action of the
  repository wherever it lives (`action.yml`, its `image: docker://…` too), and a step `uses: docker://…` as
  an image, in a Dockerfile: its `# syntax=` — the image BuildKit hands the whole file to, read as BuildKit
  reads its directives, a byte order mark and a first line of `#!` passed over, the first word of the value —
  `FROM`, `COPY --from` and `RUN --mount=…,from=`, an instruction's lines joined at `\` — and a comment naming
  a major alone (`# v7`). **A Dockerfile is known by its name**: Dependabot's word, `dockerfile` or
  `containerfile` in any case, bounded by the name's ends, `.`, `-` or `_`; a file of a kind `OTHER_KIND`
  lists by its extension (`.md`, `.py`, `.yml`…) is not one, and a kind it does not list is read. A workflow
  or an action is read as one, whatever its name holds. **An exact tag is a closed rule**, not a list of
  floating ones: a version of three numbers at its start (`2.11.9-alpine`, `v1.153.0`) or the day of a
  snapshot (`trixie-20261104-slim`); `latest`, `22`, `2.11-alpine`, `lts-alpine`, `trixie-slim` are refused. A
  stage of the file — named only after its own line, so `FROM caddy AS caddy` is an image — `scratch` and a
  local action are not pinned. **The digest is what runs**: Docker pulls it and never reads the tag, so a tag
  changed by hand without its digest changes nothing, and which tag a digest is only the registry knows — the
  check holds the form, Dependabot the pair. **What the check is**: a guard against the ordinary spelling, not
  a form built to slip past it — the boundary of `check-clock-bounds.mjs`: `uses:` and `image:` as the key at
  the start of their line or after `- `, the value on that line; a Dockerfile's lines joined at `\`, the
  default escape, a comment never an instruction nor going on with one, a blank line inside dropped, CRLF read
  as LF, the quotes of a value taken off and the keys of a mount in any case, as BuildKit reads them;
  Dependabot's directories written out — a pattern there is refused rather than guessed at. **It holds actions
  and images, nothing else a build fetches**: a file `ADD` takes by a URL or from git, and whatever `RUN`
  downloads, are review's, and their pinned forms (`ADD --checksum=sha256:…`, `#<full sha>`) with them
  (adversarial Р3-А3) — no Dockerfile here has either. **The price, named:** a Dockerfile named past that rule
  — the word inside another, an extension of another kind — is not read, and the name of a new one is
  review's, as `release.yml` names each it builds (adversarial Р5-А2, Р6-А2, review №12); another spelling of
  YAML (a value on the next line, a flow mapping, a quoted key) is past it, and only GitHub's
  `sha_pinning_required` refuses such an action, at the run (adversarial Б1); a value as BuildKit's pass of
  shell words rewrites it — quotes or `\` inside a word, `"from"=…` — is past it (adversarial Р10-Г1); the
  `image:` of a workflow's container or service is not read (below); and **a sha is trusted as the action's
  own** — GitHub serves a commit of any fork under the action's name (adversarial Г2, «imposter commits»),
  which neither the check, the setting nor Dependabot tells from a release: a sha written by hand rather than
  by Dependabot is review's to check against `gh api repos/<action>/commits/<tag>`.
- **Dependabot moves the pins**: actions monthly, the base images weekly in one group (`images`), the sha or
  the digest with its tag or comment; a major of Node never, since it is `.nvmrc`'s, which CI runs on too.
  **Every directory with a Dockerfile that takes an image is in the docker entry's `directories`**: the check
  refuses one left out, since a digest nobody moves is frozen for good (adversarial В1). A security update of
  npm comes in one pull request (`security`, `applies-to: security-updates`), Playwright's apart, as its
  version updates. **The price**: a patch of Alpine under the same tag no longer comes with any build — only
  with the bot's pull request, a week late at most and merged by the owner. **Not watched**: the images of
  compose (`pgvector` — a contract of ICU and glibc that a migration moves, `deploy.md`; the exporters and
  cAdvisor on `metrics`, which has no way out — each move of `docker-compose.prod.yml` a copy by hand to the
  machine) and `services:`/`container:` of `ci.yml`, the Playwright image held by its own check (`e2e.md`).
- **Settings outside git, written here since nothing else holds them** (MOL-364): secret scanning and push
  protection, Dependabot alerts and security updates on; Actions only GitHub's own and `docker/*`
  (`allowed_actions: selected`, owner's В-3 «а») and only by a full sha (`sha_pinning_required`). A new action
  of another author is a dependency to discuss, then a pattern in that list. Checked by
  `gh api repos/vsitchikhin/molvia --jq .security_and_analysis` and `…/actions/permissions`.

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
