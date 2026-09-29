import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * Where the camera is. The four that are not `idle`, `starting` or `live` are the scanner's
 * states (MOL-19, MOL-98): each is drawn with its own way out.
 */
export type CameraKind = 'idle' | 'starting' | 'live' | 'insecure' | 'denied' | 'none' | 'error'

// Constraints the platform types do not know yet: the torch and the focus mode of a phone camera.
type PhoneConstraints = MediaTrackConstraintSet & { torch?: boolean; focusMode?: string }

const FOCUS: PhoneConstraints = { focusMode: 'continuous' }

// The back camera, at a size where a code a hand's length away has bars several pixels wide. An
// ideal, not a demand: a phone that cannot is given what it has, never refused (MOL-98, Р-2).
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    advanced: [FOCUS],
  },
}

// The refusals `getUserMedia` names, sorted into what the person can do about them. A refusal of
// the page's own policy (`SecurityError`) reads as one of the person's: the way out is the same.
function kindOf(error: unknown): CameraKind {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none'
  return 'error'
}

// Whether the camera can light a torch. Asked of the track only where it can answer: a track with
// no `getCapabilities` (Firefox before 132) is a camera without a torch, never a camera that failed
// (adversarial Г).
function hasTorch(stream: MediaStream): boolean {
  const [track] = stream.getVideoTracks()
  if (!track || typeof track.getCapabilities !== 'function') return false
  return 'torch' in track.getCapabilities()
}

export interface Camera {
  kind: Ref<CameraKind>
  /** Whether the torch is on; null while the camera cannot light one. */
  torch: Ref<boolean | null>
  start: () => Promise<void>
  stop: () => void
  setTorch: (on: boolean) => Promise<void>
}

/**
 * The camera behind the scanner's viewfinder (MOL-98). Not a single track outlives the scanner:
 * closed, put away in the background or unmounted, the camera stops and the phone's indicator
 * goes out. Brought back into view while still wanted, it starts again — iOS ends the stream of an
 * app in the background, and the video would stay black.
 */
export function useCamera(video: Ref<HTMLVideoElement | null>): Camera {
  const kind = ref<CameraKind>('idle')
  const torch = ref<boolean | null>(null)
  let stream: MediaStream | null = null
  let wanted = false
  // Put away with the app: only a camera that ran or was on its way is, so a refusal stays on the
  // screen as it was and coming back does not ask the person again.
  let paused = false
  // Each start is numbered, so an answer that comes after a stop — or after a later start — is
  // let go instead of taking the camera back.
  let attempt = 0

  function release(): void {
    attempt++
    for (const track of stream?.getTracks() ?? []) track.stop()
    stream = null
    torch.value = null
    if (video.value) video.value.srcObject = null
  }

  async function start(): Promise<void> {
    wanted = true
    release()
    // Checked before asking: outside a secure context the browser has no `mediaDevices` at all,
    // whatever the DOM types say.
    const devices = navigator.mediaDevices as MediaDevices | undefined
    if (!window.isSecureContext || typeof devices?.getUserMedia !== 'function') {
      kind.value = 'insecure'
      return
    }
    const current = attempt
    kind.value = 'starting'
    try {
      const got = await devices.getUserMedia(CONSTRAINTS)
      if (current !== attempt) {
        for (const track of got.getTracks()) track.stop()
        return
      }
      stream = got
      const element = video.value
      if (element) {
        element.srcObject = got
        // Muted and inline, so no gesture is needed; a play that is refused anyway still shows
        // the first frame, and the frames are read from the element either way.
        await element.play().catch(() => undefined)
      }
      if (current !== attempt) return
      torch.value = hasTorch(got) ? false : null
      kind.value = 'live'
    } catch (error) {
      if (current !== attempt) return
      // A throw after the camera was given must not leave it running under the error (adversarial Г).
      release()
      kind.value = kindOf(error)
    }
  }

  function stop(): void {
    wanted = false
    paused = false
    release()
    kind.value = 'idle'
  }

  async function setTorch(on: boolean): Promise<void> {
    const [track] = stream?.getVideoTracks() ?? []
    if (!track || torch.value === null) return
    const light: PhoneConstraints = { torch: on }
    try {
      await track.applyConstraints({ advanced: [light] })
      torch.value = on
    } catch {
      // A torch the camera claimed and would not light: the button stays as it was.
    }
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      if (!wanted || (kind.value !== 'live' && kind.value !== 'starting')) return
      paused = true
      release()
      kind.value = 'starting'
    } else if (paused) {
      paused = false
      if (wanted) void start()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    stop()
  })

  return { kind, torch, start, stop, setTorch }
}
