---
paths:
  - 'bot/**'
  - 'packages/client/src/bot.ts'
  - 'backend/src/routes/internal-auth.ts'
  - 'backend/src/usecases/bot-login.ts'
---

# The bot, and what it is allowed to know (MOL-55, MOL-58)

The bot does two things in 0.1. It is the second half of the login: the one place a person is
shown **which device** they are letting in and says «yes» to it by hand. And it is where a person
**erases themselves** (MOL-58): `/delete`, one question naming what goes and what stays, one
press — the only channel people are given, because there Telegram already says who is asking.
Rating reminders are 0.2.

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
  spinner, the keyboard — lives in `answer.ts`, shared by the login and erasure.
- **A copy without `TELEGRAM_BOT_TOKEN` or without `BOT_API_SECRET` does not start**, says so in
  one line and exits 0 — «this copy has no bot» must not become a restart loop under compose.
  Such a copy signs in through `POST /dev/login` and cannot use Telegram at all.
