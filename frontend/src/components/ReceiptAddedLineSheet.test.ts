import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import ReceiptAddedLineSheet from '@/components/ReceiptAddedLineSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import type { AddedLineDraft } from '@/stores/receiptDrafts'

vi.mock('@/api', () => ({
  api: new Proxy({}, { get: () => () => new Promise(() => undefined) }),
}))

let clock = 0
const mounted: VueWrapper[] = []
const sheet = () => document.body.querySelector('dialog[open]')

async function render(line: AddedLineDraft | null = null) {
  const pinia = createPinia()
  setActivePinia(pinia)
  // The sheet lays an entry in the history: it needs the router, as on a screen.
  window.history.replaceState(null, '', '/')
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push('/purchases')
  const saved: AddedLineDraft[] = []
  const props = {
    open: true,
    line,
    currency: 'AMD' as const,
    onSaved: (draft: AddedLineDraft) => saved.push(draft),
  }
  // Under an announcer, as `App.vue` holds every sheet: what the sheet says lands in its region.
  const view = mount(
    defineComponent({
      setup() {
        provideAnnouncer()
        return () => h(ReceiptAddedLineSheet, props)
      },
    }),
    { global: { plugins: [router, pinia, createAppI18n('ru')] }, attachTo: document.body },
  )
  mounted.push(view)
  await flushPromises()
  clock += 1000
  return { saved }
}

function button(text: string): HTMLButtonElement {
  const found = [...(sheet()?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent.includes(text),
  )
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

function press(text: string): void {
  button(text).click()
}

function typeInto(field: 'quantity' | 'amount', value: string): HTMLInputElement {
  const input = sheet()?.querySelector<HTMLInputElement>(`[data-field="${field}"]`)
  if (!input) throw new Error(`нет поля ${field}`)
  input.value = value
  input.dispatchEvent(new Event('input'))
  return input
}

// A refusal at «Готово» is heard (MOL-333): the focus stayed on «Готово», and nothing was said.
describe('ReceiptAddedLineSheet — a refusal is heard (MOL-333)', () => {
  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  // The item is a button, not a field of the kit: it takes the focus and is read with its error as its
  // description (owner's В-2 «а»), before a quantity it cannot read — the item stands first in the form.
  it('no item: the focus goes to the item’s button, its error its description', async () => {
    const { saved } = await render()
    typeInto('quantity', 'не число')
    const item = sheet()?.querySelector<HTMLButtonElement>('[data-field="item"]')
    if (!item) throw new Error('нет кнопки товара')
    let described: string | null | undefined = null
    item.addEventListener('focus', () => {
      const id = item.getAttribute('aria-describedby')
      described = id ? document.getElementById(id)?.textContent.trim() : undefined
    })
    button(ru.receipt.added.done).focus()
    press(ru.receipt.added.done)
    await flushPromises()
    expect(saved).toEqual([])
    expect(document.activeElement).toBe(item)
    expect(described).toBe(ru.receipt.added.item_missing)
  })

  // The search put away with no pick gives the focus back to the item's button; a tap Safari does not
  // move the focus for leaves it there, and a description changed under it is read by nobody — so the
  // button's error is said, by what describes it (adversarial А1 of MOL-333).
  it('no item, the focus already on its button: its error is said', async () => {
    const { saved } = await render()
    const item = sheet()?.querySelector<HTMLButtonElement>('[data-field="item"]')
    if (!item) throw new Error('нет кнопки товара')
    item.focus()
    press(ru.receipt.added.done)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(saved).toEqual([])
    expect(document.activeElement).toBe(item)
    expect(sheet()?.querySelector('.region')?.textContent).toContain(ru.receipt.added.item_missing)
  })

  it('must not fire: with an item the button is described by nothing', async () => {
    await render({ key: 'k', item: { name: 'Сыр' }, figures: { quantity: null, amount: null } })
    const item = sheet()?.querySelector<HTMLButtonElement>('[data-field="item"]')
    expect(item?.hasAttribute('aria-describedby')).toBe(false)
  })

  it('an item there and a sum refused with the focus in it: the error is said', async () => {
    const { saved } = await render({
      key: 'k',
      item: { name: 'Сыр' },
      figures: { quantity: null, amount: null },
    })
    const amount = typeInto('amount', '57о')
    amount.focus()
    await flushPromises()
    press(ru.receipt.added.done)
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(saved).toEqual([])
    expect(document.activeElement).toBe(amount)
    expect(sheet()?.querySelector('.region')?.textContent).toContain(ru.error.invalid_amount)
  })
})
