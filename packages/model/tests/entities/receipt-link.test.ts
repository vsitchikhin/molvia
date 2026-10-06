import { describe, expect, it } from 'vitest'
import { serbianReceiptLink } from '#model/entities/receipt-link'
import { madeUpSerbianLink } from './serbian-receipt'

const at = new Date('2025-07-18T06:56:53.000Z')
const link = madeUpSerbianLink({
  totalHundredths: 1_394_043,
  at,
  requestedBy: 'GL7XT63N',
  signedBy: 'GL7XT63N',
  counter: 12_218,
})
const vl = decodeURIComponent(link.slice(link.indexOf('vl=') + 3))

describe('serbianReceiptLink', () => {
  it('reads the total, the moment and the number off the link, with no network', () => {
    expect(serbianReceiptLink(link)).toEqual({
      ok: true,
      link,
      total: { minor: 1_394_043n, currency: 'RSD' },
      at,
      number: 'GL7XT63N-GL7XT63N-12218',
    })
  })

  it('finds the link in whatever was pasted around it, escaped or not, and sends it on as https', () => {
    for (const text of [
      `Račun: ${link} — hvala`,
      `https://suf.purs.gov.rs/v/?vl=${vl}`,
      `http://suf.purs.gov.rs/v/?vl=${encodeURIComponent(vl)}\n`,
      `https://SUF.PURS.GOV.RS/v/?lang=sr&vl=${encodeURIComponent(vl)}`,
    ]) {
      const read = serbianReceiptLink(text)
      expect(read.ok, text).toBe(true)
      if (read.ok) expect(read.link).toBe(link)
    }
  })

  it('takes no other host and no text without a link', () => {
    for (const text of [
      '',
      'SECER KRISTAL 1KG',
      `https://suf.purs.gov.rs.example.com/v/?vl=${vl}`,
      `https://example.com/v/?vl=${vl}`,
      `https://xsuf.purs.gov.rs/v/?vl=${vl}`,
      'https://suf.purs.gov.rs/v/?lang=sr',
    ]) {
      expect(serbianReceiptLink(text), text).toEqual({ ok: false, reason: 'not_link' })
    }
  })

  it('refuses a link one sign of which was changed, or that was cut', () => {
    const changed = vl.slice(0, 100) + (vl[100] === 'A' ? 'B' : 'A') + vl.slice(101)
    const cut = vl.slice(0, 700)
    for (const damaged of [changed, cut, `${vl}AAAA`, '%E0%A4%A']) {
      expect(serbianReceiptLink(`https://suf.purs.gov.rs/v/?vl=${damaged}`)).toEqual({
        ok: false,
        reason: 'damaged',
      })
    }
  })

  it('holds the size of vl: a byte short of a receipt’s least or past its most is none, however signed', () => {
    const sized = (bytes: number) =>
      serbianReceiptLink(madeUpSerbianLink({ totalHundredths: 100, at, bytes })).ok
    expect(sized(571)).toBe(false)
    expect(sized(572)).toBe(true)
    expect(sized(848)).toBe(true)
    expect(sized(849)).toBe(false)
  })

  it('records only a sale: a refund, a copy, a pro forma, a training and an advance receipt are not', () => {
    const of = (over: { invoiceType?: number; transactionType?: number }) =>
      serbianReceiptLink(madeUpSerbianLink({ totalHundredths: 100, at, ...over }))
    expect(of({ transactionType: 1 })).toEqual({ ok: false, reason: 'refund' })
    for (const invoiceType of [1, 2, 3, 4]) {
      expect(of({ invoiceType })).toEqual({ ok: false, reason: 'not_sale' })
    }
    expect(of({ invoiceType: 2, transactionType: 1 })).toEqual({ ok: false, reason: 'refund' })
    expect(of({}).ok).toBe(true)
  })

  it('gives nothing of the buyer a receipt made out to a firm carries', () => {
    const read = serbianReceiptLink(
      madeUpSerbianLink({ totalHundredths: 100, at, buyer: '10:100000009' }),
    )
    expect(read.ok).toBe(true)
    expect(
      JSON.stringify(read, (_, value: unknown) => (typeof value === 'bigint' ? 0 : value)),
    ).not.toContain('100000009')
  })

  it('rounds a total signed past the para half up, in the currency’s minor units', () => {
    const total = (totalTenThousandths: bigint) => {
      const read = serbianReceiptLink(
        madeUpSerbianLink({ totalHundredths: 0, totalTenThousandths, at }),
      )
      return read.ok ? read.total.minor : null
    }
    expect(total(8_291_200n)).toBe(82_912n)
    expect(total(8_291_249n)).toBe(82_912n)
    expect(total(8_291_250n)).toBe(82_913n)
  })
})
