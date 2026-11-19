import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { ActorView, ReceiptsAccess } from '@molvia/model'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { useActorStore } from '@/stores/actor'

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
    photoCountry: held.capture?.photoCountry.value,
  }
  view.unmount()
  return said
}

describe('Georgia’s camera (MOL-408, MOL-276)', () => {
  it('is there for whom the model reads, «Переснять» with it', () => {
    expect(captureOf({ ...GEORGIA, receiptsByModel: true, receiptsAccess: OPEN })).toEqual({
      country: 'GE',
      photoCountry: 'GE',
    })
  })

  it('stays with the tariff closed, for its sheet to say why — never «Переснять», read by nobody', () => {
    const over = { ...OPEN, trialLeft: 0, read: 10 }
    expect(captureOf({ ...GEORGIA, receiptsByModel: false, receiptsAccess: over })).toEqual({
      country: 'GE',
      photoCountry: null,
    })
  })

  it('is gone where the tariff is open and the model still reads none — a share or the cap spent', () => {
    expect(captureOf({ ...GEORGIA, receiptsByModel: false, receiptsAccess: OPEN })).toEqual({
      country: null,
      photoCountry: null,
    })
  })

  it('is gone where nothing is said', () => {
    expect(captureOf(GEORGIA)).toEqual({ country: null, photoCountry: null })
  })
})
