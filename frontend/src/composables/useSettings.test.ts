import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { actorCodec, ERROR, settingsOf } from '@molvia/model'
import type { ActorView, SettingsUpdate } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import { useActorStore } from '@/stores/actor'
import { useSettings } from './useSettings'

const me = vi.fn<() => Promise<ActorView>>()
const save = vi.fn<(input: SettingsUpdate) => Promise<ActorView>>()
vi.mock('@/api', () => ({
  api: { me: () => me(), saveSettings: (input: SettingsUpdate) => save(input) },
}))
const initial = actorCodec.parse({
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
})
const changed = { ...initial, city: 'Ереван' }
const wrappers: { unmount(): void }[] = []
async function render() {
  let held: ReturnType<typeof useSettings> | undefined
  const view = mount(
    defineComponent({
      setup() {
        held = useSettings()
        return () => h('div')
      },
    }),
    { global: { plugins: [createAppI18n('en')] } },
  )
  wrappers.push(view)
  await flushPromises()
  if (!held) throw new Error('not mounted')
  return held
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  setActivePinia(createPinia())
  const actor = useActorStore()
  actor.id = initial.id
  actor.apply(initial)
  me.mockResolvedValue(initial)
  save.mockResolvedValue(changed)
})
afterEach(() => {
  for (const view of wrappers.splice(0)) view.unmount()
})

describe('settings drafts', () => {
  it('keeps the draft after 401 and exposes the existing identity retry', async () => {
    const { form } = await render()
    form.edit(settingsOf(changed))
    save.mockRejectedValue(new ApiError(ERROR.NO_ACTOR, 'unauthorized'))
    me.mockRejectedValue(new ApiError(ERROR.NO_ACTOR, 'unauthorized'))
    await form.save()
    expect(form.draft?.city).toBe('Ереван')
    expect(useActorStore().state).toBe('error')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps edits when leaving the screen and on reconnect, without sending them', async () => {
    const { form } = await render()
    form.edit(settingsOf(changed))
    wrappers.pop()?.unmount()
    const again = await render()
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(again.form.draft?.city).toBe('Ереван')
    expect(save).not.toHaveBeenCalled()
    await again.form.save()
    expect(save).toHaveBeenCalledWith({
      previous: settingsOf(initial),
      settings: settingsOf(changed),
    })
    expect(useActorStore().settings?.city).toBe('Ереван')
    expect(again.form.dirty).toBe(false)
  })
  it('preserves edits at a conflict and applies only after another explicit tap', async () => {
    const { form } = await render()
    form.edit(settingsOf(changed))
    save.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'conflict'))
    const rival = { ...initial, incomeCurrency: 'EUR' as const }
    me.mockResolvedValue(rival)
    await form.save()
    expect(form.conflict).toBe(true)
    expect(form.draft?.city).toBe('Ереван')
    expect(save).toHaveBeenCalledTimes(1)
    await form.save()
    expect(save).toHaveBeenLastCalledWith({
      previous: settingsOf(rival),
      settings: settingsOf(changed),
    })
  })
  it('never saves offline and keeps a draft if storage refuses it', async () => {
    const { form } = await render()
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('quota')
    })
    form.edit(settingsOf(changed))
    expect(form.stored).toBe(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await form.save()
    expect(save).not.toHaveBeenCalled()
    expect(form.draft?.city).toBe('Ереван')
  })
  it('ignores an in-flight save when the owner changes', async () => {
    const { form } = await render()
    form.edit(settingsOf(changed))
    let land: ((value: ActorView) => void) | undefined
    save.mockReturnValue(
      new Promise((resolve) => {
        land = resolve
      }),
    )
    const pending = form.save()
    const other = { ...initial, id: '2c4e6a80-1111-4222-8333-444455556666' }
    useActorStore().id = other.id
    useActorStore().apply(other)
    land?.(changed)
    await pending
    expect(useActorStore().actor?.id).toBe(other.id)
    expect(form.draft?.city).not.toBe('Ереван')
  })
  it('a failed save stays visible after a successful read and is never retried automatically', async () => {
    const { form } = await render()
    form.edit(settingsOf(changed))
    save.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    await form.save()
    expect(form.saveError).toBe(true)
    expect(form.dirty).toBe(true)
    expect(form.saving).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

it('resolves a lost successful response by reading, without another write', async () => {
  const { form } = await render()
  form.edit(settingsOf(changed))
  save.mockRejectedValue(new TypeError('network'))
  me.mockResolvedValue(changed)
  await form.save()
  expect(form.saved).toBe(true)
  expect(form.dirty).toBe(false)
  expect(form.unknown).toBe(false)
  expect(save).toHaveBeenCalledOnce()
})

it('keeps an unknown outcome across a reload and reconciles it when the connection returns', async () => {
  const { form } = await render()
  form.edit(settingsOf(changed))
  save.mockRejectedValue(new TypeError('network'))
  me.mockRejectedValue(new TypeError('network'))
  await form.save()
  expect(form.unknown).toBe(true)
  expect(form.saveError).toBe(false)
  await form.save()
  expect(save).toHaveBeenCalledOnce()
  expect(sessionStorage.getItem(`molvia.settings-draft.${initial.id}`)).toContain('"pending":true')
  wrappers.pop()?.unmount()
  setActivePinia(createPinia())
  const actor = useActorStore()
  actor.id = initial.id
  actor.apply(initial)
  const again = await render()
  expect(again.form.unknown).toBe(true)
  me.mockResolvedValue(initial)
  window.dispatchEvent(new Event('online'))
  await flushPromises()
  expect(again.form.unknown).toBe(false)
  expect(again.form.draft?.city).toBe('Ереван')
  expect(again.form.dirty).toBe(true)
  expect(save).toHaveBeenCalledOnce()
})

it('ignores repeated save taps while the first request is pending', async () => {
  const { form } = await render()
  form.edit(settingsOf(changed))
  let land: ((value: ActorView) => void) | undefined
  save.mockReturnValue(
    new Promise((resolve) => {
      land = resolve
    }),
  )
  const first = form.save()
  await form.save()
  expect(form.saving).toBe(true)
  expect(save).toHaveBeenCalledOnce()
  land?.(changed)
  await first
  expect(form.saved).toBe(true)
})
