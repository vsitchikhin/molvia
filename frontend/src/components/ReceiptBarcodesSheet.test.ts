import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReceiptBarcodesSheet from '@/components/ReceiptBarcodesSheet.vue'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'

const mounted: VueWrapper[] = []

async function render() {
  // The sheet lays an entry in the history: it needs the router, as on a screen.
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/purchases')
  const view = mount(ReceiptBarcodesSheet, {
    props: {
      open: true,
      codes: [
        { position: 0, code: '8600000000004', name: 'Сахар Sunoko' },
        { position: 3, code: '8601234567899', name: 'Печенье Medeno srce' },
      ],
    },
    global: { plugins: [router, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  // up only at the end of its rise: a tap before that is held (MOL-69)
  await new Promise((resolve) => setTimeout(resolve, 350))
  return view
}

const button = (view: VueWrapper, text: string) => {
  const found = view.findAll('button').find((one) => one.text() === text)
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('ReceiptBarcodesSheet (MOL-234, owner’s В-2 «а»)', () => {
  it('names each code with the item it would go to, and says who will see it', async () => {
    const view = await render()
    expect(view.text()).toContain(ru.receipt.codes.title)
    expect(view.text()).toContain(ru.receipt.codes.body)
    expect(view.text()).toContain('Сахар Sunoko')
    expect(view.text()).toContain('8600000000004')
    expect(view.text()).toContain('Печенье Medeno srce')
    expect(view.findAll('li')).toHaveLength(2)
  })

  it('«Привязать и записать» answers yes and puts itself away', async () => {
    const view = await render()
    await button(view, ru.item.barcode.bind).trigger('click')
    expect(view.emitted('answered')).toEqual([[true]])
    expect(view.emitted('update:open')).toEqual([[false]])
  })

  it('«Записать без кодов» answers no and puts itself away', async () => {
    const view = await render()
    await button(view, ru.receipt.codes.skip).trigger('click')
    expect(view.emitted('answered')).toEqual([[false]])
    expect(view.emitted('update:open')).toEqual([[false]])
  })
})
