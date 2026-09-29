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
 */
export function barcodeTwins(code: string): string[] {
  if (!barcodeSchema.safeParse(code).success) return []
  if (code.length === 8) {
    const upcA = /^[01]/.test(code) ? expandUpcE(code) : null
    return upcA !== null && checks(code) && checks(upcA) ? [code, `0${upcA}`] : [code]
  }
  if (code.length === 13 && code.startsWith('0') && checks(code)) {
    return [code, ...compressUpcA(code.slice(1)).filter(checks)]
  }
  return [code]
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
 */
export function typedBarcode(input: string): TypedBarcode {
  const digits = input.replace(DROPPED, '')
  if (!/^(\d{8}|\d{12,13})$/.test(digits)) return { ok: false, error: ERROR.BARCODE_SHAPE }
  if (digits.length === 8) {
    const upcE = /^[01]/.test(digits) ? expandUpcE(digits) : null
    const isUpcE = upcE !== null && checks(upcE)
    if (isUpcE && (digits.startsWith('0') || !checks(digits))) return { ok: true, code: `0${upcE}` }
    return checks(digits)
      ? { ok: true, code: digits }
      : { ok: false, error: ERROR.BARCODE_CHECK_DIGIT }
  }
  if (!checks(digits)) return { ok: false, error: ERROR.BARCODE_CHECK_DIGIT }
  return { ok: true, code: digits.length === 12 ? `0${digits}` : digits }
}
