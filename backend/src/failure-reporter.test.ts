import { describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import { RECORDINGS_AT_ONCE, failureReporter } from './failure-reporter'

function fakeLog() {
  const error = vi.fn()
  return { log: { error } as unknown as FastifyBaseLogger, error }
}

describe('failureReporter — лог и таблица одним путём (MOL-143)', () => {
  it('пишет в лог по виду и записывает то же самое', async () => {
    const { log, error } = fakeLog()
    const record = vi.fn(() => Promise.resolve())
    const recordings: Promise<void>[] = []
    const reporter = failureReporter(record, log, (recording) => recordings.push(recording))

    reporter.report(
      new TypeError('отзыв: «сыр так себе»'),
      { source: 'api', route: 'GET /x' },
      'request failed',
    )
    await Promise.all(recordings)

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'TypeError' }),
      'request failed',
    )
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ errorName: 'TypeError' }), {
      source: 'api',
      route: 'GET /x',
    })
    expect(JSON.stringify([error.mock.calls, record.mock.calls])).not.toContain('сыр')
  })

  it('запись, которая упала, — строка в логе, а не второй сбой и не исключение', async () => {
    const { log, error } = fakeLog()
    const recordings: Promise<void>[] = []
    const reporter = failureReporter(
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

  it('не больше четырёх записей разом: лишний сбой — строка в логе, а не очередь к базе', async () => {
    const { log, error } = fakeLog()
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const record = vi.fn(() => held)
    const recordings: Promise<void>[] = []
    const reporter = failureReporter(record, log, (recording) => recordings.push(recording))

    for (let index = 0; index <= RECORDINGS_AT_ONCE; index += 1) {
      reporter.report(new Error('x'), { source: 'api' }, 'request failed')
    }
    expect(record).toHaveBeenCalledTimes(RECORDINGS_AT_ONCE)
    expect(error).toHaveBeenLastCalledWith({ reason: 'busy' }, 'failure not recorded')

    release()
    await Promise.all(recordings)
    reporter.report(new Error('x'), { source: 'api' }, 'request failed')
    expect(record).toHaveBeenCalledTimes(RECORDINGS_AT_ONCE + 1)
  })
})
