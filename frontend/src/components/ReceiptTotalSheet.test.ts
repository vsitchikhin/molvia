import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import ReceiptTotalSheet from '@/components/ReceiptTotalSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'

let clock = 0
const mounted: VueWrapper[] = []
const sheet = () => document.body.querySelector('dialog[open]')

async function render() {
  const view = mount(
    defineComponent({
      setup() {
        // Under an announcer, as `App.vue` holds every sheet: what the sheet says lands in its region.
        provideAnnouncer()
        return () => h(ReceiptTotalSheet, { open: true, currency: 'AMD' })
      },
    }),
    {
      global: {
        plugins: [
          createPinia(),
          createRouter({ history: createMemoryHistory(), routes }),
          createAppI18n('ru'),
        ],
      },
      attachTo: document.body,
    },
  )
  mounted.push(view)
  await flushPromises()
  clock += 1000
  const field = sheet()?.querySelector<HTMLInputElement>('input')
  const save = [...(sheet()?.querySelectorAll('button') ?? [])].find(
    (node) => node.textContent.trim() === ru.trip.receipt.sheet.save,
  )
  if (!field || !save) throw new Error('нет поля или кнопки')
  field.value = 'сто'
  field.dispatchEvent(new Event('input'))
  await flushPromises()
  return { view, field, save }
}

// «Итог чека» refused is heard (MOL-333): the focus stayed on «Сохранить», and Enter said nothing.
describe('ReceiptTotalSheet — a refusal is heard (MOL-333)', () => {
  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('a tap on «Сохранить»: the focus goes to the sum, already marked', async () => {
    const { view, field, save } = await render()
    let marked: string | null = null
    field.addEventListener('focus', () => (marked = field.getAttribute('aria-invalid')))
    save.focus()
    save.click()
    await flushPromises()
    expect(view.findComponent(ReceiptTotalSheet).emitted('saved')).toBeUndefined()
    expect(document.activeElement).toBe(field)
    expect(marked).toBe('true')
  })

  it('Enter in the sum keeps the focus there and says its error', async () => {
    const { view, field } = await render()
    field.focus()
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(view.findComponent(ReceiptTotalSheet).emitted('saved')).toBeUndefined()
    expect(document.activeElement).toBe(field)
    expect(sheet()?.querySelector('.region')?.textContent).toContain(ru.spending.sheet.bad_amount)
  })
})
