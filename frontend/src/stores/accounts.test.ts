import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { moneyAccountsCodec, parseMoney } from '@molvia/model'
import type { AccountJournalResponse, MoneyAccountsResponse } from '@molvia/model'
import { recallJournal, rememberJournal, useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>()
const checkAccount = vi.fn<(id: string, body: unknown) => Promise<unknown>>()
vi.mock('@/api', () => ({
  api: {
    moneyAccounts: () => moneyAccounts(),
    checkAccount: (id: string, body: unknown) => checkAccount(id, body),
  },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const CASH = '5c1f8b2d-3e4a-4b6c-8d7e-9f0a1b2c3d4e'
const amd = (text: string) => parseMoney(text, 'AMD')

function page(balance: string, countedAt = '2026-09-27T10:05:00Z'): MoneyAccountsResponse {
  return {
    spendCurrency: 'AMD',
    accounts: [
      {
        id: CASH,
        name: 'Наличные ֏',
        currency: 'AMD',
        savings: false,
        start: amd('241530'),
        startOn: '2026-09-16',
        balance: amd(balance),
        approximate: false,
        uncounted: 0,
        inSpend: null,
        rate: null,
        lastCheckedOn: null,
        hasOperations: true,
        archivedAt: null,
        revision: 1,
      },
    ],
    totals: { total: amd(balance), spendable: amd(balance), savings: amd('0'), uncounted: 0 },
    unassigned: 0,
    countedAt: new Date(countedAt),
  }
}

function signedIn(id = OWNER) {
  const actor = useActorStore()
  actor.id = id
  return actor
}

describe('useAccountsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    moneyAccounts.mockReset()
    checkAccount.mockReset().mockResolvedValue(undefined)
    setActivePinia(createPinia())
  })

  it('reads the page and keeps it for offline, under its owner', async () => {
    signedIn()
    moneyAccounts.mockResolvedValue(page('190132'))
    const store = useAccountsStore()
    expect(store.phase).toBe('loading')
    await store.refresh()
    expect(store.phase).toBe('ready')
    expect(store.stale).toBeNull()

    setActivePinia(createPinia())
    signedIn()
    const again = useAccountsStore()
    expect(again.accounts[0]?.balance).toEqual(amd('190132'))
    // Remembered, not answered: the screen says «на 14:05» until the server speaks.
    expect(again.stale).toBe('loading')
    expect(again.overview?.countedAt).toEqual(new Date('2026-09-27T10:05:00Z'))

    setActivePinia(createPinia())
    signedIn(OTHER)
    expect(useAccountsStore().overview).toBeNull()
  })

  it('says offline or error after the failure, and keeps what it remembered', async () => {
    signedIn()
    localStorage.setItem(
      `molvia.accounts.${OWNER}`,
      JSON.stringify({ overview: moneyAccountsCodec.encode(page('100')) }),
    )
    const store = useAccountsStore()
    moneyAccounts.mockRejectedValue(new TypeError('Failed to fetch'))
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await store.refresh()
    expect(store.stale).toBe('offline')
    expect(store.phase).toBe('ready')
    online.mockReturnValue(true)
    await store.refresh()
    expect(store.stale).toBe('error')
    online.mockRestore()
  })

  it('reads nothing kept in a shape this version does not know', () => {
    signedIn()
    localStorage.setItem(`molvia.accounts.${OWNER}`, JSON.stringify({ overview: { accounts: 1 } }))
    expect(useAccountsStore().phase).toBe('loading')
    localStorage.setItem(`molvia.accounts.${OWNER}`, 'not json')
    setActivePinia(createPinia())
    signedIn()
    expect(useAccountsStore().overview).toBeNull()
  })

  it('takes the page a write answered over an older read still on its way', async () => {
    signedIn()
    let giveOld: (value: MoneyAccountsResponse) => void = () => undefined
    moneyAccounts.mockImplementationOnce(() => new Promise((resolve) => (giveOld = resolve)))
    const store = useAccountsStore()
    const reading = store.refresh()
    store.accept(page('300'))
    giveOld(page('100'))
    await reading
    expect(store.accounts[0]?.balance).toEqual(amd('300'))
  })

  it('reads again once a queue has had an answer — a spending moved a balance', async () => {
    signedIn()
    moneyAccounts.mockResolvedValueOnce(page('100')).mockResolvedValueOnce(page('90'))
    const store = useAccountsStore()
    await store.refresh()
    useSpendingQueueStore().landed++
    await flushPromises()
    expect(moneyAccounts).toHaveBeenCalledTimes(2)
    expect(store.accounts[0]?.balance).toEqual(amd('90'))
  })

  it('does not ask on a landing before anyone looked at the accounts', async () => {
    signedIn()
    useAccountsStore()
    useSpendingQueueStore().landed++
    await flushPromises()
    expect(moneyAccounts).not.toHaveBeenCalled()
  })

  it('keeps the first page of the three journals opened last', () => {
    const [account] = page('1').accounts
    if (!account) throw new Error('no account')
    const journal = (id: string): AccountJournalResponse => ({
      account: { ...account, id },
      rows: [],
      cursor: null,
    })
    const ids = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-00000000000${String(n)}`)
    vi.useFakeTimers()
    for (const [index, id] of ids.entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 8, 27, 10, index)))
      rememberJournal(OWNER, journal(id))
    }
    vi.useRealTimers()
    const [oldest, , , newest] = ids
    expect(recallJournal(OWNER, oldest ?? '')).toBeNull()
    expect(recallJournal(OWNER, newest ?? '')?.account.id).toBe(newest)
  })

  it('sends a check again once «Прочее · сверка» has landed — and not for another spending', async () => {
    const actor = signedIn()
    actor.state = 'idle'
    moneyAccounts.mockResolvedValue(page('100'))
    const store = useAccountsStore()
    const queue = useSpendingQueueStore()
    const WRITTEN = 'aaaaaaaa-0000-4000-8000-000000000001'
    const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002'
    const body = (id: string) => ({
      id,
      spentOn: '2026-09-26',
      amount: amd('5132'),
      categoryId: 'ffffffff-0000-4000-8000-00000000000d',
    })
    queue.record(body(OTHER))
    queue.record(body(WRITTEN))
    const check = { id: 'cccccccc-0000-4000-8000-000000000001', fact: amd('185000') }
    store.repeatAfter(WRITTEN, CASH, check)
    queue.landed++
    await flushPromises()
    expect(checkAccount).not.toHaveBeenCalled()
    // The written one leaves the queue; the other stays stuck — the repeat does not wait for it.
    queue.pending = queue.pending.filter(
      (write) => write.kind !== 'record' || write.body.id !== WRITTEN,
    )
    queue.landed++
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledExactlyOnceWith(CASH, check)
    queue.landed++
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(1)
  })
})
