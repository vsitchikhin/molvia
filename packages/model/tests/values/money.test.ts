import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { INT8_MAX } from '#model/support/decimal'
import { DomainError, ERROR } from '#model/support/errors'
import {
  MINOR_EXPONENT,
  TILL_STEP_MINOR,
  addMoney,
  compareMoney,
  currencySign,
  currencySchema,
  decimalFromMinor,
  exactFigures,
  formatEstimate,
  formatInCurrency,
  formatMoney,
  minorPerMajor,
  money,
  moneyCodec,
  moneySchema,
  parseMoney,
  priceSchema,
  subtractMoney,
} from '#model/values/money'

// Digits are asserted with spaces stripped: the grouping separator Intl picks differs
// between ICU builds and is not what is under test.
const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

describe('parseMoney', () => {
  it('keeps the fractional part of a dram receipt', () => {
    expect(parseMoney('5403.12', 'AMD').minor).toBe(540312n)
  })

  it('accepts a comma and every kind of space a keyboard or a receipt produces', () => {
    expect(parseMoney('5 403,12', 'AMD').minor).toBe(540312n)
    expect(parseMoney('5\u00a0403,12', 'AMD').minor).toBe(540312n)
    expect(parseMoney('5\u202f403.12', 'AMD').minor).toBe(540312n)
  })

  it('pads a single decimal digit instead of dropping it', () => {
    expect(parseMoney('12.5', 'RUB').minor).toBe(1250n)
  })

  it('handles a whole amount', () => {
    expect(parseMoney('570', 'AMD').minor).toBe(57000n)
  })

  it('refuses a negative amount: a price is not a difference', () => {
    expect(() => parseMoney('-40.50', 'RUB')).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_AMOUNT }),
    )
  })

  it('refuses an amount the bigint column could not hold', () => {
    expect(() => parseMoney('9'.repeat(20), 'AMD')).toThrow(DomainError)
  })

  it('takes a space as a group separator and nothing else', () => {
    expect(parseMoney('5 403,12', 'AMD').minor).toBe(540312n)
    for (const typo of ['5 4 0 3.1 2', '- 5', '5 40,12', '5 4033']) {
      expect(() => parseMoney(typo, 'AMD')).toThrow(DomainError)
    }
  })

  it('rejects what is not an amount', () => {
    for (const bad of ['', ' ', 'abc', '1.234', '1..2', '1,2,3', '--1']) {
      expect(() => parseMoney(bad, 'AMD')).toThrow(DomainError)
    }
  })

  it('reports the registry code, not a message written in place', () => {
    expect(() => parseMoney('abc', 'AMD')).toThrow(
      expect.objectContaining({ code: ERROR.INVALID_AMOUNT }),
    )
  })
})

describe('arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    const a = money(540312n, 'AMD')
    const b = money(57000n, 'AMD')
    expect(addMoney(a, b).minor).toBe(597312n)
    expect(subtractMoney(a, b).minor).toBe(483312n)
  })

  it('refuses to mix currencies rather than guessing a rate', () => {
    const amd = money(1n, 'AMD')
    const rub = money(1n, 'RUB')
    expect(() => addMoney(amd, rub)).toThrow(
      expect.objectContaining({ code: ERROR.CURRENCY_MISMATCH }),
    )
    expect(() => compareMoney(amd, rub)).toThrow(DomainError)
  })

  it('orders amounts', () => {
    expect(compareMoney(money(1n, 'AMD'), money(2n, 'AMD'))).toBe(-1)
    expect(compareMoney(money(2n, 'AMD'), money(2n, 'AMD'))).toBe(0)
  })
})

describe('formatMoney', () => {
  // Rounding happens here and nowhere else, so this is the only place a fraction is
  // allowed to disappear.

  it('keeps both minor digits of a dram amount', () => {
    expect(digits(formatMoney(money(540312n, 'AMD')))).toContain('5403,12')
  })

  it('prints a whole amount without «,00», as DESIGN.md has it (MOL-205)', () => {
    expect(digits(formatMoney(money(987000n, 'AMD')))).toBe('9870֏')
    expect(digits(formatMoney(money(0n, 'AMD')))).toBe('0֏')
    expect(digits(formatMoney(money(-20000n, 'AMD')))).toMatch(/^[-−]200֏$/)
  })

  it('prints a fraction with every digit of the currency, never rounded or trimmed', () => {
    // Money spent, not an estimate: a kopeck is never rounded away, and 40,50 is not 40,5.
    expect(digits(formatMoney(money(1n, 'USD')))).toBe('0,01$')
    expect(digits(formatMoney(money(100n, 'USD')))).toBe('1$')
    expect(digits(formatMoney(money(101n, 'USD')))).toBe('1,01$')
    expect(digits(formatMoney(money(4050n, 'RUB')))).toBe('40,50₽')
    expect(digits(formatMoney(money(249569n, 'RUB')))).toBe('2495,69₽')
  })

  it('tells a group of thousands from a fraction in English', () => {
    expect(formatMoney(money(2_000_000n, 'RUB'), 'en-US')).toBe('₽20,000')
    expect(formatMoney(money(2_000_050n, 'RUB'), 'en-US')).toBe('₽20,000.50')
  })

  it('leaves the estimate whole as it was — the rule is for money, not for «≈»', () => {
    expect(digits(formatEstimate(money(10788n, 'RUB')))).toBe('108₽')
  })

  it('keeps the sign of a negative amount', () => {
    // Not a price — a difference, which is the one shape allowed to be negative.
    expect(digits(formatMoney(money(-4050n, 'RUB')))).toContain('40,50')
    expect(formatMoney(money(-4050n, 'RUB'))).toMatch(/-|−/)
  })

  it('prints the dram sign, which is what the separate font face exists for', () => {
    expect(formatMoney(money(540312n, 'AMD'))).toContain('֏')
    expect(formatMoney(money(540312n, 'AMD'))).not.toContain('AMD')
  })

  it('печатает лари знаком ₾ в обоих языках, а не «ლ» русского CLDR (MOL-110)', () => {
    for (const locale of ['ru-RU', 'en-US']) {
      expect(formatMoney(money(345n, 'GEL'), locale)).toContain('₾')
      expect(formatMoney(money(345n, 'GEL'), locale)).not.toContain('ლ')
      expect(formatEstimate(money(34_550n, 'GEL'), locale)).toContain('₾')
      expect(currencySign('GEL', locale)).toBe('₾')
    }
    expect(digits(formatMoney(money(345n, 'GEL')))).toBe('3,45₾')
    expect(currencySign('AMD')).toBe('֏')
  })

  it('печатает динар как браузер — «RSD», с двумя знаками ISO 4217 (MOL-230, В-4 MOL-110)', () => {
    expect(formatMoney(money(123_450n, 'RSD'))).toContain('RSD')
    expect(digits(formatMoney(money(123_450n, 'RSD')))).toBe('1234,50RSD')
    expect(currencySign('RSD', 'en-US')).toBe('RSD')
    expect(minorPerMajor('RSD')).toBe(100n)
    // Касса — целые динары, как драмы (MOL-230).
    expect(TILL_STEP_MINOR.RSD).toBe(TILL_STEP_MINOR.AMD)
  })

  it('stays exact past 2^53 instead of drifting or printing infinity', () => {
    // The only bridge from bigint to float used to be here, and it failed quietly.
    const huge = money(9_007_199_254_740_993n, 'USD')
    // en-US groups with commas, so strip those too before reading the digits back.
    const bare = formatMoney(huge, 'en-US').replace(/[\s\u00a0\u202f,]/g, '')
    expect(bare).toContain('90071992547409.93')
    expect(bare).not.toContain('90071992547409.92')

    // Exact all the way to the ceiling the model accepts, which is the bigint column.
    const ceiling = formatMoney(money(INT8_MAX, 'USD'), 'en-US').replace(/[\s,]/g, '')
    expect(ceiling).toContain('92233720368547758.07')

    // A whole amount that large loses its «.00» and not a digit.
    const whole = formatMoney(money(9_007_199_254_740_900n, 'USD'), 'en-US').replace(/[\s,]/g, '')
    expect(whole).toBe('$90071992547409')
  })
})

describe('exactFigures', () => {
  // No currency keeps three digits or none today, and the exponent table is frozen, so the rule is
  // held here, by the digits a currency would keep (MOL-205).
  const printed = (decimal: `${number}`, figures: number): string =>
    digits(formatInCurrency(decimal, 'AMD', 'ru-RU', exactFigures(figures)))

  it('prints every digit of a currency of three, and none of a whole amount in it', () => {
    expect(printed('1.500', 3)).toBe('1,500֏')
    expect(printed('1.005', 3)).toBe('1,005֏')
    expect(printed('2.000', 3)).toBe('2֏')
  })

  it('prints a currency of none as it is', () => {
    expect(printed('7', 0)).toBe('7֏')
  })

  it('decides whole by what is printed: a fraction rounded into a whole number goes bare', () => {
    expect(printed('569.995', 2)).toBe('570֏')
    expect(printed('569.994', 2)).toBe('569,99֏')
  })
})

describe('the minor-unit exponent', () => {
  it('is what minorPerMajor is derived from, for every currency', () => {
    for (const currency of currencySchema.options) {
      expect(minorPerMajor(currency)).toBe(10n ** BigInt(MINOR_EXPONENT[currency]))
    }
  })

  it('is frozen, so nothing can rewrite what an already stored amount means', () => {
    // `const` holds the binding, not the contents. A write here would leave every stored
    // minor unit exactly as it is and change the price it reads as — and a value outside
    // the union made minorPerMajor undefined, which printed NaN where a price belongs.
    expect(Object.isFrozen(MINOR_EXPONENT)).toBe(true)
    expect(() => {
      // @ts-expect-error readonly in the type as well as at runtime — this is the point
      MINOR_EXPONENT.AMD = 0
    }).toThrow(TypeError)
  })

  it('rejects one digit more than the currency keeps', () => {
    for (const currency of currencySchema.options) {
      expect(() => parseMoney('1.234', currency)).toThrow(DomainError)
    }
  })
})

describe('decimalFromMinor', () => {
  it('is the inverse of parseMoney, padding and all', () => {
    expect(decimalFromMinor(money(540312n, 'AMD'))).toBe('5403.12')
    expect(decimalFromMinor(money(5n, 'RUB'))).toBe('0.05')
    expect(decimalFromMinor(money(0n, 'RUB'))).toBe('0.00')
    expect(decimalFromMinor(money(-4050n, 'RUB'))).toBe('-40.50')
  })
})

describe('moneyCodec', () => {
  it('carries the amount over a wire that a bigint cannot cross on its own', () => {
    const value = money(540312n, 'AMD')
    expect(() => JSON.stringify(value)).toThrow(TypeError)

    const wire = z.encode(moneyCodec, value)
    expect(wire).toEqual({ amount: '5403.12', currency: 'AMD' })
    expect(moneyCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(value)
  })

  it('sends a decimal string rather than a JSON number, which would be a double', () => {
    expect(typeof z.encode(moneyCodec, money(540312n, 'AMD')).amount).toBe('string')
  })

  it('keeps an amount past Number.MAX_SAFE_INTEGER exact — the whole reason for bigint', () => {
    const huge = money(BigInt(Number.MAX_SAFE_INTEGER) * 1000n + 7n, 'AMD')
    const wire = JSON.parse(JSON.stringify(z.encode(moneyCodec, huge))) as unknown
    expect(moneyCodec.parse(wire).minor).toBe(huge.minor)
  })

  it('refuses a malformed amount instead of coercing it', () => {
    expect(() => moneyCodec.parse({ amount: '1.234', currency: 'AMD' })).toThrow()
    expect(() => moneyCodec.parse({ amount: 'abc', currency: 'AMD' })).toThrow()
  })

  it('reports a bad amount through safeParse rather than escaping it', () => {
    // safeParse exists so it does not throw. A transform that throws would fly past the
    // `if (!parsed.success) return 400` branch of every route written the canonical way.
    const parsed = moneyCodec.safeParse({ amount: 'abc', currency: 'AMD' })
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues[0]).toMatchObject({
      path: ['amount'],
      message: ERROR.INVALID_AMOUNT,
    })
  })
})

describe('the ceiling of an amount', () => {
  it('takes the largest amount a bigint column holds and refuses the next one', () => {
    // The bound used to live only in the wire codec, so a Money built inside the server
    // passed the schema and the database answered 22003. Found by the MOL-6 review.
    expect(priceSchema.safeParse({ minor: INT8_MAX, currency: 'AMD' }).success).toBe(true)
    expect(priceSchema.safeParse({ minor: INT8_MAX + 1n, currency: 'AMD' }).success).toBe(false)
  })

  it('refuses a difference wider than the range, the way addition does', () => {
    // A difference of two extremes is twice the range, and once the schema grew a ceiling
    // this was the only way left to build a Money the schema itself refuses.
    expect(() => subtractMoney(money(-INT8_MAX, 'AMD'), money(INT8_MAX, 'AMD'))).toThrow(
      DomainError,
    )
    expect(subtractMoney(money(INT8_MAX, 'AMD'), money(1n, 'AMD')).minor).toBe(INT8_MAX - 1n)
  })

  it('bounds the negative side too — a difference is still a Money', () => {
    expect(moneySchema.safeParse({ minor: -INT8_MAX, currency: 'AMD' }).success).toBe(true)
    expect(moneySchema.safeParse({ minor: -INT8_MAX - 1n, currency: 'AMD' }).success).toBe(false)
  })
})

describe('currencySign', () => {
  it.each([
    ['AMD', '֏'],
    ['RUB', '₽'],
    ['USD', '$'],
    ['EUR', '€'],
  ] as const)('%s is %s', (currency, sign) => {
    expect(currencySign(currency)).toBe(sign)
  })

  // The same sign the formatter puts next to an amount, so a field's tail and a printed price agree.
  it('is the sign formatMoney prints', () => {
    expect(formatMoney(money(57000n, 'AMD'))).toContain(currencySign('AMD'))
  })
})

describe('formatEstimate', () => {
  const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '')

  it('rounds an estimate to whole units, half away from zero, and keeps the sign', () => {
    expect(digits(formatEstimate(money(10788n, 'RUB')))).toBe('108₽')
    expect(digits(formatEstimate(money(10749n, 'RUB')))).toBe('107₽')
    expect(digits(formatEstimate(money(10750n, 'RUB')))).toBe('108₽')
    expect(digits(formatEstimate(money(134712n, 'RUB')))).toBe('1347₽')
  })

  it('keeps every digit of a figure past 2^53', () => {
    const text = formatEstimate(money(9_007_199_254_740_993n, 'USD'), 'en-US')
    expect(text.replace(/[\s,]/g, '')).toContain('90071992547410')
  })
})
