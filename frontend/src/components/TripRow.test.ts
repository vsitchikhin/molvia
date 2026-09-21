import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseMoney, parseQuantity, unitPrice } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import TripRow from '@/components/TripRow.vue'
import type { RowMark, TripRowView } from '@/components/tripRow'

const milk: CatalogueEntry = {
  id: 'dddddddd-0000-4000-8000-000000000001',
  kind: 'product',
  name: 'Молоко «Марианна»',
  note: null,
  defaultUnit: 'l',
  typicalQuantity: null,
}

interface Over {
  readonly amount?: string | null
  readonly quantity?: [string, 'kg' | 'l' | 'piece'] | null
  readonly mark?: RowMark
  readonly entry?: CatalogueEntry | null
}

function row(over: Over = {}): TripRowView {
  const quantity = over.quantity === undefined ? (['0.9', 'l'] as const) : over.quantity
  const amount = over.amount === undefined ? '520' : over.amount
  const parsedQuantity = quantity ? parseQuantity(quantity[0], quantity[1]) : null
  const parsedAmount = amount ? parseMoney(amount, 'AMD') : null
  return {
    key: 'aa000000-0000-4000-8000-000000000002',
    name: milk.name,
    quantity: parsedQuantity,
    amount: parsedAmount,
    unitPrice: parsedAmount && parsedQuantity ? unitPrice(parsedAmount, parsedQuantity) : null,
    mark: over.mark ?? null,
    entry: over.entry === undefined ? milk : over.entry,
    expense: null,
  }
}

const plain = (found: { text: () => string }): string => found.text().replaceAll(' ', ' ')

const render = (over: Over = {}) =>
  mount(TripRow, { props: { row: row(over) }, global: { plugins: [createAppI18n('ru')] } })

describe('TripRow', () => {
  it('печатает цену как на ценнике и цену за единицу — ради неё строка и существует', () => {
    const view = render()
    expect(plain(view)).toContain('0,9 л')
    expect(plain(view)).toContain('520,00 ֏')
    // 520 за 0,9 л — это 577,78 за литр: то самое число, которое в уме не считают.
    expect(plain(view)).toContain('577,78 ֏ за л')
  })

  it('без цены зовёт её дописать, а не показывает пустоту', () => {
    const view = render({ amount: null })
    expect(view.text()).toContain(ru.trip.add_price)
    expect(view.find('.amount').exists()).toBe(false)
  })

  it('метка очереди говорит, что именно ещё не ушло', () => {
    expect(render({ mark: 'waiting' }).text()).toContain(ru.trip.queued.waiting)
    expect(render({ mark: 'editing' }).text()).toContain(ru.trip.queued.editing)
    expect(render({ mark: 'removing' }).text()).toContain(ru.trip.queued.removing)
  })

  it('строку открывают тапом, а удаляемую — нет: правка ушла бы следом за удалением', async () => {
    const open = render()
    expect(open.element.tagName).toBe('BUTTON')
    await open.trigger('click')
    expect(open.emitted('open')).toHaveLength(1)

    const removing = render({ mark: 'removing' })
    expect(removing.element.tagName).toBe('DIV')
    await removing.trigger('click')
    expect(removing.emitted('open')).toBeUndefined()
  })

  it('без карточки товара строка не открывается — открывать нечем', async () => {
    const unknown = render({ entry: null })
    expect(unknown.element.tagName).toBe('DIV')
    await unknown.trigger('click')
    expect(unknown.emitted('open')).toBeUndefined()
  })

  it('пересчёта в строке нет никогда: сравнивают по цене на ценнике', () => {
    expect(render().text()).not.toContain('≈')
  })
})
