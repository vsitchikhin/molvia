import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FailureCount, FailureOccurrence, FailureRepository } from '@/db/failures-repository'
import { ERROR } from '@molvia/model'
import type { OwnerNotice, PhoneFailure } from '@molvia/model'
import {
  PHONE_REPORTS_PER_ADDRESS,
  PHONE_NOTICES_PER_HOUR,
  PHONE_NOTICES_PER_SENDER,
  PHONE_REPORTS_PER_MINUTE,
  PHONE_ROWS_PER_HOUR,
  PHONE_ROWS_PER_SENDER,
  framePlace,
  noticesFor,
  occurrenceOf,
  phoneFailure,
  phoneNoticeBudget,
  phoneReportLimit,
  phoneRowBudget,
  recordFailure,
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

describe('phoneReportLimit — предел в памяти (MOL-144, Р-6); сам счётчик — address-minute.test.ts', () => {
  it(`с адреса — ${String(PHONE_REPORTS_PER_ADDRESS)} в минуту, ровно и на один больше`, () => {
    const limit = phoneReportLimit()
    expect(limit('a', PHONE_REPORTS_PER_ADDRESS - 1)).toBe(true)
    expect(limit('a', 1)).toBe(true)
    expect(limit('a', 1)).toBe(false)
    expect(limit('b', 1)).toBe(true)
  })

  it(`со всех — ${String(PHONE_REPORTS_PER_MINUTE)} в минуту`, () => {
    const limit = phoneReportLimit()
    const addresses = PHONE_REPORTS_PER_MINUTE / PHONE_REPORTS_PER_ADDRESS
    for (let host = 0; host < Math.floor(addresses); host += 1) {
      expect(limit(`198.51.100.${String(host)}`, PHONE_REPORTS_PER_ADDRESS)).toBe(true)
    }
    const left = PHONE_REPORTS_PER_MINUTE % PHONE_REPORTS_PER_ADDRESS
    expect(limit('203.0.113.1', left)).toBe(true)
    expect(limit('203.0.113.2', 1)).toBe(false)
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
      )
    }).toThrow(expect.objectContaining({ code: ERROR.CLIENT_ERRORS_RATE_LIMITED }))
    expect(taken).toEqual([])
  })
})

describe('отпечаток телефона живёт в своей сборке (MOL-144, Р-10, ревью №1)', () => {
  it('та же ошибка в другой сборке — другой отпечаток: старая и новая страница не сбрасывают счёт друг другу', () => {
    const fingerprint = (build: string) => {
      // No frame, as a registration's DOMException: nothing of the build in the top frame.
      const { frames, ...bare } = REPORT
      expect(frames).toHaveLength(1)
      const { summary, place } = phoneFailure(bare)
      return occurrenceOf(summary, place, build).fingerprint
    }
    expect(fingerprint('index-OldBuild1')).not.toBe(fingerprint('index-NewBuild2'))
  })
})

/** A clock the test moves: the budgets read the hour by it, never by the wall clock (MOL-359, Б1). */
function testClock() {
  const clock = { at: 0 }
  return { clock, read: () => clock.at }
}
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const NOW = new Date(Date.UTC(2026, 9, 3, 12, 0))

describe('phoneNoticeBudget — уведомления о телефоне (ревью №1, №7, адверсариальный Б1)', () => {
  const notice = (index: number): OwnerNotice => ({
    kind: 'failure',
    source: 'phone',
    errorName: `E${String(index)}`,
    build: 'index-BTCsHrpw',
    platform: 'ios 18 app',
    fingerprint: 'abcdef',
  })
  /** A budget of these numbers on a clock of its own, and a way to set the minute. */
  function onClock(perHour = PHONE_NOTICES_PER_HOUR, perSender = PHONE_NOTICES_PER_SENDER) {
    const { clock, read } = testClock()
    const budget = phoneNoticeBudget(perHour, perSender, undefined, read)
    return {
      budget,
      at: (minutes: number) => {
        clock.at = minutes * MINUTE_MS
      },
    }
  }

  it(`одному отправителю — ${String(PHONE_NOTICES_PER_SENDER)} в час: выдуманные с одного адреса не глушат чужой сбой (Б1)`, () => {
    const { budget, at } = onClock()
    const invented = Array.from({ length: 10 }, (_, index) =>
      budget.take([notice(index)], 'liar'),
    ).flat()
    expect(invented).toHaveLength(PHONE_NOTICES_PER_SENDER)
    at(5)
    expect(budget.take([notice(99)], 'phone')).toEqual([notice(99)])
  })

  it(`всем вместе — ${String(PHONE_NOTICES_PER_HOUR)} в час, сверх — молча считаются`, () => {
    const { budget, at } = onClock()
    at(1)
    const told = Array.from({ length: PHONE_NOTICES_PER_HOUR + 3 }, (_, index) =>
      budget.take([notice(index)], `sender${String(index)}`),
    ).flat()
    expect(told).toHaveLength(PHONE_NOTICES_PER_HOUR)
  })

  it('сводка — поверх потолка и раз в час: семь сетей, держащие потолок, её не глушат (раунд 3, В2)', () => {
    const { budget, at } = onClock()
    at(1)
    for (let index = 0; index < PHONE_NOTICES_PER_HOUR + 3; index += 1) {
      budget.take([notice(index)], `sender${String(index)}`)
    }
    at(2)
    expect(budget.held()).toEqual({ kind: 'failure_muted', source: 'phone', count: 3 })
    at(3)
    budget.take([notice(99)], 'late')
    at(4)
    expect(budget.held()).toBeNull()
    at(62)
    expect(budget.held()).toEqual({ kind: 'failure_muted', source: 'phone', count: 1 })
  })

  it('незаписанные новые сбои названы той же сводкой (раунд 3, В1)', () => {
    const { budget } = onClock()
    budget.unwritten()
    budget.unwritten()
    expect(budget.held()).toEqual({
      kind: 'failure_muted',
      source: 'phone',
      count: 0,
      unwritten: 2,
    })
  })

  it('скрытое названо таймером, как только в часе есть место, — один раз (ревью №7, Б1б)', () => {
    const { budget, at } = onClock(PHONE_NOTICES_PER_HOUR, 1)
    budget.take([notice(1), notice(2), notice(3)], 'one')
    at(1)
    expect(budget.held()).toEqual({ kind: 'failure_muted', source: 'phone', count: 2 })
    at(2)
    expect(budget.held()).toBeNull()
  })

  it('волна сверх часа и тишина: скрытые сказаны таймером, без нового сбоя', () => {
    const { budget, at } = onClock(10, 10)
    for (let index = 0; index <= 10; index += 1) {
      at(index)
      budget.take([notice(index)], 'same')
    }
    at(30)
    expect(budget.held()).toEqual({ kind: 'failure_muted', source: 'phone', count: 1 })
    at(125)
    expect(budget.held()).toBeNull()
  })

  it('giveBack возвращает места своей выдачи, а не соседней (Б1)', () => {
    const { budget, at } = onClock(PHONE_NOTICES_PER_HOUR, 2)
    const early = budget.ask([notice(1)], 'one')
    at(50)
    expect(budget.take([notice(2)], 'one')).toEqual([notice(2)])
    early.giveBack()
    expect(budget.take([notice(3)], 'one')).toEqual([notice(3)])
    // The place given back was the one of minute 0: at 60 nothing more leaves the hour.
    at(60)
    expect(budget.take([notice(4)], 'one')).toEqual([])
  })

  it('час — по часам, которые не ходят назад: стенные часы, шагнувшие на час вперёд, места не дают (Б1)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    try {
      const budget = phoneNoticeBudget()
      for (let index = 0; index < PHONE_NOTICES_PER_SENDER; index += 1) {
        budget.take([notice(index)], 'liar')
      }
      vi.setSystemTime(Date.now() + 61 * MINUTE_MS)
      vi.advanceTimersByTime(1_000)
      expect(budget.take([notice(9)], 'liar')).toEqual([])
      vi.advanceTimersByTime(HOUR_MS)
      expect(budget.take([notice(9)], 'liar')).toEqual([notice(9)])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('phoneRowBudget — новые строки телефона (ревью №6, №8, раунд 3, В1)', () => {
  it(`одному отправителю — ${String(PHONE_ROWS_PER_SENDER)} в час: два адреса не стирают чужой сбой`, () => {
    const { clock, read } = testClock()
    const rows = phoneRowBudget(PHONE_ROWS_PER_HOUR, PHONE_ROWS_PER_SENDER, read)
    for (let index = 0; index < PHONE_ROWS_PER_SENDER; index += 1) {
      expect(rows.claim('liar')).not.toBeNull()
    }
    expect(rows.claim('liar')).toBeNull()
    expect(rows.claim('phone')).not.toBeNull()
    clock.at = HOUR_MS
    expect(rows.claim('liar')).not.toBeNull()
  })

  it('транзакция, упавшая после выдачи уведомлений, их возвращает (раунд 5)', async () => {
    const budget = phoneNoticeBudget(10, 1)
    const { summary, place, build } = phoneFailure(REPORT)
    const failsAfter = {
      record: (
        _occurrence: unknown,
        _times: number,
        _at: Date,
        notices: (count: { count: number; buildCount: number }) => unknown,
      ) => {
        notices({ count: 1, buildCount: 1 })
        return Promise.reject(new Error('commit failed'))
      },
    } as unknown as FailureRepository
    await expect(
      recordFailure(
        { failures: failsAfter, owner: OWNER, phoneNotices: budget },
        occurrenceOf(summary, place, build),
        1,
        NOW,
        'one',
      ),
    ).rejects.toThrow('commit failed')
    const notice: OwnerNotice = {
      kind: 'failure',
      source: 'phone',
      errorName: 'TypeError',
      build,
      platform: 'ios 18 app',
      fingerprint: 'abcdef',
    }
    expect(budget.take([notice], 'one')).toEqual([notice])
  })

  it('придержанное уведомление упавшей записи не попадает в «скрыто» (адверсариальный Е1)', async () => {
    const budget = phoneNoticeBudget(10, 0)
    const { summary, place, build } = phoneFailure(REPORT)
    const failsAfter = {
      record: (
        _occurrence: unknown,
        _times: number,
        _at: Date,
        notices: (count: { count: number; buildCount: number }) => unknown,
      ) => {
        notices({ count: 1, buildCount: 1 })
        return Promise.reject(new Error('could not insert the notice'))
      },
    } as unknown as FailureRepository
    await expect(
      recordFailure(
        { failures: failsAfter, owner: OWNER, phoneNotices: budget },
        occurrenceOf(summary, place, build),
        1,
        NOW,
        'one',
      ),
    ).rejects.toThrow('could not insert the notice')
    expect(budget.held()).toBeNull()
  })

  it('сводка не называет запись в полёте, а упавшая не съедает чужое «скрыто» (адверсариальный Ж1)', async () => {
    const { clock, read } = testClock()
    const budget = phoneNoticeBudget(10, 0, undefined, read)
    const { summary, place, build } = phoneFailure(REPORT)
    let fail: () => void = () => undefined
    const failed = new Promise<void>((resolve) => {
      fail = resolve
    })
    const slow = {
      record: async (
        _occurrence: unknown,
        _times: number,
        _at: Date,
        notices: (count: FailureCount) => unknown,
      ) => {
        notices({ count: 1, buildCount: 1 })
        await failed
        throw new Error('could not insert the notice')
      },
    } as unknown as FailureRepository
    const writing = {
      record: (
        _occurrence: unknown,
        _times: number,
        _at: Date,
        notices: (count: FailureCount) => unknown,
      ) => {
        notices({ count: 1, buildCount: 1 })
        return Promise.resolve({ count: 1, buildCount: 1 })
      },
    } as unknown as FailureRepository
    const a = recordFailure(
      { failures: slow, owner: OWNER, phoneNotices: budget },
      occurrenceOf(summary, place, build),
      1,
      NOW,
      'one',
    )
    // A is still in flight: the minute timer tells nothing of it.
    clock.at = MINUTE_MS
    expect(budget.held()).toBeNull()
    await recordFailure(
      { failures: writing, owner: OWNER, phoneNotices: budget },
      occurrenceOf({ ...summary, errorName: 'B' }, place, build),
      1,
      NOW,
      'one',
    )
    fail()
    await expect(a).rejects.toThrow('could not insert the notice')
    // B was held back and written: it is the one told.
    clock.at = 2 * MINUTE_MS
    expect(budget.held()).toEqual({
      kind: 'failure_muted',
      source: 'phone',
      count: 1,
    })
  })

  it('запись, которая упала, возвращает своё место (ревью №9)', async () => {
    const rows = phoneRowBudget(10, 1)
    const { summary, place, build } = phoneFailure(REPORT)
    const broken = {
      record: () => Promise.reject(new Error('connection refused')),
    } as unknown as FailureRepository
    await expect(
      recordFailure(
        { failures: broken, owner: null, phoneRows: rows },
        occurrenceOf(summary, place, build),
        1,
        NOW,
        'one',
      ),
    ).rejects.toThrow('connection refused')
    expect(rows.claim('one')).not.toBeNull()
  })

  it('место, взятое под строку, которая уже была, возвращается', () => {
    const rows = phoneRowBudget(10, 1)
    const giveBack = rows.claim('one')
    expect(giveBack).not.toBeNull()
    giveBack?.()
    expect(rows.claim('one')).not.toBeNull()
  })

  it('возвращается своё место, а не соседнее: место, отпущенное часом, — ничего (Б1)', () => {
    const { clock, read } = testClock()
    const rows = phoneRowBudget(10, 2, read)
    const early = rows.claim('one')
    clock.at = 50 * MINUTE_MS
    expect(rows.claim('one')).not.toBeNull()
    early?.()
    expect(rows.claim('one')).not.toBeNull()
    clock.at = HOUR_MS
    expect(rows.claim('one')).toBeNull()
    const gone = rows.claim('two')
    clock.at = 2 * HOUR_MS + 1
    expect(rows.claim('two')).not.toBeNull()
    expect(rows.claim('two')).not.toBeNull()
    gone?.()
    expect(rows.claim('two')).toBeNull()
  })

  it(`всем вместе — ${String(PHONE_ROWS_PER_HOUR)} в час`, () => {
    const rows = phoneRowBudget(30, 10)
    for (let index = 0; index < 30; index += 1) rows.claim(`sender${String(index % 3)}`)
    expect(rows.claim('fresh')).toBeNull()
  })

  it('час — по часам, которые не ходят назад: стенные часы назад на десять минут не держат адрес дольше часа (Б1)', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance'] })
    try {
      const rows = phoneRowBudget()
      for (let index = 0; index < PHONE_ROWS_PER_SENDER; index += 1) rows.claim('liar')
      vi.setSystemTime(Date.now() - 10 * MINUTE_MS)
      vi.advanceTimersByTime(HOUR_MS)
      expect(rows.claim('liar')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('forget — адрес телефона уходит из памяти через час после сбоя (MOL-241)', () => {
  const notice: OwnerNotice = {
    kind: 'failure',
    source: 'phone',
    errorName: 'E',
    build: 'index-BTCsHrpw',
    platform: 'ios 18 app',
    fingerprint: 'abcdef',
  }

  /** The Maps a budget keeps inside itself, caught by their `set`, as adversarial А3 of MOL-97 did. */
  function memory(): { readonly moments: (sender: string) => unknown } {
    const spy = vi.spyOn(Map.prototype, 'set')
    return {
      moments: (sender) =>
        (spy.mock.contexts as Map<unknown, unknown>[]).find((map) => map.has(sender))?.get(sender),
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('phoneRowBudget', () => {
    it('адрес через час и минуту ушёл', () => {
      const kept = memory()
      const { clock, read } = testClock()
      const rows = phoneRowBudget(PHONE_ROWS_PER_HOUR, PHONE_ROWS_PER_SENDER, read)
      expect(rows.claim('203.0.113.7')).not.toBeNull()
      clock.at = HOUR_MS + MINUTE_MS
      rows.forget()
      expect(kept.moments('203.0.113.7')).toBeUndefined()
    })

    it('граница: ровно через час ушёл, за миллисекунду до часа остался', () => {
      const kept = memory()
      const { clock, read } = testClock()
      const rows = phoneRowBudget(PHONE_ROWS_PER_HOUR, PHONE_ROWS_PER_SENDER, read)
      rows.claim('old')
      clock.at = 1
      rows.claim('young')
      clock.at = HOUR_MS
      rows.forget()
      expect(kept.moments('old')).toBeUndefined()
      expect(kept.moments('young')).toEqual([{ at: 1 }])
    })

    it('уборка не возвращает мест раньше часа: шестьдесят первая строка — всё ещё отказ', () => {
      const { clock, read } = testClock()
      const rows = phoneRowBudget(PHONE_ROWS_PER_HOUR, PHONE_ROWS_PER_SENDER, read)
      for (let index = 0; index < PHONE_ROWS_PER_SENDER; index += 1) rows.claim('liar')
      clock.at = HOUR_MS / 2
      rows.forget()
      expect(rows.claim('liar')).toBeNull()
      expect(rows.claim('phone')).not.toBeNull()
    })

    it('известный отпечаток — место взято и возвращено — не оставляет адреса', () => {
      const kept = memory()
      const rows = phoneRowBudget()
      rows.claim('known')?.()
      expect(kept.moments('known')).toEqual([])
      rows.forget()
      expect(kept.moments('known')).toBeUndefined()
    })

    it('запись, упавшая вместе с базой, не оставляет адреса после уборки', async () => {
      const kept = memory()
      const rows = phoneRowBudget()
      const { summary, place, build } = phoneFailure(REPORT)
      const broken = {
        record: () => Promise.reject(new Error('connection refused')),
      } as unknown as FailureRepository
      await expect(
        recordFailure(
          { failures: broken, owner: null, phoneRows: rows },
          occurrenceOf(summary, place, build),
          1,
          NOW,
          'one',
        ),
      ).rejects.toThrow('connection refused')
      rows.forget()
      expect(kept.moments('one')).toBeUndefined()
    })
  })

  describe('phoneNoticeBudget', () => {
    it('адрес через час ушёл, адрес внутри часа остался', () => {
      const kept = memory()
      const { clock, read } = testClock()
      const notices = phoneNoticeBudget(
        PHONE_NOTICES_PER_HOUR,
        PHONE_NOTICES_PER_SENDER,
        undefined,
        read,
      )
      notices.take([notice], 'old')
      clock.at = HOUR_MS / 2
      notices.take([notice], 'young')
      clock.at = HOUR_MS
      notices.forget()
      expect(kept.moments('old')).toBeUndefined()
      expect(kept.moments('young')).toEqual([{ at: HOUR_MS / 2 }])
    })

    it('адрес без единого уведомления — владельца нет — уходит тоже', () => {
      const kept = memory()
      const notices = phoneNoticeBudget()
      notices.take([], 'silent')
      expect(kept.moments('silent')).toEqual([])
      notices.forget()
      expect(kept.moments('silent')).toBeUndefined()
    })

    it(`уборка не возвращает уведомлений раньше часа: четвёртое — скрыто`, () => {
      const { clock, read } = testClock()
      const notices = phoneNoticeBudget(
        PHONE_NOTICES_PER_HOUR,
        PHONE_NOTICES_PER_SENDER,
        undefined,
        read,
      )
      for (let index = 0; index < PHONE_NOTICES_PER_SENDER; index += 1) {
        notices.take([notice], 'liar')
      }
      clock.at = HOUR_MS / 2
      notices.forget()
      expect(notices.take([notice], 'liar')).toEqual([])
      expect(notices.held()).toEqual({
        kind: 'failure_muted',
        source: 'phone',
        count: 1,
      })
    })
  })
})
