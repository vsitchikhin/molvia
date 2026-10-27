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
  it('покупка из чека несёт под собой строку, как её напечатала касса (MOL-127, 5o)', () => {
    const printed = 'ԿԱԹ ԱՇԽԱՐՀ 3.2% 1L'
    const view = mount(TripRow, {
      props: {
        row: {
          ...row(),
          expense: {
            id: 'eeeeeeee-0000-4000-8000-000000000001',
            createdAt: new Date(),
            item: milk,
            quantity: parseQuantity('1', 'l'),
            amount: parseMoney('590', 'AMD'),
            unitPrice: null,
            printed,
            discount: null,
          },
        },
      },
      global: { plugins: [createAppI18n('ru')] },
    })
    expect(view.get('.printed').text()).toBe(printed)
    // A purchase typed by hand has none, and no empty line stands in for it.
    expect(render().find('.printed').exists()).toBe(false)
  })

  it('печатает цену как на ценнике и цену за единицу — ради неё строка и существует', () => {
    const view = render()
    // 520 за 0,9 л — это 577,78 за литр: то самое число, которое в уме не считают.
    expect(plain(view.get('.meta'))).toBe('0,9 л · 577,78 ֏ за л')
    expect(plain(view.get('.tail'))).toBe('520 ֏')
  })

  it('строка кита (MOL-206, 7a): шеврон у той, что открывается, и нет его у той, что нет', () => {
    expect(render().get('.list-row').find('.chevron').exists()).toBe(true)
    expect(render({ entry: null }).find('.chevron').exists()).toBe(false)
    expect(render({ mark: 'removing' }).find('.chevron').exists()).toBe(false)
  })

  it('без цены — «без цены» под названием и прочерк в хвосте, а не пустота (7a)', () => {
    const view = render({ amount: null })
    expect(plain(view.get('.meta'))).toBe(`0,9 л · ${ru.trip.unpriced}`)
    expect(view.get('.tail').text()).toBe('—')
    expect(render({ amount: null, quantity: null }).get('.meta').text()).toBe(ru.trip.unpriced)
  })

  it('цена без количества — без пустой строки под названием', () => {
    expect(render({ quantity: null }).find('.meta').exists()).toBe(false)
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
