import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ActorView, AdvicePlace, AdviceResponse, AdviceRow } from '@molvia/model'
import { useAdvice } from '@/composables/useAdvice'
import type { Advice } from '@/composables/useAdvice'
import { useActorStore } from '@/stores/actor'

const advice = vi.fn<() => Promise<AdviceResponse>>()
const me = vi.fn<() => Promise<ActorView>>()
vi.mock('@/api', () => ({ api: { advice: () => advice(), me: () => me() } }))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d'

function place(name: string, amount: bigint): AdvicePlace {
  return {
    placeId: `aaaaaaaa-0000-4000-8000-${name.length.toString().padStart(12, '0')}`,
    name,
    unitPrice: { scaledMinor: amount, currency: 'AMD', unit: 'l' },
    observations: 2,
  }
}

function row(n: number, level: AdviceRow['level'], rating = '4.5'): AdviceRow {
  const rated = {
    itemId: `cccccccc-0000-4000-8000-00000000000${String(n)}`,
    name: `Позиция ${String(n)}`,
    rating,
    ratingsCount: 1,
    review: null,
    isMine: true,
  }
  if (level === 'never') return { ...rated, level }
  if (level === 'take') return { ...rated, level, places: [place('SAS', 570_000_000n)] }
  return { ...rated, level, places: [], threshold: null }
}

function answer(rows: AdviceRow[], total = rows.length, scope: AdviceResponse['scope'] = 'own') {
  return { scope, rows, total, geography: { country: 'AM', city: 'Гюмри' } }
}

function actorIn(city: string): ActorView {
  return {
    id: ME,
    country: 'AM',
    city,
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    sharedUntil: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
  }
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const broke = () => new ApiError(ERROR.INTERNAL, 'HTTP 502')

/** Mounted inside a component: it loads on mount and listens for the connection. */
const wrappers: { unmount(): void }[] = []

function unmountAll(): void {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
}

async function mounted(): Promise<Advice> {
  let held: Advice | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        held = useAdvice()
        return () => h('div')
      },
    }),
  )
  wrappers.push(wrapper)
  await flushPromises()
  if (!held) throw new Error('not mounted')
  return held
}

/**
 * A launch of the app as this identity. The store is asked outright rather than through
 * storage: which device this is lives in a module of its own and is cached there, so a
 * cleared `localStorage` alone would leave the previous identity in memory.
 */
function freshPinia(id: string | null = ME): void {
  if (id)
    localStorage.setItem(
      `molvia.settings.${id}`,
      JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
    )
  setActivePinia(createPinia())
  useActorStore().id = id
}

const names = (rows: readonly AdviceRow[]) => rows.map((item) => item.name)

describe('useAdvice', () => {
  it('drops the previous city immediately and ignores its late response', async () => {
    advice.mockResolvedValue(answer([row(1, 'take')]))
    const held = await mounted()
    const landings: ((value: AdviceResponse) => void)[] = []
    advice.mockImplementation(
      () =>
        new Promise((resolve) => {
          landings.push(resolve)
        }),
    )
    void held.retry()
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({
        country: 'AM',
        city: 'Ереван',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.settings.${ME}` }))
    await flushPromises()
    expect(held.shown.value).toBe(0)
    landings[1]?.({ ...answer([row(2, 'take')]), geography: { country: 'AM', city: 'Ереван' } })
    await flushPromises()
    expect(names(held.groups.value.take)).toEqual(['Позиция 2'])
    landings[0]?.(answer([row(1, 'take')]))
    await flushPromises()
    expect(names(held.groups.value.take)).toEqual(['Позиция 2'])
  })

  it('labels the previous city offline, then hides its rows while the new city loads', async () => {
    advice.mockResolvedValue(answer([row(1, 'take')]))
    const held = await mounted()
    online(false)
    advice.mockRejectedValue(new TypeError('network'))
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({
        country: 'AM',
        city: 'Ереван',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      }),
    )
    window.dispatchEvent(new StorageEvent('storage', { key: `molvia.settings.${ME}` }))
    await flushPromises()
    expect(held.shown.value).toBe(1)
    expect(held.otherCity.value).toEqual({ oldCity: 'Гюмри', city: 'Ереван' })
    expect(held.stale.value).toBe('offline')
    online(true)
    let land: ((value: AdviceResponse) => void) | undefined
    advice.mockReturnValue(
      new Promise((resolve) => {
        land = resolve
      }),
    )
    const pending = held.retry()
    expect(held.shown.value).toBe(0)
    expect(held.cityReloading.value).toBe('Ереван')
    land?.({ ...answer([row(2, 'take')]), geography: { country: 'AM', city: 'Ереван' } })
    await pending
    expect(held.otherCity.value).toBeNull()
    expect(held.cityReloading.value).toBeNull()
  })

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    advice.mockReset()
    me.mockReset()
    vi.restoreAllMocks()
    online(true)
    freshPinia()
  })

  afterEach(unmountAll)

  it('splits the answer into three groups, keeping the server order inside each', async () => {
    advice.mockResolvedValue(
      answer([row(1, 'take'), row(2, 'take'), row(3, 'if_cheap'), row(4, 'never')], 9),
    )
    const held = await mounted()

    expect(held.phase.value).toBe('ready')
    expect(names(held.groups.value.take)).toEqual(['Позиция 1', 'Позиция 2'])
    expect(names(held.groups.value.if_cheap)).toEqual(['Позиция 3'])
    expect(names(held.groups.value.never)).toEqual(['Позиция 4'])
    expect(held.shown.value).toBe(4)
    expect(held.total.value).toBe(9)
    expect(held.scope.value).toBe('own')
    expect(held.stale.value).toBeNull()
  })

  it('an answer with no rows is empty, not a failure', async () => {
    advice.mockResolvedValue(answer([]))
    const held = await mounted()

    expect(held.phase.value).toBe('empty')
    expect(held.total.value).toBe(0)
  })

  it('without an identity nothing is asked for at all', async () => {
    freshPinia(null)
    const held = await mounted()

    expect(held.phase.value).toBe('idle')
    expect(advice).not.toHaveBeenCalled()
  })

  it('a failure with nothing remembered is offline or an error, decided after it', async () => {
    online(false)
    advice.mockRejectedValue(broke())
    expect((await mounted()).phase.value).toBe('offline')

    unmountAll()
    freshPinia()
    online(true)
    const held = await mounted()
    expect(held.phase.value).toBe('error')

    advice.mockResolvedValue(answer([row(1, 'take')]))
    await held.retry()
    expect(held.phase.value).toBe('ready')
  })

  it('a remembered list outranks a failure: rows with a strip, not a screen of «no connection»', async () => {
    advice.mockResolvedValue(answer([row(1, 'take')]))
    const first = await mounted()
    const fetchedAt = first.fetchedAt.value
    expect(fetchedAt).toBeInstanceOf(Date)

    unmountAll()
    freshPinia()
    online(false)
    advice.mockRejectedValue(broke())
    const again = await mounted()

    expect(again.phase.value).toBe('ready')
    expect(again.stale.value).toBe('offline')
    expect(names(again.groups.value.take)).toEqual(['Позиция 1'])
    // The age is the answer's, not this launch's: it is what the strip prints.
    expect(again.fetchedAt.value?.getTime()).toBe(fetchedAt?.getTime())
  })

  it('nobody else`s memory is read, and a broken one is dropped rather than shown', async () => {
    advice.mockResolvedValue(answer([row(1, 'take')]))
    await mounted()

    unmountAll()
    freshPinia(OTHER)
    online(false)
    advice.mockRejectedValue(broke())
    expect((await mounted()).phase.value).toBe('offline')

    unmountAll()
    localStorage.setItem(
      `molvia.advice.${ME}`,
      '{"answer":{"scope":"own","rows":[{}]},"fetchedAt":"x"}',
    )
    freshPinia()
    expect((await mounted()).phase.value).toBe('offline')
  })

  it('a row that grew a price where its level forbids one does not reach the screen', async () => {
    // The product's core rule is held by the schema, and the phone parses what it remembers
    // with the same one: «не брать нигде» with a price is not a row, it is a broken memory.
    // Written as the wire writes it — a decimal string, never a number.
    const never = {
      itemId: 'cccccccc-0000-4000-8000-000000000001',
      name: 'Колбаса «Молочная»',
      rating: '1.4',
      ratingsCount: 1,
      review: null,
      isMine: true,
      level: 'never',
      places: [
        {
          placeId: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'SAS',
          unitPrice: { amount: '1200.00', currency: 'AMD', unit: 'kg' },
          observations: 1,
        },
      ],
    }
    localStorage.setItem(
      `molvia.advice.${ME}`,
      JSON.stringify({
        answer: {
          geography: { country: 'AM', city: 'Гюмри' },
          scope: 'own',
          rows: [never],
          total: 1,
        },
        fetchedAt: new Date().toISOString(),
      }),
    )
    online(false)
    advice.mockRejectedValue(broke())
    freshPinia()

    expect((await mounted()).phase.value).toBe('offline')

    // The control: the same memory refused for the price alone, not for anything else in it.
    unmountAll()
    const clean = { ...never, places: undefined }
    localStorage.setItem(
      `molvia.advice.${ME}`,
      JSON.stringify({
        answer: {
          geography: { country: 'AM', city: 'Гюмри' },
          scope: 'own',
          rows: [clean],
          total: 1,
        },
        fetchedAt: new Date().toISOString(),
      }),
    )
    freshPinia()
    const held = await mounted()
    expect(held.phase.value).toBe('ready')
    expect(names(held.groups.value.never)).toEqual(['Колбаса «Молочная»'])
  })

  it('А4: a list from the phone says its age while the answer is still on its way', async () => {
    // The same yesterday's prices looked freshly loaded until the request failed: the strip
    // was printed by the failure, not by where the rows came from.
    advice.mockResolvedValue(answer([row(1, 'take')]))
    await mounted()

    unmountAll()
    freshPinia()
    advice.mockReturnValue(new Promise<AdviceResponse>(() => undefined))
    const held = await mounted()

    expect(held.phase.value).toBe('ready')
    expect(held.stale.value).toBe('loading')
    expect(held.fetchedAt.value).toBeInstanceOf(Date)
  })

  it('А4: an answer of this session is not stale, however old the phone`s copy was', async () => {
    advice.mockResolvedValue(answer([row(1, 'take')]))
    await mounted()

    unmountAll()
    freshPinia()
    const held = await mounted()

    expect(held.stale.value).toBeNull()
  })

  it('А3: an ask that arrives while a request is in the air is served, not dropped', async () => {
    // `retry` is this same function, and the screen calls it after a verdict is amended: a
    // refresh in flight used to swallow the ask, leaving the old figures on the screen.
    let land: ((response: AdviceResponse) => void) | undefined
    advice.mockReturnValue(
      new Promise<AdviceResponse>((resolve) => {
        land = resolve
      }),
    )
    const held = await mounted()
    expect(advice).toHaveBeenCalledTimes(1)

    void held.retry()
    await flushPromises()
    // Still one: the ask is remembered rather than run beside the first request.
    expect(advice).toHaveBeenCalledTimes(1)

    advice.mockResolvedValue(answer([row(1, 'take'), row(2, 'take')]))
    land?.(answer([row(1, 'take')]))
    await flushPromises()

    expect(advice).toHaveBeenCalledTimes(2)
    expect(held.shown.value).toBe(2)
  })

  it('А6: a request left over from two identities ago cannot land on the newest list', async () => {
    const landings: ((response: AdviceResponse) => void)[] = []
    advice.mockImplementation(
      () =>
        new Promise<AdviceResponse>((resolve) => {
          landings.push(resolve)
        }),
    )

    const held = await mounted()
    const actor = useActorStore()
    actor.id = OTHER
    await flushPromises()
    actor.id = ME
    await flushPromises()

    // The newest answer arrives first — which is what happens when the first request hangs.
    landings[landings.length - 1]?.(answer([row(1, 'take', '4.7')]))
    await flushPromises()
    expect(held.groups.value.take[0]?.rating).toBe('4.7')

    // And then the one nobody waits for any more: it changes neither the screen nor the phone.
    landings[0]?.(answer([row(2, 'take', '2.0')]))
    await flushPromises()

    expect(held.groups.value.take[0]?.rating).toBe('4.7')
    expect(localStorage.getItem(`molvia.advice.${ME}`)).not.toContain('2.0')
  })

  it('А3: an answer about another city is taken when the settings do not move', async () => {
    // The screen used to leave this branch having set nothing at all, and `phase === 'loading'`
    // draws a skeleton, which carries no «Повторить»: the two devices' race ended in grey bars
    // that a restart could not clear. `me` answering the city it already holds is that race.
    advice.mockResolvedValue({
      ...answer([row(1, 'take')]),
      geography: { country: 'AM', city: 'Ереван' },
    })
    me.mockResolvedValue(actorIn('Гюмри'))
    const held = await mounted()

    expect(held.phase.value).toBe('ready')
    expect(names(held.groups.value.take)).toEqual(['Позиция 1'])
    expect(advice).toHaveBeenCalledTimes(1)
    await held.retry()
    expect(held.phase.value).toBe('ready')

    // The control: the settings really did move, so nothing is taken here — the watcher asks
    // again for the city the answer is about.
    unmountAll()
    freshPinia()
    me.mockResolvedValue(actorIn('Ереван'))
    const moved = await mounted()
    await flushPromises()
    expect(moved.phase.value).toBe('ready')
    expect(advice.mock.calls.length).toBeGreaterThan(1)
  })

  it('А2: a remembered list is shown even when the city is not known yet', async () => {
    advice.mockResolvedValue(answer([row(1, 'take')]))
    await mounted()

    // A cold start with the list on the phone but no settings snapshot: the first one after an
    // update, or a `localStorage` that dropped the smaller key. Yesterday's prices are still
    // true, and the strip above them says how old they are.
    unmountAll()
    localStorage.removeItem(`molvia.settings.${ME}`)
    setActivePinia(createPinia())
    useActorStore().id = ME
    online(false)
    advice.mockRejectedValue(new TypeError('network'))
    const held = await mounted()

    expect(held.phase.value).toBe('ready')
    expect(held.stale.value).toBe('offline')
    expect(held.fetchedAt.value).toBeInstanceOf(Date)
  })

  it('comes back by itself when the connection does', async () => {
    online(false)
    advice.mockRejectedValue(broke())
    const held = await mounted()
    expect(held.phase.value).toBe('offline')

    online(true)
    advice.mockResolvedValue(answer([row(1, 'take')]))
    window.dispatchEvent(new Event('online'))
    await flushPromises()

    expect(held.phase.value).toBe('ready')
  })
})
