import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import BarcodeScannerSheet from '@/components/BarcodeScannerSheet.vue'
import { ReaderFailed, type BarcodeReader } from '@/scanner/barcodeReader'

// What the worker would read, frame by frame; a frame past the end is never answered.
let codes: (string | null | ReaderFailed)[] = []
let warm: () => Promise<void> = () => Promise.resolve()
const created = vi.fn()

vi.mock('@/scanner/barcodeReader', async (actual) => ({
  ...(await actual<object>()),
  createBarcodeReader: (): BarcodeReader => {
    created()
    let index = 0
    return {
      warm: () => warm(),
      read: () => {
        const code = codes[index++]
        if (code === undefined) return new Promise(() => undefined)
        return code instanceof ReaderFailed ? Promise.reject(code) : Promise.resolve(code)
      },
      dispose: vi.fn(),
    }
  },
}))

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
  warm = () => Promise.resolve()
  created.mockClear()
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
    expect(created).toHaveBeenCalledOnce()
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

  it('draws a reader that failed as an error too', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    warm = () => Promise.reject(new ReaderFailed())
    const sheet = await render()
    expect(sheet.find('[role="alert"]').text()).toContain(en.scanner.error_title)
  })

  it('starts the reader over when the sheet opens again after it failed', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream)
    warm = () => Promise.reject(new ReaderFailed())
    const sheet = await render()
    expect(sheet.find('[role="alert"]').exists()).toBe(true)
    await sheet.setProps({ open: false })
    warm = () => Promise.resolve()
    await sheet.setProps({ open: true })
    await settle()
    expect(sheet.find('[role="alert"]').exists()).toBe(false)
    expect(sheet.find('video').exists()).toBe(true)
    expect(created).toHaveBeenCalledTimes(2)
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

  it('stops the camera when the sheet closes', async () => {
    const { stream, track } = fakeStream()
    getUserMedia.mockResolvedValue(stream)
    const sheet = await render()
    await sheet.setProps({ open: false })
    expect(track.stop).toHaveBeenCalled()
  })
})
