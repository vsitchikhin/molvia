import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { PendingVerdict, PendingVerdicts, Rating, VerdictCard } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import VerdictsView from '@/views/VerdictsView.vue'

const pendingVerdicts = vi.fn<() => Promise<PendingVerdicts>>()
const rateItem =
  vi.fn<(itemId: string, rating: Rating) => Promise<{ verdict: VerdictCard; created: boolean }>>()
vi.mock('@/api', () => ({
  api: {
    pendingVerdicts: () => pendingVerdicts(),
    rateItem: (itemId: string, rating: Rating) => rateItem(itemId, rating),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function card(n: number, name: string): PendingVerdict {
  return {
    itemId: `cccccccc-0000-4000-8000-00000000000${String(n)}`,
    name,
    placeName: 'SAS',
    boughtAt: new Date(2026, 8, 12, 10),
  }
}

const milk = card(1, 'Молоко «Ашхар»')
const bread = card(2, 'Хлеб')

function answered(itemId: string): { verdict: VerdictCard; created: boolean } {
  const at = new Date()
  return { verdict: { itemId, score: 4, review: null, ratedAt: at, updatedAt: at }, created: true }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function button(view: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

const mounted: VueWrapper[] = []

async function render({ identity = true } = {}) {
  localStorage.setItem('molvia.actor', ME)
  const pinia = createPinia()
  setActivePinia(pinia)
  if (!identity) useActorStore().id = null
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/verdicts')
  const view = mount(VerdictsView, {
    global: { plugins: [router, pinia, createAppI18n('en')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router }
}

async function rate(view: VueWrapper, score: number): Promise<void> {
  await view.get(`button[aria-label="Rating ${String(score)} out of 5"]`).trigger('click')
  await button(view, en.verdict.save).trigger('click')
  await flushPromises()
}

describe('VerdictsView', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    pendingVerdicts.mockReset()
    rateItem.mockReset()
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
  })

  it('draws the skeleton of a card while the queue loads', async () => {
    pendingVerdicts.mockReturnValue(new Promise(() => undefined))
    const { view } = await render()

    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.findAll('.keys .key')).toHaveLength(5)
  })

  it('shows one card, the counter of what waits and the footnote', async () => {
    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    const { view } = await render()

    expect(view.get('.question').text()).toContain('Молоко «Ашхар»')
    expect(view.text()).toContain('2 purchases are waiting to be rated')
    expect(view.text()).toContain(en.verdict.footnote)
    // No price on this screen, ever.
    expect(view.text()).not.toMatch(/֏|₽|\$|€/)
  })

  it('«Сохранить» moves to the next card at once; the last one leaves the green success', async () => {
    rateItem.mockImplementation((itemId) => Promise.resolve(answered(itemId)))
    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    const { view } = await render()

    await rate(view, 4)
    expect(view.get('.question').text()).toContain('Хлеб')
    expect(view.text()).toContain('1 purchase is waiting to be rated')

    await rate(view, 2)
    expect(view.text()).toContain(en.verdict.empty.title)
    expect(view.find('.good').exists()).toBe(true)
    expect(rateItem.mock.calls.map(([id, rating]) => [id, rating.score])).toEqual([
      [milk.itemId, 4],
      [bread.itemId, 2],
    ])
  })

  it('16: nothing to rate — the green success leads to «What to buy»', async () => {
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    const { view, router } = await render()

    expect(view.find('.good').exists()).toBe(true)
    await button(view, en.verdict.empty.action).trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('advice')
  })

  it('«Не сейчас» shows the next card, and the counter does not change', async () => {
    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    const { view } = await render()

    await button(view, en.verdict.skip).trigger('click')
    await flushPromises()

    expect(view.get('.question').text()).toContain('Хлеб')
    expect(view.text()).toContain('2 purchases are waiting to be rated')
  })

  it('13: the queue did not load — red with «Try again» online, never red offline', async () => {
    online(true)
    pendingVerdicts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    const failed = await render()
    expect(failed.view.text()).toContain(en.verdict.load_error.title)
    expect(failed.view.find('.bad').exists()).toBe(true)

    pendingVerdicts.mockResolvedValue({ items: [milk], total: 1 })
    await button(failed.view, en.state.retry).trigger('click')
    await flushPromises()
    expect(failed.view.get('.question').text()).toContain('Молоко')
    failed.view.unmount()

    localStorage.clear()
    sessionStorage.clear()
    online(false)
    pendingVerdicts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const lost = await render()
    expect(lost.view.text()).toContain(en.verdict.load_offline.title)
    expect(lost.view.find('.bad').exists()).toBe(false)
  })

  it('7: saved without a connection — the green «saved», and the next card under it', async () => {
    online(false)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    const { view } = await render()

    await rate(view, 5)

    expect(view.text()).toContain(en.verdict.offline.title)
    expect(view.find('.bad').exists()).toBe(false)
    expect(view.get('.question').text()).toContain('Хлеб')
  })

  it('the last rating saved without a connection is «saved», not «everything is rated»', async () => {
    online(false)
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    pendingVerdicts.mockResolvedValue({ items: [milk], total: 1 })
    const { view } = await render()

    await rate(view, 5)

    expect(view.text()).toContain(en.verdict.offline.title)
    expect(view.text()).not.toContain(en.verdict.empty.title)
  })

  it('a server that broke keeps the draft, says so in red and sends again on «Try again»', async () => {
    online(true)
    rateItem.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    rateItem.mockResolvedValueOnce(answered(milk.itemId))
    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    const { view } = await render()

    await rate(view, 3)
    expect(view.text()).toContain(en.verdict.error.title)

    await button(view, en.state.retry).trigger('click')
    await flushPromises()

    expect(rateItem).toHaveBeenCalledTimes(2)
    expect(view.text()).not.toContain(en.verdict.error.title)
  })

  it('the next card takes the focus; with nothing left the title does', async () => {
    rateItem.mockImplementation((itemId) => Promise.resolve(answered(itemId)))
    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    const { view } = await render()

    await rate(view, 4)
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent).toContain('Хлеб')
    })

    await rate(view, 4)
    await vi.waitFor(() => {
      expect(document.activeElement?.tagName).toBe('H1')
    })
  })

  it('С-3: while the last rating is on its way, no «everything is rated» — nothing yet', async () => {
    online(true)
    let answer: (value: { verdict: VerdictCard; created: boolean }) => void = () => undefined
    rateItem.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    pendingVerdicts.mockResolvedValue({ items: [milk], total: 1 })
    const { view } = await render()

    await rate(view, 4)
    expect(view.text()).not.toContain(en.verdict.empty.title)

    answer(answered(milk.itemId))
    await flushPromises()
    expect(view.text()).toContain(en.verdict.empty.title)
  })

  it('F6: offline with an empty memory — the offline state, not a green success', async () => {
    pendingVerdicts.mockResolvedValue({ items: [], total: 0 })
    ;(await render()).view.unmount()

    online(false)
    pendingVerdicts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const { view } = await render()

    expect(view.text()).toContain(en.verdict.load_offline.title)
    expect(view.text()).not.toContain(en.verdict.empty.title)
  })

  it('F4: no identity — neither a skeleton nor a state, only the notice above', async () => {
    const { view } = await render({ identity: false })

    expect(view.find('.skeleton').exists()).toBe(false)
    expect(view.text()).not.toContain(en.verdict.empty.title)
    expect(pendingVerdicts).not.toHaveBeenCalled()
  })

  it('R5: the server broke with cards in memory — it says so, and offers «Try again»', async () => {
    pendingVerdicts.mockResolvedValue({ items: [milk], total: 1 })
    ;(await render()).view.unmount()

    online(true)
    pendingVerdicts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    const { view } = await render()
    expect(view.get('.stale').text()).toContain('the server did not answer')

    pendingVerdicts.mockResolvedValue({ items: [milk, bread], total: 2 })
    await button(view, en.state.retry).trigger('click')
    await flushPromises()
    expect(view.find('.stale').exists()).toBe(false)
    expect(view.text()).toContain('2 purchases are waiting to be rated')
  })

  it('R4: the last remembered card rated offline — only the green «saved»', async () => {
    pendingVerdicts.mockResolvedValue({ items: [milk], total: 1 })
    ;(await render()).view.unmount()

    online(false)
    pendingVerdicts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    rateItem.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
    const { view } = await render()
    await rate(view, 4)

    expect(view.text()).toContain(en.verdict.offline.title)
    expect(view.text()).not.toContain(en.verdict.load_offline.title)
    expect(view.text()).not.toContain(en.verdict.empty.title)
  })
})
