import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import BarcodeScannerSheet from '@/components/BarcodeScannerSheet.vue'
import { PERMISSION_WAIT } from '@/composables/useCameraHint'
import type * as ReaderModule from '@/scanner/barcodeReader'
import type { ReaderWorker } from '@/scanner/barcodeReader'
import type { ReaderReply } from '@/scanner/protocol'

// The real reader over a fake worker, so what a dispose does to a warm still waiting is the app's
// own code (adversarial Б). The worker answers a warm at once, never — a wasm still on its way — or
// with a failure; each frame with the next of `codes`, and a frame past the end is never answered.
let codes: (string | null)[] = []
let warmAnswer: 'ok' | 'never' | 'fail' = 'ok'
const workers: { terminate: ReturnType<typeof vi.fn> }[] = []

vi.mock('@/scanner/barcodeReader', async (importActual) => {
  const actual = await importActual<typeof ReaderModule>()
  return {
    ...actual,
    createBarcodeReader: () => {
      const listeners: ((event: MessageEvent<ReaderReply>) => void)[] = []
      const terminate = vi.fn()
      workers.push({ terminate })
      let index = 0
      const worker: ReaderWorker = {
        postMessage: (request) => {
          let answer: ReaderReply | null = null
          if (request.kind === 'warm') {
            if (warmAnswer !== 'never') {
              answer =
                warmAnswer === 'ok'
                  ? { id: request.id, ok: true, code: null }
                  : { id: request.id, ok: false }
            }
          } else {
            const code = codes[index++]
            if (code !== undefined) answer = { id: request.id, ok: true, code }
          }
          if (answer) {
            const reply = answer
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener(new MessageEvent('message', { data: reply }))
              }
            })
          }
        },
        addEventListener: (type: 'message' | 'error', listener: never) => {
          if (type === 'message') listeners.push(listener)
        },
        terminate,
      }
      return actual.createBarcodeReader(worker)
    },
  }
})

vi.mock('@/scanner/capture', () => ({
  videoFrames: () => ({
    next: () => Promise.resolve(),
    grab: (): ImageData => ({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
      colorSpace: 'srgb',
    }),
  }),
}))

function fakeStream(capabilities: Record<string, unknown> = {}) {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => capabilities,
    applyConstraints: vi.fn(() => Promise.resolve()),
  }
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

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()
const mounted: VueWrapper[] = []
let clock = 0

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/_kit')
  const wrapper = mount(BarcodeScannerSheet, {
    attachTo: document.body,
    props: { open: true, 'onUpdate:open': (open: boolean) => wrapper.setProps({ open }) },
    global: { plugins: [router, createAppI18n('en')] },
  })
  mounted.push(wrapper)
  clock += 1000
  await settle()
  return wrapper
}

function button(sheet: VueWrapper, text: string) {
  const found = sheet.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

// The state's own heading, not the sheet's title above it.
function heading(sheet: VueWrapper): string {
  return sheet.find('.state h2').text()
}

beforeEach(() => {
  clock = 0
  codes = []
  warmAnswer = 'ok'
  workers.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  getUserMedia.mockReset()
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  // A close holds «a step in flight» until the pop lands, and a memory history sends none: held
  // into the next test, it takes that test's pop (as in ItemSearchView.test.ts).
  window.dispatchEvent(new PopStateEvent('popstate'))
})

describe('BarcodeScannerSheet', () => {
  it('opens on the back camera with the frame and the hint', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    expect(getUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ facingMode: { ideal: 'environment' } }),
      }),
    )
    expect(sheet.find('video').exists()).toBe(true)
    expect(sheet.text()).toContain(en.scanner.hint)
    expect(sheet.text()).toContain(en.scanner.manual)
  })

  it('hands over a code two frames agree on, and closes', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    codes = ['4850000000007', '4850000000007']
    const sheet = await render()
    expect(sheet.emitted('read')).toEqual([['4850000000007']])
    expect(sheet.props('open')).toBe(false)
    await settle()
    expect(track.stop).toHaveBeenCalled()
  })

  it('must not hand over a code read once', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    codes = ['4850000000007', null]
    const sheet = await render()
    expect(sheet.emitted('read')).toBeUndefined()
  })

  it('warms the reader while the camera starts', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    await render()
    expect(workers).toHaveLength(1)
  })

  it('offers the torch only where the camera has one', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const plain = await render()
    expect(plain.find(`button[aria-label="${en.scanner.torch_on}"]`).exists()).toBe(false)

    const { stream, track } = fakeStream({ torch: [true, false] })
    getUserMedia.mockResolvedValue(stream)
    const lit = await render()
    const torch = lit.get(`button[aria-label="${en.scanner.torch_on}"]`)
    expect(torch.attributes('aria-pressed')).toBe('false')
    await torch.trigger('click')
    await settle()
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
    expect(lit.get(`button[aria-label="${en.scanner.torch_off}"]`).attributes('aria-pressed')).toBe(
      'true',
    )
  })

  it('says how to allow the camera when refused, and asks again on «Try again»', async () => {
    getUserMedia.mockRejectedValue(named('NotAllowedError'))
    const sheet = await render()
    expect(heading(sheet)).toBe(en.scanner.denied_title)
    expect(sheet.text()).toContain(en.scanner.denied_body)
    await button(sheet, en.scanner.try_again).trigger('click')
    await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('offers typing the digits when there is no camera, and no way back to it', async () => {
    getUserMedia.mockRejectedValue(named('NotFoundError'))
    const sheet = await render()
    expect(heading(sheet)).toBe(en.scanner.none_title)
    await button(sheet, en.scanner.manual).trigger('click')
    await settle()
    expect(sheet.find('input[inputmode="numeric"]').exists()).toBe(true)
    expect(sheet.findAll('button').some((b) => b.text() === en.scanner.scan)).toBe(false)
  })

  it('must not ask for the camera outside a secure context', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const sheet = await render()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(heading(sheet)).toBe(en.scanner.insecure_title)
  })

  it('draws a camera that would not start as an error, with «Try again»', async () => {
    getUserMedia.mockRejectedValueOnce(named('NotReadableError'))
    getUserMedia.mockResolvedValueOnce(fakeStream().stream)
    const sheet = await render()
    expect(sheet.find('[role="alert"]').text()).toContain(en.scanner.error_title)
    await button(sheet, en.state.retry).trigger('click')
    await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(sheet.find('video').exists()).toBe(true)
  })

  it('draws a reader that failed in its own words, and stops the camera under them', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    warmAnswer = 'fail'
    const sheet = await render()
    expect(sheet.find('[role="alert"]').text()).toContain(en.scanner.reader_title)
    expect(sheet.text()).not.toContain(en.scanner.error_body)
    // Adversarial В: no video on the screen, so no camera running behind it.
    expect(track.stop).toHaveBeenCalled()
  })

  it('starts a failed reader over on «Scan» from the digits, rather than land on its error', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    warmAnswer = 'fail'
    const sheet = await render()
    await button(sheet, en.scanner.manual).trigger('click')
    await settle()
    warmAnswer = 'ok'
    await button(sheet, en.scanner.scan).trigger('click')
    await settle()
    expect(sheet.find('[role="alert"]').exists()).toBe(false)
    expect(sheet.find('video').exists()).toBe(true)
    expect(workers).toHaveLength(2)
  })

  describe('a retry while the reader still loads (adversarial Б)', () => {
    it('«Check again» after the camera was allowed lands on the viewfinder', async () => {
      warmAnswer = 'never'
      getUserMedia.mockRejectedValueOnce(named('NotAllowedError'))
      const sheet = await render()
      expect(heading(sheet)).toBe(en.scanner.denied_title)
      getUserMedia.mockResolvedValue(fakeStream().stream)
      await button(sheet, en.scanner.try_again).trigger('click')
      await settle()
      expect(sheet.find('[role="alert"]').exists()).toBe(false)
      expect(sheet.find('video').exists()).toBe(true)
    })

    it('«Try again» keeps the reader that is loading instead of starting its load over', async () => {
      warmAnswer = 'never'
      getUserMedia.mockRejectedValueOnce(named('NotReadableError'))
      getUserMedia.mockRejectedValueOnce(named('NotReadableError'))
      getUserMedia.mockResolvedValue(fakeStream().stream)
      const sheet = await render()
      for (let tap = 0; tap < 2; tap++) {
        await button(sheet, en.state.retry).trigger('click')
        await settle()
      }
      expect(sheet.find('video').exists()).toBe(true)
      expect(workers).toHaveLength(1)
      expect(workers[0]?.terminate).not.toHaveBeenCalled()
    })
  })

  it('offers «Scan» from the digits again once the sheet is opened anew', async () => {
    getUserMedia.mockRejectedValueOnce(named('NotFoundError'))
    const sheet = await render()
    await sheet.setProps({ open: false })
    getUserMedia.mockResolvedValue(fakeStream().stream)
    await sheet.setProps({ open: true })
    // Risen again: the sheet takes no tap before that.
    clock += 1000
    await settle()
    await button(sheet, en.scanner.manual).trigger('click')
    await settle()
    expect(sheet.findAll('button').some((b) => b.text() === en.scanner.scan)).toBe(true)
  })

  it('buzzes for a code read by the camera, and not for digits typed', async () => {
    const vibrate = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    getUserMedia.mockResolvedValue(fakeStream().stream)
    codes = ['4850000000007', '4850000000007']
    await render()
    expect(vibrate).toHaveBeenCalledOnce()

    vibrate.mockClear()
    codes = []
    const typedSheet = await render()
    await button(typedSheet, en.scanner.manual).trigger('click')
    await settle()
    await typedSheet.get('input').setValue('4850000000007')
    await button(typedSheet, en.scanner.done).trigger('click')
    expect(typedSheet.emitted('read')).toEqual([['4850000000007']])
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('starts the reader over when the sheet opens again after it failed', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    warmAnswer = 'fail'
    const sheet = await render()
    expect(sheet.find('[role="alert"]').exists()).toBe(true)
    await sheet.setProps({ open: false })
    warmAnswer = 'ok'
    await sheet.setProps({ open: true })
    await settle()
    expect(sheet.find('[role="alert"]').exists()).toBe(false)
    expect(sheet.find('video').exists()).toBe(true)
    expect(workers).toHaveLength(2)
  })

  describe('typing the digits', () => {
    async function typing() {
      const { stream, track } = fakeStream()
      getUserMedia.mockResolvedValue(stream)
      const sheet = await render()
      await button(sheet, en.scanner.manual).trigger('click')
      await settle()
      return { sheet, track }
    }

    it('stops the camera while the field is open', async () => {
      const { track } = await typing()
      expect(track.stop).toHaveBeenCalled()
    })

    it('refuses digits that do not check, and keeps the sheet open', async () => {
      const { sheet } = await typing()
      await sheet.get('input').setValue('4850000000003')
      await button(sheet, en.scanner.done).trigger('click')
      expect(sheet.text()).toContain(en.error.barcode_check_digit)
      expect(sheet.emitted('read')).toBeUndefined()
      expect(sheet.props('open')).toBe(true)
    })

    it('says a length no barcode has', async () => {
      const { sheet } = await typing()
      await sheet.get('input').setValue('12345')
      await button(sheet, en.scanner.done).trigger('click')
      expect(sheet.text()).toContain(en.error.barcode_shape)
    })

    it('hands over typed digits in the scanner’s form, from Enter too', async () => {
      const { sheet } = await typing()
      await sheet.get('input').setValue('0 12345 67890 5')
      await sheet.get('form').trigger('submit')
      expect(sheet.emitted('read')).toEqual([['0012345678905']])
      expect(sheet.props('open')).toBe(false)
    })

    it('takes digits pasted with a character that draws nothing (adversarial Д)', async () => {
      const { sheet } = await typing()
      await sheet.get('input').setValue(`4850000000007${String.fromCodePoint(0x200b)}`)
      await button(sheet, en.scanner.done).trigger('click')
      expect(sheet.emitted('read')).toEqual([['4850000000007']])
    })

    it('forgets the error once the digits change', async () => {
      const { sheet } = await typing()
      await sheet.get('input').setValue('1')
      await button(sheet, en.scanner.done).trigger('click')
      await sheet.get('input').setValue('12')
      expect(sheet.text()).not.toContain(en.error.barcode_shape)
    })

    it('goes back to the camera on «Scan»', async () => {
      const { sheet } = await typing()
      await button(sheet, en.scanner.scan).trigger('click')
      await settle()
      expect(getUserMedia).toHaveBeenCalledTimes(2)
      expect(sheet.find('video').exists()).toBe(true)
    })
  })

  // MOL-99: the screen keeps the sheet mounted for a warm reader. Put away, the sheet draws nothing
  // — its refusal kept its words in the app's live region — but only once it is put away: emptied
  // at `open: false`, it slid down as a bare title (adversarial Е).
  it('keeps its content while it slides down, and draws nothing once put away', async () => {
    getUserMedia.mockRejectedValue(named('NotAllowedError'))
    const closed = vi.fn()
    const sheet = await render()
    await sheet.setProps({ onClosed: closed })
    expect(heading(sheet)).toBe(en.scanner.denied_title)

    await sheet.setProps({ open: false })
    expect(heading(sheet)).toBe(en.scanner.denied_title)

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()

    expect(closed).toHaveBeenCalledOnce()
    expect(sheet.find('.state').exists()).toBe(false)
    expect(sheet.find('video').exists()).toBe(false)
    expect(sheet.text()).not.toContain(en.scanner.manual)
  })

  // Adversarial Е″: in Chromium a video whose tracks stopped is black, stream on it or not — so the
  // frame is copied before the camera stops, and slides down in its place.
  it('slides down with the last frame drawn, the camera already stopped, and lets it go once away', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const sheet = await render()
    const video = sheet.get('video').element as HTMLVideoElement
    Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true })
    Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true })
    const still = sheet.get<HTMLCanvasElement>('canvas.still')
    // By `v-show`: happy-dom reads anything in a closed dialog as hidden.
    expect(still.element.style.display).toBe('none')

    await sheet.setProps({ open: false })

    expect(track.stop).toHaveBeenCalled()
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0)
    expect([still.element.width, still.element.height]).toEqual([1280, 720])
    expect(still.element.style.display).toBe('')

    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    expect(sheet.find('canvas.still').exists()).toBe(false)
  })

  it('draws no frame for a camera that never went live', async () => {
    getUserMedia.mockRejectedValue(named('NotAllowedError'))
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D)
    const sheet = await render()

    await sheet.setProps({ open: false })

    expect(drawImage).not.toHaveBeenCalled()
  })

  it('says «Loading…» only while open: a camera stopped by the close brings no skeleton', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    expect(sheet.find('video').exists()).toBe(true)

    await sheet.setProps({ open: false })

    expect(sheet.text()).not.toContain(en.state.loading)
  })

  it('stops the camera when the sheet closes', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const sheet = await render()
    await sheet.setProps({ open: false })
    expect(track.stop).toHaveBeenCalled()
  })
})

// Safari on an iPhone (MOL-163): asks for the camera once per page load unless its setting says
// «Разрешить», and tells which of the two it will do through `permissions.query`.
describe('BarcodeScannerSheet · how to stop Safari asking', () => {
  const SAFARI = ['vendor', 'maxTouchPoints', 'userAgent', 'permissions'] as const

  // The answer to `permissions.query` given at once, or held until the test hands it over.
  function safari(state: PermissionState | 'held'): { answer: (state: PermissionState) => void } {
    const held: ((status: { state: PermissionState }) => void)[] = []
    const values = {
      vendor: 'Apple Computer, Inc.',
      maxTouchPoints: 5,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
      permissions: {
        query: () =>
          state === 'held'
            ? new Promise<{ state: PermissionState }>((resolve) => held.push(resolve))
            : Promise.resolve({ state }),
      },
    }
    for (const name of SAFARI) {
      Object.defineProperty(navigator, name, { value: values[name], configurable: true })
    }
    return {
      answer: (answer) => {
        for (const resolve of held.splice(0)) resolve({ state: answer })
      },
    }
  }

  // A closed dialog keeps its words in the page: what is up is a dialog with `open`.
  function hintUp(): boolean {
    return [...document.querySelectorAll('dialog[open]')].some((dialog) =>
      dialog.textContent.includes(en.scanner.camera_hint_title),
    )
  }

  function pageButton(text: string): HTMLButtonElement {
    const found = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent.trim() === text,
    )
    if (!found) throw new Error(`no button «${text}»`)
    return found
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    for (const name of SAFARI) Reflect.deleteProperty(navigator, name)
  })

  it('tells how, over a live viewfinder, once Safari has asked — and reads nothing under it', async () => {
    safari('prompt')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    codes = ['4850000000007', '4850000000007']
    const sheet = await render()

    expect(hintUp()).toBe(true)
    expect(document.body.textContent).toContain(en.scanner.camera_hint_tab_path)
    expect(sheet.emitted('read')).toBeUndefined()

    // Past the hint's own rise: until it has come up, a sheet takes no tap (MOL-69).
    clock += 1000
    pageButton(en.scanner.camera_hint_ok).click()
    await settle()
    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()

    expect(hintUp()).toBe(false)
    expect(sheet.emitted('read')).toEqual([['4850000000007']])
  })

  it('must not tell where Safari will not ask', async () => {
    safari('granted')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    expect(hintUp()).toBe(false)
    expect(sheet.text()).not.toContain(en.scanner.camera_hint_offer)
  })

  it('must not tell outside Safari on a touch screen', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    await render()
    expect(hintUp()).toBe(false)
  })

  it('must not tell before the camera is given', async () => {
    safari('prompt')
    getUserMedia.mockRejectedValue(named('NotAllowedError'))
    await render()
    expect(hintUp()).toBe(false)
  })

  it('tells once on this phone; after that a quiet line brings it back', async () => {
    safari('prompt')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    await render()
    // Past the hint's own rise: until it has come up, a sheet takes no tap (MOL-69).
    clock += 1000
    pageButton(en.scanner.camera_hint_ok).click()
    await settle()
    window.dispatchEvent(new PopStateEvent('popstate'))
    await settle()
    for (const wrapper of mounted.splice(0)) wrapper.unmount()

    const sheet = await render()
    expect(hintUp()).toBe(false)
    await button(sheet, en.scanner.camera_hint_offer).trigger('click')
    await settle()
    expect(hintUp()).toBe(true)
  })

  it('starts no camera for a sheet put away while the browser answered', async () => {
    const browser = safari('held')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    await sheet.setProps({ open: false })
    browser.answer('prompt')
    await settle()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('starts no camera for a sheet turned to the digits while the browser answered', async () => {
    const browser = safari('held')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    await button(sheet, en.scanner.manual).trigger('click')
    browser.answer('prompt')
    await settle()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('lights no camera for a scanner gone with its screen while the browser answered (adversarial Д)', async () => {
    const browser = safari('held')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    mounted.splice(mounted.indexOf(sheet), 1)
    sheet.unmount()
    browser.answer('prompt')
    await settle()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('lights no camera for a scanner gone while the browser kept silent (adversarial Д)', async () => {
    safari('held')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    mounted.splice(mounted.indexOf(sheet), 1)
    sheet.unmount()
    // Past the ceiling, where the start would go on without an answer.
    await new Promise((resolve) => setTimeout(resolve, PERMISSION_WAIT * 2))
    await settle()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('asks for the camera once for one opening, however the answers cross (adversarial В)', async () => {
    // Seen before: the line, not the sheet, so nothing lies over the scanner's own buttons.
    localStorage.setItem('molvia.camera-hint', '1')
    const browser = safari('held')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    const sheet = await render()
    // Put away and opened again while Safari answered.
    await sheet.setProps({ open: false })
    await settle()
    await sheet.setProps({ open: true })
    await settle()
    browser.answer('prompt')
    await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    // The digits and back to the camera while it answered — past the sheet's rise, which takes no tap.
    getUserMedia.mockClear()
    clock += 1000
    await button(sheet, en.scanner.manual).trigger('click')
    await settle()
    await button(sheet, en.scanner.scan).trigger('click')
    await settle()
    browser.answer('prompt')
    await settle()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('asks for the camera anyway when the browser does not answer in time (adversarial Б)', async () => {
    safari('held')
    getUserMedia.mockResolvedValue(fakeStream().stream)
    await render()
    expect(getUserMedia).not.toHaveBeenCalled()
    // A real timer, polled: on a loaded machine the ceiling's own timer may come late.
    await vi.waitFor(
      () => {
        expect(getUserMedia).toHaveBeenCalledTimes(1)
      },
      { timeout: PERMISSION_WAIT * 10, interval: 20 },
    )
    await settle()
    expect(hintUp()).toBe(false)
  })

  it('puts the quiet line in the footer before the camera answers, not under a live picture', async () => {
    localStorage.setItem('molvia.camera-hint', '1')
    safari('prompt')
    getUserMedia.mockReturnValue(new Promise<MediaStream>(() => undefined))
    const sheet = await render()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(sheet.text()).toContain(en.scanner.camera_hint_offer)
  })
})
