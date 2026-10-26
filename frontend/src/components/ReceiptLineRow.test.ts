import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseMoney, parseQuantity } from '@molvia/model'
import type { ReceiptReviewLine } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import ReceiptLineRow from '@/components/ReceiptLineRow.vue'
import type { ReviewLine } from '@/receipts/review'

const amd = (value: string) => parseMoney(value, 'AMD')

function row(over: Partial<ReviewLine>, match: ReceiptReviewLine['match']): ReviewLine {
  const line: ReceiptReviewLine = {
    printed: 'Յոգուրտ «Երեմյան Փրոդաքթս» ելակ 2% 130գր',
    hs: null,
    sku: null,
    quantity: parseQuantity('1', 'piece'),
    price: amd('300'),
    sum: amd('300'),
    discount: null,
    settled: true,
    itemId: null,
    itemName: null,
    match,
    translation: 'Йогурт «Еремян Продактс» клубника 2% 130 г',
    amount: amd('300'),
    rememberedPrice: null,
  }
  return {
    position: 0,
    line,
    itemId: null,
    name: 'Йогурт «Еремян Продактс» клубника 2% 130 г',
    isNew: true,
    check: true,
    repaired: false,
    mismatch: false,
    quantity: line.quantity,
    amount: line.amount,
    skip: false,
    edited: false,
    ownFigures: false,
    changed: { item: false, figures: false },
    ...over,
  }
}

const render = (line: ReviewLine) =>
  mount(ReceiptLineRow, { props: { line, lang: 'hy' }, global: { plugins: [createAppI18n('ru')] } })

describe('ReceiptLineRow (MOL-293)', () => {
  it('says «проверьте» of a new item named by the binding, its name not repeated as «в чеке»', () => {
    const text = render(row({}, 'weak')).text()
    expect(text).toContain(ru.receipt.review.tag_new)
    expect(text).toContain(ru.receipt.review.tag_check)
    expect(text).not.toContain('в чеке —')
  })

  it('says what the receipt prints beside an item found unsure', () => {
    const found = row(
      { isNew: false, itemId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Йогурт' },
      'weak',
    )
    expect(render(found).text()).toContain('в чеке — «Йогурт «Еремян Продактс» клубника 2% 130 г»')
  })
})

describe('ReceiptLineRow — a line’s package (MOL-264, В-2 «а»)', () => {
  const packed = (over: Partial<ReviewLine> = {}) => {
    const plain = row({}, 'search')
    return row(
      {
        line: {
          ...plain.line,
          quantity: parseQuantity('2', 'piece'),
          pack: parseQuantity('130', 'g'),
        },
        quantity: parseQuantity('260', 'g'),
        ...over,
      },
      'search',
    )
  }

  it('keeps the till’s count beside its price, and says the purchase after it', () => {
    const wrapper = render(packed())
    expect(wrapper.find('.figures').text().replace(/\s+/gu, ' ')).toBe('2 шт × 300 ֏ · 0,26 кг')
    expect(wrapper.find('.packed').text()).toBe('0,26 кг')
    expect(wrapper.attributes('aria-label')?.replace(/\s+/gu, ' ')).toContain(
      '2 шт × 300 ֏, запишем 0,26 кг',
    )
  })

  it('says no package of a line with none, nor once the person typed their own figures', () => {
    expect(render(row({}, 'search')).find('.packed').exists()).toBe(false)
    const own = render(packed({ ownFigures: true, quantity: parseQuantity('0.5', 'kg') }))
    expect(own.find('.packed').exists()).toBe(false)
    expect(own.find('.figures').text()).toBe('0,5 кг')
  })
})
