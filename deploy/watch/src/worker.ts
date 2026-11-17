import { settingsOf, watch, watchLock } from '@/watch'
import type { Environment, Io } from '@/watch'

/**
 * The Worker «molvia-watch» on Cloudflare (MOL-221): its cron, every five minutes, runs one round
 * of the watch, the site's and the lock of Grafana's (MOL-399). A round that could not report
 * throws, and Cloudflare logs it; the URL is never printed. What a failed try saw is logged, as the
 * GitHub job printed it.
 */
export default {
  async scheduled(_controller: unknown, environment: Environment): Promise<void> {
    const settings = settingsOf(environment)
    const io: Io = {
      // Called through a closure: Workers refuse a `fetch` detached from the global scope.
      fetch: async (input, init) => fetch(input, init),
      wait: async (ms) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms)
        }),
      log: (line, warn) => {
        if (warn) console.warn(line)
        else console.log(line)
      },
    }
    // Side by side, and neither stops the other (MOL-399): the lock's secret missing or a ping of it
    // not gone fails the round only once the site has been told of — and both failing name both.
    const rounds = await Promise.allSettled([watch(settings, io), watchLock(settings, io)])
    const failures = rounds.flatMap((round) =>
      round.status === 'rejected'
        ? [round.reason instanceof Error ? round.reason.message : String(round.reason)]
        : [],
    )
    if (failures.length > 0) throw new Error(failures.join('; '))
  },
}
