import type { FEEDBACK_SYSTEMS } from '@molvia/model'
import { feedbackPlatformSchema } from '@molvia/model'

type System = (typeof FEEDBACK_SYSTEMS)[number]

/** Opened from the home screen rather than in a tab of the browser. */
export function standalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

/** The `OS` the iPhone and the iPad have said since iOS 26, whatever they run. */
const FROZEN_OS = 18

/** The major version after `prefix`, only below the frozen one: from it on, any iOS says the same. */
function trueOs(agent: string, prefix: RegExp): string | undefined {
  const major = prefix.exec(agent)?.[1]
  return major !== undefined && Number(major) < FROZEN_OS ? major : undefined
}

/**
 * The system and its major version, from what the browser says of itself — read once, here, and
 * never sent whole (MOL-147, Р-4). A version is named only where the browser still tells it:
 * Safari's `Version/` is the system's since iOS 26 froze the `OS 18_6` beside it, and an app from
 * the home screen or another browser has only the `OS 18_…` — so an `OS` of 18 and later goes without
 * a number: iOS 18 and iOS 26 say the same there (adversarial В6). Chrome on Android says
 * `Android 10; K` whatever it runs on, and Windows and macOS froze theirs long ago — those go without
 * a number rather than a wrong one.
 */
function systemOf(agent: string, touch: boolean): { system: System; major?: string } {
  const safari = /Version\/(\d+)/.exec(agent)?.[1]
  if (/iPhone|iPod/.test(agent)) {
    const major = safari ?? trueOs(agent, /OS (\d+)_\d/)
    return { system: 'ios', ...(major ? { major } : {}) }
  }
  // An iPad asks for the desktop site and calls itself a Mac; a Mac has no touch.
  if (agent.includes('iPad') || (agent.includes('Macintosh') && touch)) {
    const major = safari ?? trueOs(agent, /iPad.*OS (\d+)_\d/)
    return { system: 'ipados', ...(major ? { major } : {}) }
  }
  if (agent.includes('Android')) {
    const major = agent.includes('Android 10; K)') ? undefined : /Android (\d+)/.exec(agent)?.[1]
    return { system: 'android', ...(major ? { major } : {}) }
  }
  if (agent.includes('Windows')) return { system: 'windows' }
  if (agent.includes('Macintosh')) return { system: 'macos' }
  if (agent.includes('Linux') && !agent.includes('CrOS')) return { system: 'linux' }
  return { system: 'other' }
}

/**
 * The platform as a message to the developer carries it — `ios 18 app`, `android browser` — the
 * one line the domain checks (`feedbackPlatformSchema`). A version the schema would refuse is left
 * out rather than the whole line.
 */
export function platformLine(
  agent: string = navigator.userAgent,
  touch: boolean = navigator.maxTouchPoints > 0,
  installed: boolean = standalone(),
): string {
  const { system, major } = systemOf(agent, touch)
  const mode = installed ? 'app' : 'browser'
  const named = major === undefined ? undefined : `${system} ${major} ${mode}`
  return named !== undefined && feedbackPlatformSchema.safeParse(named).success
    ? named
    : `${system} ${mode}`
}
