import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { ReceiptLinkBody } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import LinkReceiptSheet from '@/components/LinkReceiptSheet.vue'
import type { ReceiptLinkOnPhoto } from '@/receipts/qrReader'
import { ReaderFailed } from '@/scanner/barcodeReader'

const sendLink = vi.fn<(body: ReceiptLinkBody) => boolean>()
vi.mock('@/stores/receiptQueue', () => ({
  useReceiptQueueStore: () => ({ sendLink: (body: ReceiptLinkBody) => sendLink(body) }),
}))

// The photo as `decodePhoto` draws it, and what the QR worker found on it (MOL-233): the worker and
// zxing are `qrReader.test.ts`'s and `qrDecode.test.ts`'s; here only what the sheet does with it.
let photo: { width: number; height: number } | null = null
const onPhoto = vi.fn<() => Promise<ReceiptLinkOnPhoto>>()
const dispose = vi.fn()
vi.mock('@/receipts/photo', () => ({ decodePhoto: () => Promise.resolve(photo) }))
vi.mock('@/receipts/qrReader', () => ({
  createReceiptQrReader: () => ({ warm: () => Promise.resolve(), read: vi.fn(), dispose }),
  receiptLinkOnPhoto: () => onPhoto(),
}))
const reportFailure = vi.fn()
vi.mock('@/failures', () => ({
  reportFailure: (...args: unknown[]) => {
    reportFailure(...args)
  },
}))

// Links made up by the model's `madeUpSerbianLink` (a sale of 486,37 дин, a copy, a refund): the
// repository is public, and a test of `src` may not import the package's testing export.
const LINK =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAANQ2SgAAAAAAAAABmBxSTwgAAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNQ87U0RqxUqXGlv0IC2EMdY%3D'
const COPY =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAABAnAAAAAAAAAAABmBxSTwgCAABUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNSDVAjgto%2BKbq57hjrperY0%3D'
const REFUND =
  'https://suf.purs.gov.rs/v/?vl=A1RFU1RBQUFBVEVTVEJCQkIBAAAAAQAAABAnAAAAAAAAAAABmBxSTwgAAQBUc5Kx0O8OLUxriqnI5wYlRGOCocDf%2Fh08W3qZuNf2FTRTcpGwz%2B4NLEtqiajH5gUkQ2KBoL%2Fe%2FRw7WnmYt9b1FDNScZCvzu0MK0ppiKfG5QQjQmGAn77d%2FBs6WXiXttX0EzJRcI%2BuzewLKkloh6bF5AMiQWB%2Fnr3c%2Bxo5WHeWtdTzEjFQb46tzOsKKUhnhqXE4wIhQF9%2Bnbzb%2Bhk4V3aVtNPyETBPbo2sy%2BoJKEdmhaTD4gEgP159nLva%2BRg3VnWUs9LxEC9ObYyryukIJ0ZlhKPC4QAfPl18m7rZ%2BBc2VXSTstHwDy5NbIuqyegHJkVkg6LB4P8ePVx7mrnY9xY1VHOSsdDvDi1Ma4qpyOcGJURjgqHA3%2F4dPFt6mbjX9hU0U3KRsM%2FuDSxLaomox%2BYFJENigaC%2F3v0cO1p5mLfW9RQzUnGQr87tDCtKaYinxuUEI0JhgJ%2B%2B3fwbOll4l7bV9BMyUXCPrs3sCypJaIemxeQDIkFgf5693PsaOVh3lrXU8xIxUG%2BOrczrCilIZ4alxOMCIUBffp282%2FoZOFd2lbTT8hEwT26NrMvqCShHZoWkw%2BIBID9efZy72vkYN1Z1lLPS8RAvTm2Mq8rpCCdGZYSjwuEAHz5dfJu62fgXNlV0k7LR8A8uTWyLqsnoByZFZIOiweD%2FHj1ce5q52PcWNRh79lQmrdnVEFzu9nNtkk0%3D'

const mounted: VueWrapper[] = []
let clock = 0

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/purchases')
  const wrapper = mount(LinkReceiptSheet, {
    attachTo: document.body,
    props: { open: true },
    global: { plugins: [router, createAppI18n('en')] },
  })
  mounted.push(wrapper)
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 120))
  return wrapper
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const field = (sheet: VueWrapper) => sheet.get<HTMLInputElement>('input[type="text"]')
const button = (sheet: VueWrapper, words: string) =>
  sheet.findAll('button').find((one) => one.text() === words)
const send = (sheet: VueWrapper) => button(sheet, en.receipt.capture.send)

/** «Вставить»: the field of MOL-232, in this sheet. */
async function toPaste(sheet: VueWrapper): Promise<void> {
  await button(sheet, en.receipt.qr.paste_short)?.trigger('click')
  await flushPromises()
}

/** A shot taken with the camera, or picked: the file field's change, as the system hands it over. */
async function shoot(sheet: VueWrapper, camera = true): Promise<void> {
  const input = sheet.get<HTMLInputElement>(
    camera ? 'input[capture]' : 'input:not([capture])[type="file"]',
  )
  Object.defineProperty(input.element, 'files', {
    value: [new File(['jpeg'], 'receipt.jpg', { type: 'image/jpeg' })],
    configurable: true,
  })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  sendLink.mockReset().mockReturnValue(true)
  onPhoto.mockReset().mockResolvedValue({ kind: 'none' })
  dispose.mockReset()
  reportFailure.mockReset()
  photo = { width: 3024, height: 4032 }
  online(true)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('«Чек по ссылке» (MOL-232)', () => {
  it('says how to get the link, and asks nothing of an empty field until «Отправить»', async () => {
    const sheet = await render()
    await toPaste(sheet)
    expect(sheet.text()).toContain(en.receipt.link.step_qr)
    expect(sheet.text()).toContain(en.receipt.link.step_copy)
    expect(sheet.text()).toContain(en.receipt.link.step_paste)
    expect(sheet.text()).not.toContain(en.receipt.link.refusal.not_link)

    await send(sheet)?.trigger('click')
    expect(sheet.text()).toContain(en.receipt.link.refusal.not_link)
    expect(sendLink).not.toHaveBeenCalled()
  })

  it('says at once why a pasted link is no receipt to record, by the model’s own check', async () => {
    const sheet = await render()
    await toPaste(sheet)
    const cases: [string, string][] = [
      ['https://example.com/v/?vl=abc', en.receipt.link.refusal.not_link],
      [LINK.slice(0, -10), en.receipt.link.refusal.damaged],
      [COPY, en.receipt.link.refusal.not_sale],
      [REFUND, en.receipt.link.refusal.refund],
    ]
    for (const [text, refusal] of cases) {
      await field(sheet).setValue(text)
      expect(sheet.text()).toContain(refusal)
    }
    await send(sheet)?.trigger('click')
    expect(sendLink).not.toHaveBeenCalled()
  })

  it('queues the link found in what was pasted, as a Serbian receipt, and closes', async () => {
    const sheet = await render()
    await toPaste(sheet)
    await field(sheet).setValue(`Fiskalni račun: ${LINK} hvala`)
    expect(sheet.text()).not.toContain(en.receipt.link.refusal.not_link)
    await send(sheet)?.trigger('click')
    await flushPromises()
    // at work for a double tap, then away
    expect(sheet.emitted('update:open')).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(sendLink).toHaveBeenCalledTimes(1)
    expect(sendLink.mock.calls[0]?.[0]).toMatchObject({
      link: LINK,
      country: 'RS',
      language: 'en',
    })
    expect(sheet.emitted('update:open')).toEqual([[false]])
  })

  it('queues one receipt for a double click, and says it is at work until the sheet goes (adversarial А3)', async () => {
    const sheet = await render()
    await toPaste(sheet)
    await field(sheet).setValue(LINK)
    await send(sheet)?.trigger('click')
    await send(sheet)?.trigger('click')
    await flushPromises()
    expect(sendLink).toHaveBeenCalledTimes(1)
    expect(sheet.text()).toContain(en.receipt.capture.send_busy)
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(sheet.emitted('update:open')).toEqual([[false]])
  })

  it('says so when the phone could keep nothing, and stays open', async () => {
    sendLink.mockReturnValue(false)
    const sheet = await render()
    await toPaste(sheet)
    await field(sheet).setValue(LINK)
    await send(sheet)?.trigger('click')
    expect(sheet.text()).toContain(en.receipt.capture.not_kept)
    expect(sheet.emitted('update:open')).toBeUndefined()
  })

  it('works with no connection, and says the receipt goes once there is one', async () => {
    online(false)
    const sheet = await render()
    await toPaste(sheet)
    expect(sheet.text()).toContain(en.receipt.capture.send_offline)
    await field(sheet).setValue(LINK)
    await send(sheet)?.trigger('click')
    expect(sendLink).toHaveBeenCalledTimes(1)
  })
})

describe('the QR code read off the photo (MOL-233)', () => {
  const found: ReceiptLinkOnPhoto = {
    kind: 'link',
    link: {
      link: LINK,
      total: { minor: 48_637n, currency: 'RSD' },
      at: new Date('2026-10-05T10:15:00Z'),
      number: 'TESTAAAA-TESTBBBB-1',
    },
  }

  it('opens on the camera and the gallery, says how to shoot the QR, and that the photo stays', async () => {
    const sheet = await render()
    expect(sheet.text()).toContain(en.receipt.qr.hint_qr)
    expect(sheet.text()).toContain(en.receipt.qr.hint_private)
    expect(button(sheet, en.receipt.qr.take)).toBeDefined()
    expect(button(sheet, en.receipt.capture.pick)).toBeDefined()
    expect(sheet.find('input[type="text"]').exists()).toBe(false)
  })

  it('queues only the link found on the photo, lets the photo go, and closes', async () => {
    onPhoto.mockResolvedValue(found)
    const shot = photo
    const sheet = await render()
    await shoot(sheet)
    expect(sendLink).toHaveBeenCalledTimes(1)
    expect(sendLink.mock.calls[0]?.[0]).toMatchObject({ link: LINK, country: 'RS', language: 'en' })
    expect(Object.keys(sendLink.mock.calls[0]?.[0] ?? {})).not.toContain('parts')
    // read, and let go: no canvas of the photo is held (Т-3)
    expect(shot).toEqual({ width: 0, height: 0 })
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(sheet.emitted('update:open')).toEqual([[false]])
  })

  it('reads a photo picked from the gallery the same way', async () => {
    onPhoto.mockResolvedValue(found)
    const sheet = await render()
    await shoot(sheet, false)
    expect(sendLink).toHaveBeenCalledTimes(1)
  })

  it('says how to shoot it when no QR was found, and offers the link and another shot', async () => {
    const sheet = await render()
    await shoot(sheet)
    expect(sendLink).not.toHaveBeenCalled()
    expect(sheet.text()).toContain(en.receipt.qr.missed_title)
    expect(sheet.text()).toContain(en.receipt.qr.missed_body)
    expect(button(sheet, en.receipt.qr.retake)).toBeDefined()
    await button(sheet, en.receipt.qr.paste)?.trigger('click')
    await flushPromises()
    expect(field(sheet).exists()).toBe(true)
    expect(sheet.emitted('update:open')).toBeUndefined()
  })

  it('says why a receipt of the tax office is none to record — a refund, a copy', async () => {
    onPhoto.mockResolvedValue({ kind: 'refused', reason: 'refund' })
    const sheet = await render()
    await shoot(sheet)
    expect(sheet.text()).toContain(en.receipt.link.refusal.refund)
    expect(button(sheet, en.receipt.qr.take_other)).toBeDefined()

    onPhoto.mockResolvedValue({ kind: 'refused', reason: 'not_sale' })
    await shoot(sheet)
    expect(sheet.text()).toContain(en.receipt.link.refusal.not_sale)
    expect(sendLink).not.toHaveBeenCalled()
  })

  it('says a file that is no picture did not open', async () => {
    photo = null
    const sheet = await render()
    await shoot(sheet)
    expect(sheet.text()).toContain(en.receipt.capture.bad_file)
    expect(onPhoto).not.toHaveBeenCalled()
  })

  it('reports a worker that failed as the phone’s own, and leaves the link to paste', async () => {
    const cause = new Error('unreachable')
    cause.name = 'RuntimeError'
    onPhoto.mockRejectedValue(new ReaderFailed(cause))
    const shot = photo
    const sheet = await render()
    await shoot(sheet)
    expect(reportFailure).toHaveBeenCalledWith(cause, 'scanner')
    expect(sheet.text()).toContain(en.receipt.qr.missed_title)
    expect(shot).toEqual({ width: 0, height: 0 })
    // the worker that failed is let go; the next shot gets a new one
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('says it is looking while it reads, on the button pressed, and takes no second shot meanwhile', async () => {
    let answer: (value: ReceiptLinkOnPhoto) => void = () => undefined
    onPhoto.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const sheet = await render()
    await shoot(sheet)
    const busy = sheet.get('button[aria-busy="true"]')
    expect(busy.text()).toContain(en.receipt.qr.reading)
    expect(busy.text()).toContain(en.receipt.qr.take)
    const pick = sheet.findAll('button').find((one) => one.text().includes(en.receipt.capture.pick))
    expect(pick?.attributes('aria-disabled')).toBe('true')
    expect(pick?.attributes('aria-busy')).toBeUndefined()
    await shoot(sheet)
    expect(onPhoto).toHaveBeenCalledOnce()
    answer(found)
    await flushPromises()
    expect(sendLink).toHaveBeenCalledTimes(1)
  })

  it('queues the link with no connection — the QR is read on the phone', async () => {
    online(false)
    onPhoto.mockResolvedValue(found)
    const sheet = await render()
    await shoot(sheet)
    expect(sendLink).toHaveBeenCalledTimes(1)
  })

  it('lets the worker go with the sheet', async () => {
    const sheet = await render()
    sheet.unmount()
    mounted.pop()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
