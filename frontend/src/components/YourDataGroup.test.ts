import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, watch } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { AnalyticsSetting } from '@molvia/model'
import YourDataGroup from './YourDataGroup.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { TAP_CHECK_FIRST_MS, forgetUnsureChanges } from '@/composables/useTapSetting'
import { useActorStore } from '@/stores/actor'

const exportMine =
  vi.fn<(options?: { signal?: AbortSignal }) => Promise<{ text: string; exportedAt: Date }>>()
const readAnalytics = vi.fn<() => Promise<AnalyticsSetting>>()
const chooseAnalytics = vi.fn<(on: boolean) => Promise<AnalyticsSetting>>()
vi.mock('@/api', () => ({
  api: {
    exportMine: (options?: { signal?: AbortSignal }) => exportMine(options),
    analyticsSetting: () => readAnalytics(),
    chooseAnalytics: (on: boolean) => chooseAnalytics(on),
  },
}))

const FILE_TEXT = '{\n  "format": "molvia-export",\n  "version": 1\n}'
// 23:59:58 in Yerevan on the 28th: the file is named by that day, whatever the phone's clock says.
const EXPORTED_AT = new Date('2026-09-28T19:59:58Z')
const ANSWER = { text: FILE_TEXT, exportedAt: EXPORTED_AT }
const share = vi.fn<(data: ShareData) => Promise<void>>()
const canShare = vi.fn<(data: ShareData) => boolean>()
const views: VueWrapper[] = []

/** What the app's live region was handed, in order (round 4, №10). */
const said: string[] = []
const WithRegion = defineComponent({
  setup() {
    const announcements = provideAnnouncer()
    watch(announcements, (now, before) => {
      for (const added of now.filter((a) => !before.some((b) => b.id === a.id)))
        said.push(added.text)
    })
    return () => h(YourDataGroup)
  },
})

async function render() {
  // «Удалить мои данные» shares the store of «Выйти» (MOL-94).
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings')
  said.length = 0
  const view = mount(WithRegion, {
    global: { plugins: [pinia, router, createAppI18n('en')] },
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
  forgetUnsureChanges()
  vi.restoreAllMocks()
  exportMine.mockReset().mockResolvedValue(ANSWER)
  readAnalytics.mockReset().mockResolvedValue({ off: false })
  chooseAnalytics.mockReset().mockImplementation((on) => Promise.resolve({ off: !on }))
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

    // And its button still reaches the browser, which answers for its own open sheet (review 22).
    share.mockRejectedValueOnce(refusal('InvalidStateError'))
    await view.get('.ready button').trigger('click')
    await flushPromises()
    expect(share).toHaveBeenCalledTimes(3)
    expect(clicked).toEqual([])
    expect(view.find('.ready').exists()).toBe(true)
  })

  it('a sheet that settles late speaks only for its own file, never over a newer one', async () => {
    const hanging: { settle: (error?: Error) => void } = { settle: () => undefined }
    share
      .mockReturnValueOnce(
        new Promise((resolve, reject) => {
          hanging.settle = (error) => {
            if (error) reject(error)
            else resolve()
          }
        }),
      )
      .mockRejectedValueOnce(refusal('InvalidStateError'))
    exportMine
      .mockResolvedValueOnce({ text: 'first', exportedAt: EXPORTED_AT })
      .mockResolvedValueOnce({ text: 'second', exportedAt: EXPORTED_AT })
    const view = await render()
    await download(view).trigger('click')
    await flushPromises()
    await download(view).trigger('click')
    await flushPromises()

    hanging.settle(refusal('AbortError'))
    await flushPromises()

    expect(view.find('.ready').exists()).toBe(true)
    await view.get('.ready button').trigger('click')
    await flushPromises()
    expect(await share.mock.calls[2]?.[0].files?.[0]?.text()).toBe('second')
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

  it('and to «Terms of use» right under it (MOL-95)', async () => {
    const view = await render()
    const labels = view.findAll('a').map((one) => one.text())
    expect(labels.indexOf(en.terms.title)).toBe(labels.indexOf(en.privacy.title) + 1)
    const link = view.findAll('a').find((one) => one.text() === en.terms.title)
    expect(link?.attributes('href')).toBe('/terms')
  })
})

describe('«Count me in the statistics» (MOL-96)', () => {
  const counted = (view: VueWrapper) => view.get<HTMLInputElement>('input[role="switch"]')

  function describedBy(view: VueWrapper): string[] {
    const ids = (counted(view).attributes('aria-describedby') ?? '').split(' ')
    return ids.map((id) => view.find(`[id="${id}"]`).text())
  }

  it('is on until the person objects, first in the group, and says that the past marks go', async () => {
    const view = await render()
    const first = view.get('li')
    expect(first.text()).toContain(en.settings.analytics.label)
    expect(counted(view).element.checked).toBe(true)
    expect(counted(view).attributes('aria-disabled')).toBeUndefined()
    expect(describedBy(view)).toEqual([en.settings.analytics.hint])
  })

  it('draws no switch until the server has answered: «not known» is no objection (adversarial А1)', async () => {
    readAnalytics.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    expect(view.get('li').text()).toContain(en.settings.analytics.label)
  })

  it('opened without a connection: no switch, and says why — never red (А1)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    readAnalytics.mockRejectedValue(new TypeError('Failed to fetch'))
    const view = await render()
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    expect(view.get('li').text()).toContain(en.settings.tap.offline)
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('turns off on the tap with no sheet, and back on (В-3)', async () => {
    const view = await render()
    await counted(view).setValue(false)
    await flushPromises()
    expect(chooseAnalytics).toHaveBeenLastCalledWith(false)
    expect(counted(view).element.checked).toBe(false)
    expect(document.querySelector('dialog[open]')).toBeNull()

    await counted(view).setValue(true)
    await flushPromises()
    expect(chooseAnalytics).toHaveBeenLastCalledWith(true)
    expect(counted(view).element.checked).toBe(true)
  })

  it('shows the objection the server holds', async () => {
    readAnalytics.mockResolvedValue({ off: true })
    const view = await render()
    expect(counted(view).element.checked).toBe(false)
  })

  it('puts the switch back where the server holds it when the answer does not come', async () => {
    chooseAnalytics.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()
    await counted(view).setValue(false)
    await flushPromises()
    expect(counted(view).element.checked).toBe(true)
    expect(view.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
  })

  it('offline: waits, and says why — never red', async () => {
    const view = await render()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(counted(view).attributes('aria-disabled')).toBe('true')
    expect(describedBy(view)).toEqual([en.settings.analytics.hint, en.settings.tap.offline])
    expect(view.find('[role="alert"]').exists()).toBe(false)
    await counted(view).trigger('click')
    await flushPromises()
    expect(chooseAnalytics).not.toHaveBeenCalled()
  })

  it('a failed read offers «Try again» and no switch, which comes with the answer (А1)', async () => {
    readAnalytics.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const view = await render()
    expect(view.text()).toContain(en.settings.tap.load_error)
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    expect(readAnalytics).toHaveBeenCalledTimes(2)
    expect(counted(view).element.checked).toBe(true)
    expect(view.text()).not.toContain(en.settings.tap.load_error)
  })

  it('an answer lost offline is asked for again when the connection comes back (adversarial А2)', async () => {
    readAnalytics.mockResolvedValue({ off: true })
    const view = await render()
    // Back on reaches the server and lands; the answer does not come back.
    chooseAnalytics.mockImplementation(() => {
      readAnalytics.mockResolvedValue({ off: false })
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    await counted(view).setValue(true)
    await flushPromises()
    // Whether it landed is not known: no switch drawn as an answer (round 2, Р2-А1).
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    expect(view.text()).toContain(en.settings.tap.offline)

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(counted(view).element.checked).toBe(true)
    expect(view.text()).not.toContain(en.settings.tap.offline)
  })

  it('an answer lost online is asked for at once, and a change that landed is not «not saved» (А2)', async () => {
    const view = await render()
    chooseAnalytics.mockImplementation(() => {
      readAnalytics.mockResolvedValue({ off: true })
      return Promise.reject(new TypeError('connection reset'))
    })
    await counted(view).setValue(false)
    await flushPromises()
    expect(readAnalytics).toHaveBeenCalledTimes(2)
    expect(counted(view).element.checked).toBe(false)
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('a change that got no answer, nor the read after it: no switch, «we do not know», checked again by itself (Р2-А1)', async () => {
    vi.useFakeTimers()
    try {
      readAnalytics.mockResolvedValue({ off: true })
      const view = await render()
      // Back on lands; its answer and the read after it are torn, the phone still says «online».
      chooseAnalytics.mockImplementation(() => {
        readAnalytics.mockRejectedValue(new TypeError('connection reset'))
        return Promise.reject(new TypeError('connection reset'))
      })
      await counted(view).setValue(true)
      await flushPromises()
      expect(view.find('input[role="switch"]').exists()).toBe(false)
      // A wait, not an error: quiet, never an alert (round 3, №7).
      expect(view.get('.quiet').text()).toContain(en.settings.tap.unsure)
      expect(view.find('[role="alert"]').exists()).toBe(false)
      expect(view.text()).not.toContain(en.settings.tap.save_failed)
      expect(view.text()).not.toContain(en.settings.tap.load_error)
      expect(readAnalytics).toHaveBeenCalledTimes(2)

      // The connection mends with no `online` event: the check comes by the clock.
      readAnalytics.mockResolvedValue({ off: false })
      await vi.advanceTimersByTimeAsync(TAP_CHECK_FIRST_MS)
      await flushPromises()
      expect(readAnalytics).toHaveBeenCalledTimes(3)
      expect(counted(view).element.checked).toBe(true)
      expect(view.find('[role="alert"]').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a refusal in the API’s own words is «not saved» at once, no «we do not know» (round 3, №6)', async () => {
    const view = await render()
    chooseAnalytics.mockRejectedValue(
      new ApiError(ERROR.INTERNAL, '', true, 500, { fromApi: true }),
    )
    await counted(view).setValue(false)
    await flushPromises()
    expect(readAnalytics).toHaveBeenCalledTimes(1)
    expect(counted(view).element.checked).toBe(true)
    expect(view.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
    expect(view.text()).not.toContain(en.settings.tap.unsure)
  })

  it('the focus a tap left on the switch waits on «we do not know» and goes back to it (Р3-А2)', async () => {
    const view = await render()
    let check: (answer: AnalyticsSetting) => void = () => undefined
    chooseAnalytics.mockImplementation(() => {
      readAnalytics.mockReturnValue(
        new Promise((resolve) => {
          check = resolve
        }),
      )
      return Promise.reject(new TypeError('connection reset'))
    })
    counted(view).element.focus()
    await counted(view).setValue(false)
    await flushPromises()
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    expect(document.activeElement).toBe(view.get('.quiet').element)
    // The focus reads the line: the live region does not say it a second time (round 4, №10).
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(said).not.toContain(en.settings.tap.unsure)

    check({ off: true })
    await flushPromises()
    expect(document.activeElement).toBe(counted(view).element)
    expect(counted(view).element.checked).toBe(false)
  })

  it('«we do not know» with the focus elsewhere is said once, in the live region (№7, №10)', async () => {
    const view = await render()
    chooseAnalytics.mockImplementation(() => {
      readAnalytics.mockReturnValue(new Promise(() => undefined))
      return Promise.reject(new TypeError('connection reset'))
    })
    await counted(view).setValue(false)
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(said.filter((text) => text === en.settings.tap.unsure)).toHaveLength(1)
  })

  it('«we do not know», then a tab and back: the screen says how the check ended (round 8, Р8-А1)', async () => {
    const view = await render()
    chooseAnalytics.mockImplementation(() => {
      readAnalytics.mockRejectedValue(new TypeError('connection reset'))
      return Promise.reject(new TypeError('connection reset'))
    })
    await counted(view).setValue(false)
    await flushPromises()
    expect(view.text()).toContain(en.settings.tap.unsure)
    views.splice(views.indexOf(view), 1)
    view.unmount()

    // The objection never landed: the server still counts the person.
    readAnalytics.mockResolvedValue({ off: false })
    const back = await render()
    expect(counted(back).element.checked).toBe(true)
    expect(back.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
  })

  it('switched off and a tab tapped at once: back, the screen says the objection was not saved (Р9-А1)', async () => {
    const view = await render()
    let fail: (error: Error) => void = () => undefined
    chooseAnalytics.mockImplementation(
      () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    )
    await counted(view).setValue(false)
    views.splice(views.indexOf(view), 1)
    view.unmount()
    fail(new TypeError('connection reset'))
    await flushPromises()

    const back = await render()
    expect(counted(back).element.checked).toBe(true)
    expect(back.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
  })

  it('back on «Settings» while «count me» is still on its way: «we do not know», then the switch as it landed (Р10-А1)', async () => {
    readAnalytics.mockResolvedValue({ off: true })
    const view = await render()
    let land: () => void = () => undefined
    chooseAnalytics.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = () => {
            readAnalytics.mockResolvedValue({ off: false })
            resolve({ off: false })
          }
        }),
    )
    await counted(view).setValue(true)
    views.splice(views.indexOf(view), 1)
    view.unmount()

    const back = await render()
    expect(back.find('input[role="switch"]').exists()).toBe(false)
    expect(back.text()).toContain(en.settings.tap.unsure)

    land()
    await flushPromises()
    expect(counted(back).element.checked).toBe(true)
    expect(back.text()).not.toContain(en.settings.tap.unsure)
    expect(back.find('[role="alert"]').exists()).toBe(false)
  })

  it('«Try again» beside «we do not know» checks at once, and a change that did not land says so', async () => {
    const view = await render()
    chooseAnalytics.mockImplementation(() => {
      readAnalytics.mockRejectedValueOnce(new TypeError('connection reset'))
      return Promise.reject(new TypeError('connection reset'))
    })
    await counted(view).setValue(false)
    await flushPromises()
    expect(view.text()).toContain(en.settings.tap.unsure)
    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    // The server still holds «on»: the change did not land, and now that is known.
    expect(counted(view).element.checked).toBe(true)
    expect(view.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
  })
})
