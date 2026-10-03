import { describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import type { FailureOccurrence } from '@/db/failures-repository'
import { RECORDINGS_AT_ONCE, failureReporter } from './failure-reporter'

function fakeLog() {
  const error = vi.fn()
  return { log: { error } as unknown as FastifyBaseLogger, error }
}

/** A write held until released, so what waits behind it can be seen. */
function heldWrites() {
  const writes: { occurrence: FailureOccurrence; times: number; release: () => void }[] = []
  const write = vi.fn(
    (occurrence: FailureOccurrence, times: number) =>
      new Promise<void>((resolve) => {
        writes.push({ occurrence, times, release: resolve })
      }),
  )
  return { write, writes }
}

const at = (route: string) => ({ source: 'api', route }) as const

describe('failureReporter — лог и таблица одним путём (MOL-143)', () => {
  it('пишет в лог по виду и записывает то же самое', async () => {
    const { log, error } = fakeLog()
    const write = vi.fn(() => Promise.resolve())
    const recordings: Promise<void>[] = []
    const reporter = failureReporter('b1', write, log, (recording) => recordings.push(recording))

    reporter.report(new TypeError('отзыв: «сыр так себе»'), at('GET /x'), 'request failed')
    await Promise.all(recordings)

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'TypeError' }),
      'request failed',
    )
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'TypeError', route: 'GET /x', build: 'b1' }),
      1,
    )
    expect(JSON.stringify([error.mock.calls, write.mock.calls])).not.toContain('сыр')
  })

  it('запись, которая упала, — строка в логе, а не второй сбой и не исключение', async () => {
    const { log, error } = fakeLog()
    const recordings: Promise<void>[] = []
    const reporter = failureReporter(
      'b1',
      () =>
        Promise.reject(Object.assign(new Error('connection ended'), { code: 'CONNECTION_ENDED' })),
      log,
      (recording) => recordings.push(recording),
    )

    expect(() => {
      reporter.report(new Error('first'), { source: 'api' }, 'request failed')
    }).not.toThrow()
    await Promise.all(recordings)

    expect(error).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorName: 'Error', code: 'CONNECTION_ENDED' }),
      'failure not recorded',
    )
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('всплеск одного отпечатка — одна запись в полёте, остальное одной записью со счётом (А1, А3)', async () => {
    const { log } = fakeLog()
    const { write, writes } = heldWrites()
    const recordings: Promise<void>[] = []
    const reporter = failureReporter('b1', write, log, (recording) => recordings.push(recording))
    const boom = new TypeError('x')

    for (let index = 0; index < 100; index += 1)
      reporter.report(boom, at('GET /x'), 'request failed')
    expect(writes.map((one) => one.times)).toEqual([1])

    writes[0]?.release()
    await vi.waitFor(() => {
      expect(writes.map((one) => one.times)).toEqual([1, 99])
    })
    writes[1]?.release()
    await Promise.all(recordings)
  })

  it('новый сбой посреди всплеска берёт свободный ход, а не отказ (А2)', () => {
    const { log, error } = fakeLog()
    const { write, writes } = heldWrites()
    const reporter = failureReporter('b1', write, log)

    for (let index = 0; index < 30; index += 1) {
      reporter.report(new TypeError('x'), at('GET /known'), 'request failed')
    }
    reporter.report(new RangeError('y'), at('GET /new'), 'request failed')

    expect(writes.map((one) => one.occurrence.route)).toEqual(['GET /known', 'GET /new'])
    expect(error).not.toHaveBeenCalledWith({ reason: 'busy' }, 'failure not recorded')
  })

  it(`не больше ${String(RECORDINGS_AT_ONCE)} записей разом: пятый отпечаток ждёт хода, а не теряется`, async () => {
    const { log } = fakeLog()
    const { write, writes } = heldWrites()
    const recordings: Promise<void>[] = []
    const reporter = failureReporter('b1', write, log, (recording) => recordings.push(recording))

    for (let index = 0; index <= RECORDINGS_AT_ONCE; index += 1) {
      reporter.report(new Error('x'), at(`GET /r${String(index)}`), 'request failed')
    }
    expect(writes).toHaveLength(RECORDINGS_AT_ONCE)

    writes[0]?.release()
    await vi.waitFor(() => {
      expect(writes).toHaveLength(RECORDINGS_AT_ONCE + 1)
    })
    for (const one of writes) one.release()
    await Promise.all(recordings)
  })
})
