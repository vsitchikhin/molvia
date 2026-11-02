import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parseMoney } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import ReceiptSheet from '@/components/ReceiptSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { useTripQueueStore } from '@/stores/tripQueue'
import { routes } from '@/router'

const TRIP = 'dddddddd-0000-4000-8000-000000000001'

function render(removable: boolean) {
  return mount(ReceiptSheet, {
    props: {
      open: false,
      tripId: TRIP,
      tripCurrency: 'AMD',
      current: parseMoney('1700', 'AMD'),
      removable,
    },
    global: {
      plugins: [
        createPinia(),
        createRouter({ history: createMemoryHistory(), routes }),
        createAppI18n('ru'),
      ],
    },
    attachTo: document.body,
  })
}

describe('ReceiptSheet — «Убрать сумму» (MOL-227, adversarial А4)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('offers no removal of the sum where the record would be left with nothing', () => {
    const sheet = render(false)
    expect(sheet.text()).not.toContain(ru.trip.receipt.sheet.remove)
    sheet.unmount()
  })

  it('offers it where purchases stay', () => {
    const sheet = render(true)
    expect(sheet.text()).toContain(ru.trip.receipt.sheet.remove)
    sheet.unmount()
  })
})

// «Сумма по чеку» refused is heard (MOL-333): the focus stayed on «Сохранить», and Enter said nothing.
describe('ReceiptSheet — a refusal is heard (MOL-333)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  async function opened() {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const pinia = createPinia()
    const view = mount(
      defineComponent({
        setup() {
          // Under an announcer, as `App.vue` holds every sheet: what the sheet says lands in its region.
          provideAnnouncer()
          return () =>
            h(ReceiptSheet, { open: true, tripId: TRIP, tripCurrency: 'AMD', current: null })
        },
      }),
      {
        global: {
          plugins: [
            pinia,
            createRouter({ history: createMemoryHistory(), routes }),
            createAppI18n('ru'),
          ],
        },
        attachTo: document.body,
      },
    )
    await flushPromises()
    clock += 1000
    const dialog = document.querySelector('dialog[open]')
    const field = dialog?.querySelector<HTMLInputElement>('input[data-field="receipt"]')
    const save = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (node) => node.textContent.trim() === ru.trip.receipt.sheet.save,
    )
    if (!field || !save) throw new Error('нет поля или кнопки')
    field.value = 'сто'
    field.dispatchEvent(new Event('input'))
    await flushPromises()
    return { view, field, save, queue: useTripQueueStore(pinia) }
  }

  it('a tap on «Сохранить»: the focus goes to the sum, already marked', async () => {
    const { view, field, save, queue } = await opened()
    let marked: string | null = null
    field.addEventListener('focus', () => (marked = field.getAttribute('aria-invalid')))
    save.focus()
    save.click()
    await flushPromises()
    expect(queue.pending).toEqual([])
    expect(document.activeElement).toBe(field)
    expect(marked).toBe('true')
    view.unmount()
  })

  it('Enter in the sum keeps the focus there and says its error', async () => {
    const { view, field, queue } = await opened()
    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(queue.pending).toEqual([])
    expect(document.activeElement).toBe(field)
    expect(document.querySelector('dialog .region')?.textContent).toContain(
      ru.spending.sheet.bad_amount,
    )
    view.unmount()
  })
})
