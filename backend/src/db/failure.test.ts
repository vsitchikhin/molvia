import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { describeFailure } from '@molvia/model'
import { describeMigrationFailure } from './failure'

/** A review of the kind MOL-27 allows: several lines, one of them written as a stack frame. */
const REVIEW = 'Вкусно, но дорого\n    at Аня, ул. Ширакаци 12, платила 5000 драм'

function driverFailure(params: unknown[]): DrizzleQueryError {
  const cause = Object.assign(new Error('new row violates check constraint'), { code: '23514' })
  return new DrizzleQueryError('insert into verdicts values ($1, $2)', params, cause)
}

describe('describeFailure — на настоящей обёртке drizzle (MOL-58)', () => {
  // The rule lives in the domain (MOL-143, Р-1), which may not import drizzle: this is the one case
  // that holds it to the real wrapper — the query and the parameters in its message.
  it('строка отзыва, похожая на кадр стека, в кадры не попадает', () => {
    const summary = describeFailure(driverFailure([REVIEW, '1f0e2c4a-uuid']))
    const logged = JSON.stringify(summary)

    expect(logged).not.toMatch(/Ширакаци|Вкусно|1f0e2c4a/)
    expect(summary.code).toBe('23514')
    expect(summary.frames?.[0]).toMatch(/^at .*failure\.test\.ts/)
  })
})

describe('describeMigrationFailure — вид и упавшая инструкция или файл, без значения строки (MOL-153)', () => {
  it('у запроса с параметрами инструкции нет: это не миграция, параметры — чьи-то', () => {
    const summary = describeMigrationFailure(driverFailure([REVIEW, 5]))
    expect(summary).not.toHaveProperty('statement')
    expect(summary).toMatchObject({ errorName: 'Error', code: '23514' })
    expect(JSON.stringify(summary)).not.toContain('Вкусно')
  })

  it('ответ базы без обёртки — по виду: у него есть код, а в сообщении значение строки', () => {
    const refused = Object.assign(new Error(`invalid input syntax for type numeric: "${REVIEW}"`), {
      code: '22P02',
    })
    const summary = describeMigrationFailure(refused)
    expect(summary).toMatchObject({ errorName: 'Error', code: '22P02' })
    expect(summary).not.toHaveProperty('reason')
    expect(JSON.stringify(summary)).not.toContain('Вкусно')
  })
})
