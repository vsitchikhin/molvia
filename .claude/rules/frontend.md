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
- **Every screen sits in `AppScreen`, and every move goes through the router** (MOL-17). The
  frame — pinned row, large title that collapses past 24px, back chevron, room under the tab
  bar — is drawn once; a screen fills its slots. A nested route names its `meta.parent` and
  gets the chevron, labelled with the title of where it leads, never the word «Back». **At rest
  the label has the row; once the small title comes in it gives way first** (MOL-75): whole, else
  «Back», else the chevron alone — never a fragment, which «Покуп…» would be — and the title yields
  last, only when it alone does not fit between two chevrons. The width is read in fractions, as the
  label is drawn: rounded, a word 0.4px too wide passed as whole and was drawn «Наз…» (review А1).
  **The name does not follow the ladder** — «Back Purchases» on every step, the word shown first
  (owner's decision on review). **It
  leads to the screen underneath when that screen is any ancestor** — the step the system
  button takes — and otherwise replaces onto the parent (`backTarget`, MOL-77): the search of a
  record opened cold, with the record and «Покупки» laid underneath, says «‹ Запись»; with
  «Покупки» right underneath and no record, «‹ Покупки» — and both «back»s go there. A tab
  tapped on a nested screen is tapped from its section: up the chain the way «back» goes while an
  ancestor is underneath, then the tab from there (MOL-128, adversarial Б) — read as «from no
  section», every round of the shop left two more entries before «back» left the app.
  Tabs and the chevron move through `useNavigation`: **«Что брать» is home** (MOL-128; «Поход»
  was, MOL-17) — at the shelf a person reads, at home they write — leaving it pushes, moving
  between the other sections replaces, returning is a step back — so the system «back» never
  walks through tab taps, and a nested screen opened cold gets its parents laid underneath. A
  section opened cold — a link from the bot — is its own home: «back» leaves the app, home is
  not laid under it, because a push without a gesture is what Chrome may skip. **The addresses
  of «Поход» redirect for good** (MOL-81): `/trip*` to «Покупки», `/advice` to `/`. A screen that
  has nothing left to show — the record typed by hand once it is finished or removed — goes up to
  its parent (`goUp`), and never under an open sheet: the sheet's `onClosed` asks again, **through
  `afterStep`** — a sheet is told it is closed from inside the pop that closed it, before that step
  has landed, and a move made there was taken for a second tap and dropped (MOL-128, seen only in a
  real browser: happy-dom dispatches `popstate` inside `go`). **No
  gesture is intercepted**: no touch listener, no `overscroll-behavior` on the root — the
  edge swipe and Android «back» belong to the browser, and the history is the one source of
  «back». Only the page scrolls, never an inner container: iOS hides its address bar and the
  router restores positions only for the window.
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
