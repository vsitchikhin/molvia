import { ref, type Ref } from 'vue'
import { read, write } from '@/stores/storage'

/** Where the setting lives: a tab has its own for this site, an app from the home screen has not. */
export type CameraHintPlace = 'tab' | 'app'

// Seen on this phone, not by this person: the setting is the phone's, and it outlives a sign-out.
const SEEN_KEY = 'molvia.camera-hint'

/**
 * How long the camera waits for the browser to say whether it will ask. Safari answers in
 * milliseconds; an answer that does not come must not keep the scanner on «Loading…» — the hint is
 * a courtesy, the camera is the point (adversarial Б).
 */
export const PERMISSION_WAIT = 300

// Browsers of iOS that are WebKit with Apple's vendor too, and keep the camera in settings of their
// own, where the way the sheet names leads nowhere: Chrome, Firefox, Edge, Opera, Yandex — the
// browser of much of the diaspora — DuckDuckGo and the Google app (adversarial А).
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|YaApp|DuckDuckGo|Ddg\/|GSA\//

function standalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

/**
 * Safari on an iPhone or an iPad — in a tab or from the home screen — where the camera is asked
 * once per page load until «Разрешить» is set in its settings (MOL-163, measured on the owner's
 * phone). An iPad calls itself a Mac, but a Mac has no touch. A tab of Safari names `Safari/`; a
 * browser inside another app (a bare WKWebView, a link opened in a messenger) does not, and its
 * camera is the host app's. The app from the home screen does not either, and is Safari's.
 */
function safariOnTouch(): boolean {
  const agent = navigator.userAgent
  return (
    navigator.vendor.startsWith('Apple') &&
    navigator.maxTouchPoints > 0 &&
    (agent.includes('Safari/') || standalone()) &&
    !NOT_SAFARI.test(agent)
  )
}

// What the browser will do on the next `getUserMedia`. `null` where it cannot tell — no API, a
// name it does not know (Firefox before 131), or no answer in time — and then the sheet says
// nothing rather than guess.
async function cameraPermission(): Promise<PermissionState | null> {
  try {
    const answer = navigator.permissions.query({ name: 'camera' }).then((status) => status.state)
    const late = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, PERMISSION_WAIT)
    })
    return await Promise.race([answer, late])
  } catch {
    return null
  }
}

export interface CameraHint {
  /** The sheet «Камера без вопросов» is up. */
  open: Ref<boolean>
  /** The quiet line over «Ввести вручную»: Safari asks this time, and the sheet was seen before. */
  offer: Ref<boolean>
  place: Ref<CameraHintPlace>
  /**
   * Asked before the camera starts: whether Safari is about to ask. Resolves `false` when another
   * check began meanwhile — the start that asked is not the current one.
   */
  check: () => Promise<boolean>
  /** The camera is live: the sheet comes up, once on this phone, if Safari has just asked. */
  started: () => void
  /** «Как убрать» over «Ввести вручную». */
  show: () => void
  /** Any way the sheet goes — it is not brought up by itself again on this phone. */
  dismiss: () => void
  /** The scanner is put away. */
  reset: () => void
}

/**
 * Whether to tell the person how to stop Safari asking for the camera (MOL-163). Safari asks once
 * per page load — every launch of the app from the home screen is one — and only a setting of the
 * phone stops it; no code of the page can. So the scanner says where the setting is, right after
 * Safari asked: a sheet the first time on this phone, a quiet line every time after.
 */
export function useCameraHint(): CameraHint {
  const open = ref(false)
  const offer = ref(false)
  const place = ref<CameraHintPlace>('tab')
  // Safari is about to ask on this opening of the scanner, and the sheet has not been seen.
  let unseen = false
  // Each check is numbered, so the answer to one that a later start overtook is let go.
  let checks = 0

  async function check(): Promise<boolean> {
    const mine = ++checks
    unseen = false
    offer.value = false
    if (!safariOnTouch()) return true
    const asking = (await cameraPermission()) === 'prompt'
    if (mine !== checks) return false
    place.value = standalone() ? 'app' : 'tab'
    if (!asking) return true
    // Decided before the camera, so the line is in the footer from the start: added once the
    // viewfinder was live, it pushed the picture up as the person aimed (review 2).
    if (read(SEEN_KEY) === null) unseen = true
    else offer.value = true
    return true
  }

  function started(): void {
    if (!unseen) return
    unseen = false
    open.value = true
  }

  function show(): void {
    open.value = true
  }

  function dismiss(): void {
    write(SEEN_KEY, '1')
    open.value = false
    offer.value = true
  }

  function reset(): void {
    checks++
    unseen = false
    open.value = false
    offer.value = false
  }

  return { open, offer, place, check, started, show, dismiss, reset }
}
