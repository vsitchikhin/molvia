import { describe, expect, it } from 'vitest'
import type { FailureOccurrence } from '@/db/failures-repository'
import { framePlace, noticesFor, occurrenceOf } from './record-failure'

const BUILD = 'v0.2.0-4-gabc1234'
const OWNER = 4242

describe('framePlace — кадр без строки и колонки (Р-2)', () => {
  it.each([
    ['at rateItem (file:///app/dist/index.js:48213:7)', 'at rateItem (file:///app/dist/index.js)'],
    ['at file:///app/dist/index.js:48213:7', 'at file:///app/dist/index.js'],
    [
      'at rateItem (/app/src/usecases/rate-item.ts:42:7)',
      'at rateItem (/app/src/usecases/rate-item.ts)',
    ],
    ['at async Promise.all (index 0)', 'at async Promise.all (index 0)'],
    ['at new Thing (<anonymous>)', 'at new Thing (<anonymous>)'],
  ])('%s', (frame, place) => {
    expect(framePlace(frame)).toBe(place)
  })
})

describe('occurrenceOf — отпечаток', () => {
  const summary = {
    errorName: 'TypeError',
    frames: [
      'at rateItem (file:///app/dist/index.js:48213:7)',
      'at next (file:///app/dist/index.js:1:1)',
    ],
  }
  const place = { source: 'api', route: 'PUT /verdicts/:itemId' } as const

  it('другая позиция верхнего кадра и другая сборка — тот же отпечаток', () => {
    const moved = { ...summary, frames: ['at rateItem (file:///app/dist/index.js:50001:3)'] }
    expect(occurrenceOf(moved, place, 'v0.2.0-5-gfff').fingerprint).toBe(
      occurrenceOf(summary, place, BUILD).fingerprint,
    )
  })

  it.each([
    ['маршрут', { ...summary }, { source: 'api', route: 'GET /advice' }],
    ['источник', { ...summary }, { source: 'bot', route: 'PUT /verdicts/:itemId' }],
    ['вид', { ...summary, errorName: 'RangeError' }, place],
    ['код', { ...summary, code: '57P01' }, place],
    [
      'функция в верхнем кадре',
      { ...summary, frames: ['at amend (file:///app/dist/index.js:1:1)'] },
      place,
    ],
  ] as const)('другой %s — другой отпечаток', (_what, other, otherPlace) => {
    expect(occurrenceOf(other, otherPlace, BUILD).fingerprint).not.toBe(
      occurrenceOf(summary, place, BUILD).fingerprint,
    )
  })

  it('вид, который не похож на имя класса, приводится к нему', () => {
    const sentence = 'Ошибка с текстом'
    expect(occurrenceOf({ errorName: sentence }, place, BUILD).errorName).toBe(
      '_'.repeat(sentence.length),
    )
    expect(occurrenceOf({ errorName: '' }, place, BUILD).errorName).toBe('unknown')
  })

  it('кадры и маршрут обрезаются по пределам таблицы', () => {
    const long = occurrenceOf(
      { errorName: 'Error', frames: Array.from({ length: 12 }, () => `at ${'x'.repeat(400)}`) },
      { source: 'api', route: `GET /${'y'.repeat(300)}` },
      BUILD,
    )
    expect(long.frames).toHaveLength(8)
    expect(long.frames.every((frame) => frame.length === 300)).toBe(true)
    expect(long.route).toHaveLength(200)
  })

  it('без маршрута — без маршрута, а не пустая строка', () => {
    expect(occurrenceOf({ errorName: 'Error' }, { source: 'api' }, BUILD)).not.toHaveProperty(
      'route',
    )
  })
})

describe('noticesFor — что услышит владелец (В-2, В-5)', () => {
  const occurrence: FailureOccurrence = {
    fingerprint: 'abcdef0123456789'.repeat(4),
    source: 'api',
    errorName: 'TypeError',
    route: 'PUT /verdicts/:itemId',
    frames: ['at rateItem (src/usecases/rate-item.ts:42:7)'],
    build: BUILD,
  }

  it('первый раз в сборке — сообщение с кадром и началом отпечатка', () => {
    expect(noticesFor(occurrence, { count: 7, buildCount: 1 }, OWNER)).toEqual([
      {
        kind: 'failure',
        source: 'api',
        errorName: 'TypeError',
        route: 'PUT /verdicts/:itemId',
        build: BUILD,
        frame: 'at rateItem (src/usecases/rate-item.ts:42:7)',
        fingerprint: 'abcdef',
      },
    ])
  })

  it.each([10, 100, 1000] as const)('ровно %i в сборке — сообщение о счёте', (buildCount) => {
    expect(noticesFor(occurrence, { count: buildCount + 5, buildCount }, OWNER)).toEqual([
      expect.objectContaining({ kind: 'failure_count', count: buildCount }),
    ])
  })

  it.each([2, 9, 11, 99, 101, 999, 1001, 10_000])('%i в сборке — тишина', (buildCount) => {
    expect(noticesFor(occurrence, { count: buildCount, buildCount }, OWNER)).toEqual([])
  })

  it('без владельца — ничего, даже впервые', () => {
    expect(noticesFor(occurrence, { count: 1, buildCount: 1 }, null)).toEqual([])
    expect(noticesFor(occurrence, { count: 10, buildCount: 10 }, null)).toEqual([])
  })
})
