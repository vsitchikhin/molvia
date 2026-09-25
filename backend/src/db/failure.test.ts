import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { describeFailure } from './failure'

/** A review of the kind MOL-27 allows: several lines, one of them written as a stack frame. */
const REVIEW = 'Вкусно, но дорого\n    at Аня, ул. Ширакаци 12, платила 5000 драм'
const FORGED = '    at ЭтогоКадраНетНиВОдномФайле (secrets.ts:1:1)'

function driverFailure(params: unknown[]): DrizzleQueryError {
  const cause = Object.assign(new Error('new row violates check constraint'), { code: '23514' })
  return new DrizzleQueryError('insert into verdicts values ($1, $2)', params, cause)
}

describe('describeFailure — вид сбоя без слова из его содержимого (MOL-58)', () => {
  // Adversarial П-1: lines were picked by their shape, and a person's text can take that shape.
  it('строка отзыва, похожая на кадр стека, в кадры не попадает', () => {
    const summary = describeFailure(driverFailure([REVIEW, '1f0e2c4a-uuid']))
    const logged = JSON.stringify(summary)

    expect(logged).not.toMatch(/Ширакаци|Вкусно|1f0e2c4a/)
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
})
