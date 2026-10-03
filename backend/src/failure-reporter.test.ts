import { describe, expect, it, vi } from 'vitest'
import type { FastifyBaseLogger } from 'fastify'
import { failureReporter } from './failure-reporter'

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
})
