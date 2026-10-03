import { describe, expect, it } from 'vitest'
import { parseMoney, parseQuantity } from '@molvia/model'
import type { Money, ReceiptDetail, ReceiptReviewLine } from '@molvia/model'
import { recordBody, reviewBalance, reviewDay, reviewLines, reviewPlace } from '@/receipts/review'
import type { ReceiptDraft } from '@/stores/receiptDrafts'

const amd = (value: string): Money => parseMoney(value, 'AMD')
const MILK = 'aaaaaaaa-0000-4000-8000-000000000001'
const PLACE = 'bbbbbbbb-0000-4000-8000-000000000001'
const TRIP = 'dddddddd-0000-4000-8000-000000000001'

function line(
  printed: string,
  quantity: string,
  unit: 'piece' | 'kg',
  price: string,
  sum: string,
  extra: Partial<ReceiptReviewLine> = {},
): ReceiptReviewLine {
  return {
    printed,
    hs: null,
    sku: null,
    quantity: parseQuantity(quantity, unit),
    price: amd(price),
    sum: amd(sum),
    discount: null,
    settled: true,
    itemId: MILK,
    itemName: 'Молоко',
    match: 'memory',
    translation: null,
    amount: amd(sum),
    rememberedPrice: null,
    ...extra,
  }
}

/**
 * Four lines of receipt A of the handoff: «Шоколад» printed 980, 1 × 890. The lines come to 3 573
 * at what they are recorded at, the total is 3 663 — 90 more, the chocolate's difference.
 */
function receiptA(total: string | null = '3663'): ReceiptDetail {
  return {
    receipt: {
      id: 'cccccccc-0000-4000-8000-000000000001',
      status: 'parsed',
      failure: null,
      parts: 1,
      received: 1,
      capturedAt: new Date('2026-09-26T15:42:00Z'),
      country: 'AM',
      language: 'ru',
      header: { tin: '02541234', date: '2026-09-26', time: '19:42', receiptNo: '17' },
      total: total === null ? null : amd(total),
      balanced: false,
      lineCount: 4,
      unsettled: 1,
      place: { id: PLACE, name: 'Ереван Сити', city: 'Гюмри', tin: '02541234' },
      tripId: null,
    },
    lines: [
      line('ԿԱԹ ԱՇԽԱՐՀ 3.2% 1L', '1', 'piece', '531', '531'),
      line('ԼՈԼԻԿ ՏԵՂԱԿԱՆ', '0.8', 'kg', '1290', '1032', { itemName: 'Помидоры' }),
      line('ՊԱՆԻՐ ԼՈՌԻ ԱՊԽ.', '0.35', 'kg', '3200', '1120', {
        itemId: null,
        itemName: null,
        match: 'new',
        translation: 'Сыр Лори копчёный',
      }),
      line('ՇՈԿՈԼԱԴ ԳՐԱՆԴ', '1', 'piece', '890', '980', {
        settled: false,
        itemName: 'Шоколад «Гранд»',
        match: 'weak',
        amount: amd('890'),
      }),
    ],
    rate: null,
    duplicateOf: null,
  }
}

describe('the lines of the review', () => {
  it('a line not edited is the server’s: its item, its amount, «≠» and «проверьте» as read', () => {
    const lines = reviewLines(receiptA(), null)
    expect(lines.map((one) => [one.name, one.isNew, one.check, one.mismatch])).toEqual([
      ['Молоко', false, false, false],
      ['Помидоры', false, false, false],
      ['Сыр Лори копчёный', true, false, false],
      ['Шоколад «Гранд»', false, true, true],
    ])
    expect(lines[3]?.amount).toEqual(amd('890'))
  })

  it('an edit stands over the reading, and settles the item and the sum', () => {
    const draft: ReceiptDraft = {
      lines: {
        3: {
          item: { id: MILK, name: 'Шоколад «Гранд»' },
          quantity: parseQuantity('1', 'piece'),
          amount: amd('980'),
          skip: false,
        },
      },
    }
    const [, , , chocolate] = reviewLines(receiptA(), draft)
    expect(chocolate).toMatchObject({ check: false, mismatch: false, edited: true })
    expect(chocolate?.amount).toEqual(amd('980'))
  })
})

describe('the balance — the model’s, not a sum of the phone’s', () => {
  it('names the line the difference sits in', () => {
    const detail = receiptA()
    const balance = reviewBalance(detail, reviewLines(detail, null), null)
    expect(balance.lines).toEqual(amd('3573'))
    expect(balance.difference).toEqual(amd('90'))
    expect(balance.suspect).toBe(3)
    expect(balance.recorded).toBe(4)
  })

  it('a line left out stays in «Строки» and leaves «Записать N»', () => {
    const detail = receiptA()
    const draft: ReceiptDraft = {
      lines: {
        0: { item: { id: MILK, name: 'Молоко' }, quantity: null, amount: amd('531'), skip: true },
      },
    }
    const balance = reviewBalance(detail, reviewLines(detail, draft), draft)
    expect(balance.lines).toEqual(amd('3573'))
    expect(balance.recorded).toBe(3)
  })

  it('a total corrected by the person is the one compared', () => {
    const detail = receiptA(null)
    const draft: ReceiptDraft = { lines: {}, total: amd('3573') }
    const balance = reviewBalance(detail, reviewLines(detail, draft), draft)
    expect(balance.difference).toEqual(amd('0'))
  })

  it('no total read — no difference, and nothing to blame', () => {
    const detail = receiptA(null)
    const balance = reviewBalance(detail, reviewLines(detail, null), null)
    expect(balance.difference).toBeNull()
    expect(balance.suspect).toBeNull()
  })
})

describe('what «Записать» sends', () => {
  it('every line once, a new item by its name, the place the server found, the printed day', () => {
    const detail = receiptA()
    const body = recordBody(detail, null, reviewLines(detail, null), TRIP, '2026-09-27')
    expect(body).toMatchObject({
      tripId: TRIP,
      place: { id: PLACE },
      purchasedOn: '2026-09-26',
    })
    expect(body?.total).toBeUndefined()
    expect(body?.lines.map((one) => one.position)).toEqual([0, 1, 2, 3])
    expect(body?.lines[2]).toMatchObject({ skip: false, item: { name: 'Сыр Лори копчёный' } })
  })

  it('a line left out goes as «не записываем»', () => {
    const detail = receiptA()
    const draft: ReceiptDraft = {
      lines: { 1: { item: { name: 'Помидоры' }, quantity: null, amount: null, skip: true } },
    }
    const body = recordBody(detail, draft, reviewLines(detail, draft), TRIP, '2026-09-27')
    expect(body?.lines[1]).toEqual({ position: 1, skip: true })
  })

  it('no place known — nothing to send: «Записать» asks for it first', () => {
    const detail = { ...receiptA(), receipt: { ...receiptA().receipt, place: null } }
    expect(reviewPlace(detail, null)).toBeNull()
    expect(recordBody(detail, null, reviewLines(detail, null), TRIP, '2026-09-27')).toBeNull()
  })

  it('a date not read is the day the photo was taken, and the person’s choice wins over both', () => {
    const detail = { ...receiptA(), receipt: { ...receiptA().receipt, header: null } }
    expect(reviewDay(detail, null, '2026-09-27')).toBe('2026-09-27')
    expect(reviewDay(detail, { lines: {}, purchasedOn: '2026-09-25' }, '2026-09-27')).toBe(
      '2026-09-25',
    )
  })
})
