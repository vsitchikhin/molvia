---
paths:
  - 'backend/src/db/{erasure-repository,failure,schema}.ts'
  - 'backend/src/{forget,forget-cli,server,index}*.ts'
  - 'backend/src/usecases/erase-me.ts'
  - 'backend/drizzle/*.sql'
  - 'backend/tests/{erasure,erase-route,forget-bundle,request-log,login-log,compose-logging}*.ts'
  - 'bin/forget-actor.sh'
  - 'bot/src/erase*.ts'
  - 'frontend/src/views/PrivacyView*'
  - 'e2e/privacy.spec.ts'
  - 'deploy/Caddyfile'
  - 'docker-compose.prod.yml'
---

# Erasure, trackers and logs

The detail behind the privacy lines of `CLAUDE.md`.

- **A person can be erased, and erasure is one function** (MOL-58): `ErasureRepository.erase` in
  `backend/src/db`, one transaction under a lock on the owner's row. It removes sessions, search
  picks, verdicts with the withdrawn ones, events, expenses, trips, exchanges and incomes (MOL-40,
  MOL-66 — the person's own money), spendings, their categories and frozen rates (MOL-73), accounts
  and their checks after every operation that named one (MOL-115), login requests by Telegram id
  — they carry no foreign key, so no cascade reaches them — and the owner, adding one to
  `erasures` for the week they appeared (MOL-91). Catalogue items the
  person added stay with `created_by` nulled, and **every place stays** (owner's decision
  24.09.2026). People erase themselves with `/delete` in the bot; the owner's fallback is
  `dist/forget.js` in the API image (`make forget` in a copy — `TG` reaches the script through the
  environment, never pasted into the recipe, where a value could close a quote and bring its own
  `--yes`, П-3; and only a `TG` typed on that command line — one left in the shell erased that
  person, MOL-91 Г), a dry run unless `--yes`, and
  **a dry run is the real run, rolled back**, so its count cannot disagree with what erasure does.
  **A new table that points at `actors` must join erasure** — a test compares every foreign key
  on `actors` with `ACTOR_REFERENCES`, and another scans every table for the erased person's uuid
  and Telegram id. **Its first lock is the account's, then the person's login requests, and only
  then the owner** (adversarial О-3, П-2): `for update` on an owner who does not exist yet locks
  nothing, and a login collected meanwhile created an owner the transaction had already decided
  was not there — «nobody to erase» over a live account. Collection locks its request row before
  creating the owner, so the two take turns; and a request not yet confirmed has no Telegram id to
  be locked by, so confirmation and erasure share `lockTelegramAccount`, an advisory lock on the
  account taken first by both — and so does **whatever makes an owner**: `create` and `createIfMissing` take
  it themselves (Р-1), so no path — the login, the development seam, whatever comes next — makes an
  owner inside an erasure. Collection takes the account's lock before its request row (read, lock,
  read again), because taken after it, a collection and an erasure could each wait on the other.
  One order everywhere: the account, then request rows, then the owner. The bot's `sequentialize`
  happens to order one chat's presses too, but that is another module's promise and the two API
  routes have no order of their own. **Cleaning expired requests skips locked rows** (Р-3): it runs
  under the one quota lock every login start takes, and waiting there for an erasure — or a dry
  run of one — holding a person's expired request closed the door to everybody. A dry run still
  holds that one account's lock for as long as it runs. **The page and the bot name what stays in full** — the items, the shops and the count of
  `erasures` —
  and say that copies on the phone are out of the server's reach: nothing clears a device's
  storage for an owner the server no longer knows, since a 401 there is also an expired session.
- **No third-party trackers or analytics, and so no cookie banner** (MOL-58). There are two
  cookies, both strictly necessary: the session and the five-minute one of a login in progress
  (MOL-54); what the phone keeps in its storage is the queue and the drafts the app needs to work.
  **Any third-party script that sees data is a decision, not a dependency** — it changes what the
  privacy page says and is discussed before it lands.
- **Logs live fourteen days and carry no address and no query** (MOL-58). The API logs a request
  as its method and path — the query of `/catalogue/search` is what a person looked for; Caddy
  keeps no access log; Postgres logs its errors `terse`, without the row values of `DETAIL`;
  every container writes to journald, and the term is the host's
  (`MaxRetentionSec=14day`, `deploy/README.md`). **A failure is logged by its kind, on every
  path** (adversarial О-1): name, driver code and stack frames through `describeFailure`, never
  its message — a driver's message is the query with its parameters, and a failed search wrote
  what was searched for and who asked, a dropped connection the hash of every session token in
  flight. **The frames are what follows the stack's own header, cut off whole** (П-1): picked by
  their shape, a line of a multi-line review written as `    at …` passed as a frame, with the
  rest of the parameters behind it. `forget` prints the same. An unknown address answers without echoing it and is not
  logged with its query. What the privacy page (`/privacy`) says about data is a promise these
  rules keep, and it is read before signing in — the one route with `meta.public`, which
  `App.vue` draws past the login screen (MOL-56), linked from that screen and from the settings: a change to either is a change to both — and it says only what they keep: other
  people's prices are shown in the shared mode (MOL-31), so «shown to nobody» is said of the list
  of purchases, and an address can reach Caddy's error log, so «no address» is said of requests.
