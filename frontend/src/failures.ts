import { ApiError } from '@molvia/client'
import {
  FAILURE_NAME_MAX,
  PHONE_FAILURES_KEPT,
  describePhoneFailure,
  ownFrame,
  phoneBuildSchema,
  phoneFailureSchema,
} from '@molvia/model'
import type { ClientErrors, PhoneCatcher, PhoneFailure } from '@molvia/model'
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
 * 500 — the API has recorded itself; no answer is the connection, the weather at a shelf; a page not
 * of the API's answering with something else — a portal, a proxy's 502 — is not ours either. A `2xx`
 * the contract could not read is: the phone's code against the server's answer. Everything that is
 * not an answer of the API is the phone's code.
 */
export function phoneDefect(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true
  return !error.answered && error.status !== undefined && error.status >= 200 && error.status < 300
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

/** The same failure on the phone — what the API fingerprints, as the phone can tell it. */
function keyOf(report: PhoneFailure): string {
  const top = (report.frames[0] ?? '').replace(/:\d+:\d+\)$/, ')')
  const system = report.platform.split(' ')[0] ?? ''
  return [report.catcher, report.screen, report.errorName, report.code ?? '', top, system].join('|')
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
 * app's own words. A failure with no frame of the app's own code is not sent at all (Р-2): an
 * extension, a script of Telegram's browser, `Script error.` of another origin.
 *
 * **One failure once a page** (Р-5): a screen that shows its error again on every retry, a loop that
 * throws every frame, send it the first time only — the count is of pages that met it. **Kept until
 * it can be sent** (Р-7): twenty at most, one a failure, on the shared shelf; sent at once, at start
 * and when the connection comes back. **Any answer lets them go** — sent again they would be refused
 * again — and only no answer keeps them. Sending reports nothing about itself (Р-8).
 */
export function failureReports(environment: FailureEnvironment): FailureReports {
  const seen = new Set<string>()
  let sending: Promise<void> | null = null
  let again = false

  async function sendKept(): Promise<void> {
    const reports = kept()
    if (reports.length === 0) return
    try {
      await environment.send({ reports })
    } catch (error) {
      // No answer: the connection, the weather — kept for the next time.
      if (error instanceof ApiError && !error.answered && error.status === undefined) return
    }
    const sent = new Set(reports.map(keyOf))
    keep(kept().filter((report) => !sent.has(keyOf(report))))
  }

  function flush(): Promise<void> {
    if (sending !== null) {
      again = true
      return sending
    }
    sending = sendKept()
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

  function report(error: unknown, catcher: PhoneCatcher): void {
    if (!phoneDefect(error)) return
    const summary = describePhoneFailure(error, environment.origin)
    const frames = summary.frames ?? []
    if (!frames.some(ownFrame)) return
    const parsed = phoneFailureSchema.safeParse({
      errorName:
        summary.errorName.replace(/[^\w$.-]/g, '_').slice(0, FAILURE_NAME_MAX) || 'unknown',
      ...(summary.code === undefined ? {} : { code: summary.code }),
      frames,
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
    if (!reports.some((known) => keyOf(known) === key)) {
      keep([...reports, parsed.data].slice(-PHONE_FAILURES_KEPT))
    }
    void flush()
  }

  return { report, flush }
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
