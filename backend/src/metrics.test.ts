import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { DURATION_BUCKETS, httpMetrics, processMetrics } from './metrics'
import type { ProcessMetrics } from './metrics'

/** The lines of a rendering that carry a figure, comments left out. */
function figures(text: string): string[] {
  return text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
}

describe('httpMetrics', () => {
  it('counts an answer by method, template and class of status', () => {
    const metrics = httpMetrics()
    metrics.observe('GET', '/trips/:tripId', 200, 0.01)
    metrics.observe('GET', '/trips/:tripId', 204, 0.01)
    metrics.observe('GET', '/trips/:tripId', 503, 0.01)

    const lines = figures(metrics.render())
    expect(lines).toContain(
      'molvia_http_requests_total{method="GET",route="/trips/:tripId",status="2xx"} 2',
    )
    expect(lines).toContain(
      'molvia_http_requests_total{method="GET",route="/trips/:tripId",status="5xx"} 1',
    )
  })

  it('puts every request no route answered under one place, whatever its method', () => {
    const metrics = httpMetrics()
    metrics.observe('GET', undefined, 404, 0.001)
    metrics.observe('PROPFIND', undefined, 404, 0.001)

    const lines = figures(metrics.render())
    expect(lines).toContain(
      'molvia_http_requests_total{method="*",route="unmatched",status="4xx"} 2',
    )
    expect(lines.filter((line) => line.startsWith('molvia_http_requests_total'))).toHaveLength(1)
  })

  it('writes the histogram cumulative, closed by +Inf, with its sum and count', () => {
    const metrics = httpMetrics()
    metrics.observe('POST', '/verdicts', 201, 0.03)
    metrics.observe('POST', '/verdicts', 201, 1)
    metrics.observe('POST', '/verdicts', 201, 30)

    const where = 'method="POST",route="/verdicts"'
    const lines = figures(metrics.render())
    const buckets = lines.filter((line) =>
      line.startsWith(`molvia_http_request_duration_seconds_bucket{${where}`),
    )
    expect(buckets).toEqual([
      ...DURATION_BUCKETS.map(
        (bound) =>
          `molvia_http_request_duration_seconds_bucket{${where},le="${String(bound)}"} ${String(bound < 0.03 ? 0 : bound < 1 ? 1 : 2)}`,
      ),
      `molvia_http_request_duration_seconds_bucket{${where},le="+Inf"} 3`,
    ])
    expect(lines).toContain(`molvia_http_request_duration_seconds_sum{${where}} 31.03`)
    expect(lines).toContain(`molvia_http_request_duration_seconds_count{${where}} 3`)
  })

  it('counts an answer exactly on a bound into that bound', () => {
    const metrics = httpMetrics()
    metrics.observe('GET', '/health', 200, 1)

    expect(figures(metrics.render())).toContain(
      'molvia_http_request_duration_seconds_bucket{method="GET",route="/health",le="1"} 1',
    )
  })

  it('counts a request its client left as aborted, with the time it ran (adversarial А1)', () => {
    const metrics = httpMetrics()
    metrics.observe('GET', '/actors/me/export', 'aborted', 15)

    const lines = figures(metrics.render())
    expect(lines).toContain(
      'molvia_http_requests_total{method="GET",route="/actors/me/export",status="aborted"} 1',
    )
    expect(lines).toContain(
      'molvia_http_request_duration_seconds_bucket{method="GET",route="/actors/me/export",le="10"} 0',
    )
  })

  it('escapes a value the format would misread', () => {
    const metrics = httpMetrics()
    metrics.observe('GET', '/a"b\\c\nd', 200, 0.01)

    expect(metrics.render()).toContain('route="/a\\"b\\\\c\\nd"')
  })

  it('names every figure with its type, and ends with a line break', () => {
    const text = httpMetrics().render()

    expect(text).toContain('# TYPE molvia_http_requests_total counter')
    expect(text).toContain('# TYPE molvia_http_request_duration_seconds histogram')
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('processMetrics', () => {
  let running: ProcessMetrics | undefined
  afterEach(() => {
    running?.stop()
  })

  function gauge(text: string, name: string): number {
    const line = figures(text).find((candidate) => candidate.startsWith(`${name} `))
    return Number(line?.split(' ')[1])
  }

  /** The loop held as the wallet's chain or the copy of one's data held it. */
  function holdTheLoop(ms: number): void {
    const until = Date.now() + ms
    while (Date.now() < until) {
      // busy
    }
  }

  it('names the loop, the heap and the resident memory, a number each', () => {
    running = processMetrics()
    const lines = figures(running.render())

    for (const name of [
      'nodejs_eventloop_lag_p99_seconds',
      'nodejs_eventloop_lag_max_seconds',
      'nodejs_heap_size_used_bytes',
      'process_resident_memory_bytes',
    ]) {
      const line = lines.find((candidate) => candidate.startsWith(`${name} `))
      expect(line, name).toBeDefined()
      expect(Number.isFinite(Number(line?.split(' ')[1])), name).toBe(true)
    }
  })

  it('shows a block to every reader of its window — reading resets nothing (adversarial А2)', async () => {
    running = processMetrics({ tickMs: 10, windowMs: 5000 })
    await sleep(50)
    holdTheLoop(300)
    await sleep(30)

    // A reader by hand first, then the scraper: both see the block.
    expect(gauge(running.render(), 'nodejs_eventloop_lag_max_seconds')).toBeGreaterThan(0.25)
    expect(gauge(running.render(), 'nodejs_eventloop_lag_max_seconds')).toBeGreaterThan(0.25)
  })

  it('sees a block that starts right after a read (adversarial А2b)', async () => {
    running = processMetrics({ tickMs: 10, windowMs: 5000 })
    running.render()
    holdTheLoop(300)
    await sleep(30)

    expect(gauge(running.render(), 'nodejs_eventloop_lag_max_seconds')).toBeGreaterThan(0.25)
  })

  it('lets a block go once its window has passed', async () => {
    running = processMetrics({ tickMs: 10, windowMs: 200 })
    holdTheLoop(150)
    await sleep(400)

    expect(gauge(running.render(), 'nodejs_eventloop_lag_max_seconds')).toBeLessThan(0.1)
  })

  it('reads an idle loop as on time, not as its timer’s resolution (adversarial А3)', async () => {
    // Node's monitor read the resolution itself — here the tick, 0.2 s — as the delay of an idle
    // loop; what is late past the tick is far below it, however loaded the machine running the test.
    running = processMetrics({ tickMs: 200, windowMs: 5000 })
    await sleep(1100)

    expect(gauge(running.render(), 'nodejs_eventloop_lag_p99_seconds')).toBeLessThan(0.15)
  })
})
