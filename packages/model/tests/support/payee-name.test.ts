import { describe, expect, it } from 'vitest'
import { payeeNameShare, payeeWords, payeeWordsNear } from '#model/support/payee-name'

describe('payeeWords', () => {
  it('folds Cyrillic, Armenian and Georgian to the bank’s Latin', () => {
    expect(payeeWords('Ереван Сити')).toEqual(payeeWords('YEREVAN CITY'))
    expect(payeeWords('Երևան Սիթի')).toEqual(['erevan', 'siti'])
    expect(payeeWords('თავისუფლება')).toEqual(payeeWords('TAVISUPLEBA'))
  })

  it('drops words under three letters: a country’s code, a terminal’s number', () => {
    expect(payeeWords('Ք: YEREVAN CITY AVAN YEREVAN AM 19')).toEqual([
      'erevan',
      'siti',
      'avan',
      'erevan',
    ])
  })
})

describe('payeeWordsNear', () => {
  it('lets one edit under six letters and two from six', () => {
    expect(payeeWordsNear('bolt', 'bold')).toBe(true)
    expect(payeeWordsNear('bolt', 'belk')).toBe(false)
    expect(payeeWordsNear('moskva', 'moskow')).toBe(true)
  })
})

describe('payeeNameShare', () => {
  it('is the share of the record’s words the payee has', () => {
    expect(payeeNameShare('YANDEX.GO YEREVAN', 'Yandex Taxi')).toBe(0.5)
    expect(payeeNameShare('YANDEX.GO YEREVAN', 'Yandex Go')).toBe(1)
    expect(payeeNameShare('Ք: YEREVAN CITY AVAN YEREVAN AM 19', 'Ереван Сити')).toBe(1)
    expect(payeeNameShare('NATALI FARM', 'Такси наличными')).toBe(0)
  })

  it('is 0 for a record with no words', () => {
    expect(payeeNameShare('VEGA', '')).toBe(0)
  })
})
