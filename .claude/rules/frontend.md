---
paths:
  - 'frontend/**'
---

# Frontend: faces, primitives, states, updates, navigation, the kit

The detail behind the frontend lines of `CLAUDE.md`.

- **Two faces, both self-hosted:** Nunito for titles and figures (`--font-display`), Onest
  for text (`--font`). The design prototype used Caprasimo and Figtree; neither has a
  single Cyrillic glyph, so its Russian mockups were rendered by a system fallback the
  whole time. Fonts live in the repository and are precached — the app is opened where the
  connection drops, and a request to someone else's CDN is one more thing that can hang.
- **The dram sign `֏` comes from a face of its own,** scoped to `unicode-range: U+058F`.
  Of the 321 Google fonts covering Cyrillic, four also cover Armenian and none is usable
  here. Without this the glyph falls back to a system font and shifts the baseline in the
  one place it must not: the prices.
- **Native HTML first, then Reka UI, never a styled kit.** On a phone `<select>`,
  `<input type="date">` and `<input inputmode="decimal">` open the system pickers, which
  beat anything a library renders; `<dialog>` already brings a focus trap and a backdrop.
  Reka is for the few things native cannot do; it ships unstyled primitives that tree-shake.
  **The catalogue combobox turned out not to be one of them (MOL-23):** Reka's
  `ComboboxContent` calls `hideOthers` whenever it is shown — an always-open list hid the back
  chevron, the title and the app's live region from a screen reader — and both its input and its
  listbox filter highlight the first row by themselves, so «Найти» took a row nobody chose. The
  combobox is the ARIA 1.2 pattern on a native `<input>`, about a hundred lines
  (`CatalogueCombobox`): no row is active until an arrow makes one.
  A styled kit (PrimeVue, Vuetify, Naive) is rejected on purpose: its theme and our tokens
  would be two sources of truth about colour, which empties the rule about hardcoded
  values. shadcn-vue is rejected for the same reason in a different shape — it copies
  components written in Tailwind utility classes, and Tailwind is gone.
- **Interface icons come from MDI** through `unplugin-icons`: inlined as components at
  build time, so only what is used ships, no icon font is fetched, and colour comes from
  `currentColor` — they obey the tokens like anything else. The app icon is different:
  `frontend/public/favicon.svg` is the source, `make icons` rasterises the manifest PNGs,
  and the mark is a placeholder until there is real branding.
- **Every screen has four states:** loading, empty, error, offline. The empty state is not
  "no data" but an offer to act. They are drawn by two blocks and nothing else (MOL-19):
  `ScreenSkeleton` for loading, the screen giving the widths of its bars, and `ScreenState`
  for the rest. The tone of the circle carries the meaning and is fixed by the kind — an error
  is always red and always offers «Try again»; offline is green or yellow and **never red**,
  which `vue-tsc` holds rather than memory: `bad` is not a tone a screen can ask for. The
  type holds the prop, not the choice of kind, and that choice is the screen's: **offline or
  error is decided after the failure** (`navigator.onLine` read then, never narrowed from a
  check before the request) — a connection that drops while the answer is on its way is the
  commonest break at a shelf, and drawing it red was the first consumer's bug (MOL-19, A1).
  Back online, a screen tries again by itself, as the identity does — through `useReconnect`,
  which also hears the app coming back into view: an iOS PWA frozen in the background misses
  `online`. Polite states do not carry `role="status"`: they hand their words to the app's one
  live region in `App.vue`, above the router, since a region born with its words is often not
  read. Each announcement is a node added a task later, taken back when its block goes and
  gone by itself after seconds — a hidden region is still read in browse mode. Only an error
  or «attention» on the screen interrupts; anything inline is polite.
- **An installed app takes a new version only when nobody can lose anything to it: hidden, and
  holding no typing** (`pwaUpdate.ts`, MOL-46). The client reads every answer strictly, so an old page
  against a new API breaks — and nothing reloaded it: an iOS app frozen in the background came back
  on the old code until a cold start. Hidden is not enough by itself: a sheet keeps what is typed
  in memory until its main action — the price of a purchase, a proposed item, an exchange — and at
  the shelf the phone is put away mid-sheet for the calculator or the bank. `holdsTyping` is a
  `dialog[open]`, and nothing else: everything else typed keeps a draft on the device and comes
  back — the settings, the ratings, and **the search on «Что взяли?» with its miss**
  (`searchDraft.ts`, this window's shelf, put away with the screen). Held against the update
  instead, a typed query kept out the very version that fixes a search the old code could no
  longer read, and an erased field let the miss be lost (adversarial review Е, Ж). So
  the new worker is let in, and the page reloaded after it took over, only then; a takeover that came another way —
  another window of the app let it in, or this one came back before it activated — waits for the
  same moment. **The worker is registered by our code, not by the plugin's script**
  (`injectRegister: false`): in `prompt` mode that script reloads the page on any takeover, visible
  or not (adversarial review Г). The worker waits (`registerType: 'prompt'`) — taking control at
  once leaves the old page on a precache that is no longer its own — and a new version is looked
  for whenever the app is looked at again or the network comes back. The other half is the
  contract's: a field is added so the old server's answer still reads.
- **A page that stays on the screen takes its version by the person's hand: «Вышла новая версия ·
  Обновить»** (`UpdateBand`, MOL-132). The quiet way waits for the background, and an app open all
  day on the table never gets there — while a server rolled out under it (a merge is a deploy,
  MOL-90) answers in a shape the old code refuses. So a new version is also looked for every
  fifteen minutes while the app is looked at and online, and **at once when an answer names another
  build than the first this page met** — every answer of the API carries `X-Molvia-Version`, the
  build `/health` names, encoded (`encodeURIComponent`: Node refuses a header outside latin1, and a
  tag in Cyrillic failed every answer, adversarial Д4), heard by the client before it reads the body,
  since the answer it can no longer read is the one that says most; `dev` is not compared. **It looks
  again on every such answer, at most every thirty seconds, until a version is found — and for five
  minutes at most** (review С-8, adversarial Е2): the API may come out a moment before the static
  files, and the first look finds the old worker; but a merge that touches no frontend ships the same
  `sw.js`, and looking for the page's whole life found nothing a hundred and twenty times an hour —
  past five minutes the quarter-hour look is enough, and the next build the server names starts
  over — so does the same build rolled out again after the server named the page's own in between, a
  rollback (adversarial Ж1).
  The build alone offers nothing: only a worker has a version to let in. **A first visit is
  controlled by nothing to its end** (no `clientsClaim`), and a version come out meanwhile becomes
  the active worker at once when no other window uses the registration (adversarial Д2), and waits
  when one does (Е1): the worker the page came up with is its own, and any other — waiting or become
  active — is a version for it; with no takeover to hear, its «Обновить» reloads when the version it
  let in becomes the active worker; a worker already installing or waiting as the page came up is followed too (review С-14), or the
  version taken would be called failed — after a hard reload the offer
  may be a reload onto what the page already runs, a harmless price. **`phase` is one state for the app** (`none` / `ready` / `applying` /
  `failed`), provided from `main.ts` and read through `usePwaUpdate`; without a worker — the dev
  server, the tests — it is `none`. **The strip is the top row of `AppScreen`'s pinned strip over the
  tab bar** (owner's decision В-1, Р-6): the screen's own main action — «Начать поход», the trip's
  total, «Сохранить» — stays under it, nearer the thumb, the room for the list is the strip's as
  ever, and what floats over the list (`FloatingDock`) rises by `--dock-height`, a token like
  `--keyboard-inset` that `AppScreen` sets. On the login screen, its own frame, it stands under the
  screen's action. «Обновить» lets the waiting worker in and reloads when it takes over; a version
  another window already let in (`owed`) is a reload alone. **A sheet opened between the tap and
  the takeover holds the reload** (adversarial Д3): the tap consented to a reload then, not to losing
  what is typed in the sheet — the button comes back, and the quiet way still takes the version once
  the app is put away without a sheet. **It is said out loud once for the version, not once for each
  strip** (adversarial Д1): every screen draws its own strip, born with the version already waiting,
  so what was said — `ready`, `failed` — is kept by the version's state (a `WeakMap` over the one
  `PwaUpdate`), and a strip drawn anew on the next screen says nothing. **Words still true are not taken back when
  the strip goes with its screen** (review С-13, adversarial Ж2): taken back, they were gone before a
  screen reader read them — or before they reached the region at all — and the next strip, silent,
  never said them; only words that stopped being true are taken back. **An error while a version waits offers
  «Обновить» first and «Повторить» second, whatever the error was** (В-2): which answer the old code
  could not read is not always known — a new server's unknown code arrives as `response_invalid`, a
  proxy's 502 during the rollout as `internal` — and the reload loses nothing: the queues hold both
  (`HOLDS`), the drafts are on the device. **It never reloads without the tap**, and under an open
  sheet it cannot be tapped: a modal `<dialog>` leaves the page inert, so nothing extra keeps the
  reload from under the finger. **A version that did not take is said, not retried**: no takeover in
  ten seconds, or the page «Обновить» brought up still has one waiting (`molvia.update-applied`, the
  moment of the reload on this window's own shelf — `writeOwn`, so another window cannot take it,
  review С-9 — trusted for a minute) — then the strip asks for the app to be closed all the
  way, in the words of both phones, since a guess from the user agent is wrong on an iPad. No «×»:
  it is quiet, and it goes with the version. Nothing is cleared for it — the cache and the storage
  hold the queue of purchases made offline. **The price of the first rollout:** a page on the code
  before this learns of it only the quiet way. **The price of a rollout rolled back** (review С-11,
  accepted): in the health window of a failed deploy an open page hears the new build and installs
  its worker, and «Обновить» then brings up a build the server no longer runs — the next rollout
  puts it right; holding the look until `/health` names the build twice would cost more than it saves.
- **Every screen sits in `AppScreen`, and every move goes through the router** (MOL-17). The
  frame — pinned row, large title that collapses past 24px, back chevron, room under the tab
  bar — is drawn once; a screen fills its slots. A nested route names its `meta.parent` and
  gets the chevron, labelled with the title of where it leads, never the word «Back». **At rest
  the label has the row; once the small title comes in it gives way first** (MOL-75): whole, else
  «Back», else the chevron alone — never a fragment, which «Trip…» would be — and the title yields
  last, only when it alone does not fit between two chevrons. The width is read in fractions, as the
  label is drawn: rounded, a word 0.4px too wide passed as whole and was drawn «Наз…» (review А1).
  **The name does not follow the ladder** — «Back Trip» on every step, the word shown first
  (owner's decision on review). **It
  leads to the screen underneath when that screen is any ancestor** — the step the system
  button takes — and otherwise replaces onto the parent (`backTarget`, MOL-77): a finished trip
  opened from the home screen says «‹ Поход» and both «back»s go home. Tabs and the
  chevron move through `useNavigation`: «Trip» is home — leaving it pushes, moving between
  the other sections replaces, returning is a step back — so the system «back» never walks
  through tab taps, and a nested screen opened cold gets its parent laid underneath. A
  section opened cold — a link from the bot — is its own home: «back» leaves the app, the trip
  is not laid under it, because a push without a gesture is what Chrome may skip. **No
  gesture is intercepted**: no touch listener, no `overscroll-behavior` on the root — the
  edge swipe and Android «back» belong to the browser, and the history is the one source of
  «back». Only the page scrolls, never an inner container: iOS hides its address bar and the
  router restores positions only for the window. **A move that changes only the query of the
  screen is the screen's own state, not another screen** (`sameScreen` in `transitions.ts`,
  MOL-136): the category and the period of «Графики», the month of «Деньги» live in the address and
  change by `replace`. **It is not scrolled, not animated and not an arrival** — three readers of
  one move, and all three go by the one definition. Read as a new screen, it took the page to the
  top — the category card is the third, and the chart the person chose it for was gone; it took the
  focus to the heading, so the second Enter on «‹» went into the title and the arrows of the period
  worked once (adversarial Ф); and the month cross-faded as a move between tabs, whose overlay took
  the second quick tap (Д). One rule rather than a flag on the screen: a flag has to be remembered
  by every screen that keeps its state in the address, and the one that forgets it is this bug
  again; no screen wants the top on a change of its query — one that does scrolls itself after its
  `replace`. Back and forward still return to what was saved, and the same route with other params
  (`/money/accounts/a` → `/b`) is another screen, from the top. What the rule cannot hold is the
  height of the page: a shorter version of the screen brings the scroll up to its new end — a month
  or a period read for the first time on the phone, under the skeleton, and at the very bottom of
  «Графики» a category card a line shorter (MOL-138). So e2e takes «the page stayed» on a month or a
  period the phone already keeps, by where the control stands on the screen (`e2e/scroll.ts`), off
  the bottom of the page.
- **A scroll the eye follows is smooth; a scroll that sets a screen in place is instant**
  (owner's remark on MOL-136). Smooth: the tab of the section one is in, back to the top
  (`goTab`), and a spending just saved brought to the middle (`toShow` in «Деньги») — each
  instant under «reduce motion». Instant: a new screen at the top and a screen back where it was
  — it slides in already there, and a smooth scroll would show the old page travelling under the
  transition; the sheet putting the page back (MOL-63), a compensation the eye must not see at
  all; the arrows in the catalogue list, which a smooth scroll lags behind. **Never
  `scroll-behavior: smooth` in the CSS** — Stylelint refuses it: a scroll with `behavior: 'auto'`
  takes it from the CSS, and the sheet's compensation would slide; a smooth scroll says so itself.
- **A screen is built from the kit, not drawn anew** (MOL-18): `AppButton`, `AppField`,
  `SegmentedControl`, `VerdictBadge`, `AppCard`, `BottomSheet` in `components/`, every state of
  them on the development-only page `/_kit`. `AppCard` carries exactly the differences between
  the three cards of 0.1 — `as`, `tone="take"`, `list` — and nothing for later: a component over
  a surface is one prop away from a wrapper around a `<div>`. **The sheet is a native
  `<dialog>` with an entry in the history**, laid through the router's own `history.push` at
  the same address — never a bare `pushState`, whose state lacks the `position` and `back` the
  rules of «back» read. Every close — ×, the scrim, Esc, Android «back» — steps back
  off that entry, and only the pop closes it, so exactly one entry is ever taken. **The sheet puts
  the page back by what it was opened from, never by a number** (MOL-63): it notes the element
  the opening click landed on — a tap, Enter, a screen reader alike, since iOS does not focus a
  tapped button; the click is forgotten once its task is over, and a sheet opened later is measured
  by the focus — and where it stood on the screen, and after the pop that lands on the same screen
  scrolls by the difference. A list that changed height above it meanwhile — reread, a queued row
  sent, a notice come or gone — Chrome and Firefox have already kept still, and the difference is
  nothing (Safari keeps nothing still, and gets it put back); a window the platform moved under the
  sheet — the iOS keyboard for a field in it — comes back, since `overflow: hidden` stops a finger
  and not the platform. At the very top of the page the browser keeps nothing still on purpose —
  what came above the list stays in sight — and there the top stays the top. The
  router's number did the second and broke the first, moving the list by the change. So the router
  does not scroll a move to the same address, which is a sheet's or a refused duplicate push; the
  first navigation comes «from» `START_LOCATION`, whose address is «/», and is not one — read as
  one, the trip loaded again forgot where the person was. And e2e takes «the list stayed» by where
  the opener stands on the screen, never by `scrollY`, which the jump left equal. Any move of
  the router under an open sheet — push, replace, a new query — closes it too; an entry no
  sheet holds — left by a reload or a move away — is stepped off by `installSheetEntryGuard`.
  `close(2)` closes it together with the screen under it, the sheets above and below included,
  and never steps out of the app. **A sheet over a sheet has «‹» and no ×** (`back`, MOL-123,
  owner's decision В-4): under a picker lies a spending with its sum typed, and a × that closed the
  stack threw it away at the till; one scrim, the lower sheet's. Sheets may stack: a pop closes as many from the top as
  entries it went back. Until it has come up the sheet takes
  no tap, so the second tap of a double tap cannot close it or press its main action. **«Up» is
  the end of its own rise, not a clock** (MOL-69): a rise starts with the first frame that draws
  it, and on a busy phone that frame comes late — a clock started at `showModal` ran out while
  the sheet still slid, and the second tap closed it. Never sooner than a double tap, for a sheet
  with no rise; no ceiling, since a rise either finishes or is cut short (an endless animation is
  not waited for); and a tap counts from when the finger touched — its `pointerdown`, since a click
  carries the moment the finger lifted and one resting across the end of the rise closed the sheet
  or pressed the action that slid under it (adversarial А1); a click from the keyboard, by its
  own time, and it leaves the touch alone (Б1). Open a
  sheet from a tap only: Chrome skips on «back» an entry laid without a gesture. **The sheet is the one exception to «only the
  page scrolls»**: a panel over the screen has no window of its own, so it scrolls itself and
  the page under it is held still.
