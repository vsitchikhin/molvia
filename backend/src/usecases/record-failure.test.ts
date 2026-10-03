import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { FailureOccurrence } from '@/db/failures-repository'
import { ERROR } from '@molvia/model'
import type { PhoneFailure } from '@molvia/model'
import {
  PHONE_REPORTS_PER_ADDRESS,
  PHONE_REPORTS_PER_MINUTE,
  framePlace,
  noticesFor,
  occurrenceOf,
  phoneFailure,
  phoneReportLimit,
  takePhoneFailures,
} from './record-failure'

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

  it('отпечаток — от кадра до обрезки: срез на «:строка:» не оставляет позицию (А6)', () => {
    const at = (line: number) =>
      `at handler (/app/${'p'.repeat(270)}/dist/index.js:${String(line)}:7)`
    expect(
      occurrenceOf({ errorName: 'TypeError', frames: [at(48213)] }, place, 'b1').fingerprint,
    ).toBe(occurrenceOf({ errorName: 'TypeError', frames: [at(48250)] }, place, 'b2').fingerprint)
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
    expect(noticesFor(occurrence, { count: 7, buildCount: 1 }, 1, OWNER)).toEqual([
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
    expect(noticesFor(occurrence, { count: buildCount + 5, buildCount }, 1, OWNER)).toEqual([
      expect.objectContaining({ kind: 'failure_count', count: buildCount }),
    ])
  })

  it.each([2, 9, 11, 99, 101, 999, 1001, 10_000])('%i в сборке — тишина', (buildCount) => {
    expect(noticesFor(occurrence, { count: buildCount, buildCount }, 1, OWNER)).toEqual([])
  })

  it('всплеск одной записью: 3 → 150 перешёл и 10, и 100 — владелец слышит большее (А1)', () => {
    expect(noticesFor(occurrence, { count: 150, buildCount: 150 }, 147, OWNER)).toEqual([
      expect.objectContaining({ kind: 'failure_count', count: 100 }),
    ])
  })

  it('первая же запись — пачка из 12: «новый сбой» и «уже 10»', () => {
    expect(
      noticesFor(occurrence, { count: 12, buildCount: 12 }, 12, OWNER).map((notice) => notice.kind),
    ).toEqual(['failure', 'failure_count'])
  })

  it('порог ровно на краю пачки считается, сразу за ним — нет', () => {
    expect(noticesFor(occurrence, { count: 10, buildCount: 10 }, 4, OWNER)).toHaveLength(1)
    expect(noticesFor(occurrence, { count: 14, buildCount: 14 }, 4, OWNER)).toEqual([])
  })

  it('без владельца — ничего, даже впервые', () => {
    expect(noticesFor(occurrence, { count: 1, buildCount: 1 }, 1, null)).toEqual([])
    expect(noticesFor(occurrence, { count: 10, buildCount: 10 }, 1, null)).toEqual([])
  })
})

const REPORT: PhoneFailure = {
  errorName: 'TypeError',
  frames: ['at Xe (/assets/index-BTCsHrpw.js:1:48213)'],
  catcher: 'screen',
  screen: 'advice',
  build: 'index-BTCsHrpw',
  platform: 'ios 18 app',
}

describe('phoneFailure — сбой телефона (MOL-144)', () => {
  it('место — ловушка и экран, сборка — страницы, платформа — с местом', () => {
    expect(phoneFailure(REPORT)).toEqual({
      summary: { errorName: 'TypeError', frames: REPORT.frames },
      place: { source: 'phone', route: 'screen:advice', platform: 'ios 18 app' },
      build: 'index-BTCsHrpw',
    })
  })

  it('система входит в отпечаток, версия и вид запуска — нет (В-2)', () => {
    const fingerprint = (platform: string) => {
      const { summary, place, build } = phoneFailure({ ...REPORT, platform })
      return occurrenceOf(summary, place, build).fingerprint
    }
    expect(fingerprint('ios 26 browser')).toBe(fingerprint('ios 18 app'))
    expect(fingerprint('android app')).not.toBe(fingerprint('ios 18 app'))
  })

  it('отпечаток API без платформы прежний: строки MOL-143 не стали новыми', () => {
    const summary = { errorName: 'TypeError', frames: ['at f (file:///app/dist/index.js:1:1)'] }
    const before = occurrenceOf(summary, { source: 'api', route: 'GET /x' }, BUILD)
    const formula = ['api', 'TypeError', '', 'at f (file:///app/dist/index.js)', 'GET /x']
    expect(before.fingerprint).toBe(
      createHash('sha256').update(formula.join('\u0000')).digest('hex'),
    )
    expect(before).not.toHaveProperty('platform')
  })

  it('уведомление владельцу называет платформу', () => {
    const { summary, place, build } = phoneFailure(REPORT)
    const occurrence = occurrenceOf(summary, place, build)
    expect(noticesFor(occurrence, { count: 1, buildCount: 1 }, 1, OWNER)).toEqual([
      expect.objectContaining({ source: 'phone', build: 'index-BTCsHrpw', platform: 'ios 18 app' }),
    ])
  })
})

describe('phoneReportLimit — предел в памяти (MOL-144, Р-6)', () => {
  it(`с адреса — ${String(PHONE_REPORTS_PER_ADDRESS)} в минуту, ровно и на один больше`, () => {
    const limit = phoneReportLimit()
    expect(limit('a', PHONE_REPORTS_PER_ADDRESS - 1, 0)).toBe(true)
    expect(limit('a', 1, 1)).toBe(true)
    expect(limit('a', 1, 2)).toBe(false)
    expect(limit('b', 1, 2)).toBe(true)
    expect(limit('a', 1, 60_000)).toBe(true)
  })

  it(`со всех — ${String(PHONE_REPORTS_PER_MINUTE)} в минуту`, () => {
    const limit = phoneReportLimit(PHONE_REPORTS_PER_ADDRESS, 30)
    expect(limit('a', 20, 0)).toBe(true)
    expect(limit('b', 10, 0)).toBe(true)
    expect(limit('c', 1, 0)).toBe(false)
  })

  it('отказ не считается', () => {
    const limit = phoneReportLimit(5, 100)
    expect(limit('a', 6, 0)).toBe(false)
    expect(limit('a', 5, 0)).toBe(true)
  })
})

describe('takePhoneFailures', () => {
  it('в пределе каждый отчёт уходит со своей сборкой', () => {
    const taken: string[] = []
    takePhoneFailures(
      {
        limit: () => true,
        take: (_summary, place, build) => taken.push(`${place.route ?? ''} ${build}`),
      },
      { reports: [REPORT, { ...REPORT, catcher: 'vue', build: 'index-OldBuild1' }] },
      'a',
      0,
    )
    expect(taken).toEqual(['screen:advice index-BTCsHrpw', 'vue:advice index-OldBuild1'])
  })

  it('сверх предела — отказ целиком, в таблицу ничего', () => {
    const taken: unknown[] = []
    expect(() => {
      takePhoneFailures(
        { limit: () => false, take: (...args) => taken.push(args) },
        { reports: [REPORT] },
        'a',
        0,
      )
    }).toThrow(expect.objectContaining({ code: ERROR.CLIENT_ERRORS_RATE_LIMITED }))
    expect(taken).toEqual([])
  })
})
