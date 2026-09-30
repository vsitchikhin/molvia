import { barcodeSchema } from '#model/entities/item'
import { ERROR, type ErrorCode } from '#model/support/errors'
import { INVISIBLE } from '#model/support/text'

// What a person copying a code does not see: the spaces and hyphens printed under the bars, and
// whatever draws nothing — the one list, `INVISIBLE` (adversarial Д).
const DROPPED = new RegExp(`[\\s\\-${INVISIBLE}]`, 'gu')

export type TypedBarcode = { ok: true; code: string } | { ok: false; error: ErrorCode }

// GS1 check digit: from the right, the digits before it weigh 3, 1, 3, …
function checks(digits: string): boolean {
  let sum = 0
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
    sum += Number(digits[i]) * weight
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1))
}

// UPC-E is UPC-A with zeros left out; the last of its six data digits says which.
function expandUpcE(code: string): string {
  const data = code.slice(1, 7)
  const last = data.slice(5)
  const middle =
    last <= '2'
      ? `${data.slice(0, 2)}${last}0000${data.slice(2, 5)}`
      : last === '3'
        ? `${data.slice(0, 3)}00000${data.slice(3, 5)}`
        : last === '4'
          ? `${data.slice(0, 4)}00000${data.slice(4, 5)}`
          : `${data.slice(0, 5)}0000${last}`
  return `${code.slice(0, 1)}${middle}${code.slice(7)}`
}

// The way back: the UPC-E forms that `expandUpcE` turns into this UPC-A, one per rule of the four.
function compressUpcA(upcA: string): string[] {
  if (!/^[01]/.test(upcA)) return []
  const data = [
    `${upcA.slice(1, 3)}${upcA.slice(8, 11)}${upcA.slice(3, 4)}`,
    `${upcA.slice(1, 4)}${upcA.slice(9, 11)}3`,
    `${upcA.slice(1, 5)}${upcA.slice(10, 11)}4`,
    `${upcA.slice(1, 6)}${upcA.slice(10, 11)}`,
  ]
  const forms = data.map((middle) => `${upcA.slice(0, 1)}${middle}${upcA.slice(11)}`)
  return [...new Set(forms)].filter((upcE) => expandUpcE(upcE) === upcA)
}

/**
 * Every form the code of one package may have been taken in, the code itself first (MOL-99,
 * review С-14); nothing for a code of no barcode's shape.
 *
 * Eight digits that check both as EAN-8 and as UPC-E are the one case two forms exist: scanned
 * as EAN-8 they stay eight digits, typed they are the UPC-E expanded to thirteen (`typedBarcode`),
 * and the other way round for a UPC-E of number system `1`. A lookup by both finds what the
 * other way in found. The price: a shop's own EAN-8 label and a UPC-E product with the same
 * digits find each other.
 *
 * The pair holds only where one EAN-8 folds into the thirteen. Two shop labels with different
 * digits may expand to one UPC-A (`00000055` and `00000505`), and the thirteen no longer say which
 * label they came from: guessing put another shop's item on the sheet, from the thirteen
 * (adversarial Г) and from the eight alike (Г′, review С-7). So such a label and its thirteen are
 * each only themselves — scanned and typed, it finds only what was taken in the same form.
 *
 * Twelve digits are UPC-A and fourteen led by `0` are GTIN-14 of the same package: both are also
 * looked up as the thirteen the scanner and `typedBarcode` give (adversarial З) — a client that
 * does not repeat the phone's rules still finds the package.
 */
export function barcodeTwins(code: string): string[] {
  if (!barcodeSchema.safeParse(code).success) return []
  if (code.length === 8) {
    const upcA = /^[01]/.test(code) ? expandUpcE(code) : null
    if (upcA === null || !checks(code) || !checks(upcA)) return [code]
    // Only where the thirteen lead back to these eight alone — the pair holds both ways or not at
    // all (review С-7, adversarial Г′).
    const eights = compressUpcA(upcA).filter(checks)
    return eights.length === 1 ? [code, `0${upcA}`] : [code]
  }
  const thirteen =
    code.length === 12
      ? `0${code}`
      : code.length === 14 && code.startsWith('0')
        ? code.slice(1)
        : code.length === 13
          ? code
          : null
  if (thirteen === null) return [code]
  const forms = thirteen === code ? [code] : [code, thirteen]
  if (!thirteen.startsWith('0') || !checks(thirteen)) return forms
  const eights = compressUpcA(thirteen.slice(1)).filter(checks)
  return eights.length === 1 ? [...forms, ...eights] : forms
}

/**
 * A code as it is written to the shared catalogue (MOL-100, Р-1): its last digit must check —
 * a code with one that does not cannot be printed on a package, and a code written is written for
 * everyone for good. Twelve digits (UPC-A) and fourteen led by `0` (GTIN-14 of the same package)
 * are written as the thirteen the scanner reads them as. Eight digits that check as EAN-8 are
 * written as they came — the scanner reads an EAN-8 so, and one that checks as UPC-E too is found
 * by its thirteen through `barcodeTwins`. Eight that check **only** as UPC-E are no EAN-8 the
 * scanner could have read: they are written as the thirteen it reads that UPC-E as, since
 * `barcodeTwins` pairs no eight that fail as EAN-8, and kept as eight they would be found by
 * nothing and let the same package onto another item (review А).
 *
 * A GTIN-14 of a case (led by `1`–`8`) is refused as no barcode's shape the phone knows: the scanner
 * does not read ITF-14 and the digits typed take no fourteen, so it would be found by nothing and
 * hold one of the twenty places for good (Р-12). A shop's own code is refused too (`inStoreBarcode`,
 * owner's decision В-4).
 */
export function writtenBarcode(code: string): TypedBarcode {
  const form = barcodeWriteForm(code)
  if (!form.ok) return form
  return inStoreBarcode(form.code) ? { ok: false, error: ERROR.BARCODE_IN_STORE } : form
}

/**
 * The form `writtenBarcode` writes a code in, whoever's code it is — for letting a code go (review
 * К), which must find the row whatever form the code came in, and for judging repeats in one list.
 */
export function barcodeWriteForm(code: string): TypedBarcode {
  if (!barcodeSchema.safeParse(code).success) return { ok: false, error: ERROR.BARCODE_SHAPE }
  if (code.length === 8) {
    if (checks(code)) return { ok: true, code }
    const upcA = /^[01]/.test(code) ? expandUpcE(code) : null
    return upcA !== null && checks(upcA)
      ? { ok: true, code: `0${upcA}` }
      : { ok: false, error: ERROR.BARCODE_CHECK_DIGIT }
  }
  if (code.length === 14 && !code.startsWith('0')) return { ok: false, error: ERROR.BARCODE_SHAPE }
  if (!checks(code)) return { ok: false, error: ERROR.BARCODE_CHECK_DIGIT }
  if (code.length === 12) return { ok: true, code: `0${code}` }
  if (code.length === 14) return { ok: true, code: code.slice(1) }
  return { ok: true, code }
}

/**
 * A shop's own code, not a product's (MOL-100, owner's decision В-4): GS1 leaves numbers of
 * «restricted circulation» to the shop — EAN-13 led by `020`–`029`, `040`–`049` and `200`–`299`
 * (UPC-A of number systems `2` and `4` among them), EAN-8 led by `0` or `2`. The scales print one
 * on every package of loose goods, the item's number in that shop and its weight or price: another
 * package is another code, and the same digits in another shop are another item. So such a code is
 * never written to the shared catalogue, and the screen says what it is instead of asking to link it.
 *
 * Eight digits are an EAN-8 here — the scanner reads a UPC-E as thirteen, and `typedBarcode` keeps
 * eight only where they are no UPC-E it can tell.
 */
export function inStoreBarcode(code: string): boolean {
  const thirteen =
    code.length === 12
      ? `0${code}`
      : code.length === 14 && code.startsWith('0')
        ? code.slice(1)
        : code
  if (thirteen.length === 8) return /^[02]/.test(thirteen)
  return thirteen.length === 13 && /^(02|04|2)/.test(thirteen)
}

/**
 * Whether two codes of one list are the same package (MOL-100, Р-7): one is a twin of the other.
 * Such a pair is a repeat, as two equal codes are.
 */
export function hasRepeatedBarcode(codes: readonly string[]): boolean {
  const seen = new Set<string>()
  for (const code of codes) {
    const forms = barcodeTwins(code)
    if (forms.some((form) => seen.has(form)) || seen.has(code)) return true
    for (const form of forms) seen.add(form)
    seen.add(code)
  }
  return false
}

/**
 * A code typed by hand, in the form the scanner gives the same package (MOL-98): zxing reads
 * UPC-A and UPC-E as thirteen digits, so a code typed from either comes out the same way, and
 * one package is one code whichever way it came in. Spaces and hyphens, as printed under the
 * bars, are dropped, and so is whatever draws nothing.
 *
 * Eight digits are EAN-8 or UPC-E, and the digits alone do not say which: about one UPC-E in
 * ten also checks as EAN-8. A leading `0` settles it for UPC-E — an EAN-8 starting with `0` is a
 * shop's in-house code, not a product's — and anything else checking as EAN-8 is EAN-8. The one
 * case left, a UPC-E of number system `1` that also checks as EAN-8, is read as EAN-8.
 *
 * Except where the thirteen would not say which eight they came from (MOL-100, Р-14): eight led by
 * `0` that check both ways and whose UPC-A folds back into more than one EAN-8 — `00000055` and
 * `00000505` are two shops' labels and one UPC-A. Such digits stay eight, as the scanner reads the
 * label: expanded, two labels were written as one code. The price: a real UPC-E with such digits,
 * typed, is found only by its scan.
 */
export function typedBarcode(input: string): TypedBarcode {
  const digits = input.replace(DROPPED, '')
  if (!/^(\d{8}|\d{12,13})$/.test(digits)) return { ok: false, error: ERROR.BARCODE_SHAPE }
  if (digits.length === 8) {
    const upcE = /^[01]/.test(digits) ? expandUpcE(digits) : null
    const isUpcE = upcE !== null && checks(upcE)
    const label =
      upcE !== null && digits.startsWith('0') && checks(digits) && isUpcE
        ? compressUpcA(upcE).filter(checks).length > 1
        : false
    if (isUpcE && !label && (digits.startsWith('0') || !checks(digits))) {
      return { ok: true, code: `0${upcE}` }
    }
    return checks(digits)
      ? { ok: true, code: digits }
      : { ok: false, error: ERROR.BARCODE_CHECK_DIGIT }
  }
  if (!checks(digits)) return { ok: false, error: ERROR.BARCODE_CHECK_DIGIT }
  return { ok: true, code: digits.length === 12 ? `0${digits}` : digits }
}
