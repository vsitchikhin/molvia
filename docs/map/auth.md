# Map · Identity, sessions, the way in and out

Rules: `.claude/rules/auth.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## packages/model

- `packages/model/src/contracts/actor.ts` — Contract: the session cookie's name and the owner as the wire sees them — an allowlisted view of the settings, never the Telegram id.
- `packages/model/src/contracts/auth.ts` — Contract of the login and «Устройства»: cookie and header names, quota numbers, the bot secret's shape, the start's query (`again=1`), codecs of start, poll, preview and session list.
- `packages/model/src/entities/actor.ts` — Entity of the owner: Telegram id, country, city, both currencies, `sharedUntil` with `hasSharedAccess`; new-owner and settings-patch schemas.
- `packages/model/src/entities/session.ts` — Entities of a session and a login request: device-name cleaning, session lifetime and touch interval, the login code schema.

## packages/client

- `packages/client/src/auth.test.ts` — Test: login, logout and session calls go to their paths with the login header; the bot secret reaches only its own methods; a portal's 200 is no way out.

## backend · routes

- `backend/src/routes/actor.ts` — `withActor`: the hook of the guarded scope that turns the session cookie into `actorId`, `actor` and `sessionId`, and re-sets a slid cookie. Tests: `backend/tests/sessions-auth.integration.test.ts`.
- `backend/src/routes/actors.ts` — Route `GET /actors/me` («who am I»), and `answerWithActor`, the one way an owner leaves the server. Tests: `backend/tests/actors.integration.test.ts`.
- `backend/src/routes/auth.ts` — Routes of the browser's login: start `POST /auth/login` (with `?again=1` from a device repeating a login), poll `GET /auth/login/:id`, and the way out `POST /auth/logout`. Tests: `backend/tests/login.integration.test.ts`.
- `backend/src/routes/dev-login.ts` — Route `POST /dev/login`: the development sign-in seam with no Telegram, absent from the production bundle. Tests: `backend/tests/identity-hardening.integration.test.ts`.
- `backend/src/routes/internal-auth.ts` — The bot's internal routes behind `BOT_API_SECRET`: preview, confirm and decline a login, and `POST /internal/actors/erase`. Tests: `backend/tests/login.integration.test.ts`.
- `backend/src/routes/sessions.ts` — Routes of «Устройства» in the guarded scope: `GET /sessions` and `DELETE /sessions/:id`. Tests: `backend/tests/devices.integration.test.ts`.

## backend · usecases

- `backend/src/usecases/authenticate.ts` — Use case: a session token into its owner and session id, sliding the term once a day has passed.
- `backend/src/usecases/bot-login.ts` — Use cases of the bot's half of the login: preview (whether confirmed, not who), confirm with a Telegram id, decline. Tests: `backend/tests/login-requests.integration.test.ts`.
- `backend/src/usecases/complete-login.ts` — Use case: the poll that collects a confirmed login — locks, consumes the request and signs in within one transaction. Tests: `backend/tests/login-transaction.integration.test.ts`.
- `backend/src/usecases/create-actor.ts` — Use case: a new owner for a Telegram id, with the first settings the server names (country, city, currencies).
- `backend/src/usecases/sessions.ts` — Use cases of «Устройства» and «Выйти»: list the owner's live sessions, end one of them, log out by token.
- `backend/src/usecases/sign-in.ts` — Use case: find or create the owner of a Telegram id and mint a new session token for them.
- `backend/src/usecases/start-login.ts` — Use case: start a login — code, secret and the `t.me` link, under the database-wide quota. Tests: `backend/tests/login-quota.integration.test.ts`.

## backend · db

- `backend/src/db/actors-repository.ts` — Repository of owners: create under the account lock, find by id or Telegram id, update the settings, lock an account.
- `backend/src/db/auth-unit-of-work.ts` — Unit of work of the login: the owner, session and login-request repositories built on one transaction.
- `backend/src/db/login-requests-repository.ts` — Repository of login requests: quota-limited create, confirm, decline, lock, consume, expired cleanup; secrets kept only as hashes; every step counted into `login_days` in its own transaction. Tests: `backend/tests/login-requests.integration.test.ts`, `backend/tests/login-days.integration.test.ts`.
- `backend/src/db/sessions-repository.ts` — Repository of sessions: create by token hash, live lookup with its owner, daily touch, list and remove for «Устройства», expired cleanup. Tests: `backend/tests/sessions.integration.test.ts`.
- `backend/src/db/telegram-lock.ts` — SQL of the advisory lock on one Telegram account, taken first by login confirmation, owner creation and erasure. Tests: `backend/tests/erasure.integration.test.ts`.

## backend · other

- `backend/src/cookie.ts` — The only module that reads or sets a cookie: the session, login and dev-account cookies, each set together with `no-store`.
- `backend/src/device-name.ts` — Derives an «iPhone · Safari»-style device name from a `User-Agent` for session and login rows.
- `backend/src/login-cleanup.ts` — The minute timer every expired-row cleanup hangs on — login requests, sessions and the undo windows.
- `backend/src/login-config.ts` — Reads the login's environment — bot username and `BOT_API_SECRET`; neither means no real door, production requires both.
- `backend/src/secret.ts` — `secretOrNull`: the one rule for what a session token or a login secret may look like, RFC 6265's cookie-octet.

## backend · tests

- `backend/tests/actors.integration.test.ts` — Integration test: a first visit gets an owner with default settings and no Telegram id on the wire; a cookie opens its owner and nobody else.
- `backend/tests/devices.integration.test.ts` — Integration test: sessions listed live and own, current first; ending one or logging out ends exactly that session; someone else's is 404.
- `backend/tests/identity-hardening.integration.test.ts` — Integration test: the dev seam refuses bodies and is absent in production, hands out a `no-store` cookie; the guarded scope covers every route.
- `backend/tests/idor-sessions.integration.test.ts` — Integration test: another owner's session reaches none of this owner's trips, verdicts, advice, places or picks, and is answered as a missing row.
- `backend/tests/login-days.integration.test.ts` — Integration test: the login funnel in `login_days` — each step counted once on the day the login began, a repeated «Войти» and a rolled-back collection not at all, what ran out split by confirmed, the quota's refusals.
- `backend/tests/login-log.integration.test.ts` — Integration test: a login or bot erasure failing in the database logs the error's kind, never the Telegram id, the query or its parameters.
- `backend/tests/login-quota.integration.test.ts` — Integration test: login starts get independent secrets and five minutes, the quota holds across instances, expired rows are removed.
- `backend/tests/login-requests.integration.test.ts` — Integration test: login requests keep the secret only hashed, expired, spent and unknown are one null, confirming twice is a success, collection happens once.
- `backend/tests/login-transaction.integration.test.ts` — Integration test: collection, confirm and decline racing each other end in exactly one session or one refusal, and a failure rolls back.
- `backend/tests/login.integration.test.ts` — Integration test: the Telegram login over HTTP — guards, refusals that answer alike, cookie handling, `no-store` on every auth path.
- `backend/tests/sessions-auth.integration.test.ts` — Integration test: the session cookie through the server — four refusals byte-identical, the daily sliding term, two cookies of one name refused.
- `backend/tests/sessions.integration.test.ts` — Integration test: the sessions repository keeps the token only hashed, finds only live sessions, cuts device names, touches at most once a day.

## frontend · views

- `frontend/src/views/DevicesView.vue` — «Устройства» screen under «Настройки»: every live session, this device first and marked, «Завершить» on the others.
- `frontend/src/views/LoginView.vue` — The login screen `App.vue` draws in place of any route: «Войти через Telegram», the wait for the bot, the whose-account question, the dev seam.
- `frontend/src/views/SettingsSignOut.test.ts` — Component test: «Выйти» in «Настройки» asks first, counts what would be lost, erases the device only after the server's answer, is inactive offline.

## frontend · components

- `frontend/src/components/IdentityNotice.vue` — Notice over a screen when the identity could not be fetched (error or offline), since nothing can be saved until it is.
- `frontend/src/components/SessionEndSheet.vue` — Sheet «Завершить вход на …?» from «Устройства»: names the device and ends its session; a failure is said in the sheet.
- `frontend/src/components/SignOutSheet.vue` — Sheet «Выйти из Molvia на этом устройстве?»: what goes, what stays, the count of unsent writes; inactive offline.

## frontend · composables

- `frontend/src/composables/useSessions.ts` — Composable of «Устройства»: reads the session list on every return, ends a session and drops it from the list at once.

## frontend · stores

- `frontend/src/stores/actor.ts` — Store: the identity's state (loading, ready, offline, error, signed-out) — `me()` at start, `verify()` after a refusal, `release` on sign-out.
- `frontend/src/stores/identity.ts` — The drawer's name on the device: the cached owner id, the `molvia.login` key, the `molvia.leaving` intent and `forgetOwner`, which sweeps an owner's keys.
- `frontend/src/stores/login.ts` — Store: the login on the device — the started request, the owner the person approved, the `tried` mark that makes the next start a repeat, the poll, and `closed`, the door's one definition.
- `frontend/src/stores/signOut.ts` — Store: «Выйти» — the server first, then the drawer erased; keeps the intent until the server's next answer settles it.

## e2e

- `e2e/actor.spec.ts` — End-to-end: the session survives a reload unreadable by scripts, an offline launch finds its own drawer, a lost session brings back the same owner.
- `e2e/devices.spec.ts` — End-to-end: one device ends another, which meets the login screen; signing out erases this device and leaves the other signed in.
- `e2e/login-screen.spec.ts` — End-to-end: the whole login loop lands where the person was going, survives a reload, offers a restart on a dead link; a lost session raises it.
- `e2e/login.spec.ts` — End-to-end: `HttpOnly` cookies come through `/api` to the same account; navigation, HEAD and a foreign origin cannot collect a login.
