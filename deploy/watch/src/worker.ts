import { settingsOf, watch } from '@/watch'
import type { Environment } from '@/watch'

/**
 * The Worker «molvia-watch» on Cloudflare (MOL-221): its cron, every five minutes, runs one round
 * of the watch. A round that could not report throws, and Cloudflare logs it; the URL is never
 * printed. What a failed try saw is logged, as the GitHub job printed it.
 */
export default {
  async scheduled(_controller: unknown, environment: Environment): Promise<void> {
    const settings = settingsOf(environment)
    const { attempts, verdict } = await watch(settings, {
      // Called through a closure: Workers refuse a `fetch` detached from the global scope.
      fetch: async (input, init) => fetch(input, init),
      wait: async (ms) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms)
        }),
    })
    attempts.forEach((wrong, index) => {
      if (wrong.length > 0) console.warn(`attempt ${String(index + 1)}: ${wrong.join('; ')}`)
    })
    if (verdict.up) console.log(`${settings.domain} is well`)
    else console.warn(`${settings.domain}: ${verdict.said.replaceAll('\n', '; ')}`)
  },
}
