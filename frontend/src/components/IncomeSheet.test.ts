import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { IncomeAmendBody, IncomeBody, IncomeView, IncomesResponse } from '@molvia/model'
import IncomeSheet from './IncomeSheet.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

const record = vi.fn<(body: IncomeBody) => Promise<unknown>>()
const amend = vi.fn<(id: string, body: IncomeAmendBody) => Promise<'saved' | 'conflict' | 'gone'>>()

const INCOME = '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d'
const EXCHANGE = '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d'

function overview(patch: Partial<IncomesResponse> = {}): IncomesResponse {
  return {
    base: 'RUB',
    baseSince: null,
    months: [],
    // Drams bought with roubles on the 1st: they have a price from then on.
    receipts: [{ id: EXCHANGE, currency: 'AMD', on: '2026-09-01', priced: true }],
    heldEstimates: [
      { held: { minor: 2_000_000n, currency: 'AMD' }, whole: true, from: 'exchange' },
    ],
    ...patch,
  }
}

const amended: IncomeView = {
  id: INCOME,
  receivedOn: '2026-09-15',
  amount: { minor: 9_961_500n, currency: 'RUB' },
  heldBefore: null,
  source: 'salary',
  note: 'Vikasa',
  accountId: null,
  revision: 2,
  amendedAt: new Date('2026-09-25T09:00:00.000Z'),
  history: [
    {
      amount: { minor: 9_900_000n, currency: 'RUB' },
      receivedOn: '2026-09-15',
      heldBefore: null,
      source: 'bonus',
      note: null,
      replacedAt: new Date('2026-09-25T09:00:00.000Z'),
    },
  ],
}

let clock = 0

beforeEach(() => {
  setActivePinia(createPinia())
  record.mockReset()
  amend.mockReset()
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function render(
  state: IncomesResponse = overview(),
  editing: IncomeView | null = null,
  announced = false,
): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/incomes')
  const props = { open: true, overview: state, record, amend, editing }
  const mounting = {
    attachTo: document.body,
    global: { plugins: [router, createPinia(), createAppI18n('en')] },
  }
  // Under an announcer, as `App.vue` holds every sheet: what the sheet says lands in its region.
  const view: VueWrapper = announced
    ? mount(
        defineComponent({
          setup() {
            provideAnnouncer()
            return () => h(IncomeSheet, props)
          },
        }),
        mounting,
      )
    : mount(IncomeSheet, { props, ...mounting })
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

function field(view: VueWrapper, label: string) {
  const found = view.findAll('.app-field').find((one) => one.text().includes(label))
  if (!found) throw new Error(`no field «${label}»`)
  return found
}

async function fill(view: VueWrapper, amount: string, currency = 'RUB', source = 'salary') {
  await field(view, en.income.sheet.amount).get('input').setValue(amount)
  await field(view, en.income.sheet.currency).get('select').setValue(currency)
  if (source) await field(view, en.income.sheet.source).get('select').setValue(source)
}

/** The control, and whether it was marked at the moment the focus came to it. */
function watchFocus(view: VueWrapper, label: string, tag: 'input' | 'select' = 'input') {
  const control = field(view, label).get(tag).element as HTMLElement
  const at = { marked: null as string | null }
  control.addEventListener('focus', () => {
    at.marked = control.getAttribute('aria-invalid')
  })
  return { control, at }
}

function saveButton(view: VueWrapper): HTMLButtonElement {
  const button = view.findAll('button').find((one) => one.text() === en.income.sheet.save)
  if (!button) throw new Error('no «Save income»')
  return button.element
}

async function save(view: VueWrapper, label = en.income.sheet.save): Promise<void> {
  const button = view.findAll('button').find((one) => one.text() === label)
  await button?.trigger('click')
  await flushPromises()
}

describe('IncomeSheet', () => {
  // The phone's today (MOL-121, Т-3): at 20:30 UTC it is the 28th here and the 29th in Yerevan.
  it('starts on the phone’s today, and allows no later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T20:30:00Z'))
    try {
      const view = await render()
      const day = field(view, en.income.sheet.day).get('input').element as HTMLInputElement
      expect(day.value).toBe('2026-09-28')
      expect(day.max).toBe('2026-09-28')
    } finally {
      vi.useRealTimers()
    }
  })

  it('records the amount in the currency of conversion by default, with its source', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await field(view, en.income.sheet.amount).get('input').setValue('99615')
    await field(view, en.income.sheet.source).get('select').setValue('salary')
    await save(view)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { minor: 9_961_500n, currency: 'RUB' },
        source: 'salary',
      }),
    )
    const [body] = record.mock.calls[0] ?? []
    expect(body?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body && 'heldBefore' in body).toBe(false)
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
  })

  // MOL-225, В-3: while it saves, the button is the one at work — its own word, the action's look and
  // the focus kept (a `disabled` one dropped the focus to the page), and a second tap sends nothing.
  it('says «Saving income…» while it saves, keeps the focus and takes no second tap', async () => {
    let settle: (value: unknown) => void = () => undefined
    record.mockImplementation(() => new Promise((resolve) => (settle = resolve)))
    const view = await render()
    await fill(view, '99615')
    const button = view.findAll('button').find((one) => one.text() === en.income.sheet.save)
    if (!button) throw new Error('no «Save income»')
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    await flushPromises()
    expect(button.text()).toBe(en.income.sheet.saving)
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes('disabled')).toBeUndefined()
    expect(document.activeElement).toBe(button.element)
    await button.trigger('click')
    expect(record).toHaveBeenCalledOnce()
    settle(undefined)
    await flushPromises()
  })

  it('refuses without a source or an amount, under their fields (В-3)', async () => {
    const view = await render()
    await fill(view, '0', 'RUB', '')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(field(view, en.income.sheet.source).text()).toContain(en.income.sheet.no_source)
    expect(field(view, en.income.sheet.amount).text()).toContain(en.error.invalid_amount)
  })

  it('asks what was held only for a currency that has a price that day, never the base', async () => {
    const view = await render()
    await fill(view, '200000', 'RUB')
    expect(view.text()).not.toContain('held before it came in')
    await fill(view, '200000', 'AMD')
    expect(view.text()).toContain('held before it came in')
    expect(view.text()).toContain('By the recorded spending ≈')
    // Before the drams had a price, nothing held weighs anything.
    await field(view, en.income.sheet.day).get('input').setValue('2026-08-30')
    expect(view.text()).not.toContain('held before it came in')
    // Dollars were never bought: the first money into them is valued alone.
    await fill(view, '500', 'USD')
    expect(view.text()).not.toContain('held before it came in')
  })

  it('asks nothing before the currency of conversion was chosen — the bank is not asked then', async () => {
    const view = await render(overview({ baseSince: '2026-09-10' }))
    await fill(view, '200000', 'AMD')
    await field(view, en.income.sheet.day).get('input').setValue('2026-09-05')
    expect(view.text()).not.toContain('held before it came in')
    await field(view, en.income.sheet.day).get('input').setValue('2026-09-12')
    expect(view.text()).toContain('held before it came in')
  })

  it('sends what was held in the currency that came in', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await fill(view, '200000', 'AMD')
    await field(view, 'held before it came in').get('input').setValue('115000')
    await save(view)
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      heldBefore: { minor: 11_500_000n, currency: 'AMD' },
    })
  })

  it('says money bought with the base is an exchange — for any currency but the base (Р-6)', async () => {
    const view = await render()
    const hint = en.income.sheet.bought_hint.replace('{base}', '₽')
    await fill(view, '1', 'RUB')
    expect(view.text()).not.toContain(hint)
    await fill(view, '1', 'USD')
    expect(view.text()).toContain(hint)
  })

  // A field refused is heard (MOL-333): the focus went nowhere, and nothing was said.
  it('no source chosen: the focus goes to «Source», already marked', async () => {
    const view = await render()
    await fill(view, '99615', 'RUB', '')
    const source = watchFocus(view, en.income.sheet.source, 'select')
    saveButton(view).focus()
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(source.control)
    expect(source.at.marked).toBe('true')
  })

  it('the first field marked in the form takes it: the sum before the source', async () => {
    const view = await render()
    await fill(view, 'abc', 'RUB', '')
    const amount = watchFocus(view, en.income.sheet.amount)
    saveButton(view).focus()
    await save(view)
    expect(field(view, en.income.sheet.source).get('select').attributes('aria-invalid')).toBe(
      'true',
    )
    expect(document.activeElement).toBe(amount.control)
    expect(amount.at.marked).toBe('true')
  })

  it('a note refused from inside it keeps the focus there and says its error', async () => {
    const view = await render(overview(), null, true)
    await fill(view, '99615')
    const note = field(view, en.income.sheet.note).get('input')
    await note.setValue(String.fromCharCode(7))
    ;(note.element as HTMLInputElement).focus()
    await view.get('form').trigger('submit')
    await new Promise((resolve) => setTimeout(resolve, 150))
    await flushPromises()
    expect(record).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(note.element)
    expect(document.querySelector('dialog .region')?.textContent).toContain(
      en.income.sheet.bad_note,
    )
  })

  it('a day the server refuses takes the focus from the button to the day', async () => {
    record.mockRejectedValue(new ApiError(ERROR.INCOME_IN_FUTURE))
    const view = await render()
    await fill(view, '1')
    const day = watchFocus(view, en.income.sheet.day)
    saveButton(view).focus()
    await save(view)
    await flushPromises()
    expect(document.activeElement).toBe(day.control)
    expect(day.at.marked).toBe('true')
  })

  it('must not fire: a refusal landing after the sheet was put away moves no focus into it', async () => {
    let refuse: (error: unknown) => void = () => undefined
    record.mockReturnValue(new Promise((_, reject) => (refuse = reject)))
    const view = await render()
    await fill(view, '1')
    await save(view)
    await view.setProps({ open: false })
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    refuse(new ApiError(ERROR.INCOME_IN_FUTURE))
    await flushPromises()
    await flushPromises()
    expect(document.activeElement).toBe(outside)
  })

  it('a day the server says has not come yet is said under the day', async () => {
    record.mockRejectedValue(new ApiError(ERROR.INCOME_IN_FUTURE))
    const view = await render()
    await fill(view, '1')
    await save(view)
    expect(field(view, en.income.sheet.day).text()).toContain(en.error.income_in_future)
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('any other failure is said once, and the sheet stays with what was typed', async () => {
    record.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await fill(view, '1')
    await save(view)
    expect(view.text()).toContain(en.income.failed)
    expect(view.emitted('update:open')).toBeUndefined()
  })

  it('an amendment starts from the row, shows the versions and saves over its version', async () => {
    amend.mockResolvedValue('saved')
    const view = await render(overview(), amended)
    expect(view.text()).toContain(en.income.sheet.title_amend)
    expect(
      (field(view, en.income.sheet.amount).get('input').element as HTMLInputElement).value,
    ).toBe('99615')
    expect(view.get('.versions').text()).toContain(en.income.source.bonus)
    // The day of the version as the day it was, in UTC too — not «Sep 14» (adversarial Ж′).
    expect(view.get('.versions').text()).toContain('Sep 15')
    expect(view.get('.versions').text()).not.toContain('Sep 14')
    await field(view, en.income.sheet.amount).get('input').setValue('102345')
    await save(view, en.income.sheet.save_amend)
    expect(record).not.toHaveBeenCalled()
    expect(amend).toHaveBeenCalledWith(INCOME, {
      revision: 2,
      amount: { minor: 10_234_500n, currency: 'RUB' },
      receivedOn: '2026-09-15',
      source: 'salary',
      note: 'Vikasa',
    })
  })

  it('a conflict keeps the sheet open and names what is recorded now', async () => {
    amend.mockResolvedValue('conflict')
    const view = await render(overview(), amended)
    await save(view, en.income.sheet.save_amend)
    expect(view.emitted('update:open')).toBeUndefined()
    expect(view.text()).toContain(en.income.sheet.amend_conflict)
    expect(view.get('.current').text()).toContain('Now recorded:')
    expect(view.get('.current').text()).toContain(en.income.source.salary)
  })

  // The list read again after a conflict takes its strip away with the focus on «Повторить» (MOL-188 №5):
  // the focus went to the body, under the modal sheet; it goes to the sheet's own title (MOL-317, З1).
  it('hands the focus on the strip’s «Try again» to the sheet’s title once the list is read again', async () => {
    amend.mockResolvedValue('conflict')
    const view = await render(overview(), amended)
    await save(view, en.income.sheet.save_amend)
    await view.setProps({ stale: true })
    const retry = view.get('.strip.unanswered .action button')
    ;(retry.element as HTMLElement).focus()

    await view.setProps({ stale: false })
    expect(view.find('.strip.unanswered').exists()).toBe(false)
    expect(document.activeElement).toBe(view.get('dialog h2').element)
  })

  // MOL-189 review №1: a save after the conflict that did not land — lost on the way, refused under a
  // field — leaves the sheet over the version the list holds, never back on the one it was opened on.
  it('after a conflict every next save goes over the version the list holds, past a failed one', async () => {
    const theirs: IncomeView = { ...amended, note: 'Cash', revision: 3 }
    const state = overview({ months: [{ month: '2026-09', sums: [], incomes: [theirs] }] })
    for (const failure of [new TypeError('network'), new ApiError(ERROR.INCOME_IN_FUTURE)]) {
      amend.mockReset()
      amend
        .mockResolvedValueOnce('conflict')
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce('saved')
      const view = await render(state, amended)
      for (let tap = 0; tap < 3; tap += 1) await save(view, en.income.sheet.save_amend)
      expect(amend.mock.calls.map(([, body]) => body.revision)).toEqual([2, 3, 3])
      view.unmount()
    }
  })
})

// MOL-189, Ф-34, owner's В-1 «а»: removing is the amendment's, and only where the screen offers
// «Вернуть» after it — never in a new income, never from an account's journal.
describe('IncomeSheet: removing from the amendment (MOL-189)', () => {
  const words = (view: VueWrapper) => view.findAll('button').map((button) => button.text())

  it('offers «Remove the income» in an amendment the screen can bring back, and asks it of the screen', async () => {
    const view = await render(overview(), amended)
    expect(words(view)).not.toContain(en.income.sheet.remove)
    await view.setProps({ removable: true })
    const remove = view.findAll('button').find((button) => button.text() === en.income.sheet.remove)
    expect(remove?.classes()).toContain('danger-ghost')
    await remove?.trigger('click')
    expect(view.emitted('remove')).toEqual([[amended]])
    expect(amend).not.toHaveBeenCalled()
  })

  // MOL-189 review №3: from an account's journal the sheet has no «Remove», and its words say none.
  it('offline, the strip names removing only where the sheet offers it', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const view = await render(overview(), amended)
    expect(view.get('.status').text()).toContain(en.income.sheet.offline_amend)
    await view.setProps({ removable: true })
    expect(view.get('.status').text()).toContain(en.income.sheet.offline)
  })

  it('must not fire: no «Remove» in a new income, removable or not', async () => {
    const view = await render()
    await view.setProps({ removable: true })
    expect(words(view)).not.toContain(en.income.sheet.remove)
  })
})
