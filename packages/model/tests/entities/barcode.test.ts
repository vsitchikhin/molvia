import { describe, expect, it } from 'vitest'
import {
  barcodeTwins,
  hasRepeatedBarcode,
  typedBarcode,
  writtenBarcode,
} from '#model/entities/barcode'
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

  it('drops what draws nothing, as a code copied from a message carries it (adversarial Д)', () => {
    for (const unseen of [0x200b, 0x2060, 0xad, 0xfeff]) {
      const invisible = String.fromCodePoint(unseen)
      expect(code(`4850000000007${invisible}`), unseen.toString(16)).toBe('4850000000007')
      expect(code(`485${invisible}0000000007`), unseen.toString(16)).toBe('4850000000007')
    }
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

describe('barcodeTwins', () => {
  it('pairs eight digits that check both ways with the UPC-E expanded, both ways round', () => {
    // A shop's EAN-8 led by 0: scanned it is eight digits, typed it is thirteen (MOL-98 Р-11).
    expect(barcodeTwins('00408295')).toEqual(['00408295', '0004082000095'])
    expect(barcodeTwins('0004082000095')).toEqual(['0004082000095', '00408295'])
    expect(barcodeTwins('01234565')).toEqual(['01234565', '0012345000065'])
    expect(barcodeTwins('0012345000065')).toEqual(['0012345000065', '01234565'])
  })

  it('pairs a system-1 code that checks both ways — the price typedBarcode names', () => {
    // Typed it is EAN-8; scanned as UPC-E it is thirteen digits.
    expect(barcodeTwins('10000007')).toEqual(['10000007', '0100000000007'])
    expect(barcodeTwins('0100000000007')).toEqual(['0100000000007', '10000007'])
  })

  it('pairs thirteen digits only with a UPC-E form that checks as EAN-8', () => {
    // UPC-E alone: their eight digits never check as EAN-8, so no eight digits of them are taken.
    for (const expanded of ['0042100005264', '0012300000451', '0065100004327']) {
      expect(barcodeTwins(expanded), expanded).toEqual([expanded])
    }
    // Two UPC-E forms reach this UPC-A: 01234543 by the rule of 4, 01234053 by the rule of 5–9 —
    // and the second checks as EAN-8 too, so it is a twin like any other.
    expect(barcodeTwins('0012340000053')).toEqual(['0012340000053', '01234053'])
    expect(barcodeTwins('01234053')).toEqual(['01234053', '0012340000053'])
  })

  it('must not pair a code with one form only', () => {
    expect(barcodeTwins('96385074')).toEqual(['96385074']) // EAN-8 led by neither 0 nor 1
    expect(barcodeTwins('04252614')).toEqual(['04252614']) // UPC-E, not an EAN-8
    expect(barcodeTwins('4850000000007')).toEqual(['4850000000007'])
    expect(barcodeTwins('0012345678905')).toEqual(['0012345678905']) // UPC-A with no zeros to leave out
  })

  it('looks up twelve digits and a GTIN-14 led by 0 as the thirteen the scanner gives (adversarial З)', () => {
    expect(barcodeTwins('012345678905')).toEqual(['012345678905', '0012345678905'])
    expect(barcodeTwins('04850000000007')).toEqual(['04850000000007', '4850000000007'])
    // And on to the eight digits the thirteen pair with.
    expect(barcodeTwins('004082000095')).toEqual(['004082000095', '0004082000095', '00408295'])
    // A GTIN-14 of a carton (not led by 0) is a code of its own.
    expect(barcodeTwins('14850000000004')).toEqual(['14850000000004'])
  })

  it('does not guess between two shop labels that fold into one thirteen (adversarial Г)', () => {
    // 00000055 and 00000505 both check as EAN-8 and as UPC-E, and both expand to 000000000055:
    // neither way is the pair told apart, so there is none (adversarial Г, Г′, review С-7).
    expect(barcodeTwins('00000055')).toEqual(['00000055'])
    expect(barcodeTwins('00000505')).toEqual(['00000505'])
    expect(barcodeTwins('0000000000055')).toEqual(['0000000000055'])
  })

  it('must not pair thirteen digits whose check digit fails', () => {
    expect(barcodeTwins('0004082000096')).toEqual(['0004082000096'])
  })

  it('is symmetric over a sweep of eight digits led by 0 or 1: a twin always lists the code back', () => {
    // Every 101st prefix with each last digit — the whole range was swept once by hand (С-7).
    const broken: string[] = []
    for (let n = 0; n < 2_000_000; n += 101) {
      for (let digit = 0; digit < 10; digit++) {
        const eight = `${String(n).padStart(7, '0')}${String(digit)}`
        for (const twin of barcodeTwins(eight).slice(1)) {
          if (!barcodeTwins(twin).includes(eight)) broken.push(`${eight} → ${twin}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('is symmetric: every twin lists the code back', () => {
    for (const code of [
      '00408295',
      '01234565',
      '10000007',
      '01234053',
      '0004082000095',
      '0100000000007',
    ]) {
      for (const twin of barcodeTwins(code)) expect(barcodeTwins(twin), twin).toContain(code)
    }
  })

  it('gives nothing for a code of no barcode shape', () => {
    for (const input of ['', '1234567', '123456789', 'abcdefgh', '00408295 ', '004082950000000']) {
      expect(barcodeTwins(input), input).toEqual([])
    }
  })
})

describe('writtenBarcode', () => {
  const written = (input: string) => {
    const result = writtenBarcode(input)
    return result.ok ? result.code : result.error
  }

  it('writes a code whose check digit holds, and refuses one digit off (Р-1)', () => {
    expect(written('4850000000007')).toBe('4850000000007')
    expect(written('4850000000003')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('writes twelve digits and a GTIN-14 led by 0 as the thirteen the scanner reads', () => {
    expect(written('012345678905')).toBe('0012345678905')
    expect(written('012345678906')).toBe(ERROR.BARCODE_CHECK_DIGIT)
    expect(written('04850000000007')).toBe('4850000000007')
    expect(written('04850000000003')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('keeps a GTIN-14 of a case as it is', () => {
    // 1 as the indicator: a case of the package, not the package — a code of its own.
    expect(written('14850000000004')).toBe('14850000000004')
  })

  it('keeps eight digits that check as EAN-8 as they came', () => {
    expect(written('96385074')).toBe('96385074') // EAN-8 only
    // UPC-E only: no EAN-8 the scanner reads, so written as the thirteen it reads the UPC-E as —
    // kept as eight, nothing would find it (review А).
    expect(written('04252614')).toBe('0042100005264')
    expect(barcodeTwins('0042100005264')).toEqual(['0042100005264'])
    expect(written('01234565')).toBe('01234565') // both
    expect(written('96385075')).toBe(ERROR.BARCODE_CHECK_DIGIT)
    // Led by neither 0 nor 1, eight digits are no UPC-E: only EAN-8 can pass them.
    expect(written('24252610')).toBe(ERROR.BARCODE_CHECK_DIGIT)
  })

  it('refuses what is no barcode at all — nine digits, spaces, letters', () => {
    expect(written('123456789')).toBe(ERROR.BARCODE_SHAPE)
    expect(written('4850 000000007')).toBe(ERROR.BARCODE_SHAPE)
    expect(written('')).toBe(ERROR.BARCODE_SHAPE)
  })
})

describe('hasRepeatedBarcode', () => {
  it('finds a code twice and a code beside its twin, and nothing in distinct codes', () => {
    expect(hasRepeatedBarcode([])).toBe(false)
    expect(hasRepeatedBarcode(['4850000000007', '96385074'])).toBe(false)
    expect(hasRepeatedBarcode(['96385074', '96385074'])).toBe(true)
    expect(hasRepeatedBarcode(['0004082000095', '00408295'])).toBe(true)
    expect(hasRepeatedBarcode(['04850000000007', '4850000000007'])).toBe(true)
  })
})
