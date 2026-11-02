import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReceiptPlaceSheet from '@/components/ReceiptPlaceSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'

const recentPlaces = vi.fn(() => Promise.resolve([] as { id: string; name: string }[]))
vi.mock('@/api', () => ({
  api: { recentPlaces: () => recentPlaces() },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const PLACE = 'aaaaaaaa-0000-4000-8000-000000000009'
/** 22:30 on the 3rd by the phone, in UTC — 02:30 on the 4th in Yerevan, where the till printed. */
const NOW = new Date('2026-10-03T22:30:00Z')
const ACTION = 'Записать 13 покупок'

const mounted: VueWrapper[] = []
/** Until the sheet has risen it takes no press (BottomSheet): the tests move its clock on. */
let clock = 0

/** The footer's one button, whatever it says now. */
function mainButton(): HTMLButtonElement | undefined {
  return document.body.querySelector<HTMLButtonElement>('dialog[open] .footer button') ?? undefined
}

async function render(day: string, announced = false) {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().state = 'ready'
  // The sheet lays an entry in the history: it needs the router, as on a screen.
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/purchases')
  const chosen: [unknown, string][] = []
  const props = {
    open: true,
    country: 'AM' as const,
    current: { id: PLACE, name: 'Ереван Сити', city: 'Гюмри' },
    read: true,
    day,
    action: ACTION,
    onChosen: (place: unknown, on: string) => chosen.push([place, on]),
  }
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
            return () => h(ReceiptPlaceSheet, props)
          },
        }),
        mounting,
      )
    : mount(ReceiptPlaceSheet, { props, ...mounting })
  mounted.push(view)
  await flushPromises()
  clock += 1000
  const button = [...document.body.querySelectorAll('dialog[open] button')].find((node) =>
    node.textContent.includes(ACTION),
  ) as HTMLButtonElement | undefined
  return { view, button, chosen }
}

/** The footer's button pressed through the test's own event, as a tap would. */
async function press(view: VueWrapper): Promise<void> {
  await view.get('dialog[open] .footer button').trigger('click')
  await flushPromises()
}

function dayField(): HTMLInputElement {
  const field = document.body.querySelector<HTMLInputElement>('dialog[open] input[type="date"]')
  if (!field) throw new Error('нет поля «Когда»')
  return field
}

describe('ReceiptPlaceSheet (MOL-127): the day of the purchases', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('the day printed after Yerevan’s midnight passes on a phone west of it (adversarial В1)', async () => {
    const { view, button, chosen } = await render('2026-10-04')
    expect(button?.getAttribute('aria-disabled')).toBeNull()
    expect(view.html()).not.toContain(ru.spending.sheet.bad_day)
    await press(view)
    expect(chosen.map(([, on]) => on)).toEqual(['2026-10-04'])
  })

  // A day refused at the tap is heard (MOL-333, owner's В-3 «б»): `disabled` left the button out of
  // the focus order, and a screen reader passed it by with the day's error unheard.
  it('a day the server would not take is still refused: misread far ahead, or before 2000 (review 18, 33)', async () => {
    for (const day of ['2026-10-06', '2099-10-01', '2000-01-01']) {
      const { view, button, chosen } = await render(day)
      expect(view.html(), day).toContain(ru.spending.sheet.bad_day)
      expect(button?.disabled, day).toBe(false)
      expect(button?.getAttribute('aria-disabled'), day).toBeNull()
      const field = dayField()
      let marked: string | null = null
      field.addEventListener('focus', () => (marked = field.getAttribute('aria-invalid')))
      button?.focus()
      await press(view)
      expect(chosen, day).toEqual([])
      expect(document.activeElement, day).toBe(field)
      expect(marked, day).toBe('true')
      for (const one of mounted.splice(0)) one.unmount()
    }
  })

  it('a day refused with the focus in it: its error is said in the sheet', async () => {
    const { view, chosen } = await render('2099-10-01', true)
    const field = dayField()
    field.focus()
    await press(view)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(chosen).toEqual([])
    expect(document.activeElement).toBe(field)
    expect(document.body.querySelector('dialog[open] .region')?.textContent).toContain(
      ru.spending.sheet.bad_day,
    )
  })

  it('no day at all: not now, saying so, and a tap sends nothing', async () => {
    const { view, chosen } = await render('2026-10-03')
    const field = dayField()
    field.value = ''
    field.dispatchEvent(new Event('input'))
    await flushPromises()
    const button = mainButton()
    expect(button?.textContent.trim()).toBe(ru.receipt.place.choose_day)
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    expect(button?.disabled).toBe(false)
    await press(view)
    expect(chosen).toEqual([])
  })

  it('the phone’s today passes', async () => {
    const { button } = await render('2026-10-03')
    expect(button?.getAttribute('aria-disabled')).toBeNull()
  })
})

describe('ReceiptPlaceSheet (MOL-109, adversarial А2): a receipt of another country than the settings', () => {
  /** A person whose settings moved to Tbilisi, with an Armenian receipt taken before. */
  async function away(current: { name: string; city: string } | null) {
    localStorage.setItem('molvia.actor', ME)
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({
        country: 'GE',
        city: 'Тбилиси',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      }),
    )
    recentPlaces.mockResolvedValue([{ id: PLACE, name: 'Carrefour' }])
    const pinia = createPinia()
    setActivePinia(pinia)
    useActorStore().state = 'ready'
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/purchases')
    const view = mount(ReceiptPlaceSheet, {
      props: {
        open: true,
        country: 'AM',
        current,
        read: current !== null,
        day: '2026-09-26',
        action: ACTION,
      },
      global: { plugins: [router, pinia, createAppI18n('ru')] },
      attachTo: document.body,
    })
    mounted.push(view)
    await flushPromises()
    return view
  }

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  const select = () => document.body.querySelector<HTMLSelectElement>('dialog[open] select')

  async function record(view: Awaited<ReturnType<typeof away>>, name: string) {
    await view.get('input:not([type="date"])').setValue(name)
    await flushPromises()
    const button = [...document.body.querySelectorAll('dialog[open] button')].find((node) =>
      node.textContent.includes(ACTION),
    ) as HTMLButtonElement
    // the sheet takes no press until it has risen (BottomSheet): its clock moves on
    vi.spyOn(performance, 'now').mockReturnValue(60_000)
    button.click()
    await flushPromises()
    return (view.emitted('chosen') as [[{ name: string; city: string }, string]] | undefined)?.[0]
  }

  it('offers the receipt country’s cities, not the settings’ Tbilisi, and its new shop is there', async () => {
    const view = await away(null)
    expect([...(select()?.options ?? [])].map((option) => option.value)).toEqual([
      'Гюмри',
      'Ереван',
    ])
    const [place] = (await record(view, 'Ереван Сити')) ?? []
    expect(place).toEqual({ name: 'Ереван Сити', city: 'Гюмри' })
  })

  it('no shop yet: not now, saying what it waits for', async () => {
    await away(null)
    const button = mainButton()
    expect(button?.textContent.trim()).toBe(ru.receipt.place.choose_place)
    expect(button?.getAttribute('aria-disabled')).toBe('true')
  })

  // A shop typed in a name no place takes is no wait but a refusal (adversarial А2 of MOL-333): the button
  // said «Выберите магазин» over it, the name unmarked.
  it('a name no place takes: the tap marks it and the focus goes to it', async () => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const view = await away(null)
    clock += 1000
    const name = view.get('input:not([type="date"])')
    await name.setValue(`Ереван Сити${String.fromCodePoint(0xe000)}`)
    await flushPromises()
    const button = view.get('dialog[open] .footer button')
    expect(button.text()).toBe(ACTION)
    expect(button.attributes('aria-disabled')).toBeUndefined()
    ;(button.element as HTMLButtonElement).focus()
    ;(button.element as HTMLButtonElement).click()
    await flushPromises()
    expect(view.emitted('chosen')).toBeUndefined()
    expect(name.element.getAttribute('aria-invalid')).toBe('true')
    expect(view.text()).toContain(ru.spending.sheet.bad_text)
    expect(document.activeElement).toBe(name.element)
    // put right, the mark goes with the error
    await name.setValue('Ереван Сити')
    expect(name.element.getAttribute('aria-invalid')).toBeNull()
  })

  it('must not fire: opened again, the name refused before is not marked (adversarial Р2-А1)', async () => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const view = await away(null)
    clock += 1000
    await view
      .get('input:not([type="date"])')
      .setValue(`Ереван Сити${String.fromCodePoint(0xe000)}`)
    ;(view.get('dialog[open] .footer button').element as HTMLButtonElement).click()
    await flushPromises()
    expect(view.get('input:not([type="date"])').element.getAttribute('aria-invalid')).toBe('true')
    await view.setProps({ open: false })
    await flushPromises()
    await view.setProps({ open: true })
    await flushPromises()
    const name = view.get('input:not([type="date"])').element
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(view.text()).not.toContain(ru.spending.sheet.bad_text)
  })

  it('takes the city read off the receipt first', async () => {
    await away({ name: 'SAS', city: 'Ереван' })
    expect(select()?.value).toBe('Ереван')
  })

  it('does not offer the shops of Tbilisi: the server would refuse them', async () => {
    await away(null)
    expect(document.body.querySelector('dialog[open]')?.textContent).not.toContain('Carrefour')
  })

  it('must not fire: a receipt of the person’s own country has no city field', async () => {
    await render('2026-09-26')
    expect(select()).toBeNull()
  })
})
