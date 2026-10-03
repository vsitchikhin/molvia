import { ApiError } from '@molvia/client'
import {
  ERROR,
  FAILURE_NAME_MAX,
  PHONE_FAILURES_KEPT,
  PHONE_GLOBAL_CATCHERS,
  describePhoneFailure,
  ownFrame,
  phoneBuildSchema,
  phoneFailureSchema,
} from '@molvia/model'
import type { ClientErrors, PhoneCatcher, PhoneFailure } from '@molvia/model'
import { exclusively } from '@/stores/queueing'
import { forget, read, write } from '@/stores/storage'

/** Where the phone keeps its failures until they can be sent (MOL-144, Р-7). Nobody's: no owner. */
export const FAILURES_KEY = 'molvia.failures'

/**
 * The page's build (MOL-144, В-1): the name of its own script — `index-BTCsHrpw`, a hash of its
 * content, which changes exactly when the phone's code does. The page has no other version of its
 * own; `pwaUpdate.build()` is the API's, and a page from the cache after a rollout would name the new
 * build for the old code. `dev` on the development server, or where the name is not a build's.
 */
export function pageBuild(url: string, production: boolean): string {
  const name = /\/(index-[\w-]+)\.js(?:[?#]|$)/.exec(url)?.[1]
  return production && name !== undefined && phoneBuildSchema.safeParse(name).success ? name : 'dev'
}

/**
 * Whether a failure is the phone's own (MOL-144, Р-4, owner's В-3). An API's word — a refusal or its
 * 500 — the API has recorded itself; no answer is the connection, the weather at a shelf, and so is a
 * body cut off after its headers (adversarial А1); a page not of the API's — a portal, a proxy's
 * 502 — is not ours either, a portal's `200` included: only our API names its build. The API's `2xx`
 * that came whole and the contract could not read is (`offContract`): the phone's code against the
 * server's answer. Everything that is not an answer of the API is the phone's code.
 */
export function phoneDefect(error: unknown): boolean {
  return !(error instanceof ApiError) || error.offContract
}

/**
 * Whether an answer to the sending lets the kept failures go (review №2, №3, adversarial А6): only
 * our API's — the build named — and not «too many», which says «later», not «never». A proxy's `502`
 * during a rollout, a portal's page and no answer at all keep them: that rollout is exactly when an
 * old page meets a new server, and a flood of somebody else's must not cost a real phone its report.
 */
function letsGo(error: unknown): boolean {
  return (
    error instanceof ApiError && error.fromApi && error.code !== ERROR.CLIENT_ERRORS_RATE_LIMITED
  )
}

/**
 * Sends of one window after another — within one window by the chain, across windows by the
 * browser's lock (adversarial А3): two windows that heard `online` read one shared buffer, and each
 * sent it whole. Inside, the buffer is read afresh, so the second finds it emptied.
 */
let turn: Promise<void> = Promise.resolve()
function oneAtATime(work: () => Promise<void>): Promise<void> {
  const run = () => exclusively(FAILURES_KEY, work)
  const mine = turn.then(run, run)
  turn = mine.catch(() => undefined)
  return mine
}

export interface FailureEnvironment {
  /** The page's origin: a frame of it is a path, any other is `?`. */
  readonly origin: string
  readonly build: string
  readonly platform: () => string
  /** The screen as a route's name, `login` behind the door, `start` before the first route. */
  readonly screen: () => string
  readonly send: (body: ClientErrors) => Promise<void>
}

export interface FailureReports {
  /** A failure caught by `catcher`: described, kept, and sent if it is the phone's own. */
  report(error: unknown, catcher: PhoneCatcher): void
  /** Sends what is kept: at start, when the connection comes back, after a catch. */
  flush(): Promise<void>
}

/**
 * The same failure on the phone — what the API fingerprints, as the phone can tell it: the build
 * included (adversarial Д1 of round 5). Without it a report with no frame — a registration's
 * `DOMException` — kept from an old build stood for the same failure of the new one, and the new
 * build's never went.
 */
function keyOf(report: PhoneFailure): string {
  const top = (report.frames?.[0] ?? '').replace(/:\d+:\d+\)$/, ')')
  const system = report.platform.split(' ')[0] ?? ''
  return [
    report.catcher,
    report.screen,
    report.errorName,
    report.code ?? '',
    top,
    system,
    report.build,
  ].join('|')
}

function kept(): PhoneFailure[] {
  const raw = read(FAILURES_KEY)
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const report = phoneFailureSchema.safeParse(entry)
      return report.success ? [report.data] : []
    })
  } catch {
    return []
  }
}

function keep(reports: readonly PhoneFailure[]): void {
  if (reports.length === 0) forget(FAILURES_KEY)
  else write(FAILURES_KEY, JSON.stringify(reports))
}

/**
 * The phone's failures (MOL-144). **What leaves is the kind and the frames, never the message**: a
 * message carries a person's text, a field, an answer — the frames are brought to one shape and a
 * path of this origin (`describePhoneFailure`), and the screen, the build and the platform are the
 * app's own words. What the window hears with no frame of the app's own code is not sent at all
 * (Р-2): an extension, a script of Telegram's browser, `Script error.` of another origin. What Vue,
 * a screen, the scanner or the worker's registration catches is the app's own wherever it was thrown,
 * and goes with no frame too: a registration's `DOMException` often has none.
 *
 * **One failure once a page** (Р-5): a screen that shows its error again on every retry, a loop that
 * throws every frame, send it the first time only — the count is of pages that met it. **Kept until
 * it can be sent** (Р-7): twenty at most, one a failure, on the shared shelf; sent at once, at start
 * and when the connection comes back, one window at a time. **Our API's answer lets them go** — taken,
 * or refused for good — but not «too many», and nothing that is not the API's (`letsGo`). Sending
 * reports nothing about itself (Р-8).
 */
export function failureReports(environment: FailureEnvironment): FailureReports {
  const seen = new Set<string>()
  // One error once, whoever caught it: the start reports its own throw and throws it on, and the
  // window hears it again.
  const heard = new WeakSet<object>()
  let sending: Promise<void> | null = null
  let again = false

  async function sendKept(): Promise<void> {
    const reports = kept()
    if (reports.length === 0) return
    try {
      await environment.send({ reports })
    } catch (error) {
      if (!letsGo(error)) return
    }
    const sent = new Set(reports.map(keyOf))
    keep(kept().filter((report) => !sent.has(keyOf(report))))
  }

  function flush(): Promise<void> {
    if (sending !== null) return sending
    sending = oneAtATime(sendKept)
      .catch(() => undefined)
      .finally(() => {
        sending = null
        if (again) {
          again = false
          void flush()
        }
      })
    return sending
  }

  function take(error: unknown, catcher: PhoneCatcher): void {
    if (typeof error === 'object' && error !== null) {
      if (heard.has(error)) return
      heard.add(error)
    }
    if (!phoneDefect(error)) return
    const summary = describePhoneFailure(error, environment.origin)
    const frames = summary.frames ?? []
    if (PHONE_GLOBAL_CATCHERS.includes(catcher) && !frames.some(ownFrame)) return
    const parsed = phoneFailureSchema.safeParse({
      errorName:
        summary.errorName.replace(/[^\w$.-]/g, '_').slice(0, FAILURE_NAME_MAX) || 'unknown',
      ...(summary.code === undefined ? {} : { code: summary.code }),
      ...(frames.length === 0 ? {} : { frames }),
      catcher,
      screen: environment.screen(),
      build: environment.build,
      platform: environment.platform(),
    })
    if (!parsed.success) return
    const key = keyOf(parsed.data)
    if (seen.has(key)) return
    seen.add(key)
    const reports = kept()
    if (reports.some((known) => keyOf(known) === key)) return
    keep([...reports, parsed.data].slice(-PHONE_FAILURES_KEPT))
    // Caught while a send is out: it goes after it, not with it. Asked again otherwise, a send the
    // server refused for «too many» would be sent again at once.
    if (sending === null) void flush()
    else again = true
  }

  return {
    // It stands first in a screen's catch: a report that threw would leave the screen loading.
    report(error, catcher) {
      try {
        take(error, catcher)
      } catch {
        // Nothing to do: a failure that cannot be described is not worth the screen.
      }
    },
    flush,
  }
}

let installed: FailureReports | null = null

/** The app's reports, made once in `main.ts`; before that, and in tests, a failure goes nowhere. */
export function installFailureReports(environment: FailureEnvironment): FailureReports {
  installed = failureReports(environment)
  return installed
}

/**
 * A failure a screen or a part of the app caught and showed (MOL-144): sent if it is the phone's own.
 * The one call every catch makes; whether it is a failure at all is decided here, not there.
 */
export function reportFailure(error: unknown, catcher: PhoneCatcher): void {
  installed?.report(error, catcher)
}
