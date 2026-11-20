import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActorView, ReceiptsAccess } from '@molvia/model'
import ReceiptsAccessGroup from '@/components/ReceiptsAccessGroup.vue'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'
import { useActorStore } from '@/stores/actor'
import { hearFf } from '@/stores/ff'
import { createMemoryHistory, createRouter } from 'vue-router'

const me = vi.fn()
vi.mock('@/api', () => ({ api: { me: (...args: unknown[]) => me(...args) } }))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const ARMENIA: ActorView = {
  id: OWNER,
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-16T10:00:00Z'),
  updatedAt: new Date('2026-09-16T10:00:00Z'),
}
const TRIAL: ReceiptsAccess = {
  until: null,
  ended: null,
  trialLeft: 6,
  trialOf: 10,
  month: '2026-11-01',
  read: 4,
  limit: 100,
}

const views: VueWrapper[] = []
function render(actor: ActorView): VueWrapper {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useActorStore()
  store.id = actor.id
  store.actor = actor
  store.state = 'ready'
  // a router of the two places the row may lead: with payment open it is a link (MOL-277)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'settings', component: { render: () => null } },
      { path: '/pay', name: 'pay', component: { render: () => null } },
    ],
  })
  const view = mount(ReceiptsAccessGroup, {
    global: { plugins: [pinia, router, createAppI18n('ru')] },
  })
  views.push(view)
  return view
}
const status = (view: VueWrapper) => view.get('.list-row').text()

beforeEach(() => {
  me.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  hearFf(new Set())
  vi.useFakeTimers({ now: new Date('2026-11-19T12:00:00Z'), toFake: ['Date'] })
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
})

describe('«Распознавание чеков» (MOL-276)', () => {
  it('is a status of the group «Чеки», with no chevron: nothing to open until payment', () => {
    const view = render({ ...ARMENIA, receiptsAccess: TRIAL })
    expect(view.get('h2').text()).toBe(ru.settings.group_receipts)
    expect(view.get('.list-row').element.tagName).toBe('DIV')
    expect(view.find('.list-row button').exists()).toBe(false)
    expect(view.find('[class*="chevron"]').exists()).toBe(false)
  })

  it('says the trial left', () => {
    expect(status(render({ ...ARMENIA, receiptsAccess: TRIAL }))).toContain(
      'Пробных чеков осталось: 6 из 10',
    )
  })

  it('says until when it is paid and the month’s count', () => {
    const until = new Date('2026-12-18T09:00:00Z')
    const view = render({
      ...ARMENIA,
      receiptsAccess: { ...TRIAL, until, trialLeft: 0, read: 12 },
    })
    expect(status(view)).toContain('Открыто до 18 декабря · в ноябре прочитано 12 из 100')
  })

  it('says the trial is over, and who reads now while payment is not open', () => {
    const over = { ...TRIAL, trialLeft: 0, read: 10 }
    expect(status(render({ ...ARMENIA, receiptsAccess: over }))).toContain(
      ru.receipts_access.status.trial_over_read,
    )
    hearFf(new Set(['payments']))
    expect(status(render({ ...ARMENIA, receiptsAccess: over }))).toContain(
      ru.receipts_access.status.trial_over_manual,
    )
  })

  it('opens the screen of payment, receipts chosen, while payment is open — a status with no chevron while not (MOL-277, В-7)', () => {
    const over = { ...TRIAL, trialLeft: 0, read: 10 }
    const closed = render({ ...ARMENIA, receiptsAccess: over })
    expect(closed.find('a').exists()).toBe(false)
    hearFf(new Set(['payments']))
    const open = render({ ...ARMENIA, receiptsAccess: over })
    expect(open.get('a.list-row').attributes('href')).toBe('/pay?tariff=receipts')
  })

  it('never promises Tesseract in Georgia, which it does not read', () => {
    const view = render({
      ...ARMENIA,
      country: 'GE',
      city: 'Тбилиси',
      spendCurrency: 'GEL',
      receiptsAccess: { ...TRIAL, trialLeft: 0, read: 10 },
    })
    expect(status(view)).toContain(ru.receipts_access.status.trial_over_manual)
  })

  it('says the month’s hundred and when it opens again — at the hundredth, never the ninety-ninth', () => {
    const until = new Date('2026-12-18T09:00:00Z')
    expect(
      status(render({ ...ARMENIA, receiptsAccess: { ...TRIAL, until, read: 100 } })),
    ).toContain('В ноябре прочитано 100 из 100 — снова с 1 декабря')
    expect(status(render({ ...ARMENIA, receiptsAccess: { ...TRIAL, until, read: 99 } }))).toContain(
      'в ноябре прочитано 99 из 100',
    )
  })

  it('turns December into January of the next year', () => {
    const view = render({
      ...ARMENIA,
      receiptsAccess: {
        ...TRIAL,
        until: new Date('2027-01-05T00:00:00Z'),
        month: '2026-12-01',
        read: 100,
      },
    })
    expect(status(view)).toContain('В декабре прочитано 100 из 100 — снова с 1 января')
  })

  it('says it is not known where the server has not said it — never blaming a connection that is there (А4)', () => {
    expect(navigator.onLine).toBe(true)
    const view = render(ARMENIA)
    expect(status(view)).toContain(ru.receipts_access.status.unknown)
    expect(status(view)).not.toContain('связь')
  })

  it('says a paid period over and the trial spent, with what reads now (adversarial А2, Б1)', () => {
    const lapsed = {
      ...TRIAL,
      ended: new Date('2026-11-02T09:30:00Z'),
      trialLeft: 0,
      read: 60,
    }
    const view = render({ ...ARMENIA, receiptsAccess: lapsed })
    expect(status(view)).toContain(
      'Оплаченный срок кончился 2 ноября, пробных чеков не осталось. Чеки читаем простым распознаванием',
    )
    hearFf(new Set(['payments']))
    expect(status(render({ ...ARMENIA, receiptsAccess: lapsed }))).toContain(
      'Оплаченный срок кончился 2 ноября, пробных чеков не осталось. Покупки можно записать вручную',
    )
  })

  it('says the trial too where it ran out weeks after the paid period — the trial is named, not the period alone (Б1)', () => {
    // paid while trial receipts were left; the model read them on after the period, the last on 10 January
    vi.useFakeTimers({ now: new Date('2027-01-10T09:00:00Z'), toFake: ['Date'] })
    const view = render({
      ...ARMENIA,
      receiptsAccess: {
        ...TRIAL,
        ended: new Date('2026-12-19T10:00:00Z'),
        trialLeft: 0,
        month: '2027-01-01',
        read: 4,
      },
    })
    expect(status(view)).toContain('пробных чеков не осталось')
    expect(status(view)).toContain('кончился 19 декабря 2026')
  })

  it('asks the server again at midnight with the screen in view: the hundred opens on the 1st (adversarial А3)', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 30, 23, 58), toFake: ['Date', 'setTimeout'] })
    const until = new Date('2026-12-18T09:00:00Z')
    const hundred = { ...TRIAL, until, read: 100 }
    me.mockResolvedValue({
      ...ARMENIA,
      receiptsAccess: { ...hundred, month: '2026-12-01', read: 0 },
    })
    const view = render({ ...ARMENIA, receiptsAccess: hundred })
    expect(status(view)).toContain('снова с 1 декабря')
    expect(me).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flushPromises()
    expect(me).toHaveBeenCalledTimes(1)
    expect(status(view)).toContain('в декабре прочитано 0 из 100')
  })
})
