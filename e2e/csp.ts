/// <reference lib="dom" />
// DOM for the init script, which runs in the browser.
import { expect, test as base } from '@playwright/test'
import type { Page } from '@playwright/test'

/** A report of the document's `securitypolicyviolation`, as the init script hands it over. */
interface Report {
  directive: string
  blocked: string
  sample: string
  /** The tag of the element the event was raised at, or nothing when it was the document's. */
  target: string | null
}

/**
 * The one report let go (owner's В-4 «а» of review 1): WebKit refuses its own inline style of every
 * `<select>` it makes — a bare `createElement('select')` too, `sample` empty, nothing of ours in it — and
 * nothing was seen to change on the screen. Exactly that report, and one line of its console for each:
 * an inline style on a `<select>` that is ours is let go on WebKit alone, and Chromium, walking the same
 * screens, still fails on it.
 */
const isWebKitSelect = (report: Report) =>
  report.directive === 'style-src-attr' && report.sample === '' && report.target === 'SELECT'
const WEBKIT_SELECT_LINE =
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive"

/**
 * The specs of the built app, held to the page's Content Security Policy (MOL-363): only a build carries
 * the meta, and every spec there fails on a violation in any window of its context, whatever it was
 * written for. Heard twice — the event the document raises, through a binding and an init script, which
 * the page's policy does not reach; and the console of every page and of its workers, where a worker's
 * refusal and a policy the engine ignores are said, and the event is not.
 */
export const test = base.extend<{ cspViolations: undefined }>({
  cspViolations: [
    async ({ context, page, browserName }, use) => {
      const reports: Report[] = []
      const lines: string[] = []
      // On the context, so a second window of the test — `pwa-update.spec` opens one — is heard too.
      await context.exposeBinding('molviaCspViolation', (_source, report: Report) => {
        reports.push(report)
      })
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as { molviaCspViolation: (one: unknown) => unknown })
            .molviaCspViolation
          void report({
            directive: event.effectiveDirective,
            blocked: event.blockedURI || 'inline',
            sample: event.sample,
            target: event.target instanceof Element ? event.target.tagName : null,
          })
        })
      })
      const heard = (text: string) => {
        if (/content.security.policy/i.test(text)) lines.push(text)
      }
      const listen = (one: Page) => {
        one.on('console', (message) => {
          heard(message.text())
        })
        one.on('worker', (worker) => {
          worker.on('console', (message) => {
            heard(message.text())
          })
        })
      }
      for (const open of new Set([page, ...context.pages()])) listen(open)
      context.on('page', listen)
      await use(undefined)

      const engine = browserName === 'webkit' ? reports.filter(isWebKitSelect) : []
      let unsaid = engine.length
      const said = lines.filter((line) => {
        if (unsaid === 0 || !line.startsWith(WEBKIT_SELECT_LINE)) return true
        unsaid -= 1
        return false
      })
      const broken = reports
        .filter((report) => !engine.includes(report))
        .map((report) => `${report.directive} ${report.blocked} ${report.target ?? 'document'}`)
      expect([...broken, ...said], 'the page broke its Content Security Policy').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
