---
paths:
  - 'packages/model/src/entities/barcode.ts'
  - 'packages/model/tests/entities/barcode.test.ts'
  - 'frontend/src/scanner/**'
  - 'frontend/src/components/BarcodeScannerSheet.*'
  - 'frontend/src/composables/{useCamera,useBarcodeScan}.*'
  - 'e2e/{scanner.spec,barcode-video}.ts'
---

# Barcodes: the scanner, a code typed by hand

The detail behind the barcode lines of `CLAUDE.md`. The scanner came in with MOL-98; finding an item
by its code is MOL-99, a code in «Предложить товар» and bound to an item is MOL-100.

## What the scanner is

- **A sheet that hands over a code and closes** (`BarcodeScannerSheet`, owner's decision В-4): the
  kit's `BottomSheet` with a live viewfinder, so «back», Esc and × close it as they close any sheet.
  What the code is for is the opener's. Until MOL-99 it opens only on `/_kit`, which is why the
  production bundle holds no scanner yet (owner's decision В-2).
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
  in ten also checks as EAN-8, the sample `01234565` among them. A leading `0` that checks as UPC-E
  is UPC-E — an EAN-8 starting with `0` is a shop's in-house code, not a product's. **The named
  price, both ways:** a UPC-E of number system `1` that also checks as EAN-8, typed by hand, gives
  another code than the one scanned; and so does an EAN-8 led by `0` that also checks as UPC-E —
  about one in ten of them, `00408295` among them: scanned it is eight digits, typed it is
  `0004082000095` (adversarial А). Such a code is a shop's own label, and a lookup by a code typed
  from it (MOL-99) will not find what its scan found.
- **`barcodeSchema` was not made stricter** (Р-10): `itemSchema` reads with it, and a dozen fixtures
  carry codes whose check digit does not hold. Whether the write of a code checks its digit is
  MOL-100's call, the one that writes codes.

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
