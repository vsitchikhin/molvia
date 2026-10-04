---
paths:
  - 'backend/src/db/{erasure-repository,export-repository,failure,schema}.ts'
  - 'backend/src/{forget,forget-cli,server,index}*.ts'
  - 'backend/src/usecases/{erase-me,export-mine,consent}.ts'
  - 'backend/src/routes/consent.ts'
  - 'packages/model/src/contracts/consent.ts'
  - 'backend/drizzle/*.sql'
  - 'backend/tests/{erasure,erase-route,export,export-route,life,forget-bundle,request-log,login-log,compose-logging,consent}*.ts'
  - 'packages/model/src/contracts/export.ts'
  - 'frontend/src/{components/YourDataGroup,components/EraseSheet,composables/useExport}*'
  - 'bin/forget-actor.sh'
  - 'bot/src/erase*.ts'
  - 'frontend/src/views/{PrivacyView,TermsView,policy}*'
  - 'frontend/src/components/ConsentStep*'
  - 'frontend/src/stores/consent*'
  - 'backend/src/open-food-facts/**'
  - 'e2e/{privacy,export,erase,consent}.spec.ts'
  - 'deploy/Caddyfile'
  - 'docker-compose.prod.yml'
---

# Erasure, the copy, trackers and logs

The detail behind the privacy lines of `CLAUDE.md`.

- **A person can be erased, and erasure is one function** (MOL-58): `ErasureRepository.erase` in
  `backend/src/db`, one transaction under a lock on the owner's row. It removes sessions, search
  picks, where the person stands on the ladder of rating reminders (MOL-101), verdicts with the
  withdrawn ones, events, expenses, trips, exchanges and incomes (MOL-40,
  MOL-66 — the person's own money), spendings, their categories and frozen rates (MOL-73), accounts
  and their checks after every operation that named one (MOL-115), the messages to the developer
  with the owner's replies (MOL-147), login requests by Telegram id
  — they carry no foreign key, so no cascade reaches them — and the owner, adding one to
  `erasures` for the week they appeared (MOL-91). Catalogue items the
  person added stay with `created_by` nulled, the codes they wrote to items stay with `added_by`
  nulled (MOL-100), the words they gave the shops' memory stay with `actor_id` nulled and still count
  (MOL-126: a fact about the shop, never shown as anyone's; a shelf price in it reaches another person
  only with access and from three prices, their lower median), and **every place stays** (owner's decision 24.09.2026). People erase
  themselves through **two doors and one function**: `/delete` in the bot, and since MOL-94
  «Удалить мои данные» in the settings' group «Ваши данные», under «Скачать мои данные» (owner's
  decision В-2: the copy is one row above it). The second is `DELETE /actors/me` in the guarded
  scope — a path with no owner, the session's owner erased by their Telegram id through the same
  `eraseMe`, every session with them and the cookie put out; a repeat is the guard's `401`. **The
  session is the whole proof** (В-1): no second confirmation through the bot, one press of
  «Удалить навсегда» in the sheet (В-4); the price is named in `auth.md`. The sheet says the bot's
  words for what goes and what stays, and what the bot cannot: the copies on this device go, on the
  others they stay — and on those, after an erasure, there is no session left to sign out of, so
  the page names deleting the app or the site's data, and signing out there only beforehand
  (review 1). After the `204` the phone does what «Выйти» does, and the login screen says
  «Ваши данные удалены» once; a `401` on a session already gone erases nothing anywhere and says so
  (`auth.md`). The owner's fallback is
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
- **A person can take a copy of everything, and the copy is what erasure takes** (MOL-93,
  «Скачать мои данные» in the settings' group «Ваши данные»): `GET /actors/me/export`, a path with
  no owner in it, `no-store`, `attachment; filename="molvia-<day in Yerevan>.json"`. **One source
  of truth for what goes in:** every table erasure removes has a section (`EXPORT_SECTION_OF`, a
  `Record<ErasedTable, …>` — a table added to `ERASED_TABLES` does not compile without one), a test
  counts each section against a dry run of erasure for the same person, and every key to `actors`
  must be exported as it must be erased. **And every column** — beyond the ticket: `EXPORT_COLUMNS`
  names each column of those tables as exported or left out with its reason, and a test compares
  it with `information_schema.columns`; a key alone would have let a new note on an exchange miss
  the copy in silence. A table that goes with the person through another — a version of an exchange, a
  purchase of a trip — is found by walking the graph of foreign keys, never across a key that lets
  go (`ON DELETE SET NULL`: `items.created_by`, `item_barcodes.added_by` and `store_memory.actor_id` —
  the item, the code and the shop's memory are everyone's, and so are the tables under them;
  `item_barcodes` and `store_memory` are listed by hand). A fully filled life holds each field of the file
  non-empty in some row, so a column mapped to the wrong field shows, and **every `…Id` in the file
  finds its row in the file** — found by walking the fields, not by a list, so a new reference
  without a section or a name in `catalogue` fails by itself (adversarial review 1, 2; review 11,
  15). **A new table or column that is a person's joins erasure and the copy in the
  same commit.** Besides them: the catalogue items the person added (erasure keeps them, their
  author is still this person), with barcodes, the codes the person wrote to any item
  (`addedBarcodes`, MOL-100 — they say the person held the package; `barcode`, not `code`, since
  `code` is the key the guard against secrets looks for), and — as a reference, not their data — the names of
  the items and places their rows point at, so the file reads; nobody else's author is in it.
  What was decided (owner's approval 29.09.2026, Р-1…Р-7): **what is stored, never what is
  counted** — no unit price, total, balance or chain rate, since those are our arithmetic over the
  data and would go stale with the first fix of a rule; **the removed and the withdrawn are in it,
  marked** (`removedAt`, `withdrawnAt`) — a withdrawn verdict stays a row for the gate, and a removal
  lives its ten minutes of «Вернуть», and both are ours to hand over while we hold them; **no
  secret** — no `token_hash`, no login `code` or `secret_hash` (a session's id is not one: it opens
  only one's own); `actor_id` is said once, in `account`, and `search_key` is left out, made from
  the name. The format is the wire's: English keys, money and quantity as decimal strings beside
  their currency and unit, rates to six digits, days `YYYY-MM-DD`, moments in UTC, and a header
  `format: "molvia-export"`, `version` — a change of what goes in is a new version: 2 since the
  ladder of rating reminders joined it (MOL-101), 3 with a trip's sum from the receipt (MOL-78), 4
  with an exchange's channel (MOL-137), 5 with the codes a person wrote (MOL-100), 10 with a receipt's city,
  trip and lines' items and the shops' memory (MOL-126), 11 with what is left of a message's pictures
  (MOL-167) — never a picture: its bytes live only until the owner's
  Telegram has them. Its codec
  is looser than a screen's on purpose: a copy of what is stored is never refused by a rule a
  stored row predates — an event type since withdrawn, a rate outside today's band. **One
  snapshot:** one transaction, `repeatable read, read only`; it writes nothing, not even the log.
  **The phone hands over the server's file, checking only its envelope** (`format`, `version`): an
  installed app older than the server must not refuse a copy for a field it does not know. It
  rebuilds the text, indented, **so every number in the file is a safe integer and everything else a
  string** — a test walks the codec's JSON Schema for it, and an event's `payload` is a record of
  strings, as the database's CHECK holds it (review 18) — stricter than the rest of the codec, so
  the fully filled life writes one event of every kind (`PAYLOAD_OF`, a `Record<EventType, …>`): a
  kind whose payload the file would refuse fails a test before it fails a person's copy (review
  21). **The file is named by `exportedAt`**, the
  day the server took it, never by the phone's clock after the answer (adversarial Г). On the
  phone (В-1) the file goes to the share sheet — «Сохранить в Файлы», to oneself in Telegram — and
  Safari opens that sheet only close to a tap, with the request in between: refused
  (`NotAllowedError`), the file waits under «Файл готов» for a second tap on «Сохранить или
  отправить», which calls `navigator.share` before any await. **A computer downloads** — a fine
  pointer, since the sheet of a Mac has no «Save» — and so does a browser that cannot share a file
  (Android Chrome does not share `.json`). A sheet the person closed is not an error: the file stays
  under «Файл готов»; a second `share` over an open sheet is `InvalidStateError`, never a reason to
  download as well — the file waits under «Файл готов» instead, a new one from the row included, so
  nothing the server made is thrown away (adversarial Р2-А). **There is no guard of our own**: over
  an open sheet the browser refuses by itself, and a flag or a counter of ours, stuck on a sheet
  whose promise never settled, left first the row and then «Сохранить или отправить» dead (review
  14, 22). A sheet that settles late speaks only for its own file — the last one handed to a sheet —
  and never clears or replaces a newer one under «Файл готов» (adversarial Р3-А). **Leaving the screen while the file is prepared is changing one's mind**: the
  request is cancelled and nothing is handed over on another screen (review 13, adversarial В). The row is inactive (`aria-disabled`), never disabled, and the focus goes
  back to it when the button tapped goes. **Limits, named:** a download inside an installed iOS app
  is checked on the phone, not here; and `spendings` has no CHECK on `rate_base` nor on a positive
  rate, so a row written past the app — by hand, by a bug — would make that person's copy a 500
  until put right. Measured (`.scratch/tasks/selftests/MOL-93.md`): 10 000 spendings, 2 000 purchases and 500
  events read in 0.12–0.14 s, 0.16–0.22 s with the encoding, and weigh 4 MB (5.9 MB as the phone
  writes it, indented); the client waits up to a minute. Rows are grouped by pushing into a `Map`,
  never by copying the group: 40 000 versions of one exchange held the whole API for seconds
  (adversarial Б).
  `/privacy` says what the copy holds — the removed and the withdrawn included — under «Копия ваших
  данных», and names the row by its words.
- **No third-party trackers or analytics, and so no cookie banner** (MOL-58). There are two
  cookies, both strictly necessary: the session and the five-minute one of a login in progress
  (MOL-54); what the phone keeps in its storage is the queue and the drafts the app needs to work.
  **Any third-party script that sees data is a decision, not a dependency** — it changes what the
  privacy page says and is discussed before it lands.
  **A dependency can carry a tracker of its own** (MOL-105): onnxruntime-node 1.30, the runtime of
  the search's model, starts Microsoft's telemetry with its first session — an identifier of the
  device kept on disk and an upload over HTTPS. What it would send was not read through: it is
  switched off, twice: `ORT_DISABLE_TELEMETRY=1` in the code before the library loads and in the image's
  environment. Measured on the VPS: without it the library logs its telemetry starting, with it
  nothing.
- **A third party learns of a code only from the server, never from the phone** (MOL-162, the owner's
  decision on the task): a code the catalogue missed is asked of Open Food Facts by the API, so the base
  sees the code, the server's address and our User-Agent — `Molvia/<build> (<contact>)`, the contact
  from `.env` — and never the person, their phone or their session. **A shop's own label never leaves**
  (`writtenBarcode` refuses it before anything is asked). The answers are kept in `open_food_facts`, a
  code with a day and no one behind it, so neither erasure nor the copy reaches it; `items.origin` is
  the catalogue's licence mark — the base is ODbL, what is derived from it is offered on request — and
  the copy leaves it out with that reason. No photo of the base is ever fetched: a picture from its CDN
  would hand the phone to a third party. `/privacy` says all of it under «Незнакомый штрихкод».
- **A receipt is read on our own server, and its photo lives days** (MOL-125, the owner's decisions of
  27.09 and 02.10.2026): Tesseract in `services/receipt-reader`, a container with no database, no
  disk and no log, asked over the compose network only — no third party sees a receipt. The photo
  carries a customer's name and goes once the receipt is recorded, a receipt not recorded goes whole
  after 28 days, an item line cut out for retraining the reader goes 28 days after recording, and
  none of them ever enters the nightly copy (`pg_dump --exclude-table-data`, В-2) — a copy lives
  fourteen days, longer than the promise. The copy of one's data carries receipts and their lines,
  never a photo. `/privacy` says all of it under «Чеки». `.claude/rules/receipts.md`.
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
  rest of the parameters behind it. `forget` prints the same. A migration failing at boot — or
  under `make migrate`, which prints the same — logs its kind and the statement that failed, DDL
  from our own files (`describeMigrationFailure`, MOL-153): its message is no safer — Postgres
  writes the value a cast refused into it, a person's note under `USING "note"::numeric`. A failure
  with neither a query nor a code is the migrator reading our folder — a file the journal names and
  the folder lacks — and keeps its words. An unknown address answers without echoing it and is not
  logged with its query. What the privacy page (`/privacy`) says about data is a promise these
  rules keep, and it is read before signing in — the one route with `meta.public`, which
  `App.vue` draws past the login screen (MOL-56), linked from that screen and from the settings: a change to either is a change to both — and it says only what they keep: other
  people's prices are shown in the shared mode (MOL-31), so «shown to nobody» is said of the list
  of purchases, and an address can reach Caddy's error log, so «no address» is said of requests.
