import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { VerdictAmendment, VerdictCard } from '@molvia/model'
import VerdictEditSheet from '@/components/VerdictEditSheet.vue'
import type { Score } from '@/components/rating'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'

const amendVerdict = vi.fn<(itemId: string, patch: VerdictAmendment) => Promise<VerdictCard>>()
const withdrawVerdict = vi.fn<(itemId: string) => Promise<void>>()
vi.mock('@/api', () => ({
  api: {
    amendVerdict: (itemId: string, patch: VerdictAmendment) => amendVerdict(itemId, patch),
    withdrawVerdict: (itemId: string) => withdrawVerdict(itemId),
  },
}))

const ITEM = 'cccccccc-0000-4000-8000-000000000001'

function card(): VerdictCard {
  const at = new Date()
  return { itemId: ITEM, score: 4, review: null, ratedAt: at, updatedAt: at }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

let clock = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setActivePinia(createPinia())
  amendVerdict.mockReset()
  withdrawVerdict.mockReset()
  vi.restoreAllMocks()
  online(true)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

interface Options {
  readonly ownScore?: Score | null
  readonly ownReview?: string | null
}

async function render(options: Options = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/advice')

  const view = mount(VerdictEditSheet, {
    props: {
      itemId: ITEM,
      name: 'Колбаса «Молочная»',
      ownScore: options.ownScore ?? null,
      ownReview: options.ownReview ?? null,
    },
    attachTo: document.body,
    global: { plugins: [router, createPinia(), createAppI18n('en')] },
  })
  // Past the moment the sheet rises: until then it takes no tap at all.
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return { view }
}

function key(view: VueWrapper, score: number) {
  return view.get(`button[aria-label="Rating ${String(score)} out of 5"]`)
}

function button(view: VueWrapper, text: string) {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

describe('VerdictEditSheet', () => {
  it('offers one`s own score pre-chosen, and sends only what was changed', async () => {
    amendVerdict.mockResolvedValue(card())
    const { view } = await render({ ownScore: 1, ownReview: 'Пахнет крахмалом' })

    expect(key(view, 1).attributes('aria-pressed')).toBe('true')
    // Nothing touched yet: there is nothing to save, and an empty patch the server refuses.
    expect(button(view, 'Save the rating').attributes('disabled')).toBeDefined()

    await key(view, 4).trigger('click')
    await button(view, 'Save the rating').trigger('click')

    expect(amendVerdict).toHaveBeenCalledWith(ITEM, { score: 4 })
  })

  it('in the shared mode nothing is pre-chosen: the average is not this person`s opinion', async () => {
    amendVerdict.mockResolvedValue(card())
    const { view } = await render({ ownScore: null, ownReview: 'Мой отзыв' })

    for (const score of [1, 2, 3, 4, 5]) {
      expect(key(view, score).attributes('aria-pressed')).toBe('false')
    }
    // The review is always one's own, whatever the mode — so it is there to be amended.
    expect(view.get('textarea').element.value).toBe('Мой отзыв')
  })

  it('an emptied review is erased rather than left as it was', async () => {
    amendVerdict.mockResolvedValue(card())
    const { view } = await render({ ownScore: 3, ownReview: 'Пахнет крахмалом' })

    await view.get('textarea').setValue('')
    await button(view, 'Save the rating').trigger('click')

    expect(amendVerdict).toHaveBeenCalledWith(ITEM, { review: null })
  })

  it('withdraws without asking, and says what withdrawing does', async () => {
    withdrawVerdict.mockResolvedValue()
    const { view } = await render({ ownScore: 1 })

    expect(view.text()).toContain('The item leaves this screen')
    await button(view, 'Withdraw the rating').trigger('click')

    expect(withdrawVerdict).toHaveBeenCalledWith(ITEM)
    expect(view.emitted('saved')).toHaveLength(1)
  })

  it('a failure keeps the sheet open and says whether it was the server or the connection', async () => {
    amendVerdict.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    const { view } = await render({ ownScore: 1 })

    await key(view, 5).trigger('click')
    await button(view, 'Save the rating').trigger('click')
    await view.vm.$nextTick()

    expect(view.text()).toContain('Could not save it')
    expect(view.emitted('saved')).toBeUndefined()

    online(false)
    await button(view, 'Save the rating').trigger('click')
    await view.vm.$nextTick()

    expect(view.text()).toContain('A rating can be changed once you are online')
  })
})
