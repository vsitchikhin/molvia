import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, watch } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE } from '@molvia/model'
import type { PendingVerdict, PendingVerdicts, Rating, VerdictCard } from '@molvia/model'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import type { VerdictQueue } from '@/composables/useVerdictQueue'
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
})
