import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef, watch } from 'vue'
import type { AppLocale } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import UpdateBand from '@/components/UpdateBand.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { pwaUpdateKey, type UpdatePhase } from '@/pwaUpdate'

function fakeUpdate(phase: UpdatePhase) {
  return { phase: shallowRef(phase), apply: vi.fn(), serverVersion: vi.fn() }
}

function render(update: ReturnType<typeof fakeUpdate>, locale: AppLocale = 'en') {
  const said: string[] = []
  const App = defineComponent({
    setup() {
      const announcements = provideAnnouncer()
      watch(announcements, (now, before) => {
        for (const added of now.filter((a) => !before.some((b) => b.id === a.id))) {
          said.push(added.text)
        }
      })
      return () => h(UpdateBand)
    },
  })
  const view = mount(App, {
    global: { plugins: [createAppI18n(locale)], provide: { [pwaUpdateKey as symbol]: update } },
  })
  return { view, said }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('«Вышла новая версия · Обновить» (MOL-132)', () => {
  it('is not there while nothing waits', () => {
    const { view } = render(fakeUpdate('none'))
    expect(view.find('.band').exists()).toBe(false)
  })

  it('offers the version, and «Обновить» takes it', async () => {
    const update = fakeUpdate('ready')
    const { view } = render(update, 'ru')

    expect(view.text()).toContain('Вышла новая версия')
    await view.get('button').trigger('click')

    expect(update.apply).toHaveBeenCalledOnce()
  })

  it('holds the button busy while the version is let in, and a second tap sends nothing', async () => {
    const update = fakeUpdate('applying')
    const { view } = render(update)

    const button = view.get('button')
    expect(button.attributes('aria-busy')).toBe('true')
    await button.trigger('click')

    expect(update.apply).not.toHaveBeenCalled()
  })

  it('asks for the app to be closed all the way when the version did not take, in both phones’ words', () => {
    const { view } = render(fakeUpdate('failed'), 'ru')

    expect(view.find('button').exists()).toBe(false)
    expect(view.text()).toContain('Не получилось обновить')
    expect(view.text()).toContain('iPhone')
    expect(view.text()).toContain('Android')
  })

  it('has its words in English too', () => {
    expect(render(fakeUpdate('ready'), 'en').view.text()).toContain('A new version is out')
    expect(render(fakeUpdate('failed'), 'en').view.text()).toContain('The update did not take')
  })

  describe('said out loud', () => {
    it('once, as the version comes', async () => {
      const update = fakeUpdate('none')
      const { said } = render(update)

      update.phase.value = 'ready'
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()

      expect(said).toEqual(['A new version is out'])
    })

    it('by a strip born with the version already waiting — as every screen draws its own (Д1)', async () => {
      const { said } = render(fakeUpdate('ready'))
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(said).toEqual(['A new version is out'])
    })

    it('must not be said again by the strip the next screen draws anew', async () => {
      const update = fakeUpdate('ready')
      const first = render(update)
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()
      first.view.unmount()

      const next = render(update)
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()

      expect(first.said).toEqual(['A new version is out'])
      expect(next.said).toEqual([])
    })

    it('says a failure the page came up with, before any strip was there (Д1)', async () => {
      const { said } = render(fakeUpdate('failed'))
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()
      expect(said).toEqual(['The update did not take'])
    })

    it('says the failure, and not the moment in between', async () => {
      const update = fakeUpdate('ready')
      const { said } = render(update)

      update.phase.value = 'applying'
      await nextTick()
      update.phase.value = 'failed'
      await nextTick()
      vi.advanceTimersByTime(200)
      await nextTick()

      expect(said).toEqual(['The update did not take'])
    })
  })
})
