import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import YourDataGroup from './YourDataGroup.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

const exportMine =
  vi.fn<(options?: { signal?: AbortSignal }) => Promise<{ text: string; exportedAt: Date }>>()
vi.mock('@/api', () => ({
  api: { exportMine: (options?: { signal?: AbortSignal }) => exportMine(options) },
}))

const FILE_TEXT = '{\n  "format": "molvia-export",\n  "version": 1\n}'
// 23:59:58 in Yerevan on the 28th: the file is named by that day, whatever the phone's clock says.
const EXPORTED_AT = new Date('2026-09-28T19:59:58Z')
const ANSWER = { text: FILE_TEXT, exportedAt: EXPORTED_AT }
const share = vi.fn<(data: ShareData) => Promise<void>>()
const canShare = vi.fn<(data: ShareData) => boolean>()
const views: VueWrapper[] = []

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings')
  const view = mount(YourDataGroup, {
    global: { plugins: [router, createAppI18n('en')] },
    attachTo: document.body,
  })
  views.push(view)
  await flushPromises()
  return view
}

const download = (view: VueWrapper) => view.get('button.entry')
const refusal = (name: string) => new DOMException(name, name)

function shareable(on: boolean): void {
  Object.defineProperty(navigator, 'canShare', {
    configurable: true,
    value: on ? canShare : undefined,
  })
  if (!on) Reflect.deleteProperty(navigator, 'canShare')
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  canShare.mockReturnValue(true)
}

let clicked: string[] = []

function pointer(coarse: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  vi.restoreAllMocks()
  exportMine.mockReset().mockResolvedValue(ANSWER)
  share.mockReset().mockResolvedValue(undefined)
  canShare.mockReset()
  shareable(true)
  pointer(true)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  clicked = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this.download)
  })
  URL.createObjectURL = vi.fn(() => 'blob:export')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  Reflect.deleteProperty(navigator, 'canShare')
  Reflect.deleteProperty(navigator, 'share')
})

describe('«Скачать мои данные» (MOL-93)', () => {
  it('asks for the file and offers it on the share sheet, named by the day', async () => {
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()

    expect(exportMine).toHaveBeenCalledOnce()
    const file = share.mock.calls[0]?.[0].files?.[0]
    expect(file?.name).toBe('molvia-2026-09-28.json')
    expect(file?.type).toBe('application/json')
    expect(await file?.text()).toBe(FILE_TEXT)
    expect(view.find('.ready').exists()).toBe(false)
    expect(clicked).toEqual([])
  })

  it('a sheet the phone would not open this late waits for a second tap, which hands it over', async () => {
    share.mockRejectedValueOnce(refusal('NotAllowedError'))
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()
    expect(view.get('.ready').text()).toContain(en.settings.export.ready)

    await view.get('.ready button').trigger('click')
    await flushPromises()

    expect(share).toHaveBeenCalledTimes(2)
    expect(exportMine).toHaveBeenCalledOnce()
    expect(view.find('.ready').exists()).toBe(false)
  })

  it('refused again on the second tap, the file is downloaded instead', async () => {
    share.mockRejectedValue(refusal('NotAllowedError'))
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()
    await view.get('.ready button').trigger('click')
    await flushPromises()

    expect(clicked).toEqual([expect.stringMatching(/^molvia-.*\.json$/)])
    expect(view.find('.ready').exists()).toBe(false)
  })

  it('a sheet closed by the person is not an error, and the file stays ready to hand over', async () => {
    share.mockRejectedValueOnce(refusal('AbortError'))
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()

    expect(view.get('.ready').text()).toContain(en.settings.export.ready)
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(clicked).toEqual([])
  })

  it('on a computer the file is downloaded, never offered on a sheet without «Save»', async () => {
    pointer(false)
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()

    expect(share).not.toHaveBeenCalled()
    expect(clicked).toEqual([expect.stringMatching(/^molvia-.*\.json$/)])
  })

  it('the second tap reaches the sheet within the tap itself, before anything is awaited', async () => {
    share.mockRejectedValueOnce(refusal('NotAllowedError'))
    const view = await render()
    await download(view).trigger('click')
    await flushPromises()

    ;(view.get('.ready button').element as HTMLButtonElement).click()

    expect(share).toHaveBeenCalledTimes(2)
  })

  it('a row tapped while a sheet hangs still answers — the file waits, never downloads over it', async () => {
    share
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockRejectedValueOnce(refusal('InvalidStateError'))
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()
    ;(download(view).element as HTMLButtonElement).click()
    await flushPromises()

    expect(exportMine).toHaveBeenCalledTimes(2)
    expect(share).toHaveBeenCalledTimes(2)
    expect(clicked).toEqual([])
    // The new file is not thrown away: it waits for the sheet to go (adversarial Р2-А).
    expect(view.get('.ready').text()).toContain(en.settings.export.ready)
  })

  it('leaving the screen while the file is prepared cancels it, and nothing is handed over', async () => {
    let answer: (value: typeof ANSWER) => void = () => undefined
    let signal: AbortSignal | undefined
    exportMine.mockImplementation((options) => {
      signal = options?.signal
      return new Promise((resolve) => (answer = resolve))
    })
    const view = await render()

    await download(view).trigger('click')
    view.unmount()
    answer(ANSWER)
    await flushPromises()

    expect(signal?.aborted).toBe(true)
    expect(share).not.toHaveBeenCalled()
    expect(clicked).toEqual([])
  })

  it('where a file cannot be shared — a computer — it is downloaded at once', async () => {
    shareable(false)
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()

    expect(share).not.toHaveBeenCalled()
    expect(clicked).toEqual([expect.stringMatching(/^molvia-.*\.json$/)])
  })

  it('says it is preparing the file while the server answers, and takes no second tap', async () => {
    let answer: (value: typeof ANSWER) => void = () => undefined
    exportMine.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const view = await render()

    await download(view).trigger('click')
    expect(download(view).text()).toContain(en.settings.export.busy)
    expect(download(view).attributes('aria-busy')).toBe('true')
    ;(download(view).element as HTMLButtonElement).click()
    answer(ANSWER)
    await flushPromises()

    expect(exportMine).toHaveBeenCalledOnce()
    expect(download(view).text()).toContain(en.settings.export.label)
  })

  it('offline, the row waits for the connection and asks nothing', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const view = await render()

    expect(download(view).attributes('aria-disabled')).toBe('true')
    expect(download(view).attributes('disabled')).toBeUndefined()
    expect(download(view).text()).toContain(en.settings.export.offline)
    ;(download(view).element as HTMLButtonElement).click()
    await flushPromises()

    expect(exportMine).not.toHaveBeenCalled()
  })

  it('a failure with a connection is red and offers to try again', async () => {
    exportMine.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain(en.settings.export.failed)

    await view.get('.failed button').trigger('click')
    await flushPromises()

    expect(exportMine).toHaveBeenCalledTimes(2)
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(share).toHaveBeenCalledOnce()
  })

  it('a connection lost on the way is said quietly, never red (MOL-19)', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get')
    exportMine.mockImplementationOnce(() => {
      online.mockReturnValue(false)
      return Promise.reject(new ApiError(ERROR.INTERNAL, 'transport', false))
    })
    const view = await render()

    await download(view).trigger('click')
    await flushPromises()

    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(view.get('.quiet').text()).toContain(en.settings.export.lost)
  })

  it('leads to «Data and privacy» from the same group', async () => {
    const view = await render()
    const link = view.findAll('a').find((one) => one.text() === en.privacy.title)
    expect(link?.attributes('href')).toBe('/privacy')
  })
})
