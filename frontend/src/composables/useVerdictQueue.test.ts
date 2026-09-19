import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, watch } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { PendingVerdict, PendingVerdicts, Rating, VerdictCard } from '@molvia/model'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import type { VerdictQueue } from '@/composables/useVerdictQueue'
import { useActorStore } from '@/stores/actor'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'

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
const OTHER = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'

function card(n: number, boughtAt = `2026-09-1${String(n)}T10:00:00.000Z`): PendingVerdict {
  return {
    itemId: `cccccccc-0000-4000-8000-00000000000${String(n)}`,
    name: `Позиция ${String(n)}`,
    placeName: 'SAS',
    boughtAt: new Date(boughtAt),
  }
}

const milk = card(3)
const bread = card(2)
const cheese = card(1)

function answer(items: PendingVerdict[], total = items.length): PendingVerdicts {
  return { items, total }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const offline = () => new ApiError(ERROR.INTERNAL, 'Failed to fetch')

/** Mounted inside a component: the queue loads on mount and listens for the connection. */
async function mounted(): Promise<VerdictQueue> {
  let queue: VerdictQueue | undefined
  mount(
    defineComponent({
      setup() {
        queue = useVerdictQueue()
        return () => h('div')
      },
    }),
  )
  await flushPromises()
  if (!queue) throw new Error('not mounted')
  return queue
}

function freshPinia(): void {
  localStorage.setItem('molvia.actor', ME)
  setActivePinia(createPinia())
}

const names = (queue: VerdictQueue) => queue.cards.value.map((item) => item.name)

function sent(itemId: string): { verdict: VerdictCard; created: boolean } {
  const at = new Date()
  return { verdict: { itemId, score: 4, review: null, ratedAt: at, updatedAt: at }, created: true }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** A rating saved offline: on the phone, waiting, its card gone from the screen. */
async function savedOffline(queue: VerdictQueue, item: PendingVerdict): Promise<void> {
  online(false)
  rateItem.mockRejectedValueOnce(offline())
  queue.save(item, 4, '')
  await flushPromises()
}

describe('useVerdictQueue', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    pendingVerdicts.mockReset()
    rateItem.mockReset()
    vi.restoreAllMocks()
    freshPinia()
  })

  it('loads the server order, newest first, with the total for the counter', async () => {
    pendingVerdicts.mockResolvedValue(answer([milk, bread, cheese], 7))
    const queue = await mounted()

    expect(queue.phase.value).toBe('ready')
    expect(queue.current.value).toEqual(milk)
    expect(queue.count.value).toBe(7)
    expect(queue.stale.value).toBe(false)
  })

  it('16: nothing waits — empty, which the screen draws as a success', async () => {
    pendingVerdicts.mockResolvedValue(answer([]))
    expect((await mounted()).phase.value).toBe('empty')
  })

  it('13: a failed load with nothing remembered is offline or an error, decided after it', async () => {
    online(false)
    pendingVerdicts.mockRejectedValue(offline())
    expect((await mounted()).phase.value).toBe('offline')

    freshPinia()
    online(true)
    pendingVerdicts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 502'))
    const queue = await mounted()
    expect(queue.phase.value).toBe('error')

    pendingVerdicts.mockResolvedValue(answer([milk]))
    await queue.retry()
    expect(queue.phase.value).toBe('ready')
  })

  it('В-4: the last answer is remembered — offline shows it, marked as not fresh', async () => {
    pendingVerdicts.mockResolvedValue(answer([milk, bread]))
    await mounted()

    freshPinia()
    online(false)
    pendingVerdicts.mockRejectedValue(offline())
    const queue = await mounted()

    expect(queue.phase.value).toBe('ready')
    expect(names(queue)).toEqual(['Позиция 3', 'Позиция 2'])
    expect(queue.stale.value).toBe(true)
    expect(queue.fetchedAt.value).toBeInstanceOf(Date)
  })

  it('a saved card goes at once, the counter with it, and does not come back once sent', async () => {
    online(false)
    rateItem.mockRejectedValueOnce(offline())
    pendingVerdicts.mockResolvedValue(answer([milk, bread], 2))
    const queue = await mounted()

    queue.save(milk, 4, '')
    await flushPromises()

    expect(queue.current.value).toEqual(bread)
    expect(queue.count.value).toBe(1)

    rateItem.mockResolvedValue({
      verdict: {
        itemId: milk.itemId,
        score: 4,
        review: null,
        ratedAt: new Date(),
        updatedAt: new Date(),
      },
      created: true,
    })
    await useVerdictDraftsStore().flush()

    expect(names(queue)).toEqual(['Позиция 2'])
    expect(queue.count.value).toBe(1)
    // The memory agrees: a restart without a connection does not offer the milk again.
    expect(localStorage.getItem(`molvia.verdict-queue.${ME}`)).not.toContain(milk.itemId)
  })

  it('the last rating, gone through at once, never brings its card back — not for a moment', async () => {
    rateItem.mockResolvedValue({
      verdict: {
        itemId: milk.itemId,
        score: 4,
        review: null,
        ratedAt: new Date(),
        updatedAt: new Date(),
      },
      created: true,
    })
    pendingVerdicts.mockResolvedValue(answer([milk], 1))
    const queue = await mounted()
    const seen: (string | undefined)[] = []
    watch(queue.current, (card) => seen.push(card?.name), { flush: 'sync' })

    queue.save(milk, 4, '')
    await flushPromises()

    expect(seen).toEqual([undefined])
    expect(queue.phase.value).toBe('empty')
  })

  it('a draft the server refused comes back first, and counts again', async () => {
    rateItem.mockRejectedValue(new ApiError(ISSUE.TEXT_NOT_VISIBLE))
    pendingVerdicts.mockResolvedValue(answer([milk, bread], 2))
    const queue = await mounted()

    queue.save(bread, 2, 'x')
    await flushPromises()

    expect(queue.current.value).toEqual(bread)
    expect(queue.count.value).toBe(2)
  })

  it('11: «Не сейчас» puts the card behind the others; put off everything, they come round again', async () => {
    pendingVerdicts.mockResolvedValue(answer([milk, bread, cheese]))
    const queue = await mounted()

    queue.skip(milk)
    expect(names(queue)).toEqual(['Позиция 2', 'Позиция 1', 'Позиция 3'])

    queue.skip(bread)
    queue.skip(cheese)
    expect(queue.phase.value).toBe('ready')
    expect(names(queue)).toEqual(['Позиция 3', 'Позиция 2', 'Позиция 1'])
  })

  it('a card put off stays behind after a restart', async () => {
    pendingVerdicts.mockResolvedValue(answer([milk, bread]))
    ;(await mounted()).skip(milk)

    freshPinia()
    expect(names(await mounted())).toEqual(['Позиция 2', 'Позиция 3'])
  })

  it('12: bought again after it was put off — back in its place', async () => {
    pendingVerdicts.mockResolvedValue(answer([milk, bread]))
    ;(await mounted()).skip(milk)

    freshPinia()
    const again = card(3, '2026-09-19T09:00:00.000Z')
    pendingVerdicts.mockResolvedValue(answer([again, bread]))

    expect(names(await mounted())).toEqual(['Позиция 3', 'Позиция 2'])
  })

  it('the card on screen stays while a reload brings a newer purchase to the top', async () => {
    pendingVerdicts.mockResolvedValue(answer([bread, cheese]))
    const queue = await mounted()
    expect(queue.current.value).toEqual(bread)

    pendingVerdicts.mockResolvedValue(answer([milk, bread, cheese]))
    await queue.retry()

    expect(names(queue)[0]).toBe('Позиция 3')
    expect(queue.current.value).toEqual(bread)

    queue.skip(bread)
    expect(queue.current.value).toEqual(milk)
  })

  it('15: a broken memory is an empty one', async () => {
    localStorage.setItem(`molvia.verdict-queue.${ME}`, '{nope')
    localStorage.setItem(`molvia.verdict-skips.${ME}`, '[{"itemId":1}]')
    online(false)
    pendingVerdicts.mockRejectedValue(offline())

    expect((await mounted()).phase.value).toBe('offline')
  })

  describe('adversarial round 1', () => {
    it('F1: an answer asked for before a rating was confirmed does not bring it back', async () => {
      pendingVerdicts.mockResolvedValueOnce(answer([milk, bread]))
      const queue = await mounted()
      await savedOffline(queue, milk)

      // Back online: App.vue sends, the screen reloads — on the same `online`. The server read
      // the queue before it wrote the verdict, and the GET is answered after the PUT.
      online(true)
      const put = deferred<{ verdict: VerdictCard; created: boolean }>()
      const get = deferred<PendingVerdicts>()
      rateItem.mockReturnValueOnce(put.promise)
      pendingVerdicts.mockReturnValueOnce(get.promise)
      void useVerdictDraftsStore().flush()
      void queue.retry()
      await flushPromises()
      put.resolve(sent(milk.itemId))
      await flushPromises()
      get.resolve(answer([milk, bread]))
      await flushPromises()

      expect(names(queue)).toEqual(['Позиция 2'])
      expect(queue.count.value).toBe(1)
      expect(localStorage.getItem(`molvia.verdict-queue.${ME}`)).not.toContain(milk.itemId)

      // The next answer, asked for after the rating, is taken as it is.
      pendingVerdicts.mockResolvedValueOnce(answer([bread]))
      await queue.retry()
      expect(names(queue)).toEqual(['Позиция 2'])
    })

    it('F2: a change of identity never writes one person’s queue under another', async () => {
      pendingVerdicts.mockResolvedValueOnce(answer([milk, bread]))
      const queue = await mounted()
      await savedOffline(queue, milk)

      pendingVerdicts.mockRejectedValue(offline())
      useActorStore().id = OTHER
      await flushPromises()

      expect(localStorage.getItem(`molvia.verdict-queue.${OTHER}`)).toBeNull()
      expect(names(queue)).toEqual([])
      expect(queue.phase.value).toBe('offline')
      // The first person's queue is theirs still.
      expect(localStorage.getItem(`molvia.verdict-queue.${ME}`)).toContain(bread.itemId)
    })

    it('F3: a rating on its way is off the counter even when its item fell off the page', async () => {
      pendingVerdicts.mockResolvedValueOnce(answer([milk, bread], 3))
      const queue = await mounted()
      await savedOffline(queue, milk)

      rateItem.mockReturnValueOnce(new Promise(() => undefined))
      pendingVerdicts.mockResolvedValueOnce(answer([bread], 3))
      online(true)
      await queue.retry()

      expect(queue.count.value).toBe(2)
    })

    it('F4: without an identity the queue is idle — no skeleton that waits for nothing', async () => {
      useActorStore().id = null
      const queue = await mounted()

      expect(pendingVerdicts).not.toHaveBeenCalled()
      expect(queue.phase.value).toBe('idle')
    })

    it('F6: nothing remembered and the load failed — offline, not «all rated»', async () => {
      pendingVerdicts.mockResolvedValue(answer([]))
      await mounted()

      freshPinia()
      online(false)
      pendingVerdicts.mockRejectedValue(offline())
      expect((await mounted()).phase.value).toBe('offline')
    })
  })

  describe('self-review', () => {
    it('С-1: a card the server refused can be put off like any other', async () => {
      rateItem.mockRejectedValue(new ApiError(ISSUE.TEXT_NOT_VISIBLE))
      pendingVerdicts.mockResolvedValue(answer([milk, bread, cheese]))
      const queue = await mounted()
      queue.save(milk, 2, 'x')
      await flushPromises()
      queue.skip(bread)
      expect(queue.current.value).toEqual(milk)

      queue.skip(milk)

      expect(queue.current.value).toEqual(cheese)
      expect(names(queue).at(-1)).toBe('Позиция 3')
    })

    it('С-1: a card put off and then rated comes back first when refused, not last', async () => {
      rateItem.mockRejectedValue(new ApiError(ISSUE.TEXT_NOT_VISIBLE))
      pendingVerdicts.mockResolvedValue(answer([milk, bread]))
      const queue = await mounted()
      queue.skip(milk)
      queue.save(milk, 2, 'x')
      await flushPromises()

      expect(names(queue)[0]).toBe('Позиция 3')
    })

    it('С-8: what was put off is forgotten once a full answer no longer lists it', async () => {
      pendingVerdicts.mockResolvedValue(answer([milk, bread]))
      const queue = await mounted()
      queue.skip(milk)

      pendingVerdicts.mockResolvedValue(answer([bread]))
      await queue.retry()
      expect(localStorage.getItem(`molvia.verdict-skips.${ME}`)).toBe('[]')

      // Withdrawn later, the milk is back — in its place, not behind.
      pendingVerdicts.mockResolvedValue(answer([milk, bread]))
      await queue.retry()
      expect(names(queue)).toEqual(['Позиция 3', 'Позиция 2'])
    })

    it('С-8: a page that is not the whole queue forgets nothing', async () => {
      pendingVerdicts.mockResolvedValue(answer([milk, bread]))
      const queue = await mounted()
      queue.skip(milk)

      pendingVerdicts.mockResolvedValue(answer([bread], 60))
      await queue.retry()

      expect(localStorage.getItem(`molvia.verdict-skips.${ME}`)).toContain(milk.itemId)
    })
  })
})
