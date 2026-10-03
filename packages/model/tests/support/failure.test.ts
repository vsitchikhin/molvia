import { describe, expect, it } from 'vitest'
import {
  describeFailure,
  describePhoneFailure,
  failureCodeOf,
  ownFrame,
  phoneFrame,
} from '#model/support/failure'

/** A review of the kind MOL-27 allows: several lines, one of them written as a stack frame. */
const REVIEW = 'Вкусно, но дорого\n    at Аня, ул. Ширакаци 12, платила 5000 драм'
const FORGED = '    at ЭтогоКадраНетНиВОдномФайле (secrets.ts:1:1)'

/**
 * The shape of drizzle's wrapper without drizzle, which the domain may not import: the query and
 * its parameters in the message, the driver's error with its code underneath.
 */
function driverFailure(params: readonly string[]): Error {
  const cause = Object.assign(new Error('new row violates check constraint'), { code: '23514' })
  return new Error(
    `Failed query: insert into verdicts values ($1, $2)\nparams: ${params.join(',')}`,
    {
      cause,
    },
  )
}

describe('describeFailure — вид сбоя без слова из его содержимого (MOL-58)', () => {
  // Adversarial П-1: lines were picked by their shape, and a person's text can take that shape.
  it('строка отзыва, похожая на кадр стека, в кадры не попадает', () => {
    const summary = describeFailure(driverFailure([REVIEW, '1f0e2c4a-uuid']))

    expect(JSON.stringify(summary)).not.toMatch(/Ширакаци|Вкусно|1f0e2c4a/)
    expect(summary.code).toBe('23514')
    expect(summary.frames?.[0]).toMatch(/^at .*failure\.test\.ts/)
  })

  it('и выдуманный целиком кадр тоже — вместе с параметрами за ним', () => {
    const summary = describeFailure(driverFailure([FORGED, 'второй параметр']))
    expect(JSON.stringify(summary)).not.toMatch(/ЭтогоКадра|secrets\.ts|второй параметр/)
  })

  it('сообщение, переписанное после создания ошибки, в кадры тоже не попадает', () => {
    const error = new Error('first')
    error.message = `later\n${FORGED}`
    expect(JSON.stringify(describeFailure(error))).not.toMatch(/ЭтогоКадра|later/)
  })

  it('стек, который не начинается с заголовка ошибки, не даёт кадров вовсе', () => {
    const error = new Error('real')
    error.stack = `Something else\n${FORGED}`
    expect(describeFailure(error).frames).toBeUndefined()
  })

  it('ошибка без сообщения даёт свои кадры', () => {
    expect(describeFailure(new TypeError()).frames?.length).toBeGreaterThan(0)
  })

  it('не ошибка — только её вид', () => {
    expect(describeFailure({ message: 'secret' })).toEqual({ errorName: 'object' })
  })

  it('код не своего вида не берётся: в нём мог бы быть текст', () => {
    const error = Object.assign(new Error('x'), { code: 'кто-то искал «сыр»' })
    expect(describeFailure(error)).not.toHaveProperty('code')
  })

  it('ошибка Node с кодом в шапке — `Name [CODE]: …` — кадры не теряет (адверсариальный А5)', () => {
    const error = Object.assign(new RangeError('The value of "size" is out of range'), {
      code: 'ERR_OUT_OF_RANGE',
    })
    // As bare `node` writes it; vitest's own `prepareStackTrace` leaves the code out.
    error.stack = `RangeError [ERR_OUT_OF_RANGE]: ${error.message}\n    at sizeOfPhoto (photo.ts:3:9)`
    expect(describeFailure(error)).toEqual({
      errorName: 'RangeError',
      code: 'ERR_OUT_OF_RANGE',
      frames: ['at sizeOfPhoto (photo.ts:3:9)'],
    })
  })

  it('и шапка с кодом всё так же срезается целиком: строка отзыва в сообщении — не кадр', () => {
    const error = Object.assign(new TypeError(`bad\n${FORGED}`), { code: 'ERR_INVALID_ARG_TYPE' })
    error.stack = `TypeError [ERR_INVALID_ARG_TYPE]: ${error.message}\n    at real (a.ts:1:1)`
    expect(describeFailure(error).frames).toEqual(['at real (a.ts:1:1)'])
  })

  it('кадров не больше восьми', () => {
    const error = new Error('deep')
    error.stack = [
      'Error: deep',
      ...Array.from({ length: 12 }, (_, i) => `    at f${String(i)} (a.ts:1:1)`),
    ].join('\n')
    expect(describeFailure(error).frames).toHaveLength(8)
  })
})

describe('failureCodeOf — код драйвера под обёрткой', () => {
  it('идёт по цепочке cause', () => {
    expect(failureCodeOf(driverFailure(['a', 'b']))).toBe('23514')
  })

  it('глубже четырёх звеньев не ищет', () => {
    let error: unknown = Object.assign(new Error('bottom'), { code: '23505' })
    for (let depth = 0; depth < 4; depth += 1) error = new Error('wrap', { cause: error })
    expect(failureCodeOf(error)).toBeUndefined()
  })
})

const ORIGIN = 'https://molvia.net'

describe('phoneFrame — кадр одного вида для всех движков (MOL-144, Р-1)', () => {
  it.each([
    [
      'at Xe (https://molvia.net/assets/index-BTCsHrpw.js:1:48213)',
      'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
    ],
    [
      'at https://molvia.net/assets/index-BTCsHrpw.js:1:48213',
      'at <anonymous> (/assets/index-BTCsHrpw.js:1:48213)',
    ],
    [
      'at async Qt (https://molvia.net/assets/index-BTCsHrpw.js:1:51002)',
      'at Qt (/assets/index-BTCsHrpw.js:1:51002)',
    ],
    [
      'at new Foo (https://molvia.net/assets/index-BTCsHrpw.js:1:9)',
      'at Foo (/assets/index-BTCsHrpw.js:1:9)',
    ],
    [
      'Xe@https://molvia.net/assets/index-BTCsHrpw.js:1:48213',
      'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
    ],
    [
      '@https://molvia.net/assets/index-BTCsHrpw.js:1:7',
      'at <anonymous> (/assets/index-BTCsHrpw.js:1:7)',
    ],
    [
      'setup/<@https://molvia.net/assets/index-BTCsHrpw.js:1:7',
      'at setup/< (/assets/index-BTCsHrpw.js:1:7)',
    ],
    [
      'async*Qt@https://molvia.net/assets/index-BTCsHrpw.js:1:7',
      'at Qt (/assets/index-BTCsHrpw.js:1:7)',
    ],
    [
      'https://molvia.net/assets/index-BTCsHrpw.js:1:7',
      'at <anonymous> (/assets/index-BTCsHrpw.js:1:7)',
    ],
  ])('%s', (line, frame) => {
    expect(phoneFrame(line, ORIGIN)).toBe(frame)
  })

  it('файл скрипта — путь без query и hash', () => {
    expect(
      phoneFrame('at x (http://127.0.0.1:5300/src/main.ts?t=1696:4:5)', 'http://127.0.0.1:5300'),
    ).toBe('at x (/src/main.ts:4:5)')
    expect(phoneFrame(`at x (${ORIGIN}/sw.js:1:2)`, ORIGIN)).toBe('at x (/sw.js:1:2)')
  })

  it('адрес страницы — не свой код и не уходит: id поездки, запрос (адверсариальный А2)', () => {
    const trip = '3f2a9c1e-7b4d-4e8a-9c2f-5d6e7f8a9b0c'
    expect(phoneFrame(`at inject (${ORIGIN}/purchases/${trip}:3:15)`, ORIGIN)).toBe('at inject (?)')
    expect(phoneFrame(`inject@${ORIGIN}/money/accounts/${trip}:3:15`, ORIGIN)).toBe('at inject (?)')
    expect(phoneFrame(`at ${ORIGIN}/advice/search?q=%D1%81%D1%8B%D1%80#top:12:3`, ORIGIN)).toBe(
      'at <anonymous> (?)',
    )
    expect(phoneFrame(`at f (${ORIGIN}/:1:2)`, ORIGIN)).toBe('at f (?)')
  })

  it('чужой origin, расширение, native и eval — «?»', () => {
    expect(phoneFrame('at a (https://evil.example/x.js:1:2)', ORIGIN)).toBe('at a (?)')
    expect(phoneFrame('at a (https://molvia.net.evil.example/x.js:1:2)', ORIGIN)).toBe('at a (?)')
    expect(phoneFrame('b@chrome-extension://abc/content.js:1:2', ORIGIN)).toBe('at b (?)')
    expect(phoneFrame('at Array.map (<anonymous>)', ORIGIN)).toBe('at Array.map (?)')
    expect(
      phoneFrame('at eval (eval at f (https://molvia.net/a.js:1:2), <anonymous>:1:1)', ORIGIN),
    ).toBe('at eval (?)')
  })

  it('строка, которая не кадр, не даёт ничего', () => {
    expect(phoneFrame('[native code]', ORIGIN)).toBeUndefined()
    expect(phoneFrame('global code', ORIGIN)).toBeUndefined()
  })

  it('функция, похожая на текст, — «?»', () => {
    expect(phoneFrame('Аня платила 5000@https://molvia.net/a.js:1:2', ORIGIN)).toBe(
      'at ? (/a.js:1:2)',
    )
    expect(phoneFrame('I paid@https://molvia.net/a.js:1:2', ORIGIN)).toBe('at ? (/a.js:1:2)')
  })

  it('свой кадр от чужого отличим', () => {
    expect(ownFrame('at Xe (/assets/index-BTCsHrpw.js:1:2)')).toBe(true)
    expect(ownFrame('at Xe (?)')).toBe(false)
  })
})

describe('describePhoneFailure — сбой телефона по виду (MOL-144)', () => {
  it('стек Safari без заголовка даёт кадры', () => {
    const error = new TypeError("undefined is not an object (evaluating 'a.price')")
    error.stack = [
      'Xe@https://molvia.net/assets/index-BTCsHrpw.js:1:48213',
      '[native code]',
      'Qt@https://molvia.net/assets/index-BTCsHrpw.js:1:51002',
    ].join('\n')
    expect(describePhoneFailure(error, ORIGIN)).toEqual({
      errorName: 'TypeError',
      frames: [
        'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
        'at Qt (/assets/index-BTCsHrpw.js:1:51002)',
      ],
    })
  })

  it('стек Chrome: заголовок срезан, кадры приведены', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'price')")
    error.stack = `TypeError: ${error.message}\n    at Xe (https://molvia.net/assets/index-BTCsHrpw.js:1:48213)`
    expect(describePhoneFailure(error, ORIGIN).frames).toEqual([
      'at Xe (/assets/index-BTCsHrpw.js:1:48213)',
    ])
  })

  it('стек, где встретилось сообщение, кадров не даёт', () => {
    const error = new Error(REVIEW)
    error.stack = `Something else\n${REVIEW}\nXe@https://molvia.net/a.js:1:2`
    expect(describePhoneFailure(error, ORIGIN)).toEqual({ errorName: 'Error' })
  })

  it('ни message, ни текст отзыва не уходят никуда', () => {
    const error = new Error('Купить сыр «Ширакаци»')
    error.stack = `${FORGED}\nXe@https://molvia.net/a.js:1:2`
    expect(JSON.stringify(describePhoneFailure(error, ORIGIN))).not.toMatch(
      /сыр|Ширакаци|ЭтогоКадра|secrets/,
    )
  })

  it('кадров не больше восьми', () => {
    const error = new Error('deep')
    error.stack = Array.from(
      { length: 12 },
      (_, i) => `f${String(i)}@https://molvia.net/a.js:1:1`,
    ).join('\n')
    expect(describePhoneFailure(error, ORIGIN).frames).toHaveLength(8)
  })
})
