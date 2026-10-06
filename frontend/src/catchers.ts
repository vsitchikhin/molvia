import { api } from '@/api'
import { belowFloor } from '@/browserFloor'
import { installFailureReports, pageBuild } from '@/failures'
import type { FailureReports } from '@/failures'
import { platformLine } from '@/platform'

/**
 * The phone's catchers (MOL-144), imported by the first line of `main.ts`: modules are evaluated in
 * the order they are imported, so the window's listeners stand before the router, the screens, i18n
 * and everything they pull in is evaluated — a module of the app that throws as it loads is heard
 * (adversarial Б3 of round 2). **The price, named:** what throws before this module runs — the
 * bundle failing to parse, and the few modules this one imports: the client, the model, storage —
 * reaches nobody.
 *
 * The screen is told by `main.ts` once the app is there (`placeFailures`); until then it is `start`.
 */
let screen: () => string = () => 'start'

/**
 * Below the floor of the build nothing reports and nothing listens (MOL-231): such a browser fails on
 * whatever it lacks first — as the bundle loads, as a screen draws — and that is no defect of ours.
 * The reports themselves are not installed there, so `reportFailure` from any module is silent too,
 * not only the two doors `main.ts` keeps shut (self-review №2).
 */
const SILENT: FailureReports = { report: () => undefined, flush: () => Promise.resolve() }

export const failures = belowFloor()
  ? SILENT
  : installFailureReports({
      origin: window.location.origin,
      build: pageBuild(import.meta.url, import.meta.env.PROD),
      platform: () => platformLine(),
      screen: () => screen(),
      send: (body) => api.reportClientErrors(body),
    })

if (!belowFloor()) {
  window.addEventListener('error', (event) => {
    failures.report(event.error, 'window')
  })
  window.addEventListener('unhandledrejection', (event) => {
    failures.report(event.reason, 'rejection')
  })
  window.addEventListener('online', () => {
    void failures.flush()
  })
}

/** Where on the app a failure happened, from the moment the app is mounted. */
export function placeFailures(where: () => string): void {
  screen = where
}
