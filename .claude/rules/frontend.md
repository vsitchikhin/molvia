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
- **`frontend/DESIGN.md` is the style, and the linter holds it** (MOL-171). DESIGN.md (with
  `PRODUCT.md` beside it) is what Claude Design draws from and what a screen is checked against; its
  token block is the file's front matter, generated from `_tokens.scss` by `bin/design-md.mjs` and
  passed through Prettier — `make format` rewrites quotes otherwise, and the check would fail on its
  own output. `npm run format` writes it, `npm run lint` refuses one out of date: a block typed by
  hand drifts at the first edit of a token, and the next design is drawn in old colours; a line comment
  in `_tokens.scss` is no token for it either (adversarial А8). Stylelint allows, outside
  `_tokens.scss` and `_fonts.scss` (its `@font-face` descriptors): a weight only `var(--weight-*)`; a
  size only a step of the type scale named one by one, `var(--icon*)`, `inherit` or `1em` — `--text`
  and `--text-muted` are colours, and as a size the browser drops them (А2); a radius only
  `var(--radius*)`, `0`, `50%` or a sum or difference of tokens in `calc()` — a number beside a token
  is a radius off the scale (А6); no colour function (`rgb()`, `oklch()`…); `font-family` only
  `var(--font)`; the `font` shorthand only `inherit` — it carried a face, a weight and a size past all
  three longhand rules (А1); `font-variation-settings` only `normal` — the Nunito file is variable, and
  its axis drew it at 400 (А7). **Nunito comes only with `@include display-type`**, its face and its
  one weight together (Ф-7, owner's В-3): a weight rule alone let Nunito be set at 600 beside it, and
  `--weight-display` on Onest asks for an 800 Onest has not got. The mixin's two lines are the place
  the allowed-list is disabled for it, line by line — the mixins are checked like any file, since a
  literal there reaches every component that includes it (А4). **A role is whole**
  (`molvia/display-type-whole`, `frontend/stylelint/display-type.mjs`): in the rule with the include,
  down its `@media` and `@include wider-than-phone` (the same element on a wider screen, adversarial
  Б2) — a role set inside one of them is checked from the rule up, so a sibling block cannot undo it
  (Ж1) — no `all`, `font`, `font-family`, `font-weight` or `font-variation-settings` — a weight after it
  left the figures at 800 and drew the dram sign at 400, Dram having three weights (А3). A nested rule
  sets them only with the text face of its own — a sentence in a figure's place (`&.missing`) is
  `font-family: var(--font)`; `inherit` keeps Nunito (В2); a variant that stays in Nunito keeps its one
  weight (Б1). A mixin that includes the role is the role, through any number of wrappers, and it
  is written in `_mixins.scss` alone — the one place the plugin reads at load — and refused where it is
  defined anywhere else, so the place a wrapper may live and the place it is looked for are one (Ж2,
  З1) — that file told by its whole path, not by a `styles/_mixins.scss` ending another one (И2), and
  `@forward … as prefix-*` refused, since it renames the role with no `@mixin` to catch (И1). It is read with comments taken out, names compared as Sass compares them —
  `display_type` is `display-type` (В1, Г1), whether included by name, through a namespace
  (`m.display-type`) or `sass:meta` (Д1, Д2). Another rule for the same element elsewhere is beyond
  what a linter can match (Б3), so the role is never put in a placeholder, anywhere in a selector,
  where `@extend` would carry it into such a rule (В3, Г2, Д3). **`@extend` and `@use 'sass:meta'`
  are refused outright** (adversarial round 6): neither is used, and between them they carried every
  remaining way past the check — a rule the role was extended into, a mixin applied under no name
  (Е2, Е3). The check reads the source, not the compiled CSS: each round of review found a narrower way
  past it, and the last ones were deliberate. **A custom property read where none is declared is refused** by
  our own rule, `molvia/known-custom-property` (`frontend/stylelint/known-properties.mjs`):
  `var(--space-5)` stood on two screens, dropped as invalid, because the spacing list takes any
  `--space-*` by its shape. Known is a declaration made directly in a rule that is exactly `:root`, at the top
  level of the tokens or `main.scss` (one only a media query or `[…]:root` declares is undefined in the
  light scheme, Б5, В4), in a mixin's body (known
  everywhere, set where the mixin is included), the file itself — or the one list of properties a script sets (`SET_BY_SCRIPT`, today
  `--sheet-drag`), where a false alarm is fixed, never by a disable comment in the component. A name
  the dark scheme alone declares is undefined in the light one and is refused in `_tokens.scss` (А5);
  a name in a comment is no declaration (А9); a fallback does not make a name known; a name Sass builds
  by interpolation (`var(--space-#{$n})`) is not checked. Besides the mixin's two lines there is no
  disable comment — `AppButton`'s icon size went with the icon scale (MOL-173). **A branch red after
  master took this:**
  Nunito is `@include display-type` in place of the `font-family`/`font-weight` pair, a literal is a
  token, and `npm run lint:style -w @molvia/frontend` names every place.
- **Colours that can meet on a screen are held apart by a test, not by eye** (MOL-172,
  `frontend/src/styles/tokens.test.ts`): in both schemes any two steps of different roles — accent
  with `accent-solid`, good, warn, bad, `graphic` — and every category against every step of a role
  stand 0.08 apart in OKLab; `accent`, `good`, `warn`, `bad`, `graphic` and every category are 3:1
  on `--surface`; `text`, `text-muted` and the inks 4.5:1 on `surface`, `sunken`, `surface-2`, an
  ink on its own tint, `on-accent` on `accent-solid`; and the dark mixin declares every one of them
  — a name it left out draws the light value on a dark ground. **No list of exceptions** (owner's
  В-13, MOL-118): the handoff checked chosen pairs and missed more than it named, among them the
  light `graphic` 0.071 from `good` and the dark tints of accent and warn 0.030; a value that fails
  is changed. «Any two steps of different roles» is one rule rather than a list of pairs, since a
  tint against another role's mark passes by lightness alone. `--graphic` is the colour of data
  without one of its own; `--border-strong` is decoration and the edge of a field (Ф-3: `--border`
  there was 1.29:1 on the well). The math — WCAG luminance and Ottosson's OKLab — is the test's own
  thirty lines, no dependency. **A tint stands 0.08 from `--surface`** (adversarial А3): a fill with
  no edge — a notice in a sheet — that the eye cannot tell from the sheet is no fill; the dark
  `bad-tint` of 157 v2 was 0.038. **Not from `--sunken`** (review 5, way «а»): on the page ground
  the light good, warn and bad tints stand 0.071, 0.070 and 0.040 — a strip under the month's
  switcher, a state's circle — held by icon and word; to hold them too the light `bad-tint` turns
  pink (`#fec5c7`, hue 28° → 16°), and that was not bought. **Nor from `--surface-2`** (round 3,
  В1), by the same price: on a well the light `warn-tint` and `bad-tint` stand 0.071 and 0.055, the
  dark ones 0.058 and 0.079 — the mark «ждёт отправки» on a queued row of «Покупки» (`TripRow`) is
  told by its word. **`--text-muted` is for the three grounds, never a tint** (А1): under 4.5:1
  there in both schemes, and the tints cannot be lifted for it — in the dark they would have to sink
  to OKLab L 0.32 and part by saturation alone, the accent's turning brick; on a tint a secondary
  line is `--text` (the chosen account, the active catalogue row, the hint of Open Food Facts, the
  account's row under the pointer). **The file is read as Sass reads it**: both kinds of comment out
  in one pass — a `/*` inside a line comment opens nothing (round 2, Б3) — every declaration taken
  whatever its value, a short or upper-case hex expanded — Stylelint asks for the short form and
  `--fix` writes it — and a colour of the lists that is no hex (`oklch()`) fails by name: read by a
  pattern of six lower-case digits, such a category left the test green (А4, А5). The same one-pass
  read is in the other readers of the file — `bin/design-md.mjs` and both plugins
  (`withoutComments`, `roleMixins`). The dot of a category on the chosen chip is under 3:1 on
  `--accent-tint` for ten light and three dark categories (А2; six and one before the palette of
  MOL-218) — not held: the tint cannot be made lighter without meeting `bad-tint`, the categories
  cannot all be darkened and stay 0.07 apart, and the chip's form is MOL-198's.
- **Any two categories stand 0.07 apart, and a category keeps its hue in both schemes** (MOL-218,
  the same test). **Every pair, not a list** (owner's В-1): the ring orders its sectors by sum, not
  by category, so its neighbours change from month to month; every account has all thirteen presets;
  and a dot in the legend is matched against the whole ring. Before it 36 light and 62 dark pairs
  stood closer than 0.08 — one's own colours were made as twins of the presets, «Транспорт» and
  «своя-3» 0.018 apart in the dark. **0.07, not the roles' 0.08** (owner's В-2): with seven presets
  kept («Продукты», «Кафе», «Аренда», «Дом», «Красота», «Связь», «Прочее») and the dark colour the
  same hue as the light, the measured ceiling is 0.074; 0.08 everywhere would have repainted all
  twenty-one. A role's colour is a meaning, where a mistake is a wrong answer; a category's always
  has its name beside it. **One hue within 10° OKLCH** in both schemes, so a category is one colour
  by day and by night; a grey (chroma under 0.04 in either) has no hue to keep. The hues stay off
  the roles' — green «Брать», yellow, brick, terracotta — which the test cannot see and the eye
  checks, as with the olive «своя-2» of MOL-172. The palette was searched for in
  `.scratch/tasks/status/MOL-218/`, not by hand; a colour changed later goes through the test, and a
  new one is looked for the same way.
- **Nunito is one weight, 800, one file per subset** (MOL-171): the 400 and 600 files were the same
  variable font copied twice, and the precache fetched each URL. A sentence in a figure's place
  («Рынка нет» on the rate chart) is set in Onest, not Nunito at another weight.
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
- **An icon's size is a step of `--icon-*`, by role** (MOL-173, Ф-9): 14 in a pill of 13, 18 in a
  strip, a note and a field's error, 20 the row's chevron — always — and the magnifier and a select's
  arrow, 22 before the word in a button, 24 a row's own icon and the glyph of a button that is only
  an icon (owner's В-15), 26 «back», 27 the tab bar; a state's circle holds `--state-glyph` 22. The
  chevron had stood in five sizes, 18 to 26, a strip's cloud in three, and `--space-6` was 24 in
  23 places. **An icon is `@include icon` (1em both ways, `flex: none`) with its step written
  beside it as `font-size`** — never an argument of the mixin: `font-size: $size` in `_mixins.scss`
  is checked by nothing, while the line in the component goes through the allowed-list, which takes
  `var(--icon*)` and `--state-glyph`. **The scale is held by `molvia/icon-size`**
  (`frontend/stylelint/icon-size.mjs`, owner's В-1 «а»), on master before it found all 142
  literals and every icon nothing sized. **Every icon of the template is sized, as the page would
  draw it**: a rule that reaches it has `@include icon`, and its font-size is a step — the
  font-size of the last rule of the file that reaches it, or, if none does, of its nearest
  ancestor's. A rule reaches an element when its selector matches the template — tags, static
  classes and ids, the descendant and the child combinator, `:is()` and `:where()` as
  alternatives, `:not()` of classes as their absence, `:root` as the page (review 17) (В3: a pair
  under `.card` with no `.card` above the icon, or `button svg` for an icon in a `<p>`, sizes
  nothing) — and counts only without a condition: not under an at-rule, with no pseudo-class
  (inside `:is()` too), attribute or sibling, and with no class the element wears only by `:class`
  (Б2, В3, Г3: under `:hover`, `[aria-expanded]`, `:first-child` or an `is-open` the template
  binds, the pair is not there at rest). Every font-size of the element the step is taken from —
  under a condition too — is a step (Г4: `wider-than-phone` turning the wrapper's font-size into
  text made the icon 34 on a wide screen). The order of the file stands in for specificity (В5: a
  later `.note { font-size: var(--text-display) }` wins). Adversarial А1: a step alone is drawn at
  the 1.2em unplugin-icons writes — 24 for a chevron of 20, the next step up, which looks meant —
  and the mixin alone at the text it stands in. A rule on `svg` has the pair or neither, and then
  only colours. A rule styles an icon when its last compound is `svg`, a part of an icon's svg
  (`path`, `*` or `:is(path, g)`, under a selector that reaches an icon or, past a descendant
  combinator, an element around one — И1: `.row path { transform: scale(1.6) }` drew a glyph of 18
  at 28.8 in its box; a chart's own `<svg><rect>` is none, review 21, and so is a part the template
  writes in it named through a wrapper that holds an icon too — `.card rect` beside a chart, 27; the
  price is `.card path` beside a chart's own `<path>`, read as the chart's) or an icon's class, or when it reaches an icon by any other means (Г2: `.row > *` sized it past
  every check). **Which step is the role's** — 20 for a row's chevron, 24 for a button's — is
  DESIGN.md's and review's, never the rule's: the role is the place's, and one glyph stands in
  several (`chevron-right` is the row's 20, the month's arrow 24 and a pager's «next»; a check by
  the import refused the two last and missed a chevron of another set, review 22, Е3).
  **`font-size` on an icon is a step of the icon scale**, never `--text-*`, `1em` or `inherit`.
  **Width and height are 1em; there is no padding or border width — on any side, `border-width:
0 0 1px` is a border (28) — no scale, zoom, translate in depth or transform but a turn or a shift,
  no contour of its own (`d` on a part redrew the glyph at 27, И1), no `overflow: visible`, clip or
  mask (К1: a stroke let out of the box painted a glyph of 18 at 27, `clip-path: inset(25%)` at 9), nor an `@include` but `icon`, `wider-than-phone` and
  `appear`, which moves and fades and sizes nothing** — a minimum of `0`/`auto` and a maximum of
  `none` change no 1em icon and pass, as `.row > * { min-width: 0 }` must (review 20), but
  `max-width: 100%` squeezes it in a narrow box, and so does a flex share: on an icon `flex` and
  its longhands are `none`, `0` or `auto` (Е4) (А4, Б4: the old pencil was a 32 box with a 16
  glyph, and a border does the same; А6: a mixin of its own carried a width past the rule) — down
  a nested `@media`, `@supports` or `@include wider-than-phone { }` too, whose body is read as the
  rule's (А2): a wider step is written there. **An icon's class is its own**: a class an icon
  wears and anything else wears too is refused (В2 — a size in `.strip .big`, `big` on the text
  beside the icon, reached the icon unchecked; review 11 had made a shared class no icon's, which
  left that door). **The steps are declared in `_tokens.scss` alone** (В1): `--icon: 2rem` in a
  component makes every line above right and the icon 32 — nor set by a `:style` of any tag; and
  no custom property may have a name Sass builds where it could be a step — `--#{…}`,
  `--icon-#{…}`, `--state-#{…}`, a whole `#{$step}`; `--cat-#{$c}` cannot and passes (Г1, Д1,
  review 23); nor may `@property` register a step outside the tokens — by its name or one Sass
  builds that could be a step — since its initial value would size every icon of the app (Е1, Ж2);
  any other property is no business of the scale and passes (review 26). Property names are
  matched whatever their case, as the browser matches them (Ж1). **Nor in the template**: a size
  or a font-size off the scale in `style`, any `:style` or `v-bind="…"`, a `width=`/`height=` (А5,
  Б3); on the way from an icon to the element it takes its step from, no `font-size` in a `style`
  but a step and none bound, the `font` shorthand included (Е2, Ж3: the style of a wrapper wins
  over its rule — and so a step there is the step, review 25, for a rule on `svg` too; its rules
  are read all the same, since one with `!important` or under `@media` may still give it text, З1,
  З2). An icon is a tag imported from `~icons/` under any name or registered under another in
  `components` (Б5), or written `Icon…`/`icon-…`, or a `<component :is>` of an `icon` or a `glyph`
  that holds nothing — the name of its expression tells it from a card's `<component :is="as" />`
  (Б6), so one named otherwise (`row.symbol`) is no icon to the rule. The template is read with
  its attributes' quotes, so `v-if="n > 0"` ends no tag (А3); `<Transition>` and the like render
  nothing of their own, so an icon in one stands in its parent (В4), and so does `<slot>` (review
  18); a `<Teleport>` carries its content out of the page around it, so nothing above it is an
  ancestor (Д2), unless a static `disabled` keeps it in place — a bound `:disabled` may be false
  (Е5, Ж4). The nesting is resolved first — `&` replaced, `&-chevron` glued to its parent (А7);
  `svg` is the tag, a class named `svg` none. Width and height are no allowed-list's, since a dot,
  a circle and a chart are sized there too; the rule reads the template instead. **Out of its
  sight, by design:** a class from `:class` — the keys, shorthand ones too (`{ accent }`, review
  19), and quoted strings of its expression are read, checked as the element's and never counted
  for a size; one from a variable is named nowhere; an icon styled from another file, or put
  straight into the slot of a component that sizes its slot itself — `AppButton`, the one in
  `SIZED_SLOTS`, which gives the mixin, so a step of the icon's own there is enough (Д4), where a
  new component with an icon slot goes with its own `:deep(svg)` (review 15: `RouterLink` or
  `AppCard` size nothing); a step inherited through a component, which may set a font-size of its
  own; specificity; a `:style` or `v-bind` with an object from the script, which the rule cannot
  read; an SFC with no `<style>` block, which gives the rule no root to run on. A circle around an
  icon is sized as a shape; the glyph in it is the icon (the pencil of «Настройки» was a 32 svg
  with padding, now 18 in a 32 circle).
- **Not now is one look, and chosen is a form** (MOL-174, Ф-5, Ф-6). «Inactive» had four looks —
  0.35 on the month's arrow, 0.45 on `AppButton`, 0.5 (`--opacity-stale`) on the switch, the trash
  of an exchange and the difference of a reconciliation, and none at all on a disabled segment —
  and a dimmed button reads as a live one under a cloud, while a dimmed knob in the dark is not
  seen. **Inactive is `text-muted` at 600 with no opacity, in the focus order**: `AppButton`,
  `SegmentedControl` and `AppSwitch` take `inactive`, which is `aria-disabled` plus a cancelled
  click — a tap, a tap on the label and Space all put the control back. An inactive group of
  segments is one stop whose arrows walk the focus over every radio by hand and choose none
  (adversarial А2: an arrow cancelled whole left two of three options unheard); an arrow with Alt,
  Ctrl or Meta is the browser's, as in a live group (Р2-А3). `e2e/kit-inactive`
  holds it in Chromium and WebKit, since the component tests send their own events. A native
  `disabled` is drawn the same and stays for a moment, until a screen trades it for `inactive`
  with the words saying why. **At work is never not now** — see the next rule. **The form of the variant stays** (owner's В-1 «а»): a button with
  a fill goes to `surface-2`, a ghost or danger-ghost keeps no fill — two grey pills in a sheet's
  footer read as two buttons of equal weight. The price, accepted (А4): the `surface-2` pill stands
  1.10:1 on a sheet, so in a footer that sends, primary and ghost read as two muted words; an edge
  would make it a secondary, which is `surface` with a `border-strong` edge. **The lift of a floating
  action is the dock's, not a state's** (reviews 1 and 6): `FloatingDock` gives `--shadow-md` to
  whatever it holds, live or not, by a weight above any variant's shadow — lifted only when
  inactive, a dead «Восстановить» floated above the live one; the kit drops an inactive primary's
  rest shadow by a light `:where`. The hover and the press are written on `:not(:disabled, [aria-disabled])`,
  since `aria-disabled` is still `:enabled` and an inactive primary lit up under the pointer. A button that is only an icon draws its glyph in `text`, inactive in
  `text-muted` (owner's В-15 «а») — `text-muted` for both made the month's arrow at the edge look
  like the live one. **Chosen is a fill or a form, never a weight**: a segment is filled
  `accent-solid` with `on-accent` (the old white segment on `surface-2` was not seen in the dark),
  and an inactive one keeps its choice by a `graphic` edge and its word in `text` — the
  `border-strong` edge of the handoff stood 1.65:1 and brought Н-3 back (А1, Graphic Is Data),
  a switch carries a ✓ of `--icon-xs` on its knob (owner's В-2 «а»; the handoff's 16 is no step),
  every chip and every segment is at 600, so nothing reflows under the thumb. **`--opacity-stale`
  means one thing: a previous answer left while the next is on its way** (К-11) — the searches;
  the difference of a reconciliation waits in words («Пересчитаем, когда…»), not dimmed (116 v2).
- **At work, a button says what it does** (MOL-225, owner's В-1…В-5 «а»). `busy` had no look of its
  own: alone it was drawn live, with `disabled` as not now, and only four places of twenty-seven
  changed their word — so «Удалить навсегда», «Отвязать», «Выйти и стереть», the login and the
  receipt stayed silent on a slow line while the kit swallowed the second tap. **`busy-label` is the
  word of the work** («Удаляем…»), standing in place of the action's in the action's look — variant,
  fill, ink, shadow and glyph — with `disabled` too, since this is the one at work and not one that
  cannot be pressed. **No spinner** (DESIGN.md, «no spinners on buttons»), nothing that breathes: the
  word is the sign and the explanation at once, and still under reduced motion by its nature.
  **The width is the wider word**: a button not `block` holds both words in one cell, the one not
  shown `visibility: hidden` and `aria-hidden`, so it does not jump under the thumb when the work
  starts or ends; at rest the word of the work is drawn by CSS from `data-word`, so the button's
  text is its action's word. A `block` one is as wide as its place and swaps the word (a cell there
  broke every test that finds a button by its text). **The cell keeps the word shown in its middle**
  (adversarial Р1-А4): where a grid holds the width — a pair of `1fr 1fr` — the word not shown wraps
  and the cell grows two lines high; at its top, «Готово» of «Края чека» stood 12 px above its middle
  on every phone. The prices, accepted: a live «Обновить» stands a little wider than its word, and
  the word of the work in a pair may stand on two lines («Готовим / фото…»). **The focus stays**: a
  screen does not bind `disabled` to its sending — the native attribute drops the focus to the page,
  `busy` is `aria-disabled` and the kit cancels the tap — **nor to `!online` while it works**
  (`!online && !sending`): a line that drops while the write hangs is the very case of the task, and
  the glyph does not turn to «no network» beside «Сохраняем…» (Р1-А3). **Of two buttons that share
  one write, the one pressed says it** (Р1-А1): «Удалить счёт», «Убрать план», «Снять оценку» have a
  flag of their own beside `sending`; the other is `inactive` — before, «Сохранить» said «Сохраняем…»
  of a save nobody asked for while the pressed one went grey. A neighbour that is not at work stays
  not now. **Work is not only `busy`** (Р1-А2): a button whose own work was bound to `disabled` or
  `inactive` — «Сохранить оценку», «Вернуть» of an income and an exchange (`restoring` of their
  composables), «Считать по нему», «Записать разницу», «Показать ещё» (`loadingMore`) — is `busy` too. **Nothing is announced apart**: the word is the name of
  the focused button, beside `aria-busy`, and the outcome is announced as before — the live region
  of `App.vue` is inert behind a modal sheet, where most of these buttons stand. While a photo is
  made ready, «Выбрать фото», «Снять» and «Отправить чек» are not now and the line «Готовим фото…»
  says it — the work is the photo's; three buttons with one word would be noise. The linter refuses
  `busy` without its word (`vue/no-restricted-syntax`) — the button's own attribute, bound, alone or
  by `v-model:busy` (Р5-А2), never one of an element in its slot, or a key of what its `v-bind` gives: the object, a spread, a
  choice, a cast (a name, a string, a computed string or a template with nothing in it), never a key
  of an object that is a value or an argument inside it (`t('…', { busy })` is no prop), on
  `AppButton` or `app-button`, the word as `busy-label` or `busyLabel` (Р1-А5, Р2-А1, Р3-А2,
  Р4-А1). A word written as a string is the word here when it has a letter or a digit — `""`, `"…"`,
  `"..."`, `"—"` say nothing (Р4-А2, Р5-А1): the rule of i18n cuts its whole list of signs out and
  is silent on what is left — and untranslated for `vue/no-bare-strings-in-template`, whose list of
  attributes holds `busy-label` (Р3-А1); that list replaces the plugin's own, so a new attribute of
  text joins it by hand.
  `src/eslint-busy.test.ts` holds every way through the real config. It cannot see a
  button at work through `disabled` or `inactive` alone, which reads the same as a neighbour put out
  while another works: that is review's. A button named by `label` — an icon-only one has no word to
  swap — takes the word of the work as its name. A retry keeps its ↻ under «Отправляем…». `/_kit` «Идёт работа» and
  `e2e/kit-inactive` hold the look and the width in Chromium and WebKit, `e2e/erase` the word, the
  focus and the second tap on the most final button of the app.
- **A row is `ListRow` or `NavRow`, a caps caption is `SectionCaption`** (MOL-175, Ф-12). A row of a
  list had been drawn anew on every screen — five heights (44, 52, 60, 64), a title at 400 or at 600,
  a hover here and none there — and a caps caption had grown 52 copies with three spacings to the
  card (8, 12, 16) and a 4 at the side on half of them. **`SectionCaption` is the one place caps are
  drawn**: Stylelint refuses `text-transform`, `font-variant`, `font-variant-caps` and
  `font-feature-settings` as properties in every other file (owner's В-1 «б»), whatever their value
  and in any case, so a new copy cannot grow back. **The property, not its value**: a check of the
  value read the text of the declaration, and a Sass variable, a map, an interpolated value or a
  custom property of the component carried caps past it — round 2 of review drew all four in a real
  browser (А2, Р2-2); `TEXT-TRANSFORM` had passed a rule written in lower case before that (А-1).
  `font-variant-numeric` — figures in columns — is another property and everyone's. Out of its
  sight, by design: a property name Sass interpolates (`text-#{…}`), which Stylelint skips as
  non-standard syntax, and what Stylelint does not read — a template's `style`, which no file writes
  today, and a `:style` bound from the script. A group's
  caption carries its own 4 at the side and 8 above the card; `inset` is a card's own title, placed by
  the card. The space above a caption is the screen's, set by its own class on the root — the
  caption's place is written in `:where()`, weaker than any class, because an equal selector would
  win by the order the sheets happen to load in; and in a container with a `gap` the caption and its
  card stand in a block of their own, or the gap adds to the 8 (the replacement found eleven such
  places). `#mark` (the verdict's dot) is hidden from a screen reader — a mark repeats the words
  beside it, and named, every group heading was read twice; `#tail` (a month's sum) stands inside
  the heading, so the heading is named «Сентябрь 120 000 ₽». The tone of a caption — the verdict's
  ink on «Что брать» — is the screen's class, not a prop of the kit (124 v2 is the one coloured one).
  **The chevron means «opens something to go on with»** (owner's В-14 «а»): a screen or a sheet with
  fields. A row that acts at once («Скачать мои данные») or asks to confirm («Удалить», «Выйти») has
  none, and one card never mixes the two — then «Политика» moves out of «Ваши данные», and «Написать
  разработчику», a sheet with fields, gets one though 147 drew it without. `ListRow` takes it as an
  explicit `next`, never guessed from the tag, since the card decides and not the tag; `NavRow`, an
  entry, always has it. That a card does not mix is held by review and DESIGN.md: only the whole
  screen shows it, as only the place shows an icon's role (MOL-173). **The row's icon is a prop,
  drawn in the row** at `--icon-md`, so `molvia/icon-size` sees it in one file and no screen draws a
  22 beside a 24. **A row's button look is taken off in `:where()`**: the hairline `AppCard list`
  draws between rows is a `border-top`, and an equal selector reset it by load order (`AdviceHomeNew`
  had met it). **Inactive** is the kit's not now (MOL-174): `aria-disabled`, focusable, the click
  cancelled and stopped — a link is followed nowhere, and has no `href`, or a middle click or a long
  press would open it in a tab (review Р-1); `e2e/kit-inactive` holds a tap (the cancelled click),
  Enter and a middle click (no address) in Chromium and WebKit. **Selected** is the fill, the ring and a ✓ in place of the chevron, the weight
  unchanged, and it is read out by the role the row was given — `aria-checked` for a radio, a
  checkbox, a switch and their menu items, `aria-selected` for an option, a tab, a tree item and
  the cells of a grid (А4: the first tables left `menuitemcheckbox` and `treeitem` mute); a row with
  no role says nothing, and says so while developing, so a picker gives its rows one. **The fill, the ring and
  the focus of a chosen row are a layer of its own** (`::before`), rounded as the list card, and the
  row stays square under it: rounded itself, the row bent the hairline the card draws as its
  `border-top` (round 3, Р3-1; adversarial Б1) — in an `li` a tile under a straight line, straight in the card a line bent into its round;
  square, its ring was cut at the card's corners on a first or last row (А3). **The focus stands
  inside the ring** (`outline-offset: -6px` on the layer, the fill between them): on `-2px` it was the
  ring itself — 2 px of the same colour on the same place — and the keyboard lost the row it stood on,
  where a radio group puts the focus first (adversarial А1, WCAG 2.4.7); chips draw it the other way,
  the ring inside and the focus outside, which a list card clips. `e2e/kit-rows` holds both in both
  engines.
  **Active** is the row the keyboard stands on in a list a field owns (К-4): the fill without the
  ring, since the focus is in the field; on a chosen row the fill is the layer's alone — the row's own
  square fill stood out past the round ring at every corner (adversarial В1). Only a `div` row takes a button into its tail — a button
  inside a button is no HTML. `NavRow` without `to` is a button that opens a sheet and says so
  (`aria-haspopup="dialog"`). **A note is `AppNote`, a tag in a row `AppTag`** (beyond FIXES, seven
  handoffs drew each their own way): a note on `surface-2` with an 18 icon and 13 words, or `warn` on
  its tint, in the strip's shape and never a live region; a tag a pill of 13/600, plain, warn or bad
  — rows had drawn them at 11/700, 11/600 and 13/600. Screens move onto them in their own tasks.
- **A search is one field, `SearchField`** (MOL-177, Ф-12). «Что взяли?» drew a pill in a well with
  a hint of 11, «Что брать» a rounded box on `surface` edged by an inner shadow with a ring of its own,
  «Выбрать товар» a field of the form with a label repeating the sheet's title. Now one: a pill on
  `surface-2` with a `border-strong` edge — 44 inside it, 46 outside, as `AppField` (owner's choice on
  review Р1-3: a scanner of 44 in a pill of 44 would lie over the edge), a magnifier of 20, at the right the screen's action —
  the scanner — **or** «Очистить» while there is text and the field is not read-only, never both, the
  focus of a kit field and a hint of 13 (adversarial А2: read-only kept the keys out and let the button
  empty the field). **In an open dialog the field gives Esc to the dialog**: Chromium takes a search
  field's Esc for itself — it clears the text, and the dialog never hears `cancel` — so «Выбрать товар»
  lost the receipt's words and stayed open (adversarial А3); the field prevents that Esc and makes the
  close request the platform would have: a `cancel` the dialog may prevent — a sheet does, and closes
  through the history — else the dialog is closed, since a `cancel` from a script closes nothing by
  itself (round 2, Б1) — and only where the platform makes one, by its own answer `dialog.closedBy`:
  not `none` (round 3, В1: a dialog beside the page or one to be stepped through keeps its Esc; round 4,
  Г1: one beside the page marked `closerequest` or `any` is closed, and the attribute is the platform's
  to read, not ours); an engine without the property knows no `closedby` and closes a modal dialog
  alone. **Not while a popover is open** (round 5, Д1): the platform's Esc closes the topmost of what
  closes, a popover stands above the dialog, and taken by the field Esc closed the dialog under it; which
  one is on top no script can ask, so with a popover Esc closes open (`auto`, `hint`) the key is the
  platform's; a `manual` one is a strip that stays until taken away, closes on no Esc and does not count
  (round 6, Е1: counted, every such strip gave «Выбрать товар» back to Chromium's clearing). The price,
  while none exists in the app, measured in round 6 (Е2): with such a popover in the dialog Chromium
  clears the field and the popover stays; WebKit closes the popover.
  Unless its owner took the key first. Outside a dialog Esc is the platform's,
  the combobox's «let go of the row» before it. **The focus of a field is one mixin, `field-focus`**, which `AppField` takes too. **The field
  is only a field**: a combobox gives it its role, its `aria-*` and its keys, and every attribute but
  `class` and `style` lands on the `<input>` — so the two simple searches carry no listbox they have
  not got, and the combobox keeps its list, its arrows and its Escape (MOL-23). **No width of its
  own** (`width: 0` beside `flex: 1`): an input brings some twenty characters as its least width, and
  in the kit's grid that pushed a phone of 320 to 357 in WebKit. **A second one is refused by ESLint**:
  `<input type="search">` and `enterkeyhint="search"` outside `SearchField.vue`
  (`vue/no-restricted-static-attribute`), as caps outside `SectionCaption` are; a bound `:type` passes —
  it closes carelessness, not intent. **The rows of the combobox are `ListRow as="li"`** options: no
  `type`, no stop of Tab — the focus stays in the field — and **no hover**, which on a desktop fought
  the arrows for which row is active (MOL-23); **the name wraps** (`wrap`), never «…» — its end, the fat
  or the size, is what tells two items apart, and cut they read as one (adversarial А1: «Молоко
  «Марианна» ультрапаст…» twice at 390); the active one is read out selected, as the ARIA
  combobox has it, filled at the weight of every row (К-4 — the handoff of 0.1 drew 700). **On the fill
  of an active or a selected row the meta is `text`**: muted stands 4.17:1 and 3.83:1 on `accent-tint`;
  the combobox had kept that itself, and `ListRow` had lost it for a chosen row with a meta (MOL-175).
  `e2e/kit-rows` holds the pill, its one height of 46 with or without the scanner, the active option's weight
  and meta, a chosen row's meta, and an option's whole name at 390 and 320, in both engines.
- **An operation is one row, `OperationRow`, and it knows no operation** (MOL-176, Ф-12). «Траты» drew
  `SpendingRow`, an account's journal, «не попали» and a check drew an `OperationRow` bound to
  `AccountOperationView`, and the two parted on everything seen: the chevron on purchases alone or on
  every row, a title at 400 cut to «…», a circle of 36 in the accent for purchases, a tag of 11/700.
  **The words are functions beside the data** — `journalRowProps` in `spending.ts` for a line of the
  month, `operationRowProps` in `accounts.ts` for the journal (`inAccount`) and out of any account —
  and every rule of them has a unit test: the sign (U+2212 out, «+» in), «≈» and whole units where a
  rate of its day counted it, «не посчитано», the money of another currency under the amount with
  «списано» or without, «Прочее · сверка» by the note in either language. Until this task those rules
  lived in a component's `computed` and nothing but one e2e name read them. A check's reason takes the
  circle from the same function and keeps its own words, with no tail — its title says the sum.
  **On `ListRow`, by two things the kit gained**: `tint`, the icon of 24 in a circle of 40
  (`--row-circle`) in a category's colour on `--cat-tint-share`, or `muted` (`surface-2`,
  `text-muted`) for an income, an exchange, a spending whose category the phone does not know —
  never the accent, which is «press here» (Ф-4): purchases take the circle of «Продукты»; and `#below`,
  the tag under the meta, since in the meta it would be cut with it. **The chevron is on every row** —
  every one opens a sheet to go on with — so the amounts end in one column; a sum over the rows stands
  in it by `--space-tail` (the card's hairline, the row's inset, the chevron and the gap: the day's sum
  of «Траты», whose own words wrap and never its figure). **The title wraps, the meta has two lines and
  breaks a word longer than the column** rather than cutting it at the side, and a tag on a narrow row
  breaks inside its pill rather than standing over the amount. **The amount never wraps or cuts; the
  line under it wraps only between its parts** — after «·», between two amounts (`unbroken`), never
  inside «без «списано»» (adversarial round 2, Б3). **Beside the words the tail takes at most 45 % of the
  row**, unless the amount itself is wider (`ListRow`): taken whole, a long line under the amount left
  the title 0 px and pushed the chevron past the card, which cut it (adversarial А1, А2). **A row
  narrower than 22rem stands its tail under the words**, at the right, where the column ends (owner's
  choice of 05.10.2026 on Б1, Б2, Р3-2): on the cards of «Деньги» — 256 on a phone of 320 in their gutter
  of 32 — an amount of six figures left the words forty pixels, and a salary with its kopecks none; no
  share of the tail helps, since an amount is never cut. `OperationRow` makes its `li` the container
  `row`, so every row of a card is laid out alike. The price: below 22rem such a row is a line taller,
  and the handoff, drawn at 390, has none of it. **The amount is never coloured**: only a balance below
  zero is «плохо», on the balance's card (116 v2 2d). `e2e/kit-rows` holds the column, the chevrons in
  one place inside the card, the skeleton's bars in it and nothing cut or over another at 390 and 320,
  in both engines; `accounts.spec` the account's journal at 320 and 430, `money.spec` the day's sum at
  412 and 320. **Its skeleton is `SkeletonPart kind="rows"`** (`lead="circle" tail next`, MOL-178; it
  was `OperationSkeleton form="rows"`), the same geometry in bars of
  `--border` on `--surface` (Ф-13), each bar in a line of the size and leading of the words it stands
  for, so a row of bars is as tall as a typical row of the answer — **narrow too**: its `li` is the container
  `row`, and both read the one `$row-narrow` (`_mixins.scss`), so the bars cannot part from the answer
  (adversarial round 3, В1: kept wide, a day of twelve rows would have grown by 300 px as the answer
  came); `e2e/kit-rows` holds the height and the amount's place at 390 and 320. **The typical row is the
  short one** — a title and a meta of a line each, no line under the amount — **and the line under it is
  the screen's to ask for** (`under`, owner's В-3 «б», MOL-178): an account in another currency has one
  under nearly every amount, and twelve rows of bars a line short would grow by some 200 px as the answer
  came; always drawn, a journal in its own currency would come shorter than its bars — the page under the
  month's switcher, which MOL-138 holds. **The price, named** (adversarial round 4 of MOL-176): a row whose
  words wrap is taller than its bars — on a card of 256 by 17 to 34 px — since the bars know no text.
- **The scheme is the device's, and it is drawn before the first paint** (MOL-111). «Тема» on the
  settings screen — «Системная · Светлая · Тёмная», under «Напоминания» (owner's В-2) — is kept in
  `molvia.scheme` (`light` / `dark` / `system`; anything else reads as the system), never sent: a
  property of the screen, not of the account, so «Выйти» and erasure leave it, as they leave the
  keyboard's height. **The person's choice wins both ways, by selectors, not by specificity** —
  `:root` and `[data-scheme]` weigh the same, and until this task «Светлая» on a dark system stayed
  dark, since the system's dark block lay on the root whatever the mark, and «Тёмная» on a light one
  left `color-scheme` at `light dark` and drew native controls light; the dark block is
  `:root:not([data-scheme='light'])` and the dark mark sets `color-scheme: dark`. **A script in the
  head of `index.html` sets the mark before anything is painted** — after the theme colours, which
  it points, before the styles: `main.ts` is a deferred module and the browser may paint before it,
  so a dark screen would flash light at every launch. **It is the one reader of storage outside
  `storage.ts`**, read-only and in `try/catch`, and reads as `read` does — the shared shelf, then
  the tab's, the first value found; `useColorScheme.test.ts` runs the script itself and holds its
  answer to the module's for every pair of shelves. **The status bar follows by `media`, not by
  colour**: the two theme-color tags name their scheme (`data-scheme-of`), the chosen one gets
  `all`, the other `not all`, «Системная» gives both their queries back — a copy of the colours in a
  script would be a third place to drift from the tokens. **The manifest does not follow** — it is
  read at install, iOS ignores its `theme_color`, Android takes it for the splash alone. **Every
  choice is written, «Системная» too, on every shelf or none** (`writeEverywhere`): the shared shelf
  is read first, and only an empty one lets a tab's own past through — with «Системная» a removed
  key, a tab that missed it (unloaded, closed and brought back) came back dark at every reload
  (adversarial В); and a shared shelf that refused the write but kept its past answered the choice
  just left, after a reload (Б). **Other windows follow** on `storage`, and bring **only their own
  shelf** in line (`writeOwn`): written back to the shared one, an event handled late put a stale
  choice over a newer one and sent it round again (review С-3). **A key gone is not a choice**: it
  goes when a full shared shelf refused a choice and lost its past, or the storage was cleared, and
  read as «Системная» it put every other window in a scheme nobody chose (adversarial Б′) — the
  window keeps its own, as its reload does. The control is `SegmentedControl` with `fit` — each
  segment the width of its word, the semibold reserved under it so a tap moves nothing; the word
  lies over its segment's hit area, so a tap on it lands on the label, **inside the track's own
  stacking context** (`isolation`) — lifted without it, it rose over the pinned header too, drawn
  through it and taking its taps (adversarial Д); even thirds on a 320 px phone left «Системная» (91
  px) a pixel of its 92 (owner's В-1: «выбор шире»). Not in a card for the same reason. Taken on the
  tap, nothing said: the screen is the answer; in every state of the screen, since it asks nothing
  of the server.
- **The floor of the browsers is `build.target`, one statement in `vite.config.ts`, and below it the
  app does not start** (MOL-231). A phone sent `TypeError · vue:login` (`1415bf`, 05.10.2026):
  `Object.hasOwn` in `ScreenState`, a browser of 2021. Vite lowers syntax to its target and touches
  no API, and its default target — `baseline-widely-available`, Firefox 114 in Vite 8.3 — was not
  even true: the bundle constructs `Intl.Segmenter` as it loads, which Firefox has from 125, so
  Firefox 114–124 failed at the start and reported it. **The floor is the target, not a list of
  what the code calls today**: `hasOwn`, `.at` and `findLast` are all in Safari 15.4, while a regex
  literal with a lookbehind (`receipt.ts`) is a syntax error below 16.4 that keeps the whole bundle
  from parsing — a check by those names would let iOS 15 through to a blank screen. So
  `BROWSER_FLOOR` is written out (`chrome111, edge111, firefox125, safari16.4, ios16.4`, owner's
  В-1 «а»), never Vite's default, which moves with Vite. **A classic ES5 script after `#app` in
  `index.html` checks two markers** — `String.prototype.isWellFormed` (Chrome 111, Safari 16.4,
  Firefox 119) and `Intl.Segmenter` (Firefox 125), the newest of which is the floor of each engine —
  and below it puts `data-outdated` on the root, the language by `pickLocale`'s rule into `lang`, and
  one line, «Браузер устарел — откройте Molvia в свежем Chrome, Safari, Firefox или Edge», in
  `#app`. After `#app`, since a classic script runs as the page is parsed and every module waits for
  the parse to end; a fresh browser pays one synchronous check and nothing else. **The line is
  `outdated.line` of the locales**, put into the script by a plugin of `vite.config.ts` at build
  and on the dev server — no Vue is running yet to translate it; the script names it by an
  identifier, so its test runs the file as it is. Every occurrence is replaced, by a function — a
  `$` of a line is no pattern — and a build with the name left behind, or none at all, fails: a bare
  identifier is a `ReferenceError` before the mark, the bug back for the very browsers the script is
  for (adversarial А2); the test holds the name to one place, the script. **The condition is held
  whole**: a probe added to the script and not to the test's table would raise the floor unseen.
  **Below the floor nothing listens and nothing starts**: `catchers.ts` installs no reports —
  `failures` is a silent stub, so `reportFailure` from any module says nothing — sets no listener, and
  `main.ts` no `start()`, so no `POST /client-errors`, no worker, and whatever the old engine trips
  on as the bundle loads reaches its console alone. The bundle is still fetched: a module put in by
  the script would be found late by the preload scanner, and a fresh browser would wait for it.
  **What the check lets through is our defect, and the owner hears it**: a browser at the floor
  failing on an API above it means the code outran the floor, and the floor is raised — nothing
  filters it on the server, no column of `failures` carries a version. **The floor is held by
  `browserFloor.test.ts` and by this rule, with no dependency** (owner's В-2 «а»): the test holds
  the markers, with their versions copied from MDN's browser-compat-data, to exactly the target of
  each engine, neither above nor below; **an API above the floor raises the floor here, and in the
  markers, never a workaround in the code** — `eslint-plugin-compat` sees globals but not instance
  methods, `eslint-plugin-es-x` measures ECMAScript years rather than browsers, and neither was
  bought. Never `@vitejs/plugin-legacy` or polyfills: weight at the shelf for browsers the audience
  has not got. **The price, named:** Firefox 114–124 and Safari below 16.4 get the line in place of
  the app — before, a blank or a broken screen. **And Chrome and Edge 97–110 get it too, where the app
  ran** (adversarial А1): their 111 is the target Vite's default gave, not a need of the bundle —
  nothing in it calls an API past Chrome 97 unchecked (`findLast`), and a Chromium with the API
  surface of 97 went through the login, five tabs, a sheet and a record without one failure. Kept,
  since the task forbids lowering `build.target` and the floor is the target: below 111 the CSS is
  not checked either (`:has` and `@container` 105, `dvh` 108), and a lower floor is a decision of its
  own. Who meets it: Android 6, stuck at Chrome 106, and its WebView — Telegram's in-app browser
  there — and the vendors' Chromium browsers that lag behind. **Nor does the check help a page an old
  worker serves**: a browser below the floor that reached the app before this (`1415bf` did) gets the
  old `index.html` from its precache until the new version is let in the quiet way, and reports as
  before meanwhile — a passing price.
- **The scrim is declared on `::backdrop` too** (MOL-231, adversarial А3): a backdrop inherits from
  its dialog only since Chrome 122, Firefox 120 and Safari 17.4, and on the floor below that
  `var(--scrim)` there was undefined — every sheet rose over a page not dimmed, every iPhone 8 and X
  among them, and silently, since CSS reports nothing. The light value is the one copy beside `:root`,
  the dark scheme gives the backdrop its mixin under both of its selectors, `tokens.test.ts` holds
  both. Any other custom property a backdrop reads goes the same way; `--sheet-drag`, set on the
  dialog, falls back to 0 there — the scrim does not fade under the finger on the floor, a price.
- **Every screen has four states:** loading, empty, error, offline. The empty state is not
  "no data" but an offer to act. They are drawn by two blocks and nothing else (MOL-19):
  `ScreenSkeleton` for loading, in the shape of the answer (the next rule), and `ScreenState`
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
  or «attention» on the screen interrupts; anything inline is polite. **A full-screen error also
  offers «Сообщить о проблеме»** (MOL-147), drawn by `ScreenState` and by nothing else, last and
  quietest: not `inline`, not for nobody known, not inside a `<dialog>` — `feedback.md` says why.
- **The skeleton is the answer's shape, drawn in the kit's parts** (MOL-178, Ф-13, Н-5). Its bars were
  `surface-2` on the page's ground — 1.06:1 in the light scheme, next to nothing — with no card, no
  rows and no search field, so the screen jumped as the answer came. **`ScreenSkeleton` is the frame**:
  «Loading…» in the live region, the bars hidden from a screen reader, 8 between its parts and 24 above
  a caption that is not the first (`:slotted`, the frame's rhythm, not the part's); **the shape is the
  screen's**, put in its slot in the order the answer will stand (owner's В-2 «а»): the kit's
  `SkeletonPart`s — a caption on the ground, the well of a search, a list card of rows (`lead` an icon of
  24 or a circle of 40, `tail`, `under`, `next`, `narrow`), the card of a sum (`plate`), paragraphs — and
  between them what is the screen's own, the ring of «Графики», the scale of «Оценки». A prop of one
  array was the other way, and the screen's own would have stood only after every part. A frame that drew
  nothing warns while developing — read from what is under its bars once mounted, since a slot of
  `<SkeletonPart v-if>` is passed and draws nothing; once `groups` stopped being required, the invisible
  skeleton of Н-5 was one no type or test would see (adversarial А4, Б4). **The roots of the parts are named
  `skeleton-*`**: a part is rendered by the screen that puts it in the slot, so its root carries the
  screen's scope too, and a scoped `.caption` of «Бюджет» set its size on the caption's bar
  (adversarial А3) — a class of a root is never a word a screen uses for its own, and `SkeletonPart.test`
  holds it against the styles of every component (adversarial Б1: «Настройки» drew their fields as
  `.skeleton-field`, now `ghost-*`). **A root is an element of the part's own, never `AppCard`**: the card
  carried `card`, `plain` and `list` on the root too, and a `.card` of «Графики» gave the rows a padding of
  16 and the paragraphs a gap of 4 (adversarial В1); the scope goes down to the root alone, so a card one
  level in is the part's, and the test holds that every class of a root is `skeleton-*`. **A bar is `@include skeleton-bar`** — `border-strong` at
  `--skeleton-rest` (0.62), which is `border`'s 1.42:1 on a card in the light scheme and 1.47:1 in the
  dark, 1.31 and 1.53 on the ground under a caption, as `tokens.test.ts` holds — in the parts and in what a
  screen draws in the slot (the label of «Настройки», the keys of «Оценки», the cards of exchanges), never
  `surface-2`, 1.1:1 even on a card. A well (a field) is `surface-2` with its `border-strong` edge, as the
  field's own, **and stands still** — a field is not text that is coming. No linter holds the bar — a well
  is `surface-2` by right — review does, and a bar drawn past the mixin stands still among the others.
  **It breathes by its own opacity, from its rest up to 1 and back** (`@keyframes skeleton-breath`,
  global), so it is never fainter than at rest: the frame's 0.45 to 0.9 faded the cards too and took the
  very contrast the bar is drawn for — 1.17:1 in a card at the trough, 1.09 on the ground, where Н-5 was
  1.06 (adversarial А2); and a colour that breathed instead was repainted on the main thread, 61 style
  recalculations a second against 5.5, while the answer is read (adversarial Б3); an opacity is the
  compositor's. Still under «reduce motion». **The widths of a row's bars are the part's**, the
  handoff's uneven cycle, never the screen's — the line under an amount never the amount's own, or the
  two read as one block; a caption's and the paragraphs' are the screen's, since there the width is the
  content. **Narrow is the answer's**: `narrow` makes the rows' `li` the container `row`, as
  `OperationRow` does — a `ListRow` in a plain `li` keeps its amount beside the words at any width, and
  bars gone narrow under it stood 9 px taller at 320 (adversarial А1). Left out, it is the circle's: a
  circle of 40 is `OperationRow`'s alone, and a forgotten `narrow` there left the bars 42 px short of the
  answer at 320 — the dear way, which MOL-138 holds the page against (adversarial Б2). `under` brings its
  amount with it. **`groups` is the shape from before the parts**, drawn as paragraphs in one card, so every
  screen's skeleton is seen at once (owner's В-1 «а»); each screen trades it for its answer's shape in
  its own task of the epic, and its `groups` goes with the last of them. Where a card is not the
  answer's shape the paragraphs stand bare (`card: false`): the scanner's bar at the top of the
  viewfinder. `/_kit` «Скелетон» puts each part under the answer it stands for, and `e2e/kit-rows` holds
  their heights — the well, a caption, a row of `ListRow` with its amount, a row of `OperationRow` with a
  line under its amount — and where each amount ends, at 390 and 320 in both engines; the breath and its
  stillness under «reduce motion» are held on a bar (`advice.spec`, `item-search.spec`). **The card of a
  sum is held by nothing yet**: its shape is the total of 77 v2 2a (`TripTotal`, figure 28 at
  `--leading-tight`), which is no card until MOL-206 makes it one; the sums of «Деньги», «Счета», an
  account, «Обмен» and «Бюджет» stand at the body's leading, some 8 px taller than the part — their
  tasks (MOL-183 first) set the part against their answer. **The price:** a card adds its padding and
  edge, so a skeleton of `groups` is some 34 px taller than before — taller, not shorter, which the hold
  of MOL-138 needs.
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
  «Back», else the chevron alone — never a fragment, which «Покуп…» would be — and the title yields
  last, only when it alone does not fit between two chevrons. The width is read in fractions, as the
  label is drawn: rounded, a word 0.4px too wide passed as whole and was drawn «Наз…» (review А1).
  **The name does not follow the ladder** — «Back Purchases» on every step, the word shown first
  (owner's decision on review). **It
  leads to the screen underneath when that screen is any ancestor** — the step the system
  button takes — and otherwise replaces onto the parent (`backTarget`, MOL-77): the search of a
  record opened cold, with the record and «Покупки» laid underneath, says «‹ Запись»; with
  «Покупки» right underneath and no record, «‹ Покупки» — and both «back»s go there. A tab
  asked for on a nested screen — never tapped there, the bar is shown only on a section's root, but
  a screen may send a person to a tab when it is done — goes from its section: up the chain the way
  «back» goes while an ancestor is underneath, then the tab from there (MOL-128, adversarial Б) —
  read as «from no section», every such move would leave two more entries before «back» left the
  app. The tab follows only the router's move off that screen, and only once the step has landed
  (review Р-24): a pop a sheet's guard ate must not leave it to fire on a later move.
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
  «back». **One written exception: a sheet pulled down** (MOL-80, the owner's request) — a
  vertical drag inside the sheet, which neither the edge swipe nor «back» is, and which closes
  it through the history like everything else (below). Only the page scrolls, never an inner
  container: iOS hides its address bar and the router restores positions only for the window. **A move that changes only the query of the
  screen is the screen's own state, not another screen** (`sameScreen` in `transitions.ts`,
  MOL-136): the category and the period of «Графики», the month of «Деньги», the period of the line
  of the rate on «Обмен денег» (MOL-168) live in the address and
  change by `replace`. **It is not scrolled, not animated and not an arrival** — three readers of
  one move, and a fourth below, all going by the one definition. Read as a new screen, it took the
  page to the top — the category card is the third, and the chart the person chose it for was gone;
  it took the focus to the heading, so the second Enter on «‹» went into the title and the arrows of
  the period worked once (adversarial Ф); and the month cross-faded as a move between tabs, whose
  overlay took the second quick tap (Д). One rule rather than a flag on the screen: a flag has to be
  remembered by every screen that keeps its state in the address, and the one that forgets it is
  this bug again; no screen wants the top on a change of its query — one that does scrolls itself
  after its `replace`. Back and forward still return to what was saved, and the same route with
  other params (`/money/accounts/a` → `/b`) is another screen, from the top. **Nor does it move the
  control it was made with** (MOL-138): the arrow of the month, the period, the category stay under
  the thumb whatever the screen redraws around them. **Below the control, the page is held**
  (`installHeightHold`) as tall as the bottom of the window: a month or a period read for the first
  time comes under the skeleton, a category card is a line shorter at the very end of the page, and
  the browser brought the scroll up to the new end in the very layout that made it shorter — the
  switcher left the thumb by 116 px, and the answer did not bring it back. Seen after the fact it is
  too late, a scroll put back is a jump there and back, so the page is held before the router lets
  the screen redraw: `--page-hold` on `#app`, as far as the bottom of the window and no further —
  more is empty room to scroll into. `#app` is a block, so the hold is room under the screen and
  never the screen stretched: a state that takes the free height would carry «Повторить» down with
  it. **Above the control, nothing that belongs to the answer stands**: the strips «Нет связи» and
  «Сервер не ответил», the card of a failed refresh, the card of a refusal of the queue (a row of
  its own month, a card on any other — adversarial round 3, Ж), the line «Этой категории на графиках
  нет» are drawn under the control that chooses the answer — the owner's decision В-2, against
  handoff 04, which put the strip over the month. Each comes and goes with the answer: over the
  switcher, its going took the switcher up by 74 px, and a strip of a month the phone keeps went
  with the move and came back a moment later. Made up by the scroll instead (the first try), it
  could not be at the top of the page, where «Деньги» open, and the strip that came back pushed the
  switcher the other way (review С-7, adversarial round 2). The range under the title of «Графики»
  keeps its line in every state for the same reason. The hold goes once it holds nothing in view —
  the window within the screen again, at the next scroll — with a move to another screen, after the
  view transition's picture of the old one, and when the login closes the app (`releaseHeightHold`
  in `App.vue`): the login takes the router's place without a move, and held, it was drawn scrolled
  off the window, all of it above it on an iPhone (adversarial А). **The price, named:** «back» to a
  screen left while held finds the page without its hold, and the position the router saved is
  brought up by that much — a few pixels under an empty month (adversarial В); holding it again
  would carry the hold across screens for a cosmetic. e2e holds the answer back (`page.route`) and
  takes «the page stayed» under the skeleton and after it, by where the control stands on the screen
  (`e2e/scroll.ts`): at the very end of the page, at its top, offline between months kept and not,
  and under the login.
- **A scroll the eye follows is smooth; a scroll that sets a screen in place is instant**
  (owner's remark on MOL-136). Smooth: the tab of the section one is in, back to the top
  (`goTab`), and a spending just saved brought to the middle (`toShow` in «Деньги») — each
  instant under «reduce motion». Instant: a new screen at the top and a screen back where it was
  — it slides in already there, and a smooth scroll would show the old page travelling under the
  transition; the sheet putting the page back (MOL-63), a compensation the eye must not see at
  all; the arrows in the catalogue list, which a smooth scroll lags behind. **Never
  `scroll-behavior: smooth` in the CSS** — Stylelint refuses it: a scroll with `behavior: 'auto'`
  takes it from the CSS, and the sheet's compensation would slide; a smooth scroll says so itself.
- **Nothing comes or goes in one frame** (MOL-151, the owner: «многие моменты работают как-то
  сильно резко», and «все надо делать» over the whole list). Three ways, one grammar, every length a
  token: **`appear`** (the mixin) fades a thing in with a short rise when it is put in the page — a
  state of `ScreenState`, a strip, a notice, «Вернуть», the dock, what a screen puts in its
  content in place of the skeleton (`AppScreen`, `> :slotted(*)`); an animation, so the element's
  own transitions stay its own. A screen that keeps its answer in one block of its own — «Деньги»,
  «Счета», «Категории» — fades the block's children in itself, with no rise: the control that chose
  the answer stands among them (review №5, MOL-138). «Графики» draw the answer inside `ChartsMonth`
  and `ChartsYear`, components of several roots, which take no scope of the screen's: their cards
  fade in from there (review №7). **`AppReveal`** grows what pushes its neighbours from nothing and
  shrinks it back — a row of a list (`group`), an error under a field, a block of a sheet — by its
  height, padding and margins in the flow, so the rest slides; no row is taken out of the flow, which
  a slide of the others would need. The gap of a flex column is its parent's and does not shrink with
  the row, so the margin on the row's side takes it back — otherwise the neighbour jumped by 12 px at
  the end (adversarial А2). A grid's gap stays whatever its rows do, so a sheet that grows blocks is a
  flex column, not a grid — the spending, the exchange, the income, the salary day (adversarial Б2). **What is going takes no
  tap and no focus** (`inert`, review №4). What it grows does not also fade in by `appear`: a day of
  «Деньги» is a row of the list and a child of the screen's block, and played both. **Colour changes** of a control (a button come active, a chip
  chosen) and **stale dimming** are transitions of their own. **None of it plays while a screen
  moves** (`html[data-nav]`): the view transition brings the new screen in already, and a block
  fading inside it played the arrival twice. **At the end of the move what was put in meanwhile is
  cut short** (`endMove` in `transitions.ts`): a CSS animation of no length comes back half-way
  through once its length is back, and in Chromium an answer come at the end of the move dropped to
  half its opacity and came in anew (adversarial А4). «Meanwhile» is from the frame the move began,
  with half a millisecond of slack (`SAME_FRAME`): two times of one frame come by different sums and
  differ in the last bits, and an animation started in that very frame was left to play the arrival
  again, now and then (MOL-159, the swipe back to «Счета»). **A move the browser shows itself** — the iOS
  edge swipe, Android's predictive back — is marked too (`data-nav="browser"`) for its render alone:
  nothing of ours plays, and without the mark the screen came in again after the gesture (А5). Any
  move to another screen, with a direction of ours or not: the account opened from the card of
  «Деньги» had none, and the swipe back from it came in twice (Б3; the card is on «Счета» since
  MOL-159, and the test swipes back there). **None under «reduce motion».** **An answer read is not
  a row added**: more than `BULK` (3) rows coming or going in one render — a month, a page, a first
  answer — just appear and are just gone, or a month would shrink out row by row; the first render is
  never played. **Another month is another list** (`:key` by month on the days of «Деньги»): a month
  the phone keeps came in place with one to three days, under `BULK`, and its days shrank and grew
  (adversarial А1). **A removal landed is gone at once** (`gone` in the spending queue): out of the
  queue on its answer, it no longer hid its row while the month on screen was still the one read
  before, and the day shrank, grew and shrank again (А3) — the flicker was there before, motion made
  it seen. «Before» is when the read **set out** (`askedAt`), not when its answer came: a read sent
  before the removal and come after it still held the row, which came back for seconds (Б1). A
  record of «Покупки» in the same journal is held the same way by its own queue (`gone` of the trip
  queue): removed from its screen and come back to «Деньги», it grew back and went (Б4). Both are kept on
  the device (`molvia.spending-gone`, `molvia.trip-gone`, `recallLanded` in `queueing.ts`), as the
  month they hide a row from is: kept in memory alone, a reload after a read that failed brought the
  removed spending back until some read got through (Б5). The month is kept with its `askedAt`, not
  its arrival alone: recalled after a restart, a read that set out before the removal looked newer
  than it and brought the row back (Б6). The list is written over what is stored and heard through
  `storage`, so a second window neither loses nor misses another's removal (round 5). Forgotten after
  92 days, older than any month the phone keeps unread. Both moments are the phone's clock: set back,
  a removal may hide a row restored from another device until a «Вернуть» lands here or 92 days
  pass — a named price, narrow. **What does not move, on purpose:** a change of the screen's own query beyond its
  answer coming in under the control (MOL-136 — an overlay took the second tap, and «Вернуть» and
  the main action in the dock come in without the other going out: a `mode="out-in"` would hold
  back the button the screen gives the focus to once the strip goes — read from the code, not
  tried); the card of accounts over the month's
  switcher (a height animated there takes the switcher from under the thumb, MOL-138); the reading
  and the cursor of a chart under a finger, rows re-ranked by every letter of a search, the countdown
  of «Вернуть»; and **the height of a sheet as a whole** — the lift over the keyboard and `reveal`
  measure that box (MOL-135, MOL-151), so only blocks inside it grow. Bars of «Графики» grow to a new
  answer where they stand: the area keeps its height. Component tests stub transitions (Vue Test
  Utils), so `AppReveal.test.ts` un-stubs them and fakes `animate`; e2e meets the motion as it is.
- **A screen is built from the kit, not drawn anew** (MOL-18): `AppButton`, `AppField`,
  `SegmentedControl`, `VerdictBadge`, `AppCard`, `BottomSheet` in `components/`, every state of
  them on the development-only page `/_kit`. `AppCard` carries exactly the differences between
  the three cards of 0.1 — `as`, `tone="take"`, `list` — and nothing for later: a component over
  a surface is one prop away from a wrapper around a `<div>`. **The sheet is a native
  `<dialog>` with an entry in the history**, laid through the router's own `history.push` at
  the same address — never a bare `pushState`, whose state lacks the `position` and `back` the
  rules of «back» read. Every close — ×, the scrim, a pull down, Esc, Android «back» — steps back
  off that entry, and only the pop closes it, so exactly one entry is ever taken. **A pull down
  closes it** (`useSheetDrag`, MOL-80, owner's decisions В-4…В-6): only once it is up (as a tap,
  MOL-69), only with its content at the very top, only from outside a field — a finger in a field
  moves the caret and selects — and only down more than sideways, past the tap slop; up or sideways
  is the browser's scroll. The sheet follows the finger and the scrim fades with it; let go past a
  quarter of its height, or flicked faster than 0.4 px/ms, it slides away and closes, otherwise it
  goes back up. **The flick is measured up to the lift**, where the finger lifted included, not up
  to the last move: a finger at rest sends no `touchmove`, and a fast pull held still and then let
  go — a change of mind — closed the sheet (adversarial А); a lift comes between two frames, and the
  way since the last move counts with its time (Г). **A second finger ends the pull and puts it back**: a pinch or a change of
  grip is not a decision, and the browser tells of the finger by its own `touchstart` first
  (adversarial Б). A touch that comes up from a sheet inside the sheet is that sheet's to pull. A
  pull that starts on a button does not press it: a touch that moved past the tap slop makes no
  click, in Chromium as on iOS, and e2e holds that for the main action. Touch events, not pointer
  events: once the browser starts a scroll it takes the pointer back, and only a `touchmove` that is
  not passive stops the content springing. Listened to only while the sheet is open, on the dialog:
  a shut sheet stays on many screens, and with no sheet open the shell holds no touch listener at
  all (`navigation.spec.ts` holds that). **No grab handle** (В-5): the gesture is there, the sign is
  not. **Focus comes back to what opened it, wherever the platform gave it** (MOL-80): a `<dialog>`
  returns focus to what was focused when it was shown, and Safari does not focus a tapped button — a
  screen reader was left at the top of the page, or, over a sheet, on whatever the sheet under it
  held. When the pop lands on the same screen and focus is on the body, still on the closed dialog
  (WebKit's way), or back on what held it at the opening, the opener's button takes it, without a
  scroll; on the opener already — Chromium, a keyboard — or anywhere else, it is left there, and
  `close(2)` leaves it to the next screen. No ring appears: a script's focus after a tap is not
  `:focus-visible` in either engine. **The sheet puts
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
  entries it went back. **A tap on the scrim is heard on the document** (MOL-80): iOS hands a touch
  to the page only where a listener of touches or of the pointer stands, and a listener on the
  `<dialog>` covers the panel's box — the scrim lies outside it, its `pointerdown` never came, and
  on an iPhone a tap on the scrim did nothing at all. Measured on the owner's phone: a passive
  `pointerdown` on the document, and the same tap closed it. Chromium and Playwright's WebKit have
  no such layer, which is why e2e was green; what holds it is a component test of where the
  listener stands. The press is still judged by its target — the scrim's is the dialog itself — so
  the rules below are unchanged. Until it has come up the sheet takes
  no tap, so the second tap of a double tap cannot close it or press its main action. **«Up» is
  the end of its own rise, not a clock** (MOL-69): a rise starts with the first frame that draws
  it, and on a busy phone that frame comes late — a clock started at `showModal` ran out while
  the sheet still slid, and the second tap closed it. Never sooner than a double tap, for a sheet
  with no rise; no ceiling, since a rise either finishes or is cut short (an endless animation is
  not waited for); and a tap counts from when the finger touched — its `pointerdown`, since a click
  carries the moment the finger lifted and one resting across the end of the rise closed the sheet
  or pressed the action that slid under it (adversarial А1); a click from the keyboard, by its
  own time, and it leaves the touch alone (Б1). Open a
  sheet from a tap only: Chrome skips on «back» an entry laid without a gesture. **The dialog is
  closed at once, and `data-leaving` keeps it drawn while it slides down** (hotfix-bottom-menu):
  left to the stylesheet, a closed dialog is held in the top layer by a transition of `overlay`,
  which Safari has not got — on an iPhone the × and the scrim made the sheet vanish on the spot, and
  only the pull down, which slides it itself, went down. Closed at once, so every reader of
  `dialog[open]` — «Закончить» going up to «Покупки», `holdsTyping`, the focus, the inert page, e2e —
  has it shut as ever; played open instead (the first try), «Закончить» stayed on the record, a
  sheet being up. Out of the top layer it is drawn fixed at the bottom over the tab bar, takes no
  tap, and the scrim goes at once — the price. Opened again meanwhile («save and next») it comes
  back up from where it is. The stylesheet's discrete transitions stay for a close the browser
  makes itself — a second Esc. **The sheet is the one exception to «only the
  page scrolls»**: a panel over the screen has no window of its own, so it scrolls itself and
  the page under it is held still.
- **Over the iOS keyboard the sheet's height is a share of the visual viewport's own height**
  (`--viewport-height`, MOL-135), never worked out from the window. Measured on the owner's iPhone,
  Safari: with the keyboard up the window shrank to the visible part (`innerHeight` 699 → 395),
  `100dvh` stayed 699, and the visible part was reported 304px down the page. The lift
  (`--keyboard-inset`) came out right at zero — the sheet's bottom sat on the keys — but a share of
  `100dvh` less the lift was 573px of 395 visible, and the top went 178px off the screen with the sum
  being typed; what showed was the categories. A formula of the window less the lift less the scroll
  gave 395 too, only because a negative lift is clamped to zero — which is why it is the viewport's
  height, whatever the platform did to the window. The clamp itself stays and is right for the lift:
  a negative one is Safari reporting the viewport scrolled down a window it has already shrunk, and
  the keys cover nothing of that window. **The field being typed in is kept in sight by the sheet's
  own scroll** (`reveal`), and only in three conditions (review С-1, adversarial А). **Only when the
  lift or the height changed**: a focus the browser brings into sight itself, and heard on `focusin`
  the sheet moved first and the browser's own scroll found nothing left; an event of the viewport
  that moved nothing is no reason to take the sheet from under the finger. **Only a field typed
  in** — an input, a textarea, a select: the result of a check is focused for a screen reader and read
  from its top, and scrolled to its end it put the difference above the sheet. **Just far enough, its
  top first, in whole pixels rounded outwards**: done again it moves nothing — two answers for one
  field flipped the sheet on every event — and a fraction left under the edge is a field half-hidden.
  A field taller than the sheet is left where it is; the browser keeps its caret in sight as it is
  typed. Never the window's scroll: `scrollIntoView` moves the page too. Nothing holds the window
  against the platform — a `scrollTo` back is a fight iOS wins on the next frame — and the focus is not
  put off until the rise ends, since iOS raises no keyboard for a focus outside a tap. Pinched in, the
  height is not set and the sheet keeps its share of the screen — **the price**: with the keys up in
  Safari that is the share of `100dvh` again, the top off the screen, until the pinch is let go;
  Safari does not zoom in on a focus here (no field is under 16px), so it takes a pinch by hand while
  typing. With no keyboard, and on Android where `resizes-content` shrinks the window and `dvh`
  together, the height is what it was. Playwright has no iOS keyboard: e2e replaces `visualViewport`
  before the app loads (`fakeKeyboard` in `money.spec.ts`) — keys over an unshrunk window, with the
  visible part said to be as far down as Safari says it, another geometry with the same faults, since
  a Chromium window cannot shrink without its `dvh`; the numbers measured on the iPhone are held by a
  unit test. On the device the spending sheet was checked; the
  other sheets are held by the shared component and the tests.
- **The lift is counted from the box the sheet is pinned in, read where it lies, less the visible
  height** (`pinnedBottom`, MOL-151) — never from `innerHeight`, and no longer from `100dvh`.
  `innerHeight` Safari moves on its own with the keyboard up: in the installed app the same keyboard
  over the same visual viewport (427, 123 down) came with a window of 796 once and of 720 the next
  time, and the sheet stood 76px lower, its end under the glass bar over the keys (hotfix-bottom-menu,
  which chose `100dvh` for that). `100dvh` broke the other way (MOL-151, М-2): Safari shrinks the
  box under the keys a moment before it says how far the visible part moved — on the owner's iPhone,
  «Где вы?» opened again: the keys over a window of 699 (lift 330, right), then for 300 ms the box
  369 with the visible part still said to be 0 down, and only then 330 down. A lift of
  `100dvh` less the visible height less that offset stayed 330 over a box already above the keys,
  and the sheet flew off the top of the screen — four times of four, on the recording and in the
  log. That shrink comes with no event of the visual viewport, only a scroll of the window, so the
  window's own `resize` and `scroll` are heard too while a sheet is open. A hidden fixed box with
  `bottom: 0` is read for the bottom: in every state logged on the phone — Safari, its bar folded
  (the box at 495, lift 100), the installed app (674, lift 247), the box shrunk (395 and 369, lift 0) — the box less the visible height gives what the eye saw right. The reported offset is not
  subtracted: WebKit draws a fixed box in what is visible whatever offset it reports, and in the app
  subtracting it left the sheet 123px under the keys. Where nothing is laid out (the component tests)
  the window's height stands in. `100dvh` still tells that the keys are up (`KEYBOARD`) and names
  the window a remembered height belongs to.
- **Before the keys come, the sheet takes the height they left last time** (MOL-151, М-1). The
  first keyboard of a page comes late on an iPhone — 300 to 815 ms after the focus in nine first
  openings logged, 50 to 160 after — and until it is up the page draws nothing: the main thread was
  free (a pulse never waited over 16 ms), and still no frame came for 724 ms. On the recording iOS
  finishes the rise itself, then slides the last picture up with the keys — the sheet in it the
  screen's share, 573 of 699, its top 178px off the screen, the categories over the keys — and the
  first new frame is right. Later keyboards came while the sheet still rose, and the slide was lost
  in the rise. So the visible height under the keys is remembered on the device (`molvia.keyboard`,
  by the kind of keys — `inputmode` — and the window, `100dvh` and the width: the numeric keys are
  lower than the letters, a turned phone is another window; it says nothing about the person), and a
  field of the sheet focused before the keys come takes it at once — the sum is focused before the
  first frame of the rise, so the sheet rises that high, and the picture iOS slides is already right.
  Only on a touch screen, and let go if the keys have not come in `KEYBOARD_LATE` (1500 ms: a
  hardware keyboard never comes) or the focus leaves first; an event of the viewport without the
  keys does not take it away. **On every such focus**, not only before the page's first keyboard —
  which the first round of review asked for (adversarial А6) and the log refuted (round 2, У2): a later
  keyboard came 128 to 263 ms after the focus with no frame of the page between or with one. With
  none, iOS slides what was drawn before the focus, and nothing here can change it; with one, that
  frame is what it slides — made lower, the sheet lands in place, left tall its top went off the
  screen. **The price is that one frame**: the top lower for the 15–36 ms before the keys. In
  Chromium every frame is drawn, so e2e cannot hold this either way; the unit test holds the rule. **Only a field with keys**: a select and a date bring a picker of their own,
  and a height remembered for them made the sheet short for 1.5 s and then jumped (У1); they are
  still kept in sight like any field typed in. **The price:** the very first keyboard on a phone, or
  after its data was cleared, has nothing to go by and still slides. Neither is the focus put off nor
  the window held — the rules above stand.
- **Under the keys, nothing of the page shows** (hotfix-bottom-menu). On iOS 26 and later the keys,
  the bar of «∧ ∨ ✓» over them and Safari's address bar floating above them are glass with clear
  room between them, and the sheet stands on the top of that frame, not of the keys: what lay under
  it — the spendings of the month — showed in a band between the sheet and the keys (the owner's
  screenshots, Safari and the installed app). Two layers close it, since neither closes both:
  - **The sheet goes on below its edge in its own colour**, a shadow of `--surface`, spread and
    offset alike so it starts under the rounded corners, first in the list so the sheet's own shadow
    does not darken it; not a taller box, since the box is what the lift, the height and `reveal`
    measure. That covers the installed app, where the window goes on below the keyboard's top.
  - **The page is hidden while the keys are up under a sheet** (`data-under-keys` on the root, set
    by `useKeyboardInset` once the visible part is `KEYBOARD` = 150px shorter than `100dvh` — less
    than any keyboard, more than a browser's own bars), and the canvas takes `--surface`. In Safari
    the window — and everything fixed, the sheet and its scrim with it — ends at the top of the
    keyboard, and below it only the page itself is drawn: the shadow was not, and the band stayed.
    `visibility`, so nothing is laid out anew and nothing scrolls; the open sheets and the live
    region stay. The page under a modal sheet takes nothing anyway; above the sheet the scrim now
    dims the sheet's colour instead of the screen — the price.
  - **An open sheet stays wherever it is mounted** (MOL-219): it is left out of what is hidden in the
    selector itself, `#app > :not([role='status'], dialog[open])`. A rule giving it back its
    visibility outweighs only what a sheet inside a screen inherits; on a sheet mounted in `#app`
    itself — «Написать разработчику» — the rule with the id won, the sheet hid as the keys came up,
    the browser took the focus from its field and the keys went down at once, over and over. An
    end-to-end test sets the mark by hand — no test browser has the keys — for that sheet and for a
    screen's.
- **`interactive-widget=resizes-content` is Android's alone** (hotfix-bottom-menu): set by a script
  in the head of `index.html` for an Android user agent, before the page is laid out. iOS ignored it
  until Safari 27, which began to honour it: the window shrank to the part left visible under the
  keyboard (`innerHeight` 699 → 395 with it, 699 kept without it, the same phone and state). The tab
  bar that stood mid-screen in the installed app on production is taken for the bottom of such a
  window not given back — a reading, not a measurement: the probe never caught it, and it went away
  by itself after a relaunch. `useKeyboardInset` lifts the sheet on iOS, as it did before.
