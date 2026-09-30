import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCamera } from '@/composables/useCamera'

function fakeStream(capabilities: Record<string, unknown> = {}) {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => capabilities,
    applyConstraints: vi.fn(() => Promise.resolve()),
  }
  // Of MediaStream's own prototype, so the video takes it as its source.
  const stream: MediaStream = Object.assign(Object.create(MediaStream.prototype) as MediaStream, {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  })
  return { stream, track }
}

function named(name: string): Error {
  const error = new Error(name)
  error.name = name
  return error
}

let getUserMedia: ReturnType<typeof vi.fn>

function setSecure(secure: boolean): void {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true })
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  setSecure(true)
  getUserMedia = vi.fn()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
})

// Every camera of a test is let go after it, or its listener would hear the next test's
// visibility changes.
const scopes: ReturnType<typeof effectScope>[] = []

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  setVisibility('visible')
})

function camera() {
  const video = ref(document.createElement('video'))
  vi.spyOn(video.value, 'play').mockResolvedValue()
  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(() => useCamera(video))
  if (!result) throw new Error('no camera')
  return { ...result, video, scope }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('useCamera', () => {
  it('goes live with the stream on the video, and no torch where the camera has none', async () => {
    const { stream } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { kind, torch, start, video } = camera()
    const started = start()
    expect(kind.value).toBe('starting')
    await started
    expect(kind.value).toBe('live')
    expect(video.value.srcObject).toBe(stream)
    expect(torch.value).toBeNull()
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
      }),
    )
  })

  it('must not ask for the camera outside a secure context', async () => {
    setSecure(false)
    const { kind, start } = camera()
    await start()
    expect(kind.value).toBe('insecure')
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('reads a browser with no mediaDevices at all as insecure', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    const { kind, start } = camera()
    await start()
    expect(kind.value).toBe('insecure')
  })

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'none'],
    ['OverconstrainedError', 'none'],
    ['NotReadableError', 'error'],
    ['AbortError', 'error'],
  ])('sorts %s into %s', async (name, expected) => {
    getUserMedia.mockRejectedValue(named(name))
    const { kind, start } = camera()
    await start()
    expect(kind.value).toBe(expected)
  })

  it('reads something that is not an error as an error', async () => {
    getUserMedia.mockRejectedValue('boom')
    const { kind, start } = camera()
    await start()
    expect(kind.value).toBe('error')
  })

  it('stops every track on stop, and the video lets the stream go', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { kind, start, stop, video } = camera()
    await start()
    stop()
    expect(track.stop).toHaveBeenCalled()
    expect(kind.value).toBe('idle')
    expect(video.value.srcObject).toBeNull()
  })

  it('stops a stream that arrives after the scanner was closed', async () => {
    const { stream, track } = fakeStream()
    let answer: ((stream: MediaStream) => void) | undefined
    getUserMedia.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { kind, start, stop } = camera()
    const started = start()
    stop()
    answer?.(stream)
    await started
    expect(track.stop).toHaveBeenCalled()
    expect(kind.value).toBe('idle')
  })

  it('puts the camera away in the background and starts it again on the way back', async () => {
    const first = fakeStream()
    const second = fakeStream()
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const { kind, start } = camera()
    await start()
    setVisibility('hidden')
    expect(first.track.stop).toHaveBeenCalled()
    expect(kind.value).toBe('starting')
    setVisibility('visible')
    await flush()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(kind.value).toBe('live')
  })

  it('must not start again on the way back once the scanner was closed', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const { start, stop } = camera()
    await start()
    stop()
    setVisibility('hidden')
    setVisibility('visible')
    await flush()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('must not ask again on the way back after a refusal', async () => {
    getUserMedia.mockRejectedValue(named('NotAllowedError'))
    const { kind, start } = camera()
    await start()
    setVisibility('hidden')
    setVisibility('visible')
    await flush()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(kind.value).toBe('denied')
  })

  it('offers the torch the camera has, and lights it', async () => {
    const { stream, track } = fakeStream({ torch: [true, false] })
    getUserMedia.mockResolvedValue(stream)
    const { torch, start, setTorch } = camera()
    await start()
    expect(torch.value).toBe(false)
    await setTorch(true)
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
    expect(torch.value).toBe(true)
  })

  it('keeps the torch as it was when the camera will not light it', async () => {
    const { stream, track } = fakeStream({ torch: [true, false] })
    track.applyConstraints.mockRejectedValue(named('OverconstrainedError'))
    getUserMedia.mockResolvedValue(stream)
    const { torch, start, setTorch } = camera()
    await start()
    await setTorch(true)
    expect(torch.value).toBe(false)
  })

  it('runs a camera whose track cannot say what it has, with no torch (adversarial Г)', async () => {
    const { stream, track } = fakeStream()
    Reflect.deleteProperty(track, 'getCapabilities')
    getUserMedia.mockResolvedValue(stream)
    const { kind, torch, start } = camera()
    await start()
    expect(kind.value).toBe('live')
    expect(torch.value).toBeNull()
    expect(track.stop).not.toHaveBeenCalled()
  })

  it('stops a camera it was given when what follows throws', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { kind, start, video } = camera()
    vi.spyOn(video.value, 'play').mockImplementation(() => {
      throw new Error('play exploded')
    })
    await start()
    expect(kind.value).toBe('error')
    expect(track.stop).toHaveBeenCalled()
    expect(video.value.srcObject).toBeNull()
  })

  it('stops the camera with its scope', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const { start, scope } = camera()
    await start()
    scope.stop()
    expect(track.stop).toHaveBeenCalled()
  })
})
