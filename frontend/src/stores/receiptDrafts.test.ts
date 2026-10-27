import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useActorStore } from '@/stores/actor'
import { useReceiptDraftsStore } from '@/stores/receiptDrafts'

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const RECEIPT = 'cccccccc-0000-4000-8000-000000000001'
const MILK = 'aaaaaaaa-0000-4000-8000-000000000001'
const CHEESE = 'aaaaaaaa-0000-4000-8000-000000000002'

describe('receiptDrafts — what the review showed at the first edit (MOL-222, adversarial В1)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    useActorStore().id = ME
  })

  it('keeps the item of the first edit, never a later one', () => {
    const drafts = useReceiptDraftsStore()
    drafts.setLine(RECEIPT, 0, { item: { id: CHEESE, name: 'Сыр' }, skip: false }, MILK)
    drafts.setLine(RECEIPT, 0, { item: { id: CHEESE, name: 'Сыр' }, skip: true }, CHEESE)
    drafts.setLine(RECEIPT, 1, { item: { name: 'Хлеб' }, skip: false }, null)
    expect(drafts.shownOf(RECEIPT)).toEqual({ 0: MILK, 1: null })
  })

  it('keeps it beside the drafts: a draft line holds nothing the build before would refuse', () => {
    const drafts = useReceiptDraftsStore()
    drafts.setLine(RECEIPT, 0, { item: { id: CHEESE, name: 'Сыр' }, skip: false }, MILK)
    const stored = JSON.parse(localStorage.getItem(`molvia.receipt-drafts.${ME}`) ?? '{}')
    expect(stored[RECEIPT].lines['0']).toEqual({ item: { id: CHEESE, name: 'Сыр' }, skip: false })
    // read again by another store, as another window or a reload does
    setActivePinia(createPinia())
    useActorStore().id = ME
    expect(useReceiptDraftsStore().shownOf(RECEIPT)).toEqual({ 0: MILK })
  })

  it('lets it go with the draft: forgotten, or no longer named', () => {
    const drafts = useReceiptDraftsStore()
    drafts.setLine(RECEIPT, 0, { item: { id: CHEESE, name: 'Сыр' }, skip: false }, MILK)
    drafts.keepOnly(new Set())
    expect(drafts.shownOf(RECEIPT)).toEqual({})
    drafts.setLine(RECEIPT, 0, { item: { id: CHEESE, name: 'Сыр' }, skip: false }, MILK)
    drafts.forget(RECEIPT)
    expect(drafts.shownOf(RECEIPT)).toEqual({})
  })
})

describe('receiptDrafts — the account chosen on the review (MOL-312)', () => {
  const CARD = '00000000-0000-4000-8000-000000000001'
  const OTHER = 'cccccccc-0000-4000-8000-000000000002'

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    useActorStore().id = ME
  })

  it('keeps it beside the drafts, where the build before never reads it', () => {
    const drafts = useReceiptDraftsStore()
    drafts.setPayment(RECEIPT, { accountId: CARD, debited: '1100,50' })
    expect(drafts.paymentOf(RECEIPT)).toEqual({ accountId: CARD, debited: '1100,50' })
    expect(localStorage.getItem(`molvia.receipt-drafts.${ME}`)).toBeNull()
    // read again by a new window of the app
    setActivePinia(createPinia())
    useActorStore().id = ME
    expect(useReceiptDraftsStore().paymentOf(RECEIPT)).toEqual({
      accountId: CARD,
      debited: '1100,50',
    })
  })

  it('lets it go with the receipt’s draft: recorded, removed, gone', () => {
    const drafts = useReceiptDraftsStore()
    drafts.setPayment(RECEIPT, { accountId: null, debited: '' })
    drafts.setPayment(OTHER, { accountId: CARD, debited: '' })
    drafts.forget(RECEIPT)
    expect(drafts.paymentOf(RECEIPT)).toBeNull()
    drafts.keepOnly(new Set([RECEIPT]))
    expect(drafts.paymentOf(OTHER)).toBeNull()
  })
})
