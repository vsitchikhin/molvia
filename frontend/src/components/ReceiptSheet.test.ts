import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { parseMoney } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import ReceiptSheet from '@/components/ReceiptSheet.vue'
import { routes } from '@/router'

const TRIP = 'dddddddd-0000-4000-8000-000000000001'

function render(removable: boolean) {
  return mount(ReceiptSheet, {
    props: {
      open: false,
      tripId: TRIP,
      tripCurrency: 'AMD',
      current: parseMoney('1700', 'AMD'),
      removable,
    },
    global: {
      plugins: [
        createPinia(),
        createRouter({ history: createMemoryHistory(), routes }),
        createAppI18n('ru'),
      ],
    },
    attachTo: document.body,
  })
}

describe('ReceiptSheet — «Убрать сумму» (MOL-227, adversarial А4)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('offers no removal of the sum where the record would be left with nothing', () => {
    const sheet = render(false)
    expect(sheet.text()).not.toContain(ru.trip.receipt.sheet.remove)
    sheet.unmount()
  })

  it('offers it where purchases stay', () => {
    const sheet = render(true)
    expect(sheet.text()).toContain(ru.trip.receipt.sheet.remove)
    sheet.unmount()
  })
})
