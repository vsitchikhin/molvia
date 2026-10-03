import { describe, expect, it } from 'vitest'
import { describeFailure, failureCodeOf } from '#model/support/failure'

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
