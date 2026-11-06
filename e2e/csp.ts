/// <reference lib="dom" />
// DOM for the init script, which runs in the browser.
import { expect, test as base } from '@playwright/test'

/**
 * The specs of the built app, held to the page's Content Security Policy (MOL-363): only a build carries
 * the meta, and every spec there fails on a violation, whatever it was written for. Heard twice — the
 * event the document raises, through a binding and an init script, which the page's policy does not
 * reach; and the console of the page and of its workers, where a worker's refusal and a policy the
 * engine ignores are said, and the event is not.
 */
export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = []
      await page.exposeBinding('molviaCspViolation', (_source, line: string) => {
        violations.push(line)
      })
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { molviaCspViolation: (line: string) => unknown })
            .molviaCspViolation
          void report(`${event.effectiveDirective} ${event.blockedURI || 'inline'}`)
        })
      })
      const heard = (text: string) => {
        if (/content.security.policy/i.test(text)) violations.push(text)
      }
      page.on('console', (message) => {
        heard(message.text())
      })
      page.on('worker', (worker) => {
        worker.on('console', (message) => {
          heard(message.text())
        })
      })
      await use(violations)
      expect(violations, 'the page broke its Content Security Policy').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
