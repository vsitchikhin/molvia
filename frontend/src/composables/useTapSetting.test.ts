import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAP_CHECK_FIRST_MS, TAP_CHECK_LAST_MS, useTapSetting } from './useTapSetting'
import type { TapSettingState } from './useTapSetting'
import { useActorStore } from '@/stores/actor'

// A setting saved on the tap whose answer was lost (MOL-96, adversarial А2, round 2 Р2-А1, №5): the
// change may have landed, so a read must say — and a read that fails is a check, not the screen's.

interface Setting {
  readonly off: boolean
}

let server: Setting = { off: false }
let online = true
const read = vi.fn<() => Promise<Setting>>()
const write = vi.fn<(next: Setting) => Promise<Setting>>()
const views: VueWrapper[] = []

async function mounted(): Promise<TapSettingState<Setting>> {
  let state: TapSettingState<Setting> | undefined
  setActivePinia(createPinia())
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  views.push(
    mount(
      defineComponent({
        setup() {
          state = useTapSetting(read, write)
          return () => h('div')
        },
      }),
    ),
  )
  await flushPromises()
  if (!state) throw new Error('not mounted')
  return state
}

/** The write lands on the server, and its answer is lost. */
function landsWithoutAnswer(): void {
  write.mockImplementation((next) => {
    server = next
    return Promise.reject(new TypeError('connection reset'))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  server = { off: false }
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  read.mockReset().mockImplementation(() => Promise.resolve(server))
  write.mockReset().mockImplementation((next) => {
    server = next
    return Promise.resolve(server)
  })
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useTapSetting: a change whose answer was lost', () => {
  it('is checked at once, and a change that landed is shown, not «not saved»', async () => {
    const tap = await mounted()
    landsWithoutAnswer()
    await tap.choose({ off: true })
    expect(read).toHaveBeenCalledTimes(2)
    expect(tap.value.value).toEqual({ off: true })
    expect(tap.unsure.value).toBe(false)
    expect(tap.saveFailed.value).toBe(false)
  })

  it('a check that fails keeps it unsure, never the screen’s failure, and tries again 5 s, 10 s … up to a minute', async () => {
    const tap = await mounted()
    landsWithoutAnswer()
    read.mockRejectedValue(new TypeError('connection reset'))
    await tap.choose({ off: true })
    expect(tap.unsure.value).toBe(true)
    expect(tap.failure.value).toBeNull()
    expect(tap.value.value).toEqual({ off: false })

    const reads = (): number => read.mock.calls.length
    const at = reads()
    await vi.advanceTimersByTimeAsync(TAP_CHECK_FIRST_MS - 1)
    expect(reads()).toBe(at)
    await vi.advanceTimersByTimeAsync(1)
    expect(reads()).toBe(at + 1)
    await vi.advanceTimersByTimeAsync(2 * TAP_CHECK_FIRST_MS)
    expect(reads()).toBe(at + 2)
    // Never longer than a minute between two checks.
    await vi.advanceTimersByTimeAsync(10 * TAP_CHECK_LAST_MS)
    expect(reads() - at).toBeGreaterThanOrEqual(2 + 9)
    expect(tap.failure.value).toBeNull()

    read.mockImplementation(() => Promise.resolve(server))
    await vi.advanceTimersByTimeAsync(TAP_CHECK_LAST_MS)
    expect(tap.unsure.value).toBe(false)
    expect(tap.value.value).toEqual({ off: true })
    const settled = reads()
    await vi.advanceTimersByTimeAsync(5 * TAP_CHECK_LAST_MS)
    expect(reads()).toBe(settled)
  })

  it('without a connection waits for it rather than the clock', async () => {
    const tap = await mounted()
    write.mockImplementation((next) => {
      server = next
      online = false
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    await tap.choose({ off: true })
    const at = read.mock.calls.length
    await vi.advanceTimersByTimeAsync(3 * TAP_CHECK_LAST_MS)
    expect(read.mock.calls.length).toBe(at)
    expect(tap.unsure.value).toBe(true)

    online = true
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(tap.unsure.value).toBe(false)
    expect(tap.value.value).toEqual({ off: true })
  })

  it('a change that did not land stays «not saved» once a check says so', async () => {
    const tap = await mounted()
    write.mockRejectedValue(new TypeError('connection reset'))
    await tap.choose({ off: true })
    expect(tap.unsure.value).toBe(false)
    expect(tap.saveFailed.value).toBe(true)
    expect(tap.value.value).toEqual({ off: false })
  })

  it('an answer that came settles it: no check is left behind', async () => {
    const tap = await mounted()
    await tap.choose({ off: true })
    const at = read.mock.calls.length
    await vi.advanceTimersByTimeAsync(3 * TAP_CHECK_LAST_MS)
    expect(read.mock.calls.length).toBe(at)
    expect(tap.unsure.value).toBe(false)
  })
})
