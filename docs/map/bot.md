# Map · The bot

Rules: `.claude/rules/bot.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

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
