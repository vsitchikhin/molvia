import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseMoney, parseQuantity } from '@molvia/model'
import type { ReceiptReviewLine } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { createRouter, createWebHistory } from 'vue-router'
import { routes } from '@/router'
import ReceiptLineSheet from '@/components/ReceiptLineSheet.vue'
import type { ReviewLine } from '@/receipts/review'
import type { LineDraft } from '@/stores/receiptDrafts'

vi.mock('@/api', () => ({
  api: new Proxy({}, { get: () => () => new Promise(() => undefined) }),
}))

const amd = (value: string) => parseMoney(value, 'AMD')
const MILK = 'aaaaaaaa-0000-4000-8000-000000000001'

/** «Шоколад»: 1 × 890 printed 980 — «≠», and found from far — «проверьте». */
function chocolate(): ReviewLine {
  const line: ReceiptReviewLine = {
    printed: 'ՇՈԿՈԼԱԴ',
    hs: null,
    sku: null,
    quantity: parseQuantity('1', 'piece'),
    price: amd('890'),
    sum: amd('980'),
    discount: null,
    settled: false,
    itemId: MILK,
    itemName: 'Шоколад',
    match: 'weak',
    translation: 'Шоколад',
    amount: amd('980'),
    rememberedPrice: null,
  }
  return {
    position: 0,
    line,
    itemId: MILK,
    name: 'Шоколад',
    isNew: false,
    check: true,
    mismatch: true,
    quantity: line.quantity,
    amount: amd('980'),
    skip: false,
    edited: false,
  }
}

/** The sheet takes no tap while it rises: the clock is moved past it once it is open. */
let clock = 0
const mounted: VueWrapper[] = []
const sheet = () => document.body.querySelector('dialog[open]')

async function render(line = chocolate()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  // The sheet lays an entry in the history: it needs the router, as on a screen.
  window.history.replaceState(null, '', '/')
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push('/purchases')
  const saved: LineDraft[] = []
  const view = mount(ReceiptLineSheet, {
    props: {
      open: true,
      line,
      total: 3,
      currency: 'AMD',
      lang: 'hy',
      place: null,
      country: 'AM',
      digits: 0,
      onSaved: (draft: LineDraft) => saved.push(draft),
    },
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  clock += 1000
  return { view, saved }
}

function press(text: string): void {
  const found = [...(sheet()?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent.includes(text),
  )
  if (!found) throw new Error(`нет кнопки «${text}»`)
  found.click()
}

describe('ReceiptLineSheet (MOL-127)', () => {
  beforeEach(() => {
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('says the mismatch with quantity × price, not with the sum it is recorded at (review 10)', async () => {
    await render()
    const text = (sheet()?.textContent ?? '').replace(/\s/gu, ' ')
    expect(text).toContain('В чеке у строки 980,00 ֏')
    expect(text).toContain('— это 890,00 ֏')
  })

  it('«Сохранить» with nothing changed writes no draft: «≠» and «проверьте» stay (review 16)', async () => {
    const { saved } = await render()
    await flushPromises()
    press(ru.receipt.line.save)
    await flushPromises()
    expect(saved).toEqual([])
  })

  it('«Не записывать» is written at once, whatever the figures (review 17)', async () => {
    const { saved } = await render()
    await flushPromises()
    const quantity = sheet()?.querySelector<HTMLInputElement>(
      '[data-field="quantity"] input, input[data-field="quantity"]',
    )
    if (quantity) {
      quantity.value = 'не число'
      quantity.dispatchEvent(new Event('input'))
    }
    await flushPromises()
    press(ru.receipt.line.skip)
    await flushPromises()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.skip).toBe(true)
    expect(saved[0]?.quantity).toEqual(parseQuantity('1', 'piece'))
  })

  it('«Вернуть в запись» brings a line left out back at once (review 17)', async () => {
    const { saved } = await render({ ...chocolate(), skip: true, edited: true })
    await flushPromises()
    press(ru.receipt.line.unskip)
    await flushPromises()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.skip).toBe(false)
  })
})
