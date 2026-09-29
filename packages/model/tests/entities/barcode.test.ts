import { describe, expect, it } from 'vitest'
import { typedBarcode } from '#model/entities/barcode'
import { ERROR } from '#model/support/errors'

const code = (input: string) => {
  const typed = typedBarcode(input)
  return typed.ok ? typed.code : typed.error
}

describe('typedBarcode', () => {
  it('takes an EAN-13 whose check digit holds, and refuses one digit off', () => {
    expect(code('4850000000007')).toBe('4850000000007')
    expect(code('4850000000003')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('gives a UPC-A as the thirteen digits the scanner reads it as', () => {
    // zxing-wasm reads the UPC-A 012345678905 as EAN-13 0012345678905: one package, one code.
    expect(code('012345678905')).toBe('0012345678905')
    expect(code('012345678906')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('takes an EAN-8 as it is', () => {
    expect(code('96385074')).toBe('96385074')
    expect(code('96385075')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('expands a UPC-E into the thirteen digits the scanner reads it as', () => {
    // Each of the four ways a UPC-E leaves out zeros, by its sixth data digit.
    expect(code('04252614')).toBe('0042100005264') // 0–2
    expect(code('01234531')).toBe('0012300000451') // 3
    expect(code('01234543')).toBe('0012340000053') // 4
    expect(code('06543217')).toBe('0065100004327') // 5–9
  })

  it('reads eight digits led by 0 that check both ways as UPC-E', () => {
    // 01234565 checks as EAN-8 too; zxing reads the printed UPC-E as 0012345000065.
    expect(code('01234565')).toBe('0012345000065')
  })

  it('reads a system-1 code that checks both ways as EAN-8 — the named price', () => {
    expect(code('10000007')).toBe('10000007')
  })

  it('refuses eight digits that check neither way', () => {
    expect(code('01234560')).toBe(ERROR.BARCODE_CHECK_DIGIT)
    expect(code('48500001')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('drops the spaces and hyphens printed under the bars', () => {
    expect(code('4 850000 000007')).toBe('4850000000007')
    expect(code(' 0-12345-67890-5\n')).toBe('0012345678905')
  })

  it('refuses a length the scanner never reads', () => {
    // 7, 9, 11 and 14 digits: ITF-14 is a carton, not a package on a shelf.
    for (const input of ['1234567', '123456789', '12345678901', '04850000000007']) {
      expect(code(input), input).toBe(ERROR.BARCODE_SHAPE)
    }
  })

  it('must not take letters or nothing at all', () => {
    for (const input of ['', '   ', 'abcdefgh', '485000000000x', '4850000.000007']) {
      expect(code(input), input).toBe(ERROR.BARCODE_SHAPE)
    }
  })
})
