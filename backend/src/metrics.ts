import { monitorEventLoopDelay } from 'node:perf_hooks'
import process from 'node:process'

/**
 * The API's figures for the metrics of the machine (MOL-145), in Prometheus's text format, written
 * here rather than taken from a library: three kinds of figure do not earn a dependency.
 *
 * **A label is never anything a request names** (owner's В-1, Р-1): the method and the route's
 * template, never the path — a path carries uuids and, decoded, a person's text, and a series for
 * each would be both a leak and a flood. A request no route answered is one series a class of
 * status, whatever its path.
 */
export interface MetricsSource {
  render(): string
}

export interface HttpMetrics extends MetricsSource {
  /** One answer: `route` is the template, or `undefined` when no route answered. */
  observe(method: string, route: string | undefined, status: number, seconds: number): void
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
        status: `${String(Math.floor(status / 100))}xx`,
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
        '# HELP molvia_http_requests_total Answers of the API by method, route template and class of status.',
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

/**
 * The process itself (Р-2): how late the event loop ran since the last scrape, and the memory the
 * container's figure does not split. The loop has been held for seconds before — the wallet's chain
 * (MOL-42), the copy of one's data (MOL-93) — and the container sees only that it grew.
 */
export function processMetrics(): ProcessMetrics {
  const delay = monitorEventLoopDelay({ resolution: 20 })
  delay.enable()

  return {
    render() {
      // Nanoseconds; NaN until the first sample, which is no figure at all.
      const p99 = delay.percentile(99)
      const max = delay.max
      delay.reset()
      const memory = process.memoryUsage()
      return [
        '# HELP nodejs_eventloop_lag_p99_seconds The 99th percentile of the event loop delay since the last scrape.',
        '# TYPE nodejs_eventloop_lag_p99_seconds gauge',
        `nodejs_eventloop_lag_p99_seconds ${seconds(p99)}`,
        '# HELP nodejs_eventloop_lag_max_seconds The longest event loop delay since the last scrape.',
        '# TYPE nodejs_eventloop_lag_max_seconds gauge',
        `nodejs_eventloop_lag_max_seconds ${seconds(max)}`,
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
      delay.disable()
    },
  }
}

function seconds(nanoseconds: number): string {
  return Number.isFinite(nanoseconds) && nanoseconds > 0 ? String(nanoseconds / 1e9) : '0'
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
