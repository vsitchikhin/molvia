import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { Rating, VerdictAmendment, VerdictCard } from '@molvia/model'
import VerdictEditSheet from '@/components/VerdictEditSheet.vue'
import type { Score } from '@/components/rating'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'

const amendVerdict = vi.fn<(itemId: string, patch: VerdictAmendment) => Promise<VerdictCard>>()
const withdrawVerdict = vi.fn<(itemId: string) => Promise<void>>()
const rateItem =
  vi.fn<(itemId: string, rating: Rating) => Promise<{ verdict: VerdictCard; created: boolean }>>()
vi.mock('@/api', () => ({
  api: {
    amendVerdict: (itemId: string, patch: VerdictAmendment) => amendVerdict(itemId, patch),
    withdrawVerdict: (itemId: string) => withdrawVerdict(itemId),
    rateItem: (itemId: string, rating: Rating) => rateItem(itemId, rating),
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
  rateItem.mockReset()
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
  /** Whether there is a verdict of this person's behind the row (`AdviceRow.isMine`). */
  readonly mine?: boolean
  readonly shared?: boolean
}

async function render(options: Options = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/advice')

  const view = mount(VerdictEditSheet, {
    props: {
      itemId: ITEM,
      name: 'Колбаса «Молочная»',
      mine: options.mine ?? true,
      shared: options.shared ?? false,
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

  it('a score taken back is not a change: an empty patch is a refusal nobody can act on', async () => {
    const { view } = await render({ ownScore: 4 })

    // A second tap on the chosen digit clears the scale — the only undo it has.
    await key(view, 4).trigger('click')

    expect(key(view, 4).attributes('aria-pressed')).toBe('false')
    expect(button(view, 'Save the rating').attributes('disabled')).toBeDefined()
  })

  it('А7: a space typed into an empty review is no change, and nothing is sent', async () => {
    // `tidyText` eats the space inside `save()`, so the patch used to leave as `{}` and come
    // back refused, under «Попробуйте ещё раз» — which a repeat could not fix.
    const { view } = await render({ ownScore: 3, ownReview: null })

    await view.get('textarea').setValue(' ')
    expect(button(view, 'Save the rating').attributes('disabled')).toBeUndefined()

    await button(view, 'Save the rating').trigger('click')
    await flushPromises()

    expect(amendVerdict).not.toHaveBeenCalled()
    expect(view.text()).not.toContain('Could not save it')
  })

  it('А5: a cleared scale says the rating stays, rather than leaving it to be discovered', async () => {
    const { view } = await render({ ownScore: 3, ownReview: 'Крахмал' })

    expect(view.text()).not.toContain('The rating stays as it was')

    await key(view, 3).trigger('click')

    expect(view.text()).toContain('The rating stays as it was')
  })

  it('А2: a row nobody of one`s own stands behind is rated, not amended', async () => {
    rateItem.mockResolvedValue({ verdict: card(), created: true })
    const { view } = await render({ mine: false, shared: true })

    // Nothing to amend and nothing to withdraw: the sheet says so and offers neither.
    expect(view.text()).toContain('You have not rated this yet')
    expect(view.findAll('button').map((b) => b.text())).not.toContain('Withdraw the rating')
    // A first verdict needs a score: a review alone is not a verdict.
    expect(button(view, 'Rate it').attributes('disabled')).toBeDefined()

    await key(view, 5).trigger('click')
    await button(view, 'Rate it').trigger('click')
    await flushPromises()

    expect(rateItem).toHaveBeenCalledWith(ITEM, { score: 5 })
    expect(amendVerdict).not.toHaveBeenCalled()
    expect(view.emitted('saved')).toHaveLength(1)
  })

  it('МР-3: withdrawing says what it does, and that differs in the shared mode', async () => {
    const own = await render({ ownScore: 1 })
    expect(own.view.text()).toContain('The item leaves this screen')

    const shared = await render({ ownScore: null, shared: true })
    expect(shared.view.text()).toContain('Your rating leaves the average')
    expect(shared.view.text()).not.toContain('The item leaves this screen')
  })

  it('МР-4: a refusal the domain has words for gets them, instead of «try again»', async () => {
    amendVerdict.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'HTTP 404'))
    const { view } = await render({ ownScore: 1 })

    await key(view, 5).trigger('click')
    await button(view, 'Save the rating').trigger('click')
    await flushPromises()

    expect(view.text()).toContain('You have no rating here')
    expect(view.text()).not.toContain('Try again')

    amendVerdict.mockRejectedValue(new ApiError(ISSUE.PATCH_EMPTY, 'HTTP 400'))
    await key(view, 4).trigger('click')
    await button(view, 'Save the rating').trigger('click')
    await flushPromises()

    expect(view.text()).toContain('Nothing has changed')
  })

  it('МР-6: a refusal goes as soon as the text is touched', async () => {
    amendVerdict.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    const { view } = await render({ ownScore: 1 })

    await key(view, 5).trigger('click')
    await button(view, 'Save the rating').trigger('click')
    await flushPromises()
    expect(view.text()).toContain('Could not save it')

    await view.get('textarea').setValue('Пахнет крахмалом')

    expect(view.text()).not.toContain('Could not save it')
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
