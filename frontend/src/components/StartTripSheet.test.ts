import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { TripPlace } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { newId } from '@/ids'
import { routes } from '@/router'
import StartTripSheet from '@/components/StartTripSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { useTripQueueStore } from '@/stores/tripQueue'

const recentPlaces = vi.fn<() => Promise<TripPlace[]>>()
vi.mock('@/api', () => ({
  api: {
    recentPlaces: () => recentPlaces(),
    startTrip: () => new Promise(() => undefined),
    addExpense: () => new Promise(() => undefined),
    currentTrip: () => Promise.resolve(null),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

const city: TripPlace = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  kind: 'store',
  name: 'Ереван Сити',
}

let clock = 0
const mounted: VueWrapper[] = []

/** A name no place takes: a character of the private use area, pasted from a message. */
const PRIVATE = String.fromCodePoint(0xe000)

async function render({ announced = false, settings = true } = {}) {
  localStorage.setItem('molvia.actor', ME)
  if (settings)
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
    )
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const mounting = {
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  }
  // Under an announcer, as `App.vue` holds every sheet: what the sheet says lands in its region.
  const view: VueWrapper = announced
    ? mount(
        defineComponent({
          setup() {
            provideAnnouncer()
            return () => h(StartTripSheet, { open: true })
          },
        }),
        mounting,
      )
    : mount(StartTripSheet, { props: { open: true }, ...mounting })
  mounted.push(view)
  await flushPromises()
  clock += 1000
  return { view, queue: useTripQueueStore() }
}

/** The footer's one button, whatever it says now. */
function mainButton(view: VueWrapper) {
  return view.get('dialog[open] .footer button')
}

/** The field of a new place: the one text field of the sheet. */
function nameField(view: VueWrapper) {
  return view.get<HTMLInputElement>('dialog[open] input')
}

function button(view: VueWrapper, text: string) {
  const found = view.findAll('button').find((node) => node.text() === text)
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

describe('StartTripSheet', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    recentPlaces.mockReset()
    recentPlaces.mockResolvedValue([])
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('поход уходит в очередь, а не в сеть: у двери магазина ответа не ждут', async () => {
    const { view, queue } = await render()
    await view.get('input').setValue('Рынок')
    await button(view, ru.trip.none.action).trigger('click')
    await flushPromises()

    const start = queue.pending.find((write) => write.kind === 'start')
    expect(start?.place).toEqual({ kind: 'store', name: 'Рынок' })
    // Телефон называет поход сам, в нижнем регистре — иначе сервер не примет (MOL-21).
    expect(start?.tripId).toMatch(/^[0-9a-f-]{36}$/)
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('недавнее место начинает поход одним тапом', async () => {
    recentPlaces.mockResolvedValue([city])
    const { view, queue } = await render()

    await button(view, city.name).trigger('click')
    expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe(city.name)
  })

  it('без сети список берётся с телефона, и поход всё равно начинается', async () => {
    localStorage.setItem(
      `molvia.places.${ME}.${JSON.stringify(['AM', 'Гюмри'])}`,
      JSON.stringify({ places: [city] }),
    )
    recentPlaces.mockRejectedValue(new Error('Failed to fetch'))
    const { view, queue } = await render()

    await button(view, city.name).trigger('click')
    expect(queue.pending.find((write) => write.kind === 'start')).toBeDefined()
  })

  // `disabled` left the focus order in silence (MOL-354): not now, in the focus order, saying what it waits for.
  it('пустое имя — не сейчас со словами «Выберите магазин», и касание ничего не начинает', async () => {
    const { view, queue } = await render()
    for (const empty of ['', '   ', '\u200b\u2060 ']) {
      await nameField(view).setValue(empty)
      const main = mainButton(view)
      expect(main.text(), JSON.stringify(empty)).toBe(ru.receipt.place.choose_place)
      expect(main.attributes('aria-disabled'), JSON.stringify(empty)).toBe('true')
      expect(main.attributes('disabled'), JSON.stringify(empty)).toBeUndefined()
      ;(main.element as HTMLButtonElement).click()
      await flushPromises()
      expect(queue.pending, JSON.stringify(empty)).toEqual([])
      expect(nameField(view).attributes('aria-invalid'), JSON.stringify(empty)).toBeUndefined()
    }
  })

  it('граница: один видимый знак — уже «Начать запись»', async () => {
    const { view } = await render()
    await nameField(view).setValue('Я')
    expect(mainButton(view).text()).toBe(ru.trip.none.action)
    expect(mainButton(view).attributes('aria-disabled')).toBeUndefined()
  })

  // A name no place takes is no wait but a refusal (MOL-354): the button was grey over a name in sight,
  // and nothing said why.
  it('имя, которого место не примет: касание отмечает поле и ставит в него фокус', async () => {
    const { view, queue } = await render()
    await nameField(view).setValue(`Ереван Сити${PRIVATE}`)
    const main = mainButton(view)
    expect(main.text()).toBe(ru.trip.none.action)
    expect(main.attributes('aria-disabled')).toBeUndefined()
    ;(main.element as HTMLButtonElement).focus()
    ;(main.element as HTMLButtonElement).click()
    await flushPromises()
    expect(queue.pending).toEqual([])
    expect(view.emitted('update:open')).toBeUndefined()
    expect(nameField(view).attributes('aria-invalid')).toBe('true')
    expect(view.text()).toContain(ru.spending.sheet.bad_text)
    expect(document.activeElement).toBe(nameField(view).element)
    // put right, the mark goes with the error, and the start goes
    await nameField(view).setValue('Ереван Сити')
    expect(nameField(view).attributes('aria-invalid')).toBeUndefined()
    expect(view.text()).not.toContain(ru.spending.sheet.bad_text)
    ;(mainButton(view).element as HTMLButtonElement).click()
    await flushPromises()
    expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe('Ереван Сити')
  })

  it('имя, которого место не примет, с фокусом в поле: ошибка сказана в регионе шторки', async () => {
    const { view, queue } = await render({ announced: true })
    await nameField(view).setValue(`Ереван Сити${PRIVATE}`)
    nameField(view).element.focus()
    ;(mainButton(view).element as HTMLButtonElement).click()
    // The announcer's words land a task and 100 ms later: waited for as they land, never by a time.
    await vi.waitFor(() => {
      expect(document.body.querySelector('dialog[open] .region')?.textContent).toContain(
        ru.spending.sheet.bad_text,
      )
    })
    expect(queue.pending).toEqual([])
    expect(document.activeElement).toBe(nameField(view).element)
  })

  it('не должно сработать: открыта заново — имя, отказанное раньше, не отмечено', async () => {
    const { view } = await render()
    await nameField(view).setValue(`Ереван Сити${PRIVATE}`)
    ;(mainButton(view).element as HTMLButtonElement).click()
    await flushPromises()
    expect(nameField(view).attributes('aria-invalid')).toBe('true')
    await view.setProps({ open: false })
    await flushPromises()
    await view.setProps({ open: true })
    await flushPromises()
    expect(nameField(view).attributes('aria-invalid')).toBeUndefined()
    expect(view.text()).not.toContain(ru.spending.sheet.bad_text)
  })

  // «Закончить и начать новую» puts the open record away by the start itself: a refused name starts
  // nothing, so the record stays as it was (MOL-128, review Р-2).
  it('не должно сработать: отказ имени при замене записи не закрывает открытую', async () => {
    const { view, queue } = await render()
    await view.setProps({ replacing: { tripId: newId(), place: 'Рынок', empty: false } })
    await nameField(view).setValue(`Ереван Сити${PRIVATE}`)
    ;(mainButton(view).element as HTMLButtonElement).click()
    await flushPromises()
    expect(nameField(view).attributes('aria-invalid')).toBe('true')
    expect(queue.pending).toEqual([])
  })

  // Why is said by the state over the field; «Выберите магазин» would be untrue over a name typed.
  // The settings are waited for first (Р-3): with the name empty too, the word is still the action's —
  // a mutant asking for the name first passed every test before (self-review №1, adversarial Б1).
  it('без настроек — не сейчас со словом действия, пустое имя или нет, и касание ничего не начинает', async () => {
    const { view, queue } = await render({ settings: false })
    expect(view.text()).toContain(ru.settings.context_missing)
    for (const typed of ['', '   ', '\u200b', 'Рынок']) {
      await nameField(view).setValue(typed)
      const main = mainButton(view)
      expect(main.text(), JSON.stringify(typed)).toBe(ru.trip.none.action)
      expect(main.attributes('aria-disabled'), JSON.stringify(typed)).toBe('true')
      expect(main.attributes('disabled'), JSON.stringify(typed)).toBeUndefined()
      ;(main.element as HTMLButtonElement).click()
      await flushPromises()
      expect(queue.pending, JSON.stringify(typed)).toEqual([])
    }
  })

  it('невидимые знаки из буфера не делают второго магазина', async () => {
    // Перенос строки однострочное поле снимает само; направляющие знаки, которыми чат
    // оборачивает скопированное, — нет, и «\u202aЕреван Сити» стало бы вторым местом.
    const { view, queue } = await render()
    await view.get('input').setValue('\u202aЕреван Сити\u202c')
    await flushPromises()
    await button(view, ru.trip.none.action).trigger('click')

    expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe('Ереван Сити')
  })
})
