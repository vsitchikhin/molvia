# Map · The bot

Rules: `.claude/rules/bot.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/reminder.ts` — Wire contract of the rating reminder (MOL-101): what a claim hands the bot — the chat, up to three items with place and days ago, the total — and the body of a press of 1–5; the switch's setting, its body and the bot's change (MOL-103).
- `packages/model/src/contracts/receipt-notice.ts` — Wire contract of «чек разобран» (MOL-129): what a claim hands the bot — the chat, the receipt for the button, read or not, its language, place, day and number of lines, and whether it comes without a sound; never a sum, a line or a tax number.
- `packages/model/src/entities/reminder.ts` — The reminder's ladder (MOL-101): 19:00 to 22:00 of the person's day, three items, steps after 3 and 7 days, a six-month pause, and `planReminder` deciding which step is due; the switch (MOL-103): `chosen` or `blocked`, and `switchReminders` deciding where a change leaves it.

## backend

- `backend/src/db/reminders-repository.ts` — Repository of the rating reminder (MOL-101): everyone reminded with their ladder, the claim that moves the ladder only if it still stands where it was found, the switch under the owner's row with the ladder gone on «on» (MOL-103), and the counters of `reminder_days`.
- `backend/src/routes/receipt-notices.ts` — Routes `GET`/`PUT /actors/me/receipt-notices` (MOL-129, В-2): «Сообщать, что чек разобран», saved on the tap on the page «Бот».
- `backend/src/routes/reminders.ts` — Routes `GET`/`PUT /actors/me/reminders` (MOL-103): «Напоминать об оценке в Telegram», saved on the tap beside the settings.
- `backend/src/usecases/reminders-switch.ts` — Use cases of the switch (MOL-103): read it, choose it in the settings, and the bot's change — a button, a block, an unblock.
- `backend/src/usecases/rate-from-bot.ts` — Use case of a press of 1–5 under a reminder: the owner by the Telegram account that pressed, then `rateItem`; a new verdict is counted.
- `backend/src/usecases/tell-receipts.ts` — Use case «Чек разобран» (MOL-129): the receipts read that no phone was handed, marked as told, worded with the place the review shows, the receipt's day and the night of the person's zone; a notice the contract refuses is said as a failure; the person's switch of these messages, read and chosen.
- `backend/src/usecases/remind-ratings.ts` — Use case «Напомнить об оценке»: whose evening it is in their zone, which step `planReminder` says, and what the claim hands the bot.
- `backend/tests/reminders-switch.integration.test.ts` — Integration test of the switch (MOL-103): off is off, «on» starts the ladder over, `blocked` and `chosen`, the counters, the app's and the bot's routes.
- `backend/tests/reminders.integration.test.ts` — Integration test: the evening's hour and day, the ladder with the owner's example, MOL-29, the counters, and the bot's two internal routes.

## packages/client

- `packages/client/src/bot.ts` — The bot's API client: preview, confirm and decline a login, erase a person, claim the rating reminders due, rate by a press (MOL-101) and switch them (MOL-103), report a failure of its own and claim the owner's notices (MOL-143), hand over a text written as a reply, say what became of a reply sent and which notices went (MOL-148), fetch a message's picture for the owner (MOL-167), over the internal channel with the bot secret. Tests: `packages/client/src/auth.test.ts`.

## bot

- `bot/src/answer.ts` — How a button press is answered, for login, erasure and the reminder alike: `settle` writes an outcome, `settleKeeping` writes one and keeps the buttons, `refuse` shows over the message, the spinner, the keyboard.
- `bot/src/assemble.ts` — Wires the bot: per-chat `sequentialize`, the erase, rate, switch and feedback composers before the login's, a handler's failure by kind to the log and the API (MOL-143), and the concurrent runner with the updates it handles named, a `getUpdates` retried at a pause growing linearly, its own log off and a failure logged by kind (`telegramFailure`); `introduce` asks `getMe` before it, retried the same way.
- `bot/src/bundle.test.ts` — Test of the bot as it ships (MOL-142): builds the bundle and checks that a class esbuild renamed keeps its name — node-fetch under grammY takes a signal only from a constructor called `AbortSignal`.
- `bot/src/env.ts` — The bot's environment: the Telegram token read alone, `BOT_API_SECRET`, the API and app addresses, the pulse URL; a refusal names variables, never values.
- `bot/src/feedback.ts` — «Написать разработчику» in the bot (MOL-148): a text written as a reply to a tagged notice or to the frame of a reply goes to the API with the tag of that message's first line, a command and any other reply on to the greeting; the owner's reply sent to the person in the frame of their language, then 👌 or «Доставлено», «не дошло» on a block; a person's word passed on; a photo on a frame is a word by Telegram's id and its caption, a picture sent as a file is asked again as a photo, the owner's reply words only (MOL-167); what is not ours goes on to the greeting.
- `bot/src/deliver.ts` — Sending what the API handed out, for the reminder and «чек разобран» alike (MOL-129): a 429 waited out once up to ten seconds, longer ends the run (`Flooded`); a failure logged by its code; a 403 turns the reminders off as a block; `sleep` that a stop cuts short.
- `bot/src/erase.ts` — `/delete`: one question naming what goes and what stays, «Удалить навсегда» valid for ten minutes, erasing whoever pressed.
- `bot/src/i18n.ts` — `t()`: a bot message by key in the sender's language through `pickLocale`, with `{name}` substitution.
- `bot/src/i18n/en.ts` — The bot's English dictionary, mirroring the Russian one key for key.
- `bot/src/i18n/ru.ts` — The bot's Russian dictionary, every message it sends; its keys are the `Dictionary` type.
- `bot/src/index.ts` — The bot process's entry: exits quietly without a token or secret, builds the API client with a five-second timeout, starts the reminders with the pulse, the owner's notices (MOL-143) and «чек разобран» (MOL-129), learns who the bot is, runs until stopped; a failure the runner gives up on is logged by kind and exits 1.
- `bot/src/mute.ts` — The switch in the bot (MOL-103): «Не напоминать» and «Вернуть напоминания» for whoever pressed, the outcome written with the scale kept; `my_chat_member` of a block and an unblock.
- `bot/src/receipt.ts` — «Чек разобран» (MOL-129): the minute timer that claims the receipts read that no phone was handed, one message each in the receipt's language — the place or the day, the number of lines, never a sum — a URL button to the review (a line of text on `http://`), without a sound at night; sent through `deliver`.
- `bot/src/rate.ts` — A press of 1–5 under a rating reminder (MOL-101): the verdict of whoever pressed, the outcome written under the question, the scale kept with the digit marked and the switch's row with it.
- `bot/src/pulse.ts` — The bot's pulse (MOL-142): a ping to healthchecks.io after a claim went through, while a `getUpdates` succeeded within two minutes (`hearTelegram`), at most once in five minutes by a monotonic clock, the first a minute into the process; without a URL, nothing; the URL never logged.
- `bot/src/remind.ts` — The rating reminder (MOL-101): the minute timer that claims what is due, tells the pulse a claim went through, a message an item with the scale 1–5, only the first one ringing, «Не напоминать» under the last; a 403 turns the reminders off (MOL-103); the keyboard and the outcomes read back off the message.
- `bot/src/login.ts` — The bot's half of the login: `/start` with a code asks «Впустить это устройство в ваш аккаунт Molvia?»; «Войти» and «Это не я» confirm or decline.
- `bot/src/when.ts` — `timeAgo`: the age of a login request in words («2 минуты назад») for the bot's question.

## frontend

- `frontend/src/views/BotView.vue` — `/settings/bot`, «Бот в Telegram» (MOL-129, В-2): a switch a kind of the bot's messages — the rating reminders and «чек разобран» — each saved on the tap at its own address; one line about a block above both, both inactive under it showing the person's choice; the four states.
- `frontend/src/components/BotSwitchRow.vue` — One kind of the bot's messages on the page «Бот»: its switch, what it does, «без связи» and «не сохранилось» under it, the block named to a screen reader.
- `frontend/src/composables/useReceiptNotices.ts` — Composable: «Сообщать, что чек разобран» through `useTapSetting` — off or on (MOL-129).
- `frontend/src/composables/useReminders.ts` — Composable: the reminders' switch through `useTapSetting` — off `chosen`, `blocked` or on.
