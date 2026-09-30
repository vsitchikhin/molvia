# Map · Frontend shell and kit: app, screen frame, sheet, states, styles, i18n

Rules: `.claude/rules/frontend.md`. A test beside its source, or mirroring it under
`packages/model/tests/`, is covered by the source's entry.

## frontend · views

- `frontend/src/views/KitView.vue` — Development-only kit page at `/_kit`: every kit component in its states, and a sheet in a real history for e2e.

## frontend · components

- `frontend/src/components/AppButton.vue` — Kit button in five variants (primary, secondary, ghost, danger-ghost, icon), with busy, inactive and an icon slot.
- `frontend/src/components/AppCard.vue` — Kit card: the surface of lists and blocks, with a chosen tag, the green «take» tone and an edge-to-edge list mode.
- `frontend/src/components/AppField.vue` — Kit field: a native input, textarea, select or date with its label (or one only read out), error code, a mark before and a suffix after, and the right phone keyboard.
- `frontend/src/components/AppScreen.vue` — The frame every screen sits in: pinned row, collapsing large title, back chevron with its label, docked strip, identity notice.
- `frontend/src/components/BottomSheet.vue` — The sheet: a native modal `<dialog>` rising from the bottom, closed through its history entry; stacks with «‹» instead of ×.
- `frontend/src/components/FloatingDock.vue` — Floating spot for the main action of a «Деньги» screen («Трата», «Обмен», «Доход») or «Вернуть» after a removal.
- `frontend/src/components/ScreenSkeleton.vue` — Loading state: bars in the geometry the screen gives, announcing «Loading…» through the live region.
- `frontend/src/components/ScreenState.vue` — Every non-loading screen state (empty, error, offline, attention): icon circle by tone, texts, «Try again» and actions; «Обновить» first while a version waits.
- `frontend/src/components/SegmentedControl.vue` — Kit segmented control: a radio fieldset drawn as segments, for one choice out of up to four (unit, rate).
- `frontend/src/components/TabBar.vue` — The tab bar of the five sections («Что брать», «Покупки», «Оценки», «Деньги», «Настройки»), moving through `useNavigation`.
- `frontend/src/components/UndoStrip.vue` — «Удалено · Вернуть» strip: ten seconds to take back a removal, paused under a finger or focus.
- `frontend/src/components/UpdateBand.vue` — «Вышла новая версия · Обновить»: the top row of the screen's pinned strip while a version waits, and the words when it did not take.

## frontend · composables

- `frontend/src/composables/useAnnouncer.ts` — Composable: the app's one polite live region — provided in `App.vue`, used by blocks to say and take back words.
- `frontend/src/composables/useBackLabel.ts` — Composable: which back label fits the row (parent's title, «Back», or the chevron alone), measured by a resize observer.
- `frontend/src/composables/useCollapsed.ts` — Composable: whether the large title has scrolled past the pinned row (sentinel observer), and an element's live height.
- `frontend/src/composables/useKeyboardInset.ts` — Composable: lifts an open sheet above the iOS on-screen keyboard through `--keyboard-inset`.
- `frontend/src/composables/useLocalDay.ts` — Composable: the phone's today as a screen holds it, asked again when the app comes back into view or online (MOL-121).
- `frontend/src/composables/useReconnect.ts` — Composable: calls a screen's retry when the connection may be back — `online` or the app coming into view.
- `frontend/src/composables/useSheetDrag.ts` — Composable: a sheet pulled down from the top of its content follows the finger and closes past a quarter or on a flick.
- `frontend/src/composables/useSheetHistory.ts` — Composable: the history entry an open sheet holds, closing on pop, putting the page back and focus on its opener; the stale-entry guard.

## frontend · stores

- `frontend/src/stores/storage.ts` — The one gateway to browser storage: both shelves, write-everywhere with salvage, sweeps and rewrites of keys.

## frontend · other

- `frontend/.stylelintrc.json` — Stylelint config: no literal colours, spacing only from the token scale, safe areas only through tokens.
- `frontend/env.d.ts` — Ambient type references for Vite and the PWA plugin's client.
- `frontend/index.html` — The PWA's HTML shell: viewport with keyboard resizing, per-scheme theme colours, icons, the app mount.
- `frontend/public/` — Static assets served as is: `favicon.svg` (the icon source), the rasterised app icons and the self-hosted font files.
- `frontend/src/App.vue` — The app's root: the login screen in place of any non-public route, the live region, and the occasions on which the queues send.
- `frontend/src/api.ts` — The PWA's one API client, wrapped so that any `error.no_actor` raises the login screen.
- `frontend/src/days.ts` — Day words for the screen: «сегодня»/«вчера» of a purchase, a month's name, `calendarDay` for calendar days, `shiftDay`, `localDay` — the phone's today — and `dayWords` for a card's head (MOL-121).
- `frontend/src/i18n.ts` — The i18n factory for the app and tests alike: locale from the model, Russian plural rule, English fallback, the document's `lang`.
- `frontend/src/i18n/` — The dictionaries, `ru.json` and `en.json`: every text of the PWA by key, error-registry codes included.
- `frontend/src/i18n/i18n.test.ts` — Test: both dictionaries mirror each other, compile, pluralise right and translate every error code; Russian plural forms; `lang`.
- `frontend/src/i18n/plural-ru.ts` — The Russian plural rule for vue-i18n: form by the last two digits, fractions and unknown counts included.
- `frontend/src/ids.ts` — `newId`: a lower-case uuid for rows the device names, with a fallback outside a secure context.
- `frontend/src/main.ts` — The PWA's entry: router, i18n, the update worker and the `401` seam installed, the app mounted, the identity started.
- `frontend/src/navigation.ts` — Navigation rules: how a tab tap is written into history (home — «Что брать»), where the back chevron leads, up to the parent, cold-start parent laying, guarded step back and `afterStep`.
- `frontend/src/pwaUpdate.ts` — Service-worker registration and update: quietly while hidden with no sheet, or by «Обновить»; looks every 15 min and on a new server build; `phase` for the app.
- `frontend/src/router.ts` — The router: every route with its title key, tab and parent, redirects of old addresses (`/trip*`, `/advice`), the dev-only kit route, and the scroll behaviour.
- `frontend/src/styles/_fonts.scss` — Font faces: self-hosted Nunito and Onest subsets, and the dram sign's own face.
- `frontend/src/styles/_mixins.scss` — SCSS mixins injected into every component: touch target, wider-than-phone, pinned bar, visually hidden, focus ring.
- `frontend/src/styles/_tokens.scss` — Design tokens: every colour, size, radius and duration as custom properties, light and dark schemes.
- `frontend/src/styles/main.scss` — Global styles entry: fonts and tokens, body, a page held still under a modal, view-transition animations between screens.
- `frontend/src/styles/theme-color.test.ts` — Test: the status-bar and manifest colours in `index.html` and `vite.config.ts` match the tokens of each scheme.
- `frontend/src/transitions.ts` — Screen moves: push, pop or tab direction for view transitions, focus moved to the new screen's heading, and the page held as tall as the window while only the query changes.
- `frontend/vite.config.ts` — Vite config: Vue, MDI icons, PWA manifest and precache, mixins injected into SCSS, the copy's ports and the `/api` proxy.

## repository

- `bin/make-icons.py` — Rasterises the manifest PNG icons from the geometry of `favicon.svg`; run by `make icons`.
