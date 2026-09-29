# Map · The bot

Rules: `.claude/rules/bot.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/reminder.ts` — Wire contract of the rating reminder (MOL-101): what a claim hands the bot — the chat, up to three items with place and days ago, the total — and the body of a press of 1–5.
- `packages/model/src/entities/reminder.ts` — The reminder's ladder (MOL-101): 19:00 to 22:00 of the person's day, three items, steps after 3 and 7 days, a six-month pause, and `planReminder` deciding which step is due.

## backend

- `backend/src/db/reminders-repository.ts` — Repository of the rating reminder (MOL-101): everyone with their ladder, the claim that moves the ladder only if it still stands where it was found, and the counters of `reminder_days`.
- `backend/src/usecases/rate-from-bot.ts` — Use case of a press of 1–5 under a reminder: the owner by the Telegram account that pressed, then `rateItem`; a new verdict is counted.
- `backend/src/usecases/remind-ratings.ts` — Use case «Напомнить об оценке»: whose evening it is in their zone, which step `planReminder` says, and what the claim hands the bot.
- `backend/tests/reminders.integration.test.ts` — Integration test: the evening's hour and day, the ladder with the owner's example, MOL-29, the counters, and the bot's two internal routes.

## packages/client

- `packages/client/src/bot.ts` — The bot's API client: preview, confirm and decline a login, and erase a person, over the internal channel with the bot secret. Tests: `packages/client/src/auth.test.ts`.

## bot

- `bot/src/answer.ts` — How a button press is answered, for login and erasure alike: `settle` writes an outcome, `refuse` shows over the message, the spinner, the keyboard.
- `bot/src/assemble.ts` — Wires the bot: per-chat `sequentialize`, the erase composer before the login's, and the concurrent runner.
- `bot/src/env.ts` — The bot's environment: the Telegram token read alone, `BOT_API_SECRET`, the API and app addresses; a refusal names variables, never values.
- `bot/src/erase.ts` — `/delete`: one question naming what goes and what stays, «Удалить навсегда» valid for ten minutes, erasing whoever pressed.
- `bot/src/i18n.ts` — `t()`: a bot message by key in the sender's language through `pickLocale`, with `{name}` substitution.
- `bot/src/i18n/en.ts` — The bot's English dictionary, mirroring the Russian one key for key.
- `bot/src/i18n/ru.ts` — The bot's Russian dictionary, every message it sends; its keys are the `Dictionary` type.
- `bot/src/index.ts` — The bot process's entry: exits quietly without a token or secret, builds the API client with a five-second timeout, runs until stopped.
- `bot/src/login.ts` — The bot's half of the login: `/start` with a code asks «Впустить это устройство в ваш аккаунт Molvia?»; «Войти» and «Это не я» confirm or decline.
- `bot/src/when.ts` — `timeAgo`: the age of a login request in words («2 минуты назад») for the bot's question.
