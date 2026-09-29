import { ERROR, type ErrorCode } from '#model/support/errors'

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

/**
 * A code typed by hand, in the form the scanner gives the same package (MOL-98): zxing reads
 * UPC-A and UPC-E as thirteen digits, so a code typed from either comes out the same way, and
 * one package is one code whichever way it came in. Spaces and hyphens, as printed under the
 * bars, are dropped.
 *
 * Eight digits are EAN-8 or UPC-E, and the digits alone do not say which: about one UPC-E in
 * ten also checks as EAN-8. A leading `0` settles it for UPC-E — an EAN-8 starting with `0` is a
 * shop's in-house code, not a product's — and anything else checking as EAN-8 is EAN-8. The one
 * case left, a UPC-E of number system `1` that also checks as EAN-8, is read as EAN-8.
 */
export function typedBarcode(input: string): TypedBarcode {
  const digits = input.replace(/[\s-]/g, '')
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
