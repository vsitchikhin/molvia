---
paths:
  - 'bot/**'
  - 'packages/client/src/bot.ts'
  - 'backend/src/routes/internal-auth.ts'
  - 'backend/src/usecases/bot-login.ts'
  - 'backend/src/usecases/{remind-ratings,rate-from-bot,reminders-switch,tell-receipts,broadcast}.ts'
  - 'backend/src/routes/{reminders,receipt-notices}.ts'
  - 'backend/src/db/{reminders,broadcasts}-repository.ts'
  - 'backend/src/{notify,notify-cli}.ts'
  - 'backend/tests/{broadcasts,notify-bundle}.integration.test.ts'
  - 'bin/notify.sh'
  - 'backend/tests/reminders*.ts'
  - 'packages/model/src/{entities,contracts}/reminder.ts'
  - 'packages/model/src/contracts/{receipt-notice,broadcast}.ts'
  - 'backend/tests/receipt-notices*'
  - 'frontend/src/views/BotView*'
  - 'frontend/src/components/BotSwitchRow*'
  - 'frontend/src/composables/{useReminders,useReceiptNotices}*'
---

# The bot, and what it is allowed to know (MOL-55, MOL-58, MOL-101, MOL-129, MOL-237)

The bot did two things in 0.1, and 0.2 gives it a third — the rating reminder, below. It is the
second half of the login: the one place a person is shown **which device** they are letting in and
says «yes» to it by hand. And it is where a person
**erases themselves** (MOL-58): `/delete`, one question naming what goes and what stays, one
press — the only channel people are given, because there Telegram already says who is asking.

- **Whose data goes is `ctx.from.id`, never anything in the button.** The button carries the
  action and the second it was issued, and it means yes for ten minutes
  (`ERASE_BUTTON_SECONDS`); older, without a time or from the future, it is refused over the
  message and taken away. The API answers `204` whether there was anyone to erase or not, and the
  bot writes one sentence for both — «ваших данных в Molvia нет» — so the second press of a double
  tap cannot overwrite the first with something that sounds different. **«Отмена» is not an
  outcome** (adversarial О-2): it is shown over the message and takes the buttons away, and its
  words are true whichever button came first — written in, «Ничего не удалено» overwrote «Готово»
  over an account already gone. When Telegram will not take the alert, the same words go under
  the message as a reply, and the buttons go only once something was said (П-4): a refusal may be
  silent because its buttons stay, and this one takes them. **A button too old to mean yes is
  answered the same way** (Р-2) — it too takes the buttons, and it was «Удалить навсегда» that
  was pressed. **Under the message speaks only the press that took the buttons away** (С-1): the bot keeps no
  state, but Telegram refuses to take away buttons already gone («message is not modified»), so
  the second press of a double tap stays quiet; if nothing can be said at all, the buttons are put
  back. The erase composer is installed **before** the login's, which
  ends in a catch-all that greets every text.

- **The i18n rule of the frontend covers the bot too, and this is the line that says so.** Not a
  string of text in the code — every message is a key, Russian first, English mirroring it. The
  dictionaries are `.ts` rather than `.json`, unlike the PWA's: there Vite loads them, here the
  module is read by `tsx` and bundled by esbuild, where a JSON import in ESM wants attributes.
  The keys become a type as a result, so **the two languages mirror each other by the type
  checker**, and the test is left to cover what types cannot see — an empty value and a lost
  substitution. The language is `pickLocale` of `packages/model`, the very rule the PWA uses:
  Telegram's `language_code` is an IETF tag like any other, and a second copy of that decision
  would be a second place to drift.
- **The bot keeps no state of its own.** The login code rides in the button's `callback_data`,
  which is Telegram's memory rather than ours, and everything else is asked of the API — the
  only write path there is. So nothing survives a restart, because nothing needs to.
- **The pulse holds two moments in memory and nothing else** (MOL-142, `pulse.ts`): when its last
  ping succeeded and when a `getUpdates` last did. A claim of reminders that went through beats at
  most once in five minutes, by a monotonic clock — a wall clock stepped back an hour kept it silent
  for an hour (adversarial А3) — and only while **the bot hears Telegram**: a `getUpdates` succeeded
  within two minutes (`hearTelegram`, a transformer on the bot's own API). The claim alone proved
  the API, not the sign-in: the runner retries a failing `getUpdates` for up to fifteen hours with
  the process alive, and half an hour of Telegram down kept the pulse «alive» over a sign-in that
  was dead (А1). **The first beat comes a minute into the process**, never at once: a bot dying
  on a revoked token or a second poller (`401`, `409`) beat on every restart of its crash loop
  (А2) — such a process does not hear Telegram anyway, and the minute is the margin on top. Five
  minutes made rollouts a few minutes apart add up into a false alarm (round 2, Г1). A failed ping is tried a claim later; one on its way is not doubled; none waits for an
  evening's messages. Without `BOT_PULSE_URL` — every copy and the end-to-end run — not one request
  leaves; the URL is never logged, and a failure is logged by its kind. It is not in the API's
  `/health`: `deploy.md` says why.
- **A failed `getUpdates` is retried at a pause growing by a tenth of a second a try**
  (`retryInterval: 'quadratic'` in `startBot`), not the runner's doubling: after half an hour of
  Telegram down the doubled pause had grown to some 27 minutes, and the sign-in stayed dead that
  long after Telegram was back. Now it is seconds — and a stop during an outage waits out at most
  that pause, since no stop cuts it short.
- **The runner's own log is off** (`silent: true`, round 2 Г2): it printed a failed `getUpdates`
  whole, and grammY's network error carries the request's address — the bot's token in it — into
  journald, on every try. A failure of a call to Telegram is logged by its kind, `telegramFailure`
  — Telegram's code or `network` — and so is the one the runner gives up on (a revoked token, a
  second poller, fifteen hours away): `index.ts` catches it, says
  `[molvia] telegram: <kind>, stopping` and exits 1 for compose — left unhandled, Node printed it
  whole, token and all (round 3 Д2).
- **Who the bot is, it asks itself, before the runner starts** (`introduce`, round 3 Д1). Left to the
  runner, `getMe` was grammY's `bot.init()`: a silent retry doubling its pause up to twenty minutes,
  so a bot started while Telegram was away stayed deaf some seventeen minutes after it came back and
  said nothing in the log. Now the pause grows as the runner's does, a 429 waits what Telegram asks,
  each failure is `[molvia] telegram getMe: <kind>`, and a stop cuts the wait short. **Only what may
  pass is retried** — the network, a 5xx, a 429 — as grammY did; any other code ends the process:
  a 401 is a token revoked or cut short, a 404 one Telegram cannot read at all — a stray character
  before it or after it gives one or the other — and retried forever they made a
  live, silent bot where the rollout and the guide look for a crash loop (round 4 Е1).
- **Updates of different people are handled at once; updates of one person, in order** — and
  both halves are load-bearing (MOL-55, О-4). `bot.start()` handles updates strictly one after
  another, which is grammY's ordering guarantee and was measured costing the next person their
  whole turn: while the API thought for 300 ms, their request did not leave at all, and a queue
  measured in whole timeouts outlives the login requests standing in it. `@grammyjs/runner` is
  the answer — a dependency the owner agreed to on 24.09.2026 — with `sequentialize` by chat
  keeping the other half: «Войти» and «Это не я» pressed one after the other must end where the
  second press says, not where the faster answer does. Both succeed on their own — `confirm` is
  idempotent and `decline` works on a confirmed request — so unordered they would leave «Вход
  подтверждён» standing over a request that was in fact put out. **The price of that ordering is
  named** (Е1): presses of one chat queue behind each other, so somebody tapping a silent API
  waits a whole `API_TIMEOUT_MS` per tap. Nothing can fix it here — the alert _is_ the answer to
  a press, a press is answered once, and the answer is unknown until the API replies.
- **The question is asked from the account owner's side** (З-2, owner's decision 24.09.2026):
  «Впустить это устройство в ваш аккаунт Molvia?», and the last line names what it costs to
  get it wrong. «Войти в Molvia?» over a button labelled «Войти» read as «log _me_ in» — the
  wrong way round for the one attack the button exists to stop, where a stranger's link makes
  your tap let **their** browser into **your** account.
- **An outcome is written into the message; a refusal is only shown over it** (О-1). Both
  presses of a double tap leave before the first edit lands — the buttons are still on screen,
  which at a shelf on a slow connection is ordinary — so the second was refused by the API,
  correctly, and used to **overwrite «Вход подтверждён» with «Начните вход заново»** over a
  session already granted. A refusal goes to `answerCallbackQuery`, which cannot rewrite what
  is written. The buttons then go only if the link is dead: «the API did not answer, try again»
  has to keep the very buttons it asks for.
- **Confirming twice from the same account is a success, not a refusal** (О-2). A confirmation
  that was written while its answer was lost left the bot unable to tell that from «not written»
  — and it chose wrong, twice: «не получилось», and then «начните вход заново» on the link
  opened again. So `confirm` is idempotent for the same account (another one is still refused —
  that is what the button is for), and a preview says `confirmed`, **whether and not who** (Р-11).
  The bot then says the one true thing: it is confirmed, go back to the app — **and offers «Это
  не я» with it** (Б1). That sentence reaches two people, because «whether» cannot tell them
  apart: the one who just pressed the button, and the person whose link leaked and was confirmed
  from a stranger's Telegram, whose browser is about to collect a session of **somebody else's**
  account. Pure reassurance at that moment is worse than the confusing «ссылка больше не
  действует» they used to get, and `decline` still works on a confirmed request until it is
  collected — the button is the only way to reach it. Telling the two apart needs no id to leave
  the server (the preview could take the asker's), and until it is asked for, the answer is the
  same for both and safe for both.
- **A refusal is shown over the message and written nowhere — and that rule has no exceptions**
  (О-1, and two rounds of trying to make one). Telegram will not answer a callback query that
  aged out while the API was thinking, and then the refusal reaches nobody (В1). Both cures were
  worse than the disease. A **new message** stayed in the chat for good, so the successful retry
  it asked for rewrote the question above it and the last word was a refusal over a login that
  had happened (Г1). **Editing the question** was worse still: it rested on «the API did not
  answer, so no press of this message can have succeeded», which is false — the API can answer
  one press and time out on the next, which is the very case idempotent `confirm` exists for —
  and it erased «Вход подтверждён», handed the buttons back, and «Это не я» among them would
  then put out the person's own confirmed login (Д1). So when the alert cannot be shown, nothing
  is said: the buttons are still there, and the next press carries a **fresh** query that can be
  answered. What that press is made cheap by is the **bot's own API timeout — five seconds, not
  fifteen** (`API_TIMEOUT_MS`): the answer has to be given while the finger is still on the
  button, the API's work here is one indexed row, and a press given up on early is safe to
  repeat. The residue is named: if the alert cannot be shown, that press produces no words at
  all — for a dead link the buttons go instead, and opening the link again says it in full.
- **The spinner is cosmetic, and its failure is not news.** `answerCallbackQuery` throws on an
  aged-out query; on the success path it stands in a `finally` after the outcome is written, and
  letting it out wrote «update failed» in the log about a login that had just succeeded (Г2) —
  the same wrong-thing-named-as-broken that З-4 removed from the other path.
- **The «Это не я» of an already-confirmed request reaches anyone holding the link**,
  so a stranger can put out a login somebody else confirmed — a denial of service, not a
  takeover, since confirming with their own account is still refused (В2, owner's decision
  24.09.2026). Accepted for the asymmetry: a cancelled login costs seconds and is visible, while
  the hijack that button rescues is silent and permanent. The same power over an _unconfirmed_
  request has always been there — the prompt itself carries «Это не я».
- **«message is not modified» is an answer, not a failure.** An idempotent second confirmation
  rewrites the message with the text it already carries, Telegram refuses that, and reading the
  refusal as «the message is gone» put a duplicate reply in the chat on every double tap (Б2).
  And the **outcome is written before the press is answered**, with the answer in `finally`:
  `answerCallbackQuery` throws on a query Telegram has aged out, and with it first that left the
  login made but the message still showing the question (П-2).
- **It repeats none of the API's rules.** The five-minute term, the one-use rule, the quota and
  «expired, spent, declined and unknown are one answer» belong to MOL-54 and are read off its
  refusals. The bot adds exactly two things: the account, which only Telegram can vouch for,
  and the person's explicit consent.
- **A handler's failure is logged by its kind and reported to the API by its handler** (MOL-143,
  `failure.ts`): `bot.catch` printed the error's message before. Only a defect is reported — never
  the network, Telegram's 403, 429 or 5xx, or the API's own answers — and the handler is the kind of
  update and the prefix of its button or command, never the button's data, the text or `ctx.from`.
  **The owner's notices** are the bot's second timer, the twin of the reminders'
  (`POST /internal/owner/claim`, `owner.ts`): claimed, already marked, sent one by one in Russian.
  The rules are in `observability.md`.
- **Telegram updates are never logged whole** (the privacy page, п. 4.3): an update carries a
  name, a username and a language we deliberately do not store. What goes to the log is the code
  of the error and the operation that failed. How a press is answered — `settle`, `refuse`, the
  spinner, the keyboard — lives in `answer.ts`, shared by the login, erasure and the reminder.
- **A copy without `TELEGRAM_BOT_TOKEN` or without `BOT_API_SECRET` does not start**, says so in
  one line and exits 0 — «this copy has no bot» must not become a restart loop under compose.
  Such a copy signs in through `POST /dev/login` and cannot use Telegram at all.

## The rating reminder (MOL-101)

The lever of gate 0.2: the day after a purchase the bot asks «вчера · Ереван Сити — Молоко — как
вам?» under a scale of 1–5, and a press is the verdict. The owner's decisions of 29.09.2026 are
В-1…В-4 and the ladder Л-1…Л-6 in `.scratch/tasks/requirements/MOL-101.md`.

- **The API decides, the bot only sends** (Р-1). Every minute the bot asks
  `POST /internal/reminders/claim`, behind the same `BOT_API_SECRET` as the login and erasure; the
  API picks whose evening it is, which step is due and what to ask about, and **marks the step in
  the same transaction it hands it out** (`rating_reminders`, a conditional upsert on the day it
  was found at). Pushing from the API would have meant an HTTP server in the bot and a second
  secret; giving the API the bot's token, a second sender in Telegram. So the bot still keeps no
  state and has no schedule — its one timer asks, and a restart loses nothing.
- **At most once, not at least once** (Р-2). The step is marked on handing out, not on sending: a
  bot that dies in between loses that evening's reminder, and nothing sends it twice. A message too
  many is what gets a bot blocked, and a blocked bot cannot deliver a login either.
- **So a person is claimed alone and fails alone** (adversarial А). Each claim commits by itself;
  one that throws goes to the log as `rating reminder failed` and the rest of the minute go on — the
  whole answer thrown away had every person of the minute marked and none reminded. **What can be
  sent is decided before anything is marked:** an item whose name or place predates today's rule of
  visible text would fail the contract the bot reads, so the claim skips it (it stays in «Оценки»)
  and marks only for what it hands over. **The claim has its own timeout, thirty seconds**, not the
  press's five: no finger waits for it, and a claim given up on early is a minute marked and lost.
- **Nothing is asked of the database it cannot answer** (adversarial В, review Т-5): outside every
  zone's evening the use case returns at once, and a person is claimed for step 1 only if they
  bought a product they have no live verdict on since the day asked about — by the purchase's day,
  `least(entered, trip finished)`, as the claim reads it, not by the entry (adversarial Е). **A
  claim that found nothing settles the evening** (`QuietToday`, the API's memory of one entry a
  person): an item only with a name the bot cannot be handed passes the filter and would otherwise
  open an empty claim every minute. **A purchase entered after it opens the evening again**
  (adversarial И): the memory keeps the latest entry of an unrated purchase it saw, and the milk
  written into yesterday's closed trip at 20:00 moves it — «nothing at 19:00» is an answer about
  19:00, and tomorrow that milk would be too old to ask about. A restart forgets it; the cost is one
  more empty claim.
- **The ladder is the owner's** (29.09.2026), and it lives in the domain (`planReminder`): step 1 at
  19:00 of the day after a purchase; nothing rated since — step 2 three days later, step 3 a week
  after that, then **six calendar months of silence**, and after it only what was bought after the
  pause. Steps 2 and 3 ask about everything unrated since the ladder began, so a purchase between
  steps waits instead of starting a reminder of its own. **Any live verdict of the person's after
  the last reminder starts the ladder over** — from the screen or the bot, during the pause too; a
  withdrawal is not a verdict, and a repeat of the same score does not move `updated_at`.
- **The person's day, in their country's zone** (`timeZoneOf`, `localClock`): 19:00 to 22:00 of it
  (`REMINDER_HOUR`, `REMINDER_LAST_HOUR`). An evening missed entirely is lost, never sent at night;
  a step is due until sent, so it comes the next evening. Days in SQL are turned into instants by
  Postgres with the zone named — never the session's `timezone`. A country without a zone is not
  reminded; a test holds every country the settings accept to having one — Tbilisi's and
  Belgrade's since MOL-109, Belgrade's with its summer time, so the evening is theirs all year.
- **A message an item, at most three a day, only the first one rings** (В-1). The freshest three;
  under the last, how many more wait in «Оценки» with the link — as text, since Telegram refuses an
  inline button to an `http://` address and a copy in development has one.
- **What is asked about is `pendingVerdictsFor` with a window of days** — the very selection of
  «Оценки», products only, deleted trips out — plus the answer to MOL-29 (В-3): **not a purchase
  made before the person withdrew their verdict on the item**. One after the withdrawal is a new
  experience and is asked about. The screen is unchanged.
- **The message is always Russian** (Р-7): it is sent without an update, and the person's language
  is not something we keep (the privacy page). The answer to a press speaks the presser's.
- **A place is named with its city only where two items of one reminder share its name** (MOL-120)
  — «Вчера · Ереван Сити в Ереване» beside the Gyumri one, the name alone otherwise. The rule is
  the domain's `cityWhereNameRepeats`, the one «Оценки» reads, so the bot keeps none of its own —
  **applied to the reminder's own items** (В-1): a reminder of three may name a shop alone that
  «Оценки», holding its namesake as a fourth card, names with its city (adversarial А5). The city's
  case is a key of the dictionary (`remind.in.<город>`) by the city of the settings the spelling
  folds to (`settingsCityOf`: «гюмри» is «в Гюмри», А2); a city of none is bracketed, and a test
  holds a key for every city of the settings. An API before MOL-120 sends no city (`placeCity` is
  optional), and the names stay as they were.
- **A press is the verdict of whoever pressed** — `ctx.from.id` through
  `PUT /internal/verdicts/:itemId` into the same `rateItem`; the button carries the item and the
  digit and nothing else (43 bytes of 64). Only a score travels, so the review stays (MOL-27). An
  unknown account or item is `404`, and the bot says «аккаунта или товара больше нет» over the
  message and takes the scale away.
- **The outcome is written under the question and the scale stays** (Р-6, `settleKeeping`), the
  pressed digit marked: a slip of the finger is one more press, every press is the same idempotent
  verdict, and `sequentialize` keeps them in order, so the last press is the verdict and the
  message says so. This is the one outcome that keeps its buttons: the login's and erasure's close
  a question, this one records an opinion that may be changed. The outcome begins at a mark
  (`\n\n✓ `), and a second press replaces everything after it — the bot keeps no state, and
  Telegram's copy of the message is the only memory there is.
- **A failure to send is logged by its code, never the chat** (the privacy page). A 403 — the bot
  was blocked — ends that person's messages of the evening and turns their reminders off (MOL-103,
  below).
  **A 429 is waited out once** (review Т-4), by Telegram's `retry_after`: at 19:00 all of Armenia
  is one batch. **Asked to wait longer than ten seconds, the bot gives the rest of the run up at
  once** (adversarial З) — that is flood control over the whole bot, a retry before it ends is
  refused for certain, and waiting the cap on every message spent minutes to send nothing. **An
  assumption, not a measurement:** that a long `retry_after` is the whole bot's and not one chat's
  — if Telegram gave it for one chat, the rest of that minute is given up with it. Only live
  Telegram can say. The
  bot's container has thirty seconds to stop (`stop_grace_period`); **a stop cuts every wait
  short**, the messages left go without pauses, and the runner stops beside the reminders rather
  than after them.
- **A failure in the bot's channel outside the login is logged as `bot request failed`**
  (adversarial Г): «authentication failed» over a failed reminder sent whoever read it to the login.
  Erasure (`/internal/actors/erase`) is logged so too since — it is not a login (review Т-9).
- **The lever is counted** (В-4): `reminder_days`, by Yerevan day and with no id, holds how many
  people got each step, how many items were asked about and how many verdicts a press gave;
  `make gates` prints it as its fourth block, the share beside its n and no verdict. **A press
  counts only the first verdict on the item** (adversarial Б) — a withdrawn one given again is not a
  second, or one item asked about read «2 of 1 — 200 %». More presses than items is then a message
  forwarded and pressed by somebody else too, or the window's edge — printed as it is with both
  reasons (adversarial Ж). **The price** (review Т-8): an item asked about after its verdict was
  withdrawn (В-3) is counted among the items, and its press is never «first» — the lever errs
  towards «not pressed» there too. **Counted after the verdict, in a transaction of
  its own** (review Т-7): a failure in between leaves the verdict written and the press uncounted —
  the lever errs towards «not pressed», a named price.
- **The ladder is in the person's copy** (MOL-93, Л-5): `ratingReminders` of the file, version 2.

## The switch (MOL-103)

A bot that writes every evening and cannot be told to stop is a bot that gets blocked — and a
blocked bot cannot deliver a login either (MOL-55). The owner's decisions of 02.10.2026 are В-1…В-4
in `.scratch/tasks/requirements/MOL-103.md`.

- **One column, `actors.reminders_off`, and it says why** (Р-2): empty is on, as every account
  starts; `chosen` — the person turned them off; `blocked` — they blocked the bot. Not a column of
  `rating_reminders` (review Т-3): a ladder with nothing to ask about deletes its row, and the
  switch would go with it. The reason is kept because the two end differently, and `switchReminders`
  in the domain is the whole rule: **blocking does not overwrite «chosen», and unblocking turns on
  only what blocking turned off** (В-1) — someone who said «не напоминать» and later unblocked the
  bot to sign in is still not reminded. The person's own «on» clears either from the bot; from the
  settings, only «chosen» (В-5, below).
- **The settings cannot lift a block** (В-5, owner's decision 02.10.2026): `switchReminders` takes
  where a change came from, and «on» from the settings leaves `blocked` as it is — the group shows
  the switch inactive and says to unblock the bot. Turned on over a blocked bot, the next evening's
  403 turned it off again: a switch promising what nothing could keep, a step counted that never
  went out, and one block counted as many in `make gates` (adversarial Б). A press in the bot does
  lift it: whoever presses «Вернуть напоминания» there has not blocked it.
- **Off is off, whoever turned it** (Р-4): `candidates()` leaves them out, so nothing is planned,
  marked or counted; the claim checks it again under the owner's row. **The named price:** a switch
  committed after that check lets one evening go — `for key share` does not wait for it.
- **Turned on, the ladder starts over** (Р-3): its row is deleted in the same transaction. Kept, a
  ladder switched off at step 1 in October and on in January finds step 2 «overdue» and asks about
  everything since September; started over, it is a step 1 about yesterday. **Unless it reminded on
  the person's today** (adversarial А): «Не напоминать» and «Вернуть» pressed by a slip of the
  finger, or a block lifted ten minutes later, deleted the one row that says «already asked today»,
  and the next minute asked the same questions again — the «at most once» of MOL-101 broken by its
  most ordinary path, and the lever counting it twice. So the use case passes `now`, and a ladder
  whose `reminded_on` is the person's today in their zone stays. Under the owner's row first, then
  the ladder — the order erasure takes them in (`privacy.md`).
- **In the app it is its own address, never the settings form** (Р-1):
  `/actors/me/reminders`, read and saved on the tap, as «Зарплата — в следующий месяц» is
  (MOL-134) and for the same two reasons — the form's four fields are also a trip's context, and
  an installed app reads `/actors/me` strictly. Since MOL-129 it is a row of the page «Бот»
  (below), which says once why nothing comes when a block turned it.
- **In the bot, «Не напоминать» stands under the last message of the evening only** (В-2) — one line
  in the chat, not three — and once pressed **«Вернуть напоминания» takes its place** (В-3): it sits
  beside the scale, and a slip of the finger is one more press, not a trip to the app. Both are
  `ctx.from.id`'s, only in a private chat, and carry the action alone (`remind:off`, `remind:on`).
  The API answers `204` to «off» for an account it does not know — «off» is true of nobody too — and
  **`404` to «on»** (adversarial В): «Напоминания снова включены» to an erased account was a false
  statement about its data, so the bot says «аккаунта больше нет» over the message and takes the
  buttons. **A press of the scale answered «gone» keeps the switch's row** (review №3): it is the
  evening's only «Не напоминать», and the item gone is not the reminders gone.
- **Two outcomes share the message and neither erases the other** (Р-7): a rating's after `✓`, the
  switch's from its own 🔕 or 🔔, in that order. The keyboard is rebuilt from the message's own
  `reply_markup` (`keyboardOf`) — the bot keeps no state — so a press of the scale keeps the
  switch's row and a press of the switch keeps the digit marked. **A message handed over without its
  text** (`InaccessibleMessage`, adversarial Г) is not edited at all — read back as «no question»,
  it was rewritten into the outcome alone, the question and the scale gone; the outcome goes as a
  reply.
- **Telegram says when the bot is blocked** (`my_chat_member` of a private chat): `kicked` turns the
  reminders off at once, `member` passes «unblocked» to the API, which decides what it turns on. **A
  403 while sending is the fallback** (Р-5), for a block the bot did not hear about while it was
  down; a failure to report it is the log's, by its code — the next evening's 403 asks again.
  **Whoever writes to the bot has not blocked it** (`heardFrom`, adversarial round 2 Н): any message
  or press in a private chat passes «unblocked», installed before every composer. Telegram keeps an
  unblock's `my_chat_member` for a day at most, and a bot down longer left `blocked` for good — with
  the settings unable to lift it (В-5) and the screen asking for what was already done. `/start`
  alone was not enough: an unblock from Telegram's list sends none, and a chat with its history
  shows no «START»; a word typed or a digit pressed under an old reminder is what such a person
  does. Not waited for, so the login or the rating behind it does not stand in the API's queue;
  «unblocked» writes nothing on anyone not blocked. **Not for a press of the switch** (adversarial
  round 3, О): «Не напоминать» and «Вернуть» tell the API themselves, and two words of one press
  arrived in no order — the count of the button and the ladder hung on which came first. What stays
  unordered is the «unblocked» of a press of the scale — with its verdict, which the switch does not
  touch, and with a press of the switch right after it (round 4, О4): over a stuck `blocked`, one
  unit of «turned off under a reminder» and the ladder hang on which arrives first. Accepted rather
  than waited for: the slower request has to lose to a verdict, an edit and a whole next update, and
  waiting would put the rating back in the API's queue. **The named prices:** a press followed at
  once by a block may let its «unblocked» arrive after the block and turn the reminders on until
  that evening's 403; and if Telegram hands a bot the presses of someone who blocked it — not
  checked on live Telegram — a digit pressed under an old reminder turns them on until the same 403.
  The updates the bot polls for are named (`ALLOWED_UPDATES`): left to «the previous setting» a
  token keeps, one once polled with a narrower list would never hear of a block.
- **Turning off is counted** (В-4): `reminder_days` adds `off_button`, `off_settings` and
  `off_blocked` — people whose reminders went from on to off that day, by how, with no id — and
  `make gates` prints them under the lever, as counts and no verdict: whether the reminder annoys.
- **The switch is in the person's copy**: `remindersOff` of the account, file version 6.

## «Написать разработчику» (MOL-148)

The bot's half of the epic MOL-141: a message from the app reaches the owner, the owner's reply
reaches the person, and the person's answer to it continues the thread. Decided in MOL-150 (В-1, В-3,
Р-8…Р-12) and this task (В-1…В-4, Р-1…Р-14 in `.scratch/tasks/requirements/MOL-148.md`); the thread's
storage is `feedback.md`.

- **The owner's notice is one more kind of the owner's channel** (`observability.md`): «🐞 Сломалось ·
  #fb42», the text, what went with it, the time in Yerevan; a continuation is «↩️ Продолжение · #fb42»
  with the reply quoted by its first 200 characters. The kind in the sheet's own words; nothing of the
  person, since the copy stays in the owner's chat for good.
- **The tag ends the first line, and only there is it read** (`threadTagOf`, Р-3): the frame of a reply
  quotes the owner's text, which may carry a tag of its own. It is the number of the thread's first
  message, the same on every notice of a thread, so the hashtag shows the whole thread. **A change of
  a key of `owner.feedback.*` must keep it there** — a test builds every kind and reads the tag back.
- **A text written as a reply to a notice or to the frame of a reply goes to the API as it is**
  (`feedback.ts`, `POST /internal/feedback/reply`): `ctx.from.id`, the message answered and the tag
  of its first line. **No other reply goes** (adversarial В2): one to the greeting or a reminder is
  the greeting's, and waiting on the API it got «сервер не ответил» when the API was down. The frame
  is known by its last line, «Чтобы ответить, ответьте на это сообщение.», in any language the bot
  speaks (`isReplyFrame`) — the bot reads its own message back, as it reads a tag. **A command is the
  bot's** (В6): `/start` sent as a reply to the frame is a command, never a word to the developer. **What it is, the API decides** — the owner's reply on a tagged notice (only
  `OWNER_TELEGRAM_ID` makes it one), a person's word on a reply they were sent, or nothing of ours —
  and the bot acts on the answer. Nothing of ours is a `404`, and the update goes on to the greeting
  as before: the composer stands before the login's catch-all. How long a text may be is the API's
  too, by who writes: 3500 for the owner, 2000 for a person, as the form.
- **The owner's reply goes to the person at once, not through a queue** (Р-10): the owner waits to see
  it went. In the frame of the person's language — the language of their message, «Ответ на ваше
  сообщение от 3 октября:», the text, «Чтобы ответить, ответьте на это сообщение.» — with sound: it is
  what they wait for.
- **Delivered is a reaction 👌 on the owner's message** (В-1): ✅ is not among the reactions Telegram
  takes, and a refused reaction is the line «Доставлено.» instead. **A 403 is the person's block**:
  the reply is marked `blocked`, their reminders go off by the path of MOL-103, and the owner reads
  «Не дошло: человек заблокировал бота». **Any other refusal of Telegram is marked `failed`**
  (adversarial В4) — the copy says the reply never reached the person, and it keeps no thread alive
  — and the owner reads «Не отправлено… Ответьте ещё раз». **A broken connection marks nothing**
  (review №8): Telegram may have taken the message before it broke, so the reply stays «unknown» and
  the owner reads «Не знаю, дошло ли… человек может получить ответ дважды». Every other outcome — a thread gone, too long, nothing
  visible, the person's day spent, the server silent — is one line under the message it answers; no
  error is shown, and there are no buttons to keep.
- **The person's answer finds its thread by the message it answers** (В-2): after the send the bot
  tells the API which message the reply went out as (`POST /internal/feedback/delivered`), and a reply
  to that message, from that account, is the thread's continuation — no number shown to the person,
  and nobody else's chat holds that message. **The named price** (Р-4, Р-14): a mark lost between the
  send and the API leaves that reply «unknown», and an answer to it is refused as nothing of ours —
  so the owner gets no 👌 then, but «Доставлено, но… ответ человека на него не найдёт переписку»,
  and does not wait for an answer that cannot come (review №2).
- **The same word within a day is the same message** (adversarial В3, round 2 Г1): the same words of
  the same person to the same reply within a rolling 24 hours are a repeat — «ответьте ещё раз» after
  a lost answer writes it once, and so does Telegram handing the update over twice. A day on, the
  same «Не работает» is a new word: taken for a repeat for good, it was «передали» and nothing.
- **The frame is known by its last line, so that line is frozen like a tag** (round 2, Г3): a frame
  stays in a person's chat for good. A new wording of `feedback.howToAnswer` moves the old one, in
  every language, to `FRAME_LAST_LINES`, or every frame already sent stops being one and its answers
  greet.
- **A failure in the composer is `message:reply`** (`handlerOf`): apart from the greeting's `message`.
- **The owner's reply is words only** (Р-9, MOL-167 Р-9): a photo — a caption too, which must not go
  without its photo — a voice or a file on a tagged notice says «Отвечать можно только текстом», so
  the owner does not think it went.
- **A person's photo on a frame is a word of the thread** (MOL-167, Р-8, В-3): the largest size
  Telegram keeps, by its `file_id` and `file_unique_id` — the bytes stay in Telegram, which strips a
  photo's EXIF — and its caption as the text, or none. **A picture sent as a file is asked for again as
  a photo** («Пришлите как фото»): a document keeps where and when it was taken. An album is a word a
  photo — Telegram hands them over one by one, and the bot keeps nothing to glue them; anything else
  that is not a word stays quiet, as before.
- **A message's pictures follow its notice** (MOL-167, Р-5): each a photo replying to the notice,
  captioned «Снимок 1 из 2 · #fb42» — the tag ends the caption's first line, so the owner's reply to a
  picture finds the thread (`threadTagOf` reads `text ?? caption`). The phone's JPEG, fetched from
  `GET /internal/feedback/:number/pictures/:position`, goes as a file; a person's photo by its id —
  never forwarded, so no sender is shown. «Sent» is said after the last picture: a picture Telegram
  refuses (400) or no longer there is the log's and the rest go on — a notice that could never go
  whole would be handed for good — and it is named to the API as `missed`, which marks it never sent
  (adversarial А4). A broken connection says nothing, and the notice comes again whole: the owner
  reads its text twice, the price a lost mark already has. **A 429 on a picture ends the run** as it
  does on a text, with the same line of what was given up (review 4).

## «Чек разобран» (MOL-129)

The bot's fourth thing: a receipt read reaches the person who left the screen. The owner's decisions
of 04.10.2026 are В-1…В-3 and Р-1…Р-13 in `.scratch/tasks/requirements/MOL-129.md`; the texts are
handoff 08 (`design_handoff_mol_127_128_129_v2`).

- **Only to whoever the phone did not hand it to with its page in view** (owner, 30.09.2026: reading
  takes ~30 s, not minutes). `receipts.heard` says how the person learned it was read: `app` —
  `GET /receipts` or `GET /receipts/:id` **with `?shown=1`** answered it `parsed` or `failed`; `bot` —
  the bot was handed it. The first word stands. The server does not know what is on the screen, so
  the phone says it: `shown` is `document.visibilityState` when the request leaves. **A list asked
  hidden marks nothing** (adversarial А1): the same list is asked on `online` and on every write of a
  queue that lands, with no look at the page, and a phone in the pocket on a shop's flaky connection
  was «told in the app». «Покупки» ask every five seconds while one is read and the page is in view,
  so `RECEIPT_TELL_AFTER_SECONDS` (30) is six asks of margin. **The named prices** (Р-1, review №2): a
  newcomer back on «Что брать», whose home also reads the list but shows no «Посмотреть», is counted as
  told in the app; and the mark is the answer **sent**, not the answer received — one lost to the
  phone's timeout at a till marks `app`, and if the phone goes to the pocket before the next ask, no
  message comes; and **a version of the app from before `shown` marks nothing at all** (review №8,
  adversarial Б2) — an installed app takes a new version only hidden or by «Обновить» (`pwaUpdate.ts`),
  so for its first session after the rollout the bot tells of every receipt, to someone looking at it
  too. Nothing tells that request from a new app's asked hidden, and the window is one session.
- **The API decides and marks as it hands out, the bot only sends** — the rating reminder's rule
  (Р-1, Р-2 of MOL-101). `POST /internal/receipts/claim`, every minute, one statement: pick under
  `for update skip locked`, re-check `heard is null`, mark `bot` — two claims never share a receipt and
  a phone's mark landing first leaves it out. At most once: a bot that dies after the claim loses
  that message. **A receipt removed or recorded between the claim and the send is told of all the
  same** (review №2) — the button then opens «чека нет» or «уже записан»: the bot keeps nothing to check
  it against, and a second look would be a second claim. **Not after `RECEIPT_TELL_WITHIN_HOURS` (6)**:
  past it the answer waits in «Покупки», and a bot back from an outage does not bring a day of
  receipts.
- **Not to anyone who blocked the bot or turned it off** — `actors.bot_blocked_at` or
  `receipt_notices_off`. **The block is a column of its own** (review №1, adversarial А2; it replaces
  Р-9): MOL-103 keeps «chosen» over a block in `reminders_off` (В-1), so someone who turned the
  reminders off and then blocked the bot had the block written nowhere — every receipt was handed to a
  chat that refused it, marked `bot`, and the page said nothing. Telegram's block (`my_chat_member`
  kicked, a 403) sets it once, any other word of the bot — an unblock, a press — clears it, the settings
  never touch it; the migration carried over every `reminders_off = 'blocked'`. `reminders_off` keeps
  its own `blocked` for the reminders as before. **The rating reminders' switch does not touch it**
  (В-2): a receipt read is the answer to the person's own act, as a login is.
- **Nothing of the receipt's money goes to Telegram**: the wire (`receiptNoticeSchema`) carries the
  chat, the receipt's id for the button, read or not, the language, the place's name, the day and the
  number of lines — no sum, no line, no tax number, so the bot could not print one. The place is the
  one the review shows (`withPlaces`: the seller's, by tax number, in the city its address prints or
  the person's), its name as the catalogue has it, no city; a name today's rule of visible text
  refuses goes as no place (`parsed_no_place`), and a notice the contract refuses is said as a
  failure (`ReceiptNoticeUnreadable`) — never a claim the bot cannot parse with the minute in it.
  **The date goes too** — the receipt's, or the shot's; without a place it is all the message says of
  the receipt, so the text about data and the switch's hint name it (adversarial А3).
- **A second shot of a receipt recorded before is said to be one** (adversarial А4): `duplicate`,
  by the review's own rule (`recordedTwin`, Т-11) — «…разобран, но он уже записан — второй раз
  записывать не нужно» under «Открыть чек», never «запишите» over a screen that says «уже записан».
- **The language is the receipt's** (П-4): the interface's when it was sent, `receipts.language` —
  the person's Telegram language is not kept. The count picks its form by `Intl.PluralRules`, the date
  is the printed one or the day of the shot in the person's zone, without the year.
- **The night of the person's zone is quiet** (Р-4): 22:00–08:00 by `timeZoneOf` of their country,
  `disable_notification`. A receipt is read half a minute after it is sent, by day; one read at night
  was held by a reader that was away.
- **One URL button straight to the review** (`/purchases/receipts/:id`, no `?from=bot`, Р-5); on an
  `http://` address — a copy in development — Telegram refuses it, so the link goes as a line of
  text. **On iPhone Telegram opens it in its own browser**, which holds no session, and the login
  gate stands before the receipt — accepted (В-1), to be checked on the owner's phone.
- **Sent as the reminder is** (`deliver.ts`): a 429 waited out once up to ten seconds, longer ends the
  run; a 403 marks the person blocked by MOL-103's path, which sets `bot_blocked_at` too; any failure
  logged by its code, never the chat. **The claim is never cut short by a stop**: the API marks what it
  hands out, and a claim given up midway loses those messages.
- **The page «Бот»** (`/settings/bot`, В-2, В-3): in the settings «Бот в Telegram» stands where the
  group «Напоминания» was, and the page holds a switch a kind of the bot's messages — the rating
  reminders and «чек разобран» — each saved on the tap at its own address. The next kind is one more
  row. **A block is the bot's, not a kind's** (Р-10): one line above both, both switches inactive and
  showing what the person chose; the receipts' answer carries `blocked`, since the reminders' cannot
  say it over «chosen» (and a field added to theirs would fail an installed app's strict read). **No
  connection is said once too, under the switches** (review №5), each naming it by `aria-describedby`.
- **In the copy**: a receipt's `heard` and `heardAt`, the account's `receiptNoticesOff` and
  `botBlockedAt` (version 13).

## The message to people about a leak (MOL-237)

«Порядок при утечке персональных данных» (Confluence 12124161, MOL-97, owner's В-3 of 05.10.2026)
promises to write personally to everybody concerned by any leak of what was not encrypted — Georgia
(art. 30) and Serbia (art. 53) ask it at a high risk, ours is any. Before this the bot wrote to one
person on one event only, and the promise had nothing to stand on. Owner's decisions 09.10.2026, the
plan in `.scratch/tasks/plans/MOL-237.md`.

- **The API queues it, the bot sends it — the way of the rating reminders** (В-1). `make notify` in
  a copy and `dist/notify.js` in the API's image write a row of `broadcasts`; every minute the bot
  claims a batch (`POST /internal/broadcasts/claim`) and sends it through `deliver`. Who gets it is
  the API's — the audience, the moment it was queued, a blocked bot — so the bot repeats no rule. Not
  the other way, a script with the bot's token: the token lives in the bot's container alone, and it
  is exactly what step 2 of the procedure revokes through BotFather in the first hour of a leak; the
  script would need the new one typed in, and a second implementation of 429 and 403 in the API.
- **One message, Russian then English, the owner's file as it is** (В-2): nobody's language is kept
  (`actors` holds none, the bot keeps no Telegram language), and the first market is Russian-speaking
  in three countries. **It is the one message of the bot that is not an i18n key**: its words are the
  incident's, written on the day by the template of 12124161. Plain text with no `parse_mode` — an
  escape missed in the middle of an incident would refuse the message — and no link preview. What the
  dry run printed is what goes. The file comes on standard input, so on production it travels over
  ssh and is never put on the server. **Its length is held in UTF-16 units** (`broadcastTextSchema`):
  Telegram counts an emoji as two, zod's `max` as one.
- **Everybody, or the people of some countries, and a try on the owner alone first** (В-3):
  `COUNTRY=AM,GE`, `OWNER=1` — one message to `OWNER_TELEGRAM_ID` of the API's environment, to see the
  text in Telegram before everybody; it goes before a broadcast to people, and none goes in a copy
  without that variable. **Created after the broadcast — not concerned; the bot blocked — skipped and
  counted** (`blocked_at_start`), and a 403 on the way marks the block as the reminders do (MOL-103).
  **The reminders off, the consent not accepted, the statistics off are no reason to stay silent**: it
  is not a reminder, it is a duty. A list of the people concerned by Telegram id is a task of its own
  when a leak touches a few.
- **Better twice than never** (the owner's notice of a message, MOL-148, is the precedent): the
  cursor moves only by the bot's word on a batch (`POST /internal/broadcasts/done`), a batch is leased
  for five minutes (`BROADCAST_LEASE_SECONDS` — 25 messages each waiting out a 429 to the cap), and a
  batch never reported goes out again: a bot killed mid-batch writes to up to 25 people twice. A late
  or repeated word changes nothing (`cursor < through`).
- **Only sent, blocked and «the chat is gone» move the cursor past a person** (adversarial А1).
  `deliver` tells `failed` — refused for good, a 400 naming the chat as not found — from `again`: the
  network, Telegram's 5xx, a revoked token's 401, any other 400, a 429 twice, a 429 whose wait a stop
  cut short. The reminders lose either, by their own rule; a broadcast ends its batch at `again`, at
  Telegram's flood control and at the bot stopping — a stop sends nothing more, so no volley without
  the pauses meets a 429 — the word covers the part that went, and the rest goes the next minute.
  With nothing gone the word is `through: null`, which only lets the lease go, so a batch stopped on
  its first message is not held five minutes. **The price, named:** a person whose every message
  fails in a way that may pass holds the broadcast at them, a try a minute — `STATUS=1` shows «left»
  not moving, and `CANCEL=1` stops it; the step's log says why, by its code.
- **One broadcast to people at a time**: a second `YES=1` while one goes is refused — a repeat would
  write to everybody twice — by a lock on queueing and a partial unique index; the owner's try is not
  one of them. `CANCEL=1` stops what is going (a typo seen after the start), `STATUS=1` says how far
  the latest broadcast to people got, and an owner's try after it beside it — a try must not hide it.
  **A message forgotten on the way in is said, not waited for** (adversarial А4): over `ssh … exec -T`
  the input is a pipe that never ends, so two seconds without a byte is «the message comes on standard
  input». **25 a second** (`BROADCAST_GAP_MS`), under Telegram's 30 for a bot.
- **The table holds nobody** (`privacy.md`): the text, the audience, the counts and a cursor in the
  order of `actors.id`. The cursor always names a live person or nobody (`BROADCAST_START`, the nil
  uuid): the bot's word and erasure both put it on the nearest live id at or below, which leaves the
  same people after it — so erasure and the copy do not change, and no erased id stays. **The two take
  turns on the broadcast's row** (adversarial А2): the word locks it and only then computes the cursor,
  in a statement of its own, and erasure locks every broadcast whose cursor may come to the person
  before deleting them — a word computed from before the erasure wrote the erased id back. What
  `make notify` and the bot print is the text and counts, never anyone.
- **The privacy page names it** among the bot's messages under «Telegram» — a revision of edition 2,
  since «Если данные утекут» already promised it.
