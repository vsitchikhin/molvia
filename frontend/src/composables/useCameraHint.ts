import { ref, type Ref } from 'vue'
import { read, write } from '@/stores/storage'

/** Where the setting lives: a tab has «aA» for this site alone, an app from the home screen has not. */
export type CameraHintPlace = 'tab' | 'app'

// Seen on this phone, not by this person: the setting is the phone's, and it outlives a sign-out.
const SEEN_KEY = 'molvia.camera-hint'

/**
 * Safari on an iPhone or an iPad — in a tab or from the home screen — where the camera is asked
 * once per page load until «Разрешить» is set in its settings (MOL-163, measured on the owner's
 * phone). An iPad calls itself a Mac, but a Mac has no touch; Chrome, Firefox and Edge for iOS are
 * WebKit too and keep their own settings, so the way named in the sheet is not theirs.
 */
function safariOnTouch(): boolean {
  return (
    navigator.vendor.startsWith('Apple') &&
    navigator.maxTouchPoints > 0 &&
    !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
  )
}

function placeOf(): CameraHintPlace {
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return standalone || window.matchMedia('(display-mode: standalone)').matches ? 'app' : 'tab'
}

// What the browser will do on the next `getUserMedia`. `null` where it cannot tell — no API, or a
// name it does not know (Firefox before 131) — and then the sheet says nothing rather than guess.
async function cameraPermission(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' })
    return status.state
  } catch {
    return null
  }
}

export interface CameraHint {
  /** The sheet «Камера без вопросов» is up. */
  open: Ref<boolean>
  /** The quiet line under the viewfinder: Safari asked this time, and the sheet was seen before. */
  offer: Ref<boolean>
  place: Ref<CameraHintPlace>
  /** Asked before the camera starts: whether Safari is about to ask. */
  check: () => Promise<void>
  /** The camera is live: the sheet comes up, once on this phone, if Safari has just asked. */
  started: () => void
  /** «Как убрать» under the viewfinder. */
  show: () => void
  /** «Понятно» — the sheet is not brought up by itself again on this phone. */
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
  // Safari is about to ask on this opening of the scanner.
  let asking = false

  async function check(): Promise<void> {
    asking = false
    offer.value = false
    if (!safariOnTouch()) return
    asking = (await cameraPermission()) === 'prompt'
    place.value = placeOf()
  }

  function started(): void {
    if (!asking) return
    asking = false
    if (read(SEEN_KEY) === null) open.value = true
    else offer.value = true
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
    asking = false
    open.value = false
    offer.value = false
  }

  return { open, offer, place, check, started, show, dismiss, reset }
}
