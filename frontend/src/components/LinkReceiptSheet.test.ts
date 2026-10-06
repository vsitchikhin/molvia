import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { ReceiptLinkBody } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import LinkReceiptSheet from '@/components/LinkReceiptSheet.vue'

const sendLink = vi.fn<(body: ReceiptLinkBody) => boolean>()
vi.mock('@/stores/receiptQueue', () => ({
  useReceiptQueueStore: () => ({ sendLink: (body: ReceiptLinkBody) => sendLink(body) }),
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
const send = (sheet: VueWrapper) =>
  sheet.findAll('button').find((button) => button.text() === en.receipt.capture.send)

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  sendLink.mockReset().mockReturnValue(true)
  online(true)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('«Чек по ссылке» (MOL-232)', () => {
  it('says how to get the link, and asks nothing of an empty field until «Отправить»', async () => {
    const sheet = await render()
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
    await field(sheet).setValue(LINK)
    await send(sheet)?.trigger('click')
    expect(sheet.text()).toContain(en.receipt.capture.not_kept)
    expect(sheet.emitted('update:open')).toBeUndefined()
  })

  it('works with no connection, and says the receipt goes once there is one', async () => {
    online(false)
    const sheet = await render()
    expect(sheet.text()).toContain(en.receipt.capture.send_offline)
    await field(sheet).setValue(LINK)
    await send(sheet)?.trigger('click')
    expect(sendLink).toHaveBeenCalledTimes(1)
  })
})
