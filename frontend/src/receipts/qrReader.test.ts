import { describe, expect, it } from 'vitest'
import type { ReaderWorker } from '@/scanner/barcodeReader'
import type { ReaderReply, ReaderRequest } from '@/scanner/protocol'
import { createReceiptQrReader, receiptLinkOfCodes } from './qrReader'

// Links made up by the model's `madeUpSerbianLink` (a sale of 486,37 дин, a copy, a refund), as in
// `LinkReceiptSheet.test.ts`: the repository is public, and a test of `src` may not import the
// package's testing export.
const sale =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAANQ2SgAAAAAAAAABmBxSTwgAAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNQ87U0RqxUqXGlv0IC2EMdY%3D'
const copy =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAABAnAAAAAAAAAAABmBxSTwgCAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNSDVAjgto%2BKbq57hjrperY0%3D'
const refund =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAABAnAAAAAAAAAAABmBxSTwgAAQBUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNRh79lQmrdnVEFzu9nNtkk0%3D'
// one letter of `vl` changed: the MD5 no longer holds
const damaged = sale.replace(/vl=(.)/u, (_, c: string) => `vl=${c === 'A' ? 'B' : 'A'}`)
const shop = 'https://shop.example/partner-discount'

describe('receiptLinkOfCodes', () => {
  it('takes the receipt’s link, checked by the model’s own function', () => {
    const found = receiptLinkOfCodes([sale])
    expect(found).toMatchObject({
      kind: 'link',
      link: { link: sale, number: 'TESTAAAA-TESTBBBB-1' },
    })
    expect(found.kind === 'link' && found.link.total).toEqual({ minor: 48_637n, currency: 'RSD' })
  })

  it('passes a shop’s own QR by for the tax office’s, whichever was read first', () => {
    expect(receiptLinkOfCodes([shop, sale]).kind).toBe('link')
    expect(receiptLinkOfCodes([sale, shop]).kind).toBe('link')
  })

  it('says why a receipt of the tax office is none to record — a refund, a copy', () => {
    expect(receiptLinkOfCodes([refund])).toEqual({ kind: 'refused', reason: 'refund' })
    expect(receiptLinkOfCodes([shop, copy])).toEqual({ kind: 'refused', reason: 'not_sale' })
  })

  it('takes a sale over a refusal on the same photo', () => {
    expect(receiptLinkOfCodes([refund, sale]).kind).toBe('link')
  })

  it('finds nothing in no code, a shop’s code or a link whose MD5 does not hold', () => {
    expect(receiptLinkOfCodes([])).toEqual({ kind: 'none' })
    expect(receiptLinkOfCodes([shop])).toEqual({ kind: 'none' })
    expect(receiptLinkOfCodes([damaged])).toEqual({ kind: 'none' })
  })
})

describe('createReceiptQrReader', () => {
  it('answers a read with every text the worker found', async () => {
    let listener: ((event: MessageEvent<ReaderReply<string[]>>) => void) | undefined
    const sent: ReaderRequest[] = []
    const worker: ReaderWorker<string[]> = {
      postMessage: (request) => {
        sent.push(request)
      },
      addEventListener: (type: 'message' | 'error', handler: never) => {
        if (type === 'message') listener = handler
      },
      terminate: () => undefined,
    }
    const reader = createReceiptQrReader(worker)
    const read = reader.read({
      data: new Uint8ClampedArray(16),
      width: 2,
      height: 2,
      colorSpace: 'srgb',
    })
    const id = sent[0]?.id ?? -1
    listener?.(new MessageEvent('message', { data: { id, ok: true, code: [shop, sale] } }))
    expect(await read).toEqual([shop, sale])
  })
})
