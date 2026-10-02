---
paths:
  - 'bot/**'
  - 'packages/client/src/bot.ts'
  - 'backend/src/routes/internal-auth.ts'
  - 'backend/src/usecases/bot-login.ts'
  - 'backend/src/usecases/{remind-ratings,rate-from-bot,reminders-switch}.ts'
  - 'backend/src/routes/reminders.ts'
  - 'backend/src/db/reminders-repository.ts'
  - 'backend/tests/reminders*.ts'
  - 'packages/model/src/{entities,contracts}/reminder.ts'
  - 'frontend/src/components/RemindersGroup*'
  - 'frontend/src/composables/useReminders*'
---

# The bot, and what it is allowed to know (MOL-55, MOL-58, MOL-101)

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
  reminded; a test holds every country the settings accept to having one.
- **A message an item, at most three a day, only the first one rings** (В-1). The freshest three;
  under the last, how many more wait in «Оценки» with the link — as text, since Telegram refuses an
  inline button to an `http://` address and a copy in development has one.
- **What is asked about is `pendingVerdictsFor` with a window of days** — the very selection of
  «Оценки», products only, deleted trips out — plus the answer to MOL-29 (В-3): **not a purchase
  made before the person withdrew their verdict on the item**. One after the withdrawal is a new
  experience and is asked about. The screen is unchanged.
- **The message is always Russian** (Р-7): it is sent without an update, and the person's language
  is not something we keep (the privacy page). The answer to a press speaks the presser's.
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
  an installed app reads `/actors/me` strictly. The group «Напоминания» says why it is off when a
  block turned it. Both switches of the settings are `AppSwitch` over `useTapSetting`.
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
