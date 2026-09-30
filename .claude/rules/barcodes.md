---
paths:
  - 'packages/model/src/entities/barcode.ts'
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
---

# Barcodes: the scanner, a code typed by hand, the item by its code

The detail behind the barcode lines of `CLAUDE.md`. The scanner came in with MOL-98; finding an item
by its code is MOL-99, a code in «Предложить товар» and bound to an item is MOL-100.

## What the scanner is

- **A sheet that hands over a code and closes** (`BarcodeScannerSheet`, owner's decision В-4): the
  kit's `BottomSheet` with a live viewfinder, so «back», Esc and × close it as they close any sheet.
  What the code is for is the opener's: «Что взяли?» finds the item by it (MOL-99, below).
- **EAN-13, EAN-8, UPC-A and UPC-E, nothing else** (`READER_OPTIONS`). A QR or a Code 128 on the
  same package is not the item's code, and every format read beyond these is one more chance of a
  false read. That the scanner reads EAN and not QR is the reason the Telegram Mini App was dropped.
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
  «Предложить товар» from anywhere on the screen while it waits, the code goes with the item.
- **A pick while a code waits asks first** — «Привязать код … к „…“?» — in a block where the code's
  block stood, not in a sheet (В-2): «taken», «no network» or an error is then said where the person
  is, and the purchase sheet comes only after the answer, one sheet at a time. The rows go while the
  question stands, the focus goes to its first answer and the question is said out loud. **An answer
  «written» that lands after typing went on** opens no sheet, but the code no longer waits: the server
  holds it (Р-13, adversarial Д). **While the code is on its way the other answers wait** (review Б): «без кода» then would be written with the code anyway, and «другой товар» would meet it at the very item it was said not to be. **Three
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
  the person with the package decides, the last answer at hand. Typing drops the question, and the code
  still waits.
- **Taken** — «Код … уже у „…“»: «Взять „…“» takes the holder as found by the code, with no query;
  «Записать „…“ без кода» goes on with the row picked. **No network** is an offline state with
  «Повторить» and «Записать без кода» — the catalogue has no queue, as «Предложить товар» has none; an
  error is red with «Повторить» and the same way out. **An item holding twenty codes** is said in the words of `error.barcodes_full`, with no «Повторить» — asking again changes nothing (review В); so is it on «Предложить товар» by a name already there. A retry of a write waits for a tap: nothing is
  sent by itself.
- **A code written is remembered for offline** as one found is: the item it went to goes into «Часто
  берёте» with it once it is added to a record.
