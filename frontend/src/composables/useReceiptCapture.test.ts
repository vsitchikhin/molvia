import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { ActorView, ReceiptsAccess } from '@molvia/model'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { useActorStore } from '@/stores/actor'
import { hearFf } from '@/stores/ff'

vi.mock('@/api', () => ({ api: {} }))

const GEORGIA: ActorView = {
  id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f',
  country: 'GE',
  city: 'Тбилиси',
  spendCurrency: 'GEL',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-16T10:00:00Z'),
  updatedAt: new Date('2026-09-16T10:00:00Z'),
}
const OPEN: ReceiptsAccess = {
  until: null,
  ended: null,
  trialLeft: 6,
  trialOf: 10,
  month: '2026-11-01',
  read: 4,
  limit: 100,
}

function captureOf(actor: ActorView) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useActorStore()
  store.id = actor.id
  store.actor = actor
  const held: { capture?: ReturnType<typeof useReceiptCapture> } = {}
  const view = mount(
    defineComponent({
      setup() {
        held.capture = useReceiptCapture()
        return () => null
      },
    }),
    { global: { plugins: [pinia] } },
  )
  const said = {
    country: held.capture?.country.value,
    readCountry: held.capture?.readCountry.value,
    photoCountry: held.capture?.photoCountry.value,
  }
  view.unmount()
  return said
}

beforeEach(() => {
  hearFf(new Set())
})

describe('Georgia’s camera (MOL-408, MOL-276)', () => {
  it('is there for whom the model reads, «Переснять» with it', () => {
    expect(captureOf({ ...GEORGIA, receiptsByModel: true, receiptsAccess: OPEN })).toEqual({
      country: 'GE',
      readCountry: 'GE',
      photoCountry: 'GE',
    })
  })

  it('stays with the tariff closed, for its sheet to say why — never «Переснять», nor a promise to read (А5)', () => {
    const over = { ...OPEN, trialLeft: 0, read: 10 }
    expect(captureOf({ ...GEORGIA, receiptsByModel: false, receiptsAccess: over })).toEqual({
      country: 'GE',
      readCountry: null,
      photoCountry: null,
    })
  })

  it('is gone where the tariff is open and the model still reads none — a share or the cap spent', () => {
    expect(captureOf({ ...GEORGIA, receiptsByModel: false, receiptsAccess: OPEN })).toEqual({
      country: null,
      readCountry: null,
      photoCountry: null,
    })
  })

  it('is gone where nothing is said', () => {
    expect(captureOf(GEORGIA)).toEqual({ country: null, readCountry: null, photoCountry: null })
  })
})

describe('whom a receipt is promised to be read for (MOL-276, adversarial А5)', () => {
  const ARMENIA: ActorView = { ...GEORGIA, country: 'AM', city: 'Гюмри', spendCurrency: 'AMD' }
  const over = { ...OPEN, trialLeft: 0, read: 10 }

  it('is Armenia with the trial spent while Tesseract reads, the фф `payments` off', () => {
    expect(captureOf({ ...ARMENIA, receiptsAccess: over })).toMatchObject({
      country: 'AM',
      readCountry: 'AM',
    })
  })

  it('is nobody with the trial spent once payment is open: the camera stays, the promise goes', () => {
    hearFf(new Set(['payments']))
    expect(captureOf({ ...ARMENIA, receiptsAccess: over })).toMatchObject({
      country: 'AM',
      readCountry: null,
    })
  })

  it('is Serbia, read by its link whatever the model says', () => {
    expect(
      captureOf({
        ...ARMENIA,
        country: 'RS',
        city: 'Белград',
        spendCurrency: 'RSD',
        receiptsAccess: over,
      }),
    ).toMatchObject({ country: 'RS', readCountry: 'RS' })
  })
})
