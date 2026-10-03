import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import {
  receiptBodySchema,
  receiptDetailCodec,
  receiptSummaryCodec,
} from '#model/contracts/receipt'

const body = {
  id: '0b0d8f1e-5c1a-4e2b-9a64-3f0d9c4a1e77',
  parts: 2,
  country: 'AM',
  language: 'ru',
  capturedAt: '2026-10-03T08:15:00.000Z',
}

describe('«Отправить чек»', () => {
  it('takes a receipt of one to four parts', () => {
    expect(receiptBodySchema.safeParse({ ...body, parts: 1 }).success).toBe(true)
    expect(receiptBodySchema.safeParse({ ...body, parts: 4 }).success).toBe(true)
    expect(receiptBodySchema.safeParse({ ...body, parts: 0 }).success).toBe(false)
    expect(receiptBodySchema.safeParse({ ...body, parts: 5 }).success).toBe(false)
  })

  it('refuses an id the device spelled in capitals: the answer would not match it', () => {
    expect(receiptBodySchema.safeParse({ ...body, id: body.id.toUpperCase() }).success).toBe(false)
  })

  it('refuses a country whose receipts are not read yet, and a language the app has not', () => {
    expect(receiptBodySchema.safeParse({ ...body, country: 'GE' }).success).toBe(false)
    expect(receiptBodySchema.safeParse({ ...body, language: 'hy' }).success).toBe(false)
  })

  it('refuses what it does not know', () => {
    expect(receiptBodySchema.safeParse({ ...body, total: '100' }).success).toBe(false)
  })
})

describe('a receipt on the wire', () => {
  const view: z.input<typeof receiptSummaryCodec> = {
    id: body.id,
    status: 'parsed',
    failure: null,
    parts: 2,
    received: 2,
    capturedAt: body.capturedAt,
    country: 'AM',
    language: 'ru',
    header: { tin: '01282006', date: '2026-09-30', time: '15:03', receiptNo: '21410811' },
    total: { amount: '8676.41', currency: 'AMD' },
    balanced: true,
    lineCount: 1,
    unsettled: 0,
  }

  it('reads back what the server writes', () => {
    const decoded = receiptSummaryCodec.decode(view)
    expect(decoded.total).toEqual({ minor: 867_641n, currency: 'AMD' })
    expect(receiptSummaryCodec.encode(decoded)).toEqual(view)
  })

  it('reads a receipt still waiting for the reader: no head, no total', () => {
    const waiting: z.input<typeof receiptSummaryCodec> = {
      ...view,
      status: 'queued',
      header: null,
      total: null,
      balanced: false,
      lineCount: 0,
    }
    expect(receiptSummaryCodec.safeParse(waiting).success).toBe(true)
  })

  it('carries lines with a weight, and a line whose figures were lost', () => {
    const detail: z.input<typeof receiptDetailCodec> = {
      receipt: view,
      lines: [
        {
          printed: 'Թուզ կգ',
          hs: '0804',
          sku: '032748',
          quantity: { value: '0.902', unit: 'kg' },
          price: { amount: '675', currency: 'AMD' },
          sum: { amount: '608.86', currency: 'AMD' },
          discount: { amount: '0', currency: 'AMD' },
          settled: true,
        },
        {
          printed: '?',
          hs: null,
          sku: null,
          quantity: null,
          price: null,
          sum: null,
          discount: null,
          settled: false,
        },
      ],
    }
    const decoded = receiptDetailCodec.decode(detail)
    expect(decoded.lines[0]?.quantity).toEqual({ milli: 902n, unit: 'kg' })
    expect(decoded.lines[1]?.sum).toBeNull()
  })
})
