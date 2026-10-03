import { performance } from 'node:perf_hooks'
import process from 'node:process'

/**
 * The API's figures for the metrics of the machine (MOL-145), in Prometheus's text format, written
 * here rather than taken from a library: three kinds of figure do not earn a dependency.
 *
 * **A label is never anything a request names** (owner's В-1, Р-1): the method and the route's
 * template, never the path — a path carries uuids and, decoded, a person's text, and a series for
 * each would be both a leak and a flood. A request no route answered is one series a class of
 * status, whatever its path.
 *
 * **A request whose client left before the answer is counted too, as `aborted`** (adversarial А1),
 * with the time it ran until then: the phone gives up after 15 s and the bot after 5, and an answer
 * nobody waited for is exactly the slow one p95 is there for. Fastify's `onResponse` never comes for
 * it — a closed socket gives neither `finish` nor `error`.
 */
export interface MetricsSource {
  render(): string
}

export interface HttpMetrics extends MetricsSource {
  /**
   * One answer: `route` is the template, or `undefined` when no route answered; `aborted` when the
   * client left before it.
   */
  observe(
    method: string,
    route: string | undefined,
    status: number | 'aborted',
    seconds: number,
  ): void
}

export interface ProcessMetrics extends MetricsSource {
  stop(): void
}

/**
 * Where an answer's time falls, in seconds. From the quickest the API gives to well past the second
 * the alarm is set at (Р-6 of MOL-149), so p95 near the threshold is read between close bounds.
 */
export const DURATION_BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const

/** The method and the route of a request no route answered: one series, whatever was asked. */
export const UNMATCHED = { method: '*', route: 'unmatched' } as const

interface Timing {
  readonly labels: string
  readonly counts: number[]
  sum: number
  total: number
}

export function httpMetrics(): HttpMetrics {
  const requests = new Map<string, number>()
  const timings = new Map<string, Timing>()

  return {
    observe(method, route, status, seconds) {
      const where = route === undefined ? UNMATCHED : { method, route }
      const place = labels({ method: where.method, route: where.route })
      const counted = labels({
        method: where.method,
        route: where.route,
        status: status === 'aborted' ? status : `${String(Math.floor(status / 100))}xx`,
      })
      requests.set(counted, (requests.get(counted) ?? 0) + 1)

      const timing = timings.get(place) ?? {
        labels: place,
        counts: DURATION_BUCKETS.map(() => 0),
        sum: 0,
        total: 0,
      }
      timings.set(place, timing)
      DURATION_BUCKETS.forEach((bound, index) => {
        if (seconds <= bound) timing.counts[index] = (timing.counts[index] ?? 0) + 1
      })
      timing.sum += seconds
      timing.total += 1
    },

    render() {
      const lines = [
        '# HELP molvia_http_requests_total Answers of the API by method, route template and class of status; aborted when the client left first.',
        '# TYPE molvia_http_requests_total counter',
        ...[...requests].map(
          ([where, count]) => `molvia_http_requests_total{${where}} ${String(count)}`,
        ),
        '# HELP molvia_http_request_duration_seconds Time from the request to the answer, by method and route template.',
        '# TYPE molvia_http_request_duration_seconds histogram',
      ]
      for (const timing of timings.values()) {
        DURATION_BUCKETS.forEach((bound, index) => {
          lines.push(
            `molvia_http_request_duration_seconds_bucket{${timing.labels},le="${String(bound)}"} ${String(timing.counts[index] ?? 0)}`,
          )
        })
        lines.push(
          `molvia_http_request_duration_seconds_bucket{${timing.labels},le="+Inf"} ${String(timing.total)}`,
          `molvia_http_request_duration_seconds_sum{${timing.labels}} ${String(timing.sum)}`,
          `molvia_http_request_duration_seconds_count{${timing.labels}} ${String(timing.total)}`,
        )
      }
      return `${lines.join('\n')}\n`
    },
  }
}

/** How often the loop is looked at, and over how long its figures are read (adversarial А2, А3). */
export const LOOP_TICK_MS = 100
export const LOOP_WINDOW_MS = 60_000

interface Lateness {
  readonly at: number
  readonly late: number
}

/**
 * The process itself (Р-2): how late the event loop ran over the last minute, and the memory the
 * container's figure does not split. The loop has been held for seconds before — the wallet's chain
 * (MOL-42), the copy of one's data (MOL-93) — and the container sees only that it grew.
 *
 * **Measured by a timer of its own, over a sliding minute, and never reset by a reader** (adversarial
 * А2, А2b, А3). Node's `monitorEventLoopDelay` was reset at every render: a scrape VictoriaMetrics gave
 * up on during a long block was still served once the loop freed, and took the block with it; a `curl`
 * by hand did the same; a block starting right after a reset was not recorded at all; and an idle loop
 * read its timer's resolution, 20 ms, as delay. Here a tick every 100 ms writes how much later than
 * planned it came, and a render reads the minute behind it — a block of a few seconds is seen by every
 * scrape of that minute, whoever else read it.
 */
export function processMetrics(
  options: { readonly tickMs?: number; readonly windowMs?: number } = {},
): ProcessMetrics {
  const tick = options.tickMs ?? LOOP_TICK_MS
  const window = options.windowMs ?? LOOP_WINDOW_MS
  const seen: Lateness[] = []
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    seen.push({ at: now, late: Math.max(0, now - last - tick) })
    last = now
    while ((seen[0]?.at ?? now) < now - window) seen.shift()
  }, tick)
  timer.unref()

  return {
    render() {
      const now = performance.now()
      // The tick under way counts too: a render right after a block may come before its timer does.
      const lates = [
        ...seen.filter((sample) => sample.at >= now - window).map((sample) => sample.late),
        Math.max(0, now - last - tick),
      ].sort((a, b) => a - b)
      const p99 = lates[Math.ceil(lates.length * 0.99) - 1] ?? 0
      const max = lates.at(-1) ?? 0
      const memory = process.memoryUsage()
      return [
        '# HELP nodejs_eventloop_lag_p99_seconds The 99th percentile of how late the event loop ran over the last minute.',
        '# TYPE nodejs_eventloop_lag_p99_seconds gauge',
        `nodejs_eventloop_lag_p99_seconds ${String(p99 / 1000)}`,
        '# HELP nodejs_eventloop_lag_max_seconds The longest the event loop was late over the last minute.',
        '# TYPE nodejs_eventloop_lag_max_seconds gauge',
        `nodejs_eventloop_lag_max_seconds ${String(max / 1000)}`,
        '# HELP nodejs_heap_size_used_bytes The heap in use.',
        '# TYPE nodejs_heap_size_used_bytes gauge',
        `nodejs_heap_size_used_bytes ${String(memory.heapUsed)}`,
        '# HELP process_resident_memory_bytes The memory the process holds.',
        '# TYPE process_resident_memory_bytes gauge',
        `process_resident_memory_bytes ${String(memory.rss)}`,
        '',
      ].join('\n')
    },
    stop() {
      clearInterval(timer)
    },
  }
}

/** Labels as the format writes them; a value is escaped, though a template has nothing to escape. */
function labels(values: Record<string, string>): string {
  return Object.entries(values)
    .map(
      ([name, value]) =>
        `${name}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`,
    )
    .join(',')
}
