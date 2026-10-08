import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type {
  Currency,
  MoneyAccountView,
  MoneyAccountsResponse,
  TransferAmendBody,
  TransferBody,
  TransferResponse,
  TransferView,
} from '@molvia/model'
import TransferSheet from './TransferSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { useTransferOutcome } from '@/composables/useTransferOutcome'
import type { TransferOutcomes } from '@/composables/useTransferOutcome'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'

const recordTransfer =
  vi.fn<(body: TransferBody) => Promise<{ transfer: TransferResponse; created: boolean }>>()
const amendTransfer = vi.fn<(id: string, body: TransferAmendBody) => Promise<TransferResponse>>()
const removeTransfer = vi.fn<(id: string) => Promise<MoneyAccountsResponse>>()
const restoreTransfer = vi.fn<(id: string) => Promise<TransferResponse>>()
const transfer = vi.fn<(id: string) => Promise<TransferView>>()
const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>()
vi.mock('@/api', () => ({
  api: {
    recordTransfer: (body: TransferBody) => recordTransfer(body),
    amendTransfer: (id: string, body: TransferAmendBody) => amendTransfer(id, body),
    removeTransfer: (id: string) => removeTransfer(id),
    restoreTransfer: (id: string) => restoreTransfer(id),
    transfer: (id: string) => transfer(id),
    moneyAccounts: () => moneyAccounts(),
  },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRANSFER = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
let next = 0

function account(name: string, currency: Currency): MoneyAccountView {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    name,
    currency,
    savings: false,
    start: parseMoney('0', currency),
    startOn: '2026-09-16',
    balance: parseMoney('3140', currency),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: null,
    revision: 1,
  }
}

const card = account('Dad’s card', 'USD')
const dollars = account('Dollars', 'USD')
const cash = account('Cash', 'AMD')

function page(accounts: MoneyAccountView[]): MoneyAccountsResponse {
  const zero = parseMoney('0', 'AMD')
  return {
    spendCurrency: 'AMD',
    accounts,
    totals: { total: zero, spendable: zero, savings: zero, uncounted: 0 },
    unassigned: 0,
    countedAt: new Date(),
  }
}

function written(patch: Partial<TransferView> = {}): TransferView {
  return {
    id: TRANSFER,
    fromAccountId: card.id,
    toAccountId: dollars.id,
    amount: parseMoney('2000', 'USD'),
    fee: parseMoney('20', 'USD'),
    transferredOn: '2026-10-08',
    note: null,
    revision: 1,
    amendedAt: null,
    ...patch,
  }
}

function withAccounts(accounts: MoneyAccountView[]): Pinia {
  const pinia = createPinia()
  const actor = useActorStore(pinia)
  actor.id = OWNER
  actor.state = 'idle'
  useAccountsStore(pinia).accept(page(accounts))
  return pinia
}

let clock = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [
    recordTransfer,
    amendTransfer,
    removeTransfer,
    restoreTransfer,
    transfer,
    moneyAccounts,
  ]) {
    mock.mockReset()
  }
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function sheet(props: Record<string, unknown>, pinia: Pinia): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/accounts')
  const view = mount(TransferSheet, {
    props: { open: true, ...props } as never,
    attachTo: document.body,
    global: { plugins: [router, pinia, createAppI18n('en')] },
  })
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

/** «Перевести» — the large button of the footer, whatever it says now. */
const mainButton = (view: VueWrapper) => view.get('.footer button.large')
const row = (view: VueWrapper, label: string) => {
  const found = view
    .findAll('button[aria-haspopup="dialog"]')
    .find((one) => one.find('.label').exists() && one.get('.label').text().endsWith(label))
  if (!found) throw new Error(`no row «${label}»`)
  return found
}

async function typeAmount(view: VueWrapper, text: string): Promise<void> {
  await view.get('input.entry').setValue(text)
}

describe('TransferSheet (MOL-253)', () => {
  it('opens on the account it came from, with the one target of its currency put in (Р-6)', async () => {
    const view = await sheet({ from: card.id }, withAccounts([card, dollars, cash]))
    expect(row(view, 'From').text()).toContain('Dad’s card')
    expect(row(view, 'To').text()).toContain('Dollars')
    expect(mainButton(view).text()).toBe('Enter the amount')
    await typeAmount(view, '2000')
    expect(mainButton(view).text()).toContain('Transfer')
    expect(mainButton(view).text()).toContain('2')
    expect(mainButton(view).attributes('aria-disabled')).toBeUndefined()
  })

  it('says what it still needs, in order, and stays in focus (Ф-6)', async () => {
    const savings = account('Savings', 'USD')
    const none = await sheet({ from: null }, withAccounts([card, dollars, savings, cash]))
    expect(mainButton(none).text()).toBe('Choose where from')
    expect(mainButton(none).attributes('aria-disabled')).toBe('true')
    expect(row(none, 'To').attributes('aria-disabled')).toBe('true')

    const alone = await sheet({ from: cash.id }, withAccounts([card, dollars, savings, cash]))
    expect(mainButton(alone).text()).toBe('Needs a second account in drams')
    expect(alone.text()).toContain('No other account in drams')

    const two = await sheet({ from: card.id }, withAccounts([card, dollars, savings, cash]))
    expect(mainButton(two).text()).toBe('Enter the amount')
    await typeAmount(two, '100')
    expect(mainButton(two).text()).toBe('Choose where to')
  })

  it('offline: one yellow line, the button says it waits, nothing is sent', async () => {
    const view = await sheet({ from: card.id, online: false }, withAccounts([card, dollars]))
    expect(view.text()).toContain('No connection. You can transfer once online')
    await typeAmount(view, '2000')
    expect(mainButton(view).text()).toBe('We’ll transfer once online'.replace('’', "'"))
    await mainButton(view).trigger('click')
    expect(recordTransfer).not.toHaveBeenCalled()
  })

  it('sends the sum, the fee and the day under one name — the same again after a failure', async () => {
    const pinia = withAccounts([card, dollars])
    recordTransfer
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'offline', false))
      .mockResolvedValueOnce({
        transfer: { transfer: written(), accounts: page([card, dollars]) },
        created: true,
      })
    const view = await sheet({ from: card.id }, pinia)
    await typeAmount(view, '2000')
    const fee = view
      .findAll('input')
      .find((one) => one.attributes('inputmode') === 'decimal' && !one.classes('entry'))
    await fee?.setValue('20')
    expect(view.text()).toContain('leaves in all')
    await mainButton(view).trigger('click')
    await flushPromises()
    expect(view.text()).toContain('The transfer didn')
    await mainButton(view).trigger('click')
    await flushPromises()
    const [first, second] = recordTransfer.mock.calls.map(([body]) => body)
    expect(first).toMatchObject({
      fromAccountId: card.id,
      toAccountId: dollars.id,
      amount: { minor: 200_000n, currency: 'USD' },
      fee: { minor: 2_000n, currency: 'USD' },
    })
    expect(second?.id).toBe(first?.id)
    expect(view.emitted('done')).toEqual([[{ kind: 'saved', transfer: written(), created: true }]])
  })

  it('an account gone on another phone empties «Куда», marks it and keeps what was typed', async () => {
    const savings = account('Savings', 'USD')
    const pinia = withAccounts([card, dollars, savings])
    recordTransfer.mockRejectedValueOnce(new ApiError(ERROR.TRANSFER_ACCOUNT, 'gone', true))
    moneyAccounts.mockResolvedValueOnce(page([card, savings]))
    const view = await sheet({ from: card.id }, pinia)
    await typeAmount(view, '2000')
    await row(view, 'To').trigger('click')
    await flushPromises()
    // Past the moment the picker rises: until then it takes no tap at all.
    clock += 2000
    await new Promise((resolve) => setTimeout(resolve, 5))
    const option = document.body.querySelector<HTMLButtonElement>(
      `button[role="radio"]:not([aria-checked="true"])`,
    )
    expect(option?.textContent).toContain('Dollars')
    option?.click()
    await flushPromises()
    await mainButton(view).trigger('click')
    await flushPromises()
    expect(view.text()).toContain('«Dollars» was deleted on another phone')
    expect(row(view, 'To').attributes('aria-invalid')).toBe('true')
    expect((view.get('input.entry').element as HTMLInputElement).value).toBe('2000')
  })

  it('amends what it opened on and removes it with its fee', async () => {
    const pinia = withAccounts([card, dollars])
    transfer.mockResolvedValue(written({ amendedAt: new Date('2026-10-08T10:00:00Z') }))
    removeTransfer.mockResolvedValue(page([card, dollars]))
    const view = await sheet({ editingId: TRANSFER }, pinia)
    expect(view.text()).toContain('Edit transfer')
    expect(view.text()).toContain('edited')
    expect(mainButton(view).text()).toBe('Save')
    const remove = view.findAll('button').find((one) => one.text() === 'Delete transfer')
    await remove?.trigger('click')
    await flushPromises()
    expect(removeTransfer).toHaveBeenCalledWith(TRANSFER)
    expect(view.emitted('done')?.[0]).toEqual([
      { kind: 'removed', transfer: written({ amendedAt: new Date('2026-10-08T10:00:00Z') }) },
    ])
  })

  describe('adversarial round 1', () => {
    const offline = () => new ApiError(ERROR.INTERNAL, 'offline', false)
    const settle = async () => {
      await flushPromises()
      clock += 1000
      await new Promise((resolve) => setTimeout(resolve, 5))
      await flushPromises()
    }

    it('А3: a conflict of an amendment says what is recorded now, in a transfer’s words', async () => {
      transfer
        .mockResolvedValueOnce(written())
        .mockResolvedValueOnce(written({ amount: parseMoney('2500', 'USD'), revision: 2 }))
      amendTransfer
        .mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'conflict', true))
        .mockResolvedValueOnce({
          transfer: written({ revision: 3 }),
          accounts: page([card, dollars]),
        })
      const view = await sheet({ editingId: TRANSFER }, withAccounts([card, dollars]))
      await typeAmount(view, '2100')
      await mainButton(view).trigger('click')
      await settle()
      const refusal = view.get('.refusal').text()
      expect(refusal).toContain('The transfer was edited on another phone')
      expect(refusal).toMatch(/Recorded now: \$2,500 → «Dollars» · fee \$20/)
      expect(refusal).not.toMatch(/exchange|below/i)
      expect((view.get('input.entry').element as HTMLInputElement).value).toBe('2100')
      // «Сохранить» again goes over the version held now.
      await mainButton(view).trigger('click')
      await settle()
      expect(amendTransfer.mock.calls[1]?.[1]).toMatchObject({
        revision: 2,
        amount: { minor: 210_000n },
      })
    })

    it('А5: written already under its name with other figures — told so, and amended, never a second one', async () => {
      recordTransfer
        .mockRejectedValueOnce(offline())
        .mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'conflict', true))
      transfer.mockResolvedValueOnce(written())
      moneyAccounts.mockResolvedValue(page([card, dollars]))
      amendTransfer.mockResolvedValueOnce({
        transfer: written({ amount: parseMoney('2100', 'USD'), revision: 2 }),
        accounts: page([card, dollars]),
      })
      const view = await sheet({ from: card.id }, withAccounts([card, dollars]))
      await typeAmount(view, '2000')
      await mainButton(view).trigger('click')
      await settle()
      await typeAmount(view, '2100')
      await mainButton(view).trigger('click')
      await settle()
      const [first] = recordTransfer.mock.calls.map(([body]) => body)
      expect(transfer).toHaveBeenCalledWith(first?.id)
      expect(view.get('.refusal').text()).toContain('The transfer is already recorded')
      expect(moneyAccounts).toHaveBeenCalled()
      expect(mainButton(view).text()).toBe('Save')
      await mainButton(view).trigger('click')
      await settle()
      expect(recordTransfer).toHaveBeenCalledTimes(2)
      // The transfer as the server holds it, amended over its version — not a new one.
      expect(amendTransfer).toHaveBeenCalledWith(
        TRANSFER,
        expect.objectContaining({ revision: 1, amount: { minor: 210_000n, currency: 'USD' } }),
      )
    })

    it('А6: a row whose transfer the server did not give opens on «не ответил» with «Повторить»', async () => {
      transfer.mockRejectedValueOnce(offline()).mockResolvedValueOnce(written())
      const view = await sheet({ editingId: TRANSFER }, withAccounts([card, dollars]))
      expect(view.emitted('update:open')).toBeUndefined()
      expect(view.text()).toContain('The transfer didn’t open')
      const retry = view.findAll('button').find((one) => one.text() === 'Try again')
      await retry?.trigger('click')
      await settle()
      expect(mainButton(view).text()).toBe('Save')
    })

    describe('«Вернуть» (review С-3, А4)', () => {
      function outcomesHost() {
        let outcomes: TransferOutcomes | undefined
        const Child = defineComponent({
          setup() {
            outcomes = useTransferOutcome()
            return () => h('i')
          },
        })
        const Host = defineComponent({
          setup() {
            const said = provideAnnouncer()
            return () =>
              h('div', [
                h(
                  'p',
                  { class: 'said' },
                  said.value.map((one) => one.text),
                ),
                h(Child),
              ])
          },
        })
        const view = mount(Host, {
          attachTo: document.body,
          global: { plugins: [withAccounts([card, dollars]), createAppI18n('en')] },
        })
        if (!outcomes) throw new Error('not mounted')
        const said = async () => {
          await new Promise((resolve) => setTimeout(resolve, 400))
          await flushPromises()
          return view.get('.said').text()
        }
        return { outcomes, said }
      }

      it('no answer puts the strip back and asks to tap again, in a transfer’s words', async () => {
        restoreTransfer.mockRejectedValueOnce(offline())
        const { outcomes, said } = outcomesHost()
        outcomes.done({ kind: 'removed', transfer: written() })
        await outcomes.restore()
        expect(outcomes.removed.value?.id).toBe(TRANSFER)
        expect(await said()).toContain('The transfer didn’t come back')
      })

      it('too late takes the strip away and says so', async () => {
        restoreTransfer.mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'gone', true))
        const { outcomes, said } = outcomesHost()
        outcomes.done({ kind: 'removed', transfer: written() })
        await outcomes.restore()
        expect(outcomes.removed.value).toBeNull()
        expect(await said()).toContain('Too late')
      })

      it('a transfer written after the removal takes its «Вернуть» away: it is final on the server', () => {
        const { outcomes } = outcomesHost()
        outcomes.done({ kind: 'removed', transfer: written() })
        outcomes.done({
          kind: 'saved',
          transfer: written({ id: '7d1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f' }),
          created: true,
        })
        expect(outcomes.removed.value).toBeNull()
      })
    })
  })
})
