---
paths:
  - 'packages/model/src/entities/barcode.ts'
  - 'frontend/src/components/CameraHintSheet.*'
  - 'frontend/src/composables/useCameraHint.*'
  - 'backend/src/usecases/{find-by-barcode,attach-barcode,propose-item}.*'
  - 'packages/model/tests/entities/barcode.test.ts'
  - 'frontend/src/scanner/**'
  - 'frontend/src/components/BarcodeScannerSheet.*'
  - 'frontend/src/composables/{useCamera,useBarcodeScan,useBarcodeLookup}.*'
  - 'e2e/{scanner.spec,barcode-video}.ts'
  - 'backend/src/routes/catalogue.ts'
  - 'backend/tests/catalogue.integration.test.ts'
  - 'frontend/src/views/{ItemSearchView,TripView}*'
  - 'frontend/src/components/{CatalogueCombobox,ProposeItemSheet,ItemDetailsSheet}*'
  - 'frontend/src/stores/{itemEntry,recentItems}*'
  - 'backend/src/open-food-facts/**'
  - 'backend/src/usecases/hint-by-barcode.*'
  - 'backend/src/db/open-food-facts-repository.ts'
  - 'frontend/src/composables/useBarcodeHint.*'
  - 'bin/fake-open-food-facts.mjs'
---

# Barcodes: the scanner, a code typed by hand, the item by its code

The detail behind the barcode lines of `CLAUDE.md`. The scanner came in with MOL-98; finding an item
by its code is MOL-99, a code in «Предложить товар» and bound to an item is MOL-100, a name for it from
Open Food Facts is MOL-162.

## What the scanner is

- **A sheet that hands over a code and closes** (`BarcodeScannerSheet`, owner's decision В-4): the
  kit's `BottomSheet` with a live viewfinder, so «back», Esc and × close it as they close any sheet.
  What the code is for is the opener's: «Что взяли?» finds the item by it (MOL-99, below).
- **EAN-13, EAN-8, UPC-A and UPC-E, nothing else** (`READER_OPTIONS`). A QR or a Code 128 on the
  same package is not the item's code, and every format read beyond these is one more chance of a
  false read. That the scanner reads EAN and not QR is the reason the Telegram Mini App was dropped.
- **A receipt's QR is not the scanner's** (MOL-233): a Serbian receipt's QR code is read off a photo by a
  worker of its own (`receipts/qrWorker.ts`, `RECEIPT_QR_OPTIONS`) with the same wasm; the two share the
  worker's loop (`serveFrames`) and the page's reader (`createFrameReader`), never the options, so the
  scanner at the shelf still reads retail codes only and a reader that fails takes nobody else's down.
- **One package, one code.** zxing-wasm reads UPC-A and UPC-E as thirteen digits — the UPC-A
  `012345678905` as `0012345678905`, the UPC-E `01234565` as `0012345000065`, measured on
  29.09.2026 and held by `decode.test.ts`. So the scanner writes no normalisation of its own, and a
  code typed by hand is brought to that same form (`typedBarcode`).
- **A code is taken after two frames in a row read it** (`createReadStreak`, Р-1). zxing checks the
  digit and wants two scan lines of one frame to agree (`minLineCount` 2); a partial read with a
  check digit that holds still happens, and taken it would bind a stranger's code to an item in the
  shared catalogue for good (MOL-100). The price is one frame, some 0.1–0.2 s. A frame that reads
  nothing or something else starts the count over.

## The reader

- **Decoding runs in a worker** (`barcodeWorker.ts`); the page only cuts the frame and moves its
  pixels there without a copy. **One frame at a time**: the loop awaits each read before taking the
  next, so a slow phone reads what the camera sees now rather than a queue of what it saw.
- **The worker carries zxing and nothing of the model.** Whether a read has a barcode's shape
  (`barcodeSchema`) is asked on the page, in `useBarcodeScan`: imported into the worker, the model
  was some 120 KB of its 165 for one regex (adversarial П3).
- **A throw anywhere in a step of the loop is the reader's error**, the frame cut as much as the
  read: a loop that died without a word left a live viewfinder that would never read (adversarial
  Е). A video or a frame not laid out yet cuts nothing, never a crop of NaN (`cropOf`).
- **Only what lies under the frame on the screen is read** (`cropOf`, Р-5), grown by 15 % and mapped
  through the video's `object-fit: cover`: fewer pixels read faster, and a neighbour on the shelf is
  left out.
- **The wasm comes from the app's own origin, never the library's default CDN** (`locateWasm`). By
  default zxing-wasm fetches it from jsDelivr: that would fail offline and tell a third party who
  opened the scanner (privacy: no third-party script sees data). e2e asserts no request leaves the
  origin.
- **The wasm is precached** (`globPatterns` in `vite.config.ts`, owner's decision В-1). 931 KB,
  314 KB in brotli — the precache grows by some three quarters. It is fetched once: its hashed name
  changes with the library, not with a deploy of ours. On demand the first scan would fail exactly
  where the scanner is needed, at a shelf with no connection — which is why the scanner has no
  «offline» state at all.
- **The reader is warmed while the camera starts**, so the first frame that could be read is.
- **A reader is thrown away only when it is the one that failed** — on opening the sheet, on
  «Сканировать» from the digits, on a retry alike (`startCamera`). A retry of a camera refusal used
  to reset it too: every tap killed a wasm still loading, and its warm, rejected by the dispose,
  marked the next reader failed — «Проверить снова» after allowing the camera landed on red for as
  long as the load took (adversarial Б, review С-8). So a warm fails the scan only while its reader
  is still the scan's own.

## The camera

- **The back camera, 1280×720 as an ideal, continuous focus where the phone has it** (Р-2) — never a
  demand, a phone that cannot is given what it has. No choice of camera: some Android phones pick a
  wide-angle one that does not focus close, a risk named and left for a phone to show.
- **No track outlives the scanner**: closed, typing the digits, under the reader's error, put away
  in the background or unmounted, the camera stops and the indicator goes out — and so does a camera
  given just before something threw (adversarial В, Г). Brought back into view while it ran, it
  starts again — iOS ends the stream of an app in the background and the video would stay black. A
  refusal is not asked again on the way back.
- **The torch is offered only where the track has one** (`getCapabilities().torch`, Р-3): bad light
  at the shelf is the product's premise, and a button that does nothing is worse than none. A track
  with no `getCapabilities` (Firefox before 132) is a camera without a torch, not a camera that
  failed (adversarial Г).
- **A code taken by the camera buzzes** where the phone can (`navigator.vibrate`, not on iPhone) —
  no sound, and not for digits typed by hand, where the person is looking already (review С-11).

## Asking for the camera (MOL-163)

- **Safari asks once per page load, and nothing of ours makes it ask again** (measured on the
  owner's iPhone, 01.10.2026). Opened again and again within a load, the scanner is never asked
  about; a reload of the tab asks anew, and so does every launch of the app from the home screen,
  each a load of its own. So neither the sheet's entry in the history nor the tracks stopped on
  every close are the cause, and **«No track outlives the scanner» stands**: a camera kept alive
  between scans would spare not one question. Android was not measured (owner's decision В-2):
  Chrome keeps «Allow» for the site.
- **Only a setting of the phone stops it**, and no page can set it or open it: «Настройки →
  Приложения → Safari → Камера → Разрешить» — for every site in Safari, checked by the owner — or,
  in a tab, «Настройки веб-сайта → Камера» in the page menu by the address bar, for this site alone.
  That menu is named by no icon: it was «aA» before iOS 18, an icon of its own since, and goes
  behind «…» in the compact layout of iOS 26 (review 1) — and the tab's sheet adds the way for every
  site, the one checked on a phone, and the search of Settings for «Safari», which finds it before
  iOS 18 too, where it stood at the top of Settings and «Приложения» was not yet (review 5). iOS
  opens no Settings from a web page (`App-Prefs:` is for native apps), so **the way is written out,
  never linked**; the refusal «Нет доступа к камере» names the same path.
- **The scanner says where the setting is, right after Safari asked** (`useCameraHint`,
  `CameraHintSheet`, owner's decision of 01.10.2026). Before the camera starts it asks
  `permissions.query({ name: 'camera' })`: once the camera is given Safari answers `granted` until
  the page reloads, so asked later it could no longer say it was about to ask. `prompt`, and the
  camera went live — «Камера без вопросов» rises over the scanner, a sheet over a sheet. `granted`
  (the setting is there), `denied` (the refusal says how already) or no answer at all — nothing:
  silence is better than teaching the wrong thing.
- **The camera waits for that answer `PERMISSION_WAIT`, 300 ms, and no longer** (adversarial Б): the
  hint is a courtesy and the camera is the point. An answer that never came kept the scanner on
  «Загрузка…» for good; Safari answers in milliseconds.
- **One opening asks for the camera once** (adversarial В): the checks are numbered, and a start
  whose check a later one overtook — the scanner put away and opened again, the digits and back to
  «Сканировать», while the browser answered — starts nothing. Guarded by the state alone («open, not
  typing»), the first start took the second for its own and asked again, while Safari still held its
  question on the screen.
- **A camera let go with its scope asks for nothing** (`useCamera`, adversarial Д): a scanner that
  left with its screen while the browser answered — or kept silent to the ceiling — still went on to
  `camera.start()`, its `open` never turned false, and lit a camera no dispose was left to stop. The
  guard is in `useCamera` rather than in the scanner, so no later await in front of a start can open
  the same hole.
- **Once on this phone, then a quiet line** (Р-4): any way the sheet goes counts as seen
  (`molvia.camera-hint`, a key of the phone, not of a person — the setting is the phone's, and a
  sign-out changes nothing of it); after that, when Safari is about to ask, «Safari спрашивает
  каждый раз? Как убрать» over «Ввести вручную» brings it back. A sheet on every launch would be a
  second interruption on top of the first. **The line is decided before the camera**, with the
  answer: added once the picture was live, it grew the footer and pushed the viewfinder up as the
  person aimed, on the commonest path at the shelf (review 2). The sheet still waits for the camera
  — it covers it.
- **Only Safari on a touch screen** (Р-3): Apple's `navigator.vendor` and touch — an iPad calls
  itself a Mac, a Mac has no touch — **and `Safari/` in the user agent, or the app from the home
  screen**, whose agent has none. A browser inside another app — a bare WKWebView, a link opened in
  a messenger — names no `Safari/`, and its camera is the host app's. **Every browser of iOS is
  WebKit with Apple's vendor**, so the others are named one by one (`NOT_SAFARI`): Chrome, Firefox,
  Edge, Opera, Yandex — the browser of much of the diaspora — Aloha, DuckDuckGo and the Google app
  (adversarial А, А′). Told Safari's way, a person in Yandex would pay the price the sheet names and
  get nothing for it.
- **A tab and the app say different things** (Р-7): a tab has a setting for this site in its page
  menu; the app from the home screen has only Safari's own setting, and **the sheet names its
  price** (Р-6) — it opens the camera to every site in Safari, not only to Molvia. Trust is the
  asset the product cannot write off.
- **Nothing is read under the sheet** (Р-5): the camera stays on behind it, but a code taken there
  would be taken unseen.
- **A scanner put away or turned to the digits while the browser answered starts no camera.**
- **The named prices.** The sheet rises with no tap, and Chrome skips on «back» an entry laid
  without a gesture — it is Safari's alone, where this does not happen. A phone that cannot write to
  storage sees the sheet on every load. **Brave, a link opened in `SFSafariViewController` and the
  browser inside Telegram** — where the bot's links open — send Safari's very agent and cannot be
  told from it; nor can an app put on the home screen from another browser, whose camera setting was
  not measured. A browser not in `NOT_SAFARI` is taken for Safari. A Safari that answered the query
  untruly would show it or hide it wrongly — the owner's phone checks it once the sheet is out:
  «Спрашивать» — the sheet; «Разрешить» — none; the scanner opened again in the same load — neither
  the sheet nor the line, since Safari answers `granted` by then; a link from the bot opened in
  Telegram — whether the sheet comes up there, and whether its way leads anywhere.

## One way into the camera (MOL-163)

**`getUserMedia` is called by `useCamera` alone** — `no-restricted-properties` in
`frontend/eslint.config.js` on `getUserMedia` and the prefixed `webkitGetUserMedia` and
`mozGetUserMedia`, tests aside. It closes carelessness, not intent: a name computed or handed to
`Reflect.get` passes (adversarial Г). A second caller would bring a second set of refusals, stops
and states to keep in step. **The receipt (MOL-127) takes its photo through the system camera**
(`<input type="file" capture>`, handoff MOL-124): the page is given a file and asks for nothing, so
there is no question for Safari to repeat. A receipt that one day wants a viewfinder of its own
takes `useCamera`.

## States (MOL-19)

Every refusal is drawn by `ScreenState` in the sheet, and every one offers the digits typed by hand:

| The camera        | Kind      | Drawn as                                                         |
| ----------------- | --------- | ---------------------------------------------------------------- |
| starting          | loading   | `ScreenSkeleton` over the viewfinder                             |
| no secure context | attention | checked before asking — outside one there is no `mediaDevices`   |
| `NotAllowedError` | attention | how to allow it on both phones in one text, «Проверить снова»    |
| `NotFoundError`   | attention | no camera; «Сканировать» is not offered from the digits after it |
| anything else     | error     | red, «Повторить»                                                 |
| the reader failed | error     | red, words of its own; the camera stops under it                 |

«Сканировать» comes back with the next opening of the sheet: a camera missing once may be there
now (review С-9). The reader's failure has words of its own: «another app holds the camera» sent the
person to close apps that were not at fault (review С-10).

**The named price of focus** (review С-2): after «Проверить снова» or «Повторить» the state goes,
and `ScreenState` hands the focus to the screen's title — which under a modal sheet is inert, so it
lands on the dialog itself. It is `ScreenState`'s behaviour, and the sheet is its first user inside a
`<dialog>`; a task of its own if it gets in the way.

The text of «no permission» names both phones rather than guessing one from the user agent, which
lies on an iPad (as MOL-132 Р-3).

## A code typed by hand (owner's decision В-3)

- **«Ввести вручную» is a field for the digits in the same sheet**, `AppField kind="digits"` (the
  digit pad, still text, so a leading zero stays). The code goes out through the same `read` in the
  same form as a scanned one.
- **`typedBarcode` in `packages/model` checks it**: spaces and hyphens printed under the bars are
  dropped, and so is whatever draws nothing — `INVISIBLE`, the one list, since a code copied from a
  message may carry a U+200B that no eye can remove (adversarial Д); 8, 12 or 13 digits, else
  `error.barcode_shape`; the check digit, else `error.barcode_check_digit`; 12 digits (UPC-A)
  become 13 with a leading `0`.
- **Eight digits are EAN-8 or UPC-E, and the digits alone do not say which** (Р-11): about one UPC-E
  in ten also checks as EAN-8, the sample `01234565` among them. **Eight that check as EAN-8 are read
  as EAN-8** — as the scanner reads a label printed so — and only eight that check as UPC-E alone are
  expanded to its thirteen (MOL-100, owner's decision В-7). MOL-98 read a leading `0` as UPC-E: typed
  so, a shop's own EAN-8 label (`00408295`) became thirteen written for everyone, and another shop's
  same label, typed, found that shop's item (adversarial Л of MOL-100's second round); read as EAN-8 it
  is what its scan says — a shop's label, never written. **The named price**: a real UPC-E whose digits
  also check as EAN-8, typed by hand, gives another code than its scan (eight against thirteen) — led
  by `0` the screen calls it a shop's label, led by `1` the lookup still finds the scanned thirteen
  through `barcodeTwins`. UPC-E is American packaging, rare on an Armenian shelf; a shop's labels are not.
- **`barcodeSchema` was not made stricter** (Р-10): `itemSchema` reads with it, and a dozen fixtures
  carry codes whose check digit does not hold. The write checks the digit instead — `writtenBarcode`
  (MOL-100, below).

## End-to-end

- **The scanner's specs run in a project of their own, `camera`: the full Chromium with a fake
  camera.** The headless shell every other spec runs in answers any `getUserMedia` with
  `NotSupportedError`, fake camera or not (measured 29.09.2026). `playwright install chromium`
  brings both, here and in CI.
- **The camera films a file drawn at every run** (`e2e/barcode-video.ts`, `globalSetup`): an EAN-13
  from an encoder of its own — not zxing's writer, so the reader is checked against a hand that is
  not its own — as one Y4M frame, which Chromium plays in a loop. No binary in git, no ffmpeg in CI.
  It lives in the copy's `node_modules/.cache`, so two copies running e2e at once do not rewrite
  each other's.
- **Without a grant Chromium refuses the camera**, which is the spec of «no permission»; «no camera»
  replaces `getUserMedia` in an init script.
- **Safari is played by Chromium** for the hint (MOL-163): an init script gives the page Apple's
  vendor, touch, Safari's agent and a `permissions.query` that says `prompt` or `granted`; the camera
  itself is Chromium's fake one. «Got it» is tapped until the sheet goes: on a loaded machine its rise
  starts a frame late, and a tap timed by its animations was held — the price is that a first tap
  swallowed by a sheet already up would pass unseen.

## The item by its code (MOL-99)

- **Where it opens** (owner's decision В-4): from the field of «Что взяли?», and from «Сканировать
  штрихкод» on the record beside «Добавить позицию», which opens «Что взяли?» with the scanner already
  up — one tap less at the shelf; put away, it leaves the search by name. The ask lives in memory
  (`itemEntry.askToScan`), so a reload of the search is not a tap on «Сканировать».
- **`GET /catalogue/barcode?code=…`, the code in the query, not the path**: the API logs a request
  as its path (MOL-58), and a code is what a person bought. The answer is `200 { item | null }`: a
  miss is an ordinary outcome, and a `404` would read the same as one from a Wi-Fi portal. A code of
  no barcode's shape is the same `null`, without asking the database. Behind the door like the
  search; nobody's picks take part.
- **Looked up with its twins, the code as read first** (`barcodeTwins`, owner's decision В-3, review
  С-14). Eight digits that check both as EAN-8 and as UPC-E are the one case of two forms: scanned as
  EAN-8 they stay eight, typed they are thirteen (`typedBarcode`), and the other way round for a UPC-E
  of number system `1`. The lookup takes both, which lifts both named prices of MOL-98 Р-11 without
  touching `typedBarcode`. One UPC-A may be reached by two UPC-E forms (`012340000053` by `01234543`
  and `01234053`); a form that checks as EAN-8 is a twin like any other. **The named price:** a shop's
  own EAN-8 label and a UPC-E product with the same digits find each other — rare on an Armenian
  shelf, and the name on the sheet shows it.
- **The pair holds only where it is one both ways: one EAN-8 folds into the thirteen** (adversarial Г,
  Г′, review С-7). Two shop labels with different digits may expand to one UPC-A — `00000055` and
  `00000505` both to `000000000055`, some one in five of the eight digits that check both ways — and
  the thirteen no longer say which label they came from. Guessing put the other shop's item on the
  sheet, silently: from the thirteen typed, and from the eight scanned when the other label had been
  typed. So such a label and its thirteen are each only themselves. **The price:** such a label finds
  only what was taken in the same form — scanned what was scanned, typed what was typed; MOL-98 Р-11
  named it for typing, and it now holds for scanning as well. Symmetric everywhere, swept over all
  twenty million eight digits led by `0` or `1`.
- **Eight that check only as UPC-E are looked up as the thirteen they are written as** (MOL-100,
  adversarial Р5-В): the lookup asks the twins of the written form too (`barcodeWriteForm`).
- **Twelve digits and a GTIN-14 led by `0` are looked up as the thirteen too** (adversarial З): the
  API is the one write path and keeps the rule, and a client that does not repeat the phone's — the
  bot repeats none — still finds the package.
- **No HEAD twin**, as no GET of the API has one (adversarial В): Fastify runs the whole handler for
  it, and the length of a bodiless answer tells found from not.
- **The item found goes to the purchase sheet with no query**: a code is not one, so neither a pick
  nor the person's own word (`admits`) is written. The miss held from before is used up all the
  same, as by any sheet opened after it (MOL-45). The sheet waits for the scanner to be put away —
  its close is a step back through history, as «Предложить товар»'s is. **A find held for that
  belongs to its code**: the next code read, or typing, drops it (adversarial А) — a second scan while
  the first answer is on its way is exactly what a person does when nothing seems to happen, and the
  first item came up over «Код … не знаком» of the second.
- **A miss** says «Код … справочнику не знаком» on the screen and out loud, and offers «Предложить
  товар» — with the code since MOL-100 (below). **Proposed from
  there, the item was looked for by the code**: the name starts empty, whatever the field held before
  the scan, the pick carries no query, and the block goes once the item is proposed (adversarial Д,
  review С-5). An error is red with «Повторить»; typing gives the search back and drops a lookup
  still out. **Under the code's answer the search says nothing**: its rows are not shown, and an
  answer landing then read «найдено два» over «не знаком» (adversarial Б).
- **Offline and error ask again once the connection is back**, quietly — the block stays until the
  answer replaces it — as the search does (`useReconnect`, adversarial Ж). **What that retry finds
  does not open a sheet**: it says «По коду … нашлось» with the item as a button, and the sheet comes
  from the tap (adversarial Ж′, review С-8). The retry comes with a phone unlocked, over whatever the
  person opened meanwhile — it took a purchase sheet with its price typed away — and a sheet laid
  without a tap is one Chrome skips on «back». **Taking another item answers the code's question
  too**: a pick drops the lookup, so nothing is asked again under the sheet it opened.
- **Offline, the device knows the codes it found items by** (owner's decision В-2): an item found by
  a code and added to a record keeps that code beside «Часто берёте», under
  `molvia.recent-codes.<owner>` — beside the list, not in its rows, so a row an older version wrote
  stays readable — and only while the item is on the list. Looked up with the twins, as the server
  does. A server that fails is asked of the device too before the screen says «error». The price:
  an item only ever taken by its name is not found by its code without a network.
- **The reader lives with the screen, not the sheet** (review С-12а): a second scan on the same
  screen is warm, and leaving the screen — which a found item always does — lets it go. So the sheet
  stays mounted closed, and **a scanner put away draws nothing**: its skeleton kept «Загрузка…» in
  the app's live region over the search's answer. **Put away means after the slide down**, not at
  `open: false` and not at `onClosed`, which comes as the dialog closes — when the slide starts:
  emptied then, every scan and every × slid down as a bare title, 92 px of 249 (adversarial Е,
  measured frame by frame in Chromium). The refusal it slides down with is the one it showed, not
  what the stopped camera says, and **the viewfinder slides down with its last frame, drawn**: the
  close copies the live frame onto a canvas over the video (`holdStill`), then stops every track —
  the indicator goes out at once, as it must. Keeping the stream on the video instead held nothing:
  a stopped track is black in Chromium, stream on it or not (adversarial Е′, Е″, measured on the
  screen, not on `srcObject` — a test of the stream passed while the eye got black). The frame goes
  when the sheet is put away. The skeleton alone goes at `open: false`: brought up by the stopped
  camera, it would say «Загрузка…» for nothing.
- **Not yet:** a code by its item on «Что брать» (its own search, MOL-128), and in the bot.

## Writing a code (MOL-100)

A code the catalogue did not know is written the first time it is met, so the next scan finds the
item — before MOL-100 every scan on production was a miss. **Anyone may write a code to any item**
(from the task): a code is a fact from the package, not an opinion. So the catalogue is shared in its
codes too, and a wrong one needs a way out (В-1, below).

- **Two ways in, one rule.** «Предложить товар» takes the codes read from the package, up to
  `ITEM_BARCODES_MAX` (`proposedItemSchema`), written with the item or not at all; «привязать код к
  ней?» writes one to an item found by name (`POST /catalogue/items/:itemId/barcodes`, the code in the
  body — the API logs paths, MOL-58). **A name the catalogue already holds takes no code** (owner's
  decision В-5, in place of Р-4): the answer is that item with nothing written (`200`), and the screen
  asks about it the question any item found by name gets. Written silently, it was the way round В-3:
  «Это другой товар — предложить» after declining «Молоко» opened with the name typed, «молоко», and the
  code went to the very «Молоко» just declined (adversarial А).
- **The code must check** (`writtenBarcode`, Р-1): a code written is written for everyone for good, and
  one whose last digit does not hold is on no package. Twelve digits and a GTIN-14 led by `0` are
  written as the thirteen the scanner reads; eight that check as EAN-8 as they came — the scanner reads
  an EAN-8 so, and one that checks as UPC-E too is found by its thirteen through `barcodeTwins`. **Eight
  that check only as UPC-E are written as the thirteen** the scanner reads that UPC-E as (review А):
  `barcodeTwins` pairs no eight that fail as EAN-8, so kept as eight they were found by nothing — not
  by a scan, not by the digits typed — and the same package could be written to another item as its
  thirteen. Repeats in one list are judged by the written forms, for the same reason. **A GTIN-14 of a
  case** (led by `1`–`8`) is refused as `error.barcode_shape` (Р-12): no scan and no typing gives one,
  and it would hold one of the twenty places for good.
- **A shop's own code is never written** (`inStoreBarcode`, `error.barcode_in_store`, owner's decision
  В-4). GS1 leaves «restricted circulation» to the shop: EAN-13 led by `020`–`029`, `040`–`049` and
  `200`–`299` — UPC-A of number systems `2` and `4` among them — and EAN-8 led by `0` or `2`. The scales
  print one on each package of loose goods — the item's number in that shop and its weight or price —
  so another package is another code, twenty packages closed the item to codes for good, and the same
  digits in another shop are another item (review Е, adversarial Б). **The screen does not ask**:
  scanned or typed, such a code is «Код … — этикетка магазина», said out loud, with no request and no
  code waiting — «найдите товар по названию». Loose goods are found by name, as they always were.
  **The named price**: a packaged item the shop labels with its own code is not found by a scan. Typed
  by hand, the digits of such a label are read as the scanner reads them (В-7, above) — a shop's label.
- **One package, one item — with its twins** (Р-2). The key of `item_barcodes` holds one string, and
  `00408295` at one item beside `0004082000095` at another would find one or the other by whether it was
  scanned or typed. So a write asks every form of every code (`barcodeTwins`) and takes a lock per form
  (`pg_advisory_xact_lock(hashtext('barcode'), …)`), in ascending order, **after the item's own lock** —
  `lockItemKey` for a new item, `FOR UPDATE` of the row for one there — so two writes never wait on each
  other crosswise. Two codes of one list that are twins are a repeat (`hasRepeatedBarcode`, Р-7), refused
  as two equal codes are.
- **A code held by another item is an answer, not an error** (Р-3): nothing is written — not the code,
  not the new item, which is most likely a duplicate of the holder — and a `409` carries the holder
  whole (`barcodeTakenSchema`), since the registry of errors has no room for an item. The client reads
  each status by its own schema (`answers: { 409: … }` of the transport, review И): «taken» only under
  the `409`, the entry only under a `2xx`; a `409` with a code of the registry is still the failure it
  was. The screen offers the holder: the package in the hand is
  what the catalogue knows it as. **The same code on the same item is success** (`200`) — a repeat after
  a lost answer — and keeps who wrote it first. **Twenty is the ceiling** (`error.barcodes_full`, `409`),
  counted under the item's lock: the database has no trigger for it.
- **Who wrote it is kept** (`item_barcodes.added_by`, `added_at`, Р-5): a code written says the person
  held the package — theirs, as an item's author is. Erasure nulls it and the code stays; the copy of
  one's data lists the codes one wrote (`addedBarcodes`, version 5), `privacy.md`. The screens show it to
  nobody.
- **«Не этот товар?» lets a code go, and anyone may** (owner's decision В-1): a quiet line on the
  purchase sheet of an item that came by a code — found, linked or proposed with it — whoever holds the
  package says it is not this one (`DELETE /catalogue/items/:itemId/barcodes?code=`, the code in the
  query as the lookup's; `204` whether it was held or not). **Under the form, and asked first** (Р-9,
  review Ж): «Отвязать код … от „…“? Его перестанут находить все» — «Отвязать» / «Отменить»; in the
  footer under «Записать» a finger took it at the shelf, and it goes for everyone with no «Вернуть».
  «Отвязать» is `danger-ghost`, as every destructive confirmation of the app, and the focus waits on
  «Отменить» (Р-15, review Л). **A block that takes itself away hands the focus back** (adversarial О,
  О′): «Отменить» to the line «не этот товар?», the ✕ of «Код … ждёт позицию» to the field, every block
  of «привязать?» to its first answer — an error or offline to its first button unless the person put
  the focus somewhere of their own, «Повторить» to the busy «Привязать» — and «Этот код уже у „…“» in
  «Предложить товар» to «Взять „…“», inside the sheet. Gone with its button, the focus fell to the body,
  outside the modal sheet, in Chromium and WebKit alike. The question «Отвязать?» is a group named by its
  words: the focus waits on «Отменить», and the app's live region is outside the modal sheet. e2e holds
  every change in Chromium («the focus through the code's blocks»).
  **In the form a write gives it** (Р-11, review К): `04252614` is written as `0042100005264`, and asked
  by its eight a `204` let go of nothing; a code of no barcode's form is refused. The item lets go of the code and whichever
  twin it holds, never another item's; the device forgets it (`recentItems.forgetCode`) — in the sheet, which an answer still reaches after it was swiped away, when an emit to the screen no longer would (review Г); the sheet goes
  one step back, and the code is looked up again — nobody holds it, so it waits for its item. **The
  named price**: whoever wants to spoil a code can unbind it, accepted for 0.2's circle; `added_by` shows
  who wrote what. **Merging two items is not this** (Р-6): it moves ratings, purchases and picks, and is
  the nightly merge of MOL-106, where the codes move to the item that stays.

### On «Что взяли?» (owner's decisions В-2, В-3)

- **A code nobody holds waits for its item.** Once the server says «не знаком» the code is kept
  (`pendingCode`) — only then: a code not asked about for want of a network may well be held. Typing no
  longer drops it: a strip «Код … ждёт позицию» stands over the search, and × lets it go. Proposed with
  «Предложить товар» from anywhere on the screen while it waits, the code goes with the item. **It is kept
  in the search draft** with the query (adversarial Р5-Г): a new version reloads the page with only the
  strip up, and the code, lost, made the next pick ask nothing. **Not while its write is on its way**,
  and **asked again quietly when brought back** (adversarial Р6-Б): an answer that died with the page, or
  came to a «Предложить товар» put away, may have written it — held, it waits no more.
- **A pick while a code waits asks first** — «Привязать код … к „…“?» — in a block where the code's
  block stood, not in a sheet (В-2): «taken», «no network» or an error is then said where the person
  is, and the purchase sheet comes only after the answer, one sheet at a time. The rows go while the
  question stands, the focus goes to its first answer and the question is said out loud. **While the
  code is on its way nothing takes the question away** (review Б, adversarial Р5-Б, Р6-А): the other
  answers wait, the field is read-only, and the scanner reads nothing — a miss typed meanwhile rode
  along as the person's own word for the row picked before it — dropped, a question asked
  again over the same code had live answers the landing then overruled: «без кода» written with the code,
  «другой товар» met at the very item it was said not to be. The answer goes on with the query the row
  was picked on, not what was typed since. **An answer that lands after the screen was left is nobody's**
  (adversarial Р5-А): written into the store, it opened a purchase sheet by itself on the next visit.
  **An answer that lands after the wait takes the focus only where its holder went** (adversarial Р6-В).
  **An answer that opens a sheet puts the focus on the screen's title first** (adversarial Ф, Ф′ — the
  question's answers, «Предложить товар» sent from the code's block, «По коду … нашлось»): the block
  that held it goes with the answer, and the sheet, closed, gives the focus back to what held it when it
  opened — the title rather than nothing; not the field, whose focus would raise a keyboard under the
  sheet. **Three
  answers**: «Привязать и записать»; «Записать без кода» — the code is let go; «Это другой товар —
  предложить» — the item found by name is not the package, and the code goes with the one proposed,
  whose name starts from what was typed — and if that name is one the catalogue holds, it is asked about
  that item in turn (В-5), **saying so**: «„Молоко“ уже есть в справочнике. Привязать код к нему?», and its
  «другой товар» opens the sheet empty with «„Молоко“ уже есть — назовите товар иначе» (Р-17,
  adversarial Н) — before that the same name went round the same question. **Asked from the code's own
  block, the item was looked for by the code** (Р-16, adversarial М): linked or not, it goes on with no
  query, and «другой товар» starts empty — the word in the field before the scan is nobody's word for it. **The question names who will see it** — «все, кто
  отсканирует этот код, увидят эту позицию» — **and is asked for any item** (В-3), the seed's common
  «Молоко» included: the seed has no mark of its own (`created_by` is null for the erased as well), and
  the person with the package decides, the last answer at hand. Typing drops a question not yet
  answered, and the code still waits.
- **Taken** — «Код … уже у „…“»: «Взять „…“» takes the holder as found by the code, with no query;
  «Записать „…“ без кода» goes on with the row picked. **No network** is an offline state with
  «Повторить» and «Записать без кода» — the catalogue has no queue, as «Предложить товар» has none; an
  error is red with «Повторить» and the same way out. **An item holding twenty codes** is said in the words of `error.barcodes_full`, with no «Повторить» — asking again changes nothing (review В). A retry of a write waits for a tap: nothing is
  sent by itself.
- **A code written is remembered for offline** as one found is: the item it went to goes into «Часто
  берёте» with it once it is added to a record.

## A hint from Open Food Facts (MOL-162)

After MOL-100 a code met for the first time is written to its item, but the item is still typed from
nothing at the shelf — what makes a stranger give up (the owner, 30.09.2026). Open Food Facts is an
open base of products by their codes; for a code our catalogue missed, «Предложить товар» starts from
what it says. Only ever a hint: the base holds what anyone typed — `test2`, `&quot;`, a name in
French — and the person confirms or corrects it.

- **Asked by the server, never the phone** (the task's decision, `privacy.md`): the base sees the
  code, our address and `Molvia/<build> (<contact>)` — the contact is `OPEN_FOOD_FACTS_CONTACT`, the
  owner's address in production's `.env` (В-4), and without it the hint is off: copies, CI and the
  tests never ask the real base. **A shop's own label never leaves**, nor a code that does not check:
  only a code `writtenBarcode` takes is asked, in the form it is written.
- **Its own route, `GET /catalogue/barcode/hint?code=&lang=`** (Р-1), asked by the phone the moment a
  code starts waiting for its item (`useBarcodeHint` follows `pendingCode`, so a reload of the draft
  asks again). Not inside the lookup's answer: the miss waits for nobody, and that answer is strict —
  a field added would be refused by every installed app (MOL-46). Behind the door, so the route is no
  free proxy to the base's limit; the code in the query as the lookup's; `200 { hint | null }`, and
  nothing else: unknown, out of reach, over the limit, a label — no hint, never an error.
- **What is read** (`parseProduct`): found is `status: 1` with a product and only that — the base
  answers a code it does not know with a `404` and `status: 0`, a code it calls invalid with a `200`
  and `status: 0`, and a page «temporarily unavailable» in HTML with a `503` (all measured on
  01.10.2026, recorded in `backend/tests/fixtures/open-food-facts/`). **The name** in each language of
  the interface (Р-2): its own field, the main name when the product is in that language, English,
  the main name in any language, the other interface language's — the first that is a name: entities
  decoded, a line, a private-use glyph or a lone surrogate dropped (one U+F8FF lost the whole name and
  kept the code unknown for a week — adversarial Ж), cut at 200, with a letter and two characters at
  least. **The brand** goes after the name unless the name carries it — a word of the first brand that
  says which mark it is (four letters or more as written, letters with a digit, or the first word of
  three past a legal form) is a word of the name by the search key, all of it when none says (Р-3). A
  legal form is one by its place — the Russian and Armenian ones at either edge («ООО КДВ», «Գրանդ
  Քենդի» ՍՊԸ, adversarial В⁷), the European ones only trailing («Fit Parade LLC») — and never the whole
  brand: «SAS», Yerevan's supermarket, and «Spa» are marks (В⁵); the brand is written after the name
  without its form, its double quotes and whatever the cut left without its pair — a single quote off a
  letter, a bracket whose partner stayed outside — as a shelf prints it (review 18, В⁶, В⁶′): «Pepsi
  (PepsiCo)» is written «Pepsi PepsiCo», «Lay’s» keeps its apostrophe; «Nutella» + «Nutella,
  Ferrero» is «Nutella», «Coca Cola» + «COCA-COLA SERVICES SA/NV» is «Coca Cola», «Сыр Савушкин 45%» +
  «Савушкин продукт», «Напиток 7Up» + «7Up» and «Конфеты KDV» + «KDV Group» stay as they are — the
  base keeps a mark with its company or country, the package prints the mark — and «Молоко 3,2%» +
  «Простоквашино» is «Молоко 3,2% Простоквашино». Each rule before failed one way: the first word took
  an article for the brand (adversarial В), both of two first words wrote the mark twice (В′), three
  letters by the key let «для», «des», «for» pass (В″), four letters as written lost a mark with a
  digit or of three letters (В‴), «ООО» standing first hid «КДВ» after it (В⁗), and a number alone met
  a size or a fat in the name — «Danone 2» on «Йогурт 2,5%» (review 16). **The price, named:** a brand sharing a word with what the name
  says of the product is lost — «Сыр Российский» + «Российский сыродел» — and so is one sharing a
  function word of four letters or more («pour», «avec») or a first word of three («Les»); a company
  written into its mark is written after it — «Pepsi Max» + «PepsiCo». **The size** is
  `product_quantity` in g, kg, ml, cl, dl or l, as kg or l, up to fifty (Р-4); pieces, ounces and the
  text of `quantity` («6 x 1,5 l») give none. Only the fields used are asked for: never a photo — its
  licence, the rights on the package, and a picture from the base's CDN would hand it the phone.
- **The limit is the base's, kept by the API** (Р-5, Р-6): a 2.5 s timeout — the median answer is
  0.3–0.4 s, and the miss is on screen already; at most twelve questions a minute against the base's
  fifteen from one address, past which it bans; a minute of silence after any failure; a code asked
  twice at once is asked once. **A person's share is a third of the minute — four** (owner's decision
  В-6): one person scanning a shelf of imports, or a script, held the hint off for everybody for as
  long as they liked (adversarial А); at the shelf a code comes every ten to thirty seconds, so four
  is plenty, and over the share there is simply no hint. **The price, named** (adversarial А′): three
  people at their share in one minute take it all — three shelves of imports at once, or a script with
  three accounts — and a fourth gets no hint until the minute turns. Counted in the API's process — there is
  one; **a second instance needs a count they share.** `OPEN_FOOD_FACTS_PER_MINUTE` moves the limit,
  and the share with it, for end-to-end alone, whose fake has no limit: at twelve the run spent its
  own minute on the misses of MOL-100 and the spec of the hint lived by its turn (adversarial Е).
- **The answers are kept** (`open_food_facts`, Р-7): a find believed thirty days, a miss seven — a
  code nobody knows is scanned again and again — and a failure not kept at all. Past its days the base
  is asked again, and a base that cannot answer leaves the old find standing. A row is a code and a
  day: no person, no moment, so neither erasure nor the copy reaches it.
- **On «Что взяли?»** (owner's decisions В-1, В-5): «Похоже, это «Nutella», 0,4 кг · по данным Open
  Food Facts» in the block «Код … не знаком», **under** «Предложить товар», so the button stays where the
  thumb saw it. Above it — В-1 as first chosen — the hint came 0.3–2.5 s after the block and moved the
  button some 100 px down, and the tap aimed at it landed in the hint (review 1, adversarial Г);
  holding the room instead would move it up on every miss, the common case in Armenia. Said out loud
  with the miss, in one message, so neither cuts the other off — not over «Предложить товар» opened
  meanwhile (review 3), but once that sheet is put away with nothing proposed (review 6). Nothing else on the screen changes: no hint, the block is exactly MOL-99's.
- **In «Предложить товар»**: opened with an empty name — from the code's block, or with nothing typed
  — the form starts from the hint: the name, the unit of its size and «В упаковке 0,4 кг ✕», sent as
  `typicalQuantity`, so the purchase sheet of the item opens at «0,4 кг» and its price per kilo shows at
  once. **The unit may start chosen here** — MOL-12 left it empty against a guess, and a size from the
  package is no guess. A unit chosen that is not the size's hides the size and sends none. **Only the
  hint at hand when the sheet opens**: one that comes later is not used at all. Filling what was
  still empty (Р-8 as first decided) grew the sheet up under the thumb on its way to the name — 94 px
  — and the tap chose «л» (adversarial Д), and an emptied field was not «untouched» (review 5). A name
  typed before — the search's word, «другой товар» (`nameTaken` passes no hint) — takes none either.
  «По данным Open Food Facts ↗» links the product's page, the attribution the licence asks for: last,
  under the code's line and with a target of 44 px — between the name and the unit a thumb meant for
  either opened a browser (review 2).
- **ODbL** (owner's decision В-2): the base is share-alike, so what the catalogue takes from it is
  marked — `items.origin = 'open_food_facts'`, set by the server when a new item is proposed with a code
  the base named (`named`), never by the phone, and generously: the mark stays if the person rewrote the
  name. `/privacy` offers an export of it on request; nobody asked yet, so no open file (В-2 «в» was
  not chosen).
- **How it is measured** (owner's decision В-3: no measurement before the code): on production, the
  share of codes the base named, and of items proposed with its help —

  ```sql
  select count(*) filter (where found) as named, count(*) as asked from open_food_facts;
  select count(*) filter (where origin = 'open_food_facts') as by_hint, count(*) as proposed
    from items where created_by is not null and created_at >= '<the release>';
  ```

  The second leaves out the items of people erased since — their author is nulled — a small shift
  over a period.

- **Not here:** giving codes back to the base (a decision of its own); looking the hint's name up in
  our catalogue — duplicates are `nameIdentity`'s (MOL-12) and the nightly merge's (MOL-106); Open
  Prices, no source of prices for Armenia; the bot.
- **End-to-end asks a fake** (`bin/fake-open-food-facts.mjs`, on the API's port + 1): codes led by
  `46` are a can of stew named by their last digits, so a retry never meets an item a failed try
  wrote; the rest unknown; a request without our User-Agent refused.
