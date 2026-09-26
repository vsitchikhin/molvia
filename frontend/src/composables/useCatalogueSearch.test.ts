import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { CatalogueEntry, CatalogueSearchResponse } from '@molvia/model'
import { SEARCH_DEBOUNCE_MS, useCatalogueSearch } from '@/composables/useCatalogueSearch'

/** One search the test answers by hand, with the signal the composable passed. */
interface Call {
  readonly query: string
  readonly signal: AbortSignal | undefined
  /** A close answer — or an empty one, which is never close. */
  answer(entries: CatalogueEntry[]): void
  /** Rows, none of them close to the query (MOL-46). */
  answerFar(entries: CatalogueEntry[]): void
  /** An answer of an API before MOL-46, as the client reads it: `near` defaults to true. */
  answerOld(entries: CatalogueEntry[]): void
  fail(error?: Error): void
}

const calls: Call[] = []
vi.mock('@/api', () => ({
  api: {
    searchCatalogue: (query: string, options?: { signal?: AbortSignal }) =>
      new Promise<CatalogueSearchResponse>((resolve, reject) => {
        calls.push({
          query,
          signal: options?.signal,
          answer: (items) => {
            resolve({ items, near: items.length > 0 })
          },
          answerFar: (items) => {
            resolve({ items, near: false })
          },
          // What the client makes of an answer with no `near`: the contract's default.
          answerOld: (items) => {
            resolve({ items, near: true })
          },
          fail: (error: Error = new ApiError(ERROR.INTERNAL, 'transport')) => {
            reject(error)
          },
        })
      }),
  },
}))

function entry(name: string): CatalogueEntry {
  return {
    id: crypto.randomUUID(),
    kind: 'product',
    name,
    note: null,
    defaultUnit: 'l',
    typicalQuantity: null,
  }
}

const milk = entry('Молоко «Ашхар»')
const cream = entry('Сливки')

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const mounted: { unmount(): void }[] = []

function harness() {
  const query = ref('')
  let search!: ReturnType<typeof useCatalogueSearch>
  const wrapper = mount(
    defineComponent({
      setup() {
        search = useCatalogueSearch(query)
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return { query, search, wrapper }
}

/** Types the text and lets the watcher see it. */
async function type(query: { value: string }, text: string): Promise<void> {
  query.value = text
  await nextTick()
}

/** Past the pause, so the scheduled search goes out. */
async function pause(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
}

/** Lets an answer given by hand reach the composable. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  calls.length = 0
  vi.useFakeTimers()
  online(true)
})

afterEach(() => {
  // A screen left mounted keeps listening for `online` and answers the next test's event.
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the catalogue search as the screen types it', () => {
  it('sends one search per pause, with the text as typed', async () => {
    const { query } = harness()

    for (const text of ['м', 'мо', 'мол', 'моло', 'молок']) {
      await type(query, text)
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1)
    }
    expect(calls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(calls.map((call) => call.query)).toEqual(['молок'])
  })

  it('sends the query untrimmed: the key is the server’s to take', async () => {
    const { query } = harness()
    await type(query, ' Мол ')
    await pause()

    expect(calls[0]?.query).toBe(' Мол ')
  })

  it('never asks about an empty or blank field — it would count as a visit', async () => {
    const { query, search } = harness()
    for (const text of ['', '   ', '\t']) {
      await type(query, text)
      await pause()
    }

    expect(calls).toHaveLength(0)
    expect(search.phase.value).toBe('idle')
  })

  it('shows the skeleton only before the first answer', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    expect(search.phase.value).toBe('loading')

    await pause()
    calls[0]?.answer([milk])
    await settle()
    expect(search.phase.value).toBe('ready')
    expect(search.results.value).toEqual([milk])
  })

  it('keeps the previous answer on screen, marked stale, while the next one is out', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    await pause()
    calls[0]?.answer([milk])
    await settle()

    await type(query, 'моло')
    expect(search.phase.value).toBe('ready')
    expect(search.stale.value).toBe(true)
    expect(search.results.value).toEqual([milk])

    await pause()
    calls[1]?.answer([milk, cream])
    await settle()
    expect(search.stale.value).toBe(false)
    expect(search.results.value).toEqual([milk, cream])
  })

  it('stays stale over an empty answer too, rather than blinking to the skeleton', async () => {
    const { query, search } = harness()
    await type(query, 'тан')
    await pause()
    calls[0]?.answer([])
    await settle()
    expect(search.phase.value).toBe('empty')
    expect(search.answered.value).toBe('тан')

    await type(query, 'танн')
    expect(search.phase.value).toBe('empty')
    expect(search.stale.value).toBe(true)
  })

  it('calls an answer with rows and nothing close far, and keeps its rows (MOL-46)', async () => {
    const { query, search } = harness()
    await type(query, 'пельмени')
    await pause()
    calls[0]?.answerFar([cream])
    await settle()
    expect(search.phase.value).toBe('far')
    expect(search.results.value).toEqual([cream])
    expect(search.answered.value).toBe('пельмени')

    // Stale over it as over any answer, not back to the skeleton.
    await type(query, 'пельмен')
    expect(search.phase.value).toBe('far')
    expect(search.stale.value).toBe(true)

    await pause()
    calls[1]?.answer([milk])
    await settle()
    expect(search.phase.value).toBe('ready')
  })

  it('aborts the search still out when the next one goes', async () => {
    const { query } = harness()
    await type(query, 'мол')
    await pause()
    await type(query, 'молоко')
    await pause()

    expect(calls[0]?.signal?.aborted).toBe(true)
    expect(calls[1]?.signal?.aborted).toBe(false)
  })

  it('drops an answer that arrives after a newer one — the abort can lose the race', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    await pause()
    await type(query, 'молоко')
    await pause()

    calls[1]?.answer([milk])
    await settle()
    calls[0]?.answer([cream])
    await settle()

    expect(search.results.value).toEqual([milk])
    expect(search.answered.value).toBe('молоко')
  })

  it('drops the failure of a superseded search as well', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    await pause()
    await type(query, 'молоко')
    await pause()

    calls[0]?.fail()
    await settle()

    expect(search.phase.value).toBe('loading')
  })

  it('shows an answer that lands inside the pause, dimmed — it answers the text before', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    await pause()
    calls[0]?.answer([milk])
    await settle()
    await type(query, 'моло')
    await pause()

    await type(query, 'молок')
    // Not cut at the keystroke: on a slow network that would leave nothing on screen until the
    // typing stopped (Р-13).
    expect(calls[1]?.signal?.aborted).toBe(false)
    calls[1]?.answer([cream])
    await settle()

    expect(search.results.value).toEqual([cream])
    expect(search.answered.value).toBe('моло')
    expect(search.stale.value).toBe(true)

    await pause()
    expect(calls.map((call) => call.query)).toEqual(['мол', 'моло', 'молок'])
    expect(search.stale.value).toBe(true)
    calls[2]?.answer([milk])
    await settle()
    expect(search.stale.value).toBe(false)
    expect(search.answered.value).toBe('молок')
  })

  it('answers while the person keeps typing, however slow the network — every pause shows something', async () => {
    const { query, search } = harness()
    await type(query, 'м')
    await pause()
    // The next letter comes before the answer: the search it sent lives on.
    await type(query, 'мо')
    calls[0]?.answer([milk])
    await settle()

    expect(search.phase.value).toBe('ready')
    expect(search.results.value).toEqual([milk])
    expect(search.stale.value).toBe(true)
  })

  it('does not paint an error for a search the next pause will replace', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    await pause()
    await type(query, 'моло')
    calls[0]?.fail(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
    await settle()

    expect(search.phase.value).toBe('loading')
    await pause()
    calls[1]?.answer([milk])
    await settle()
    expect(search.phase.value).toBe('ready')
  })

  it('never asks about a field that draws nothing — a pasted U+200B is as empty as spaces', async () => {
    const { query, search } = harness()
    for (const text of [String.fromCodePoint(0x200b), String.fromCodePoint(0x2060, 0x20)]) {
      await type(query, text)
      await pause()
    }

    expect(calls).toHaveLength(0)
    expect(search.phase.value).toBe('idle')
  })

  it('goes back to idle when the field is cleared, cancelling what was out', async () => {
    const { query, search } = harness()
    await type(query, 'мол')
    await pause()
    await type(query, '')

    expect(calls[0]?.signal?.aborted).toBe(true)
    calls[0]?.answer([milk])
    await settle()
    expect(search.phase.value).toBe('idle')
    expect(search.results.value).toEqual([])
  })

  it('cancels a search not yet sent when the field is cleared inside the pause', async () => {
    const { query } = harness()
    await type(query, 'мол')
    await type(query, '')
    await pause()

    expect(calls).toHaveLength(0)
  })

  describe('when it fails', () => {
    it('is an error while the device is online — the server broke, not the network', async () => {
      const { query, search } = harness()
      await type(query, 'мол')
      await pause()
      calls[0]?.fail(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
      await settle()

      expect(search.phase.value).toBe('error')
      expect(search.results.value).toEqual([])
    })

    it('is offline when the connection dropped while the answer was on its way', async () => {
      const { query, search } = harness()
      await type(query, 'мол')
      await pause()
      online(false)
      calls[0]?.fail()
      await settle()

      expect(search.phase.value).toBe('offline')
    })

    it('stays offline letter by letter — no skeleton over the recent items', async () => {
      online(false)
      const { query, search } = harness()
      for (const text of ['м', 'мо', 'мол']) {
        await type(query, text)
        expect(search.phase.value, text).toBe('offline')
      }
      await pause()
      expect(calls).toHaveLength(0)
    })

    it('does not ask at all while offline', async () => {
      online(false)
      const { query, search } = harness()
      await type(query, 'мол')
      await pause()

      expect(calls).toHaveLength(0)
      expect(search.phase.value).toBe('offline')
    })

    it('tries again on «Повторить», at once and with the current text', async () => {
      const { query, search } = harness()
      await type(query, 'мол')
      await pause()
      calls[0]?.fail()
      await settle()

      search.retry()
      expect(search.phase.value).toBe('loading')
      expect(calls.map((call) => call.query)).toEqual(['мол', 'мол'])

      calls[1]?.answer([milk])
      await settle()
      expect(search.phase.value).toBe('ready')
    })

    it('tries again by itself when the connection comes back', async () => {
      online(false)
      const { query, search } = harness()
      await type(query, 'мол')
      await pause()
      expect(search.phase.value).toBe('offline')

      online(true)
      window.dispatchEvent(new Event('online'))
      expect(calls.map((call) => call.query)).toEqual(['мол'])
    })

    it('retries quietly when the app is looked at again: what is on screen stays until the answer', async () => {
      const { query, search } = harness()
      await type(query, 'мол')
      await pause()
      calls[0]?.fail()
      await settle()
      expect(search.phase.value).toBe('error')

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(calls).toHaveLength(2)
      expect(search.phase.value).toBe('error')

      calls[1]?.fail()
      await settle()
      expect(search.phase.value).toBe('error')
    })

    it('does not search again on reconnect when nothing failed', async () => {
      const { query } = harness()
      await type(query, 'мол')
      await pause()
      calls[0]?.answer([milk])
      await settle()

      window.dispatchEvent(new Event('online'))
      expect(calls).toHaveLength(1)
    })
  })

  it('lets go of everything when the screen is left', async () => {
    const { query, wrapper } = harness()
    await type(query, 'мол')
    await pause()
    await type(query, 'моло')

    wrapper.unmount()
    await pause()
    window.dispatchEvent(new Event('online'))

    expect(calls).toHaveLength(1)
    expect(calls[0]?.signal?.aborted).toBe(true)
  })
})

describe('the query that found nothing (MOL-45)', () => {
  /** Types, waits out the pause and answers the search that went out. */
  async function ask(query: { value: string }, text: string, found: CatalogueEntry[]) {
    await type(query, text)
    await pause()
    calls.at(-1)?.answer(found)
    await settle()
  }

  it('holds the last query the server found nothing for, and keeps it past a later find', async () => {
    const { query, search } = harness()
    expect(search.missed.value).toBeNull()

    await ask(query, 'бахчевые', [])
    expect(search.missed.value).toBe('бахчевые')

    await ask(query, 'арбуз', [milk])
    expect(search.missed.value).toBe('бахчевые')
  })

  it('keeps it when erasing back through it: «бахч» found nothing too, and is not the word', async () => {
    const { query, search } = harness()
    await ask(query, 'бахчевые', [])
    await ask(query, 'БАХЧ', [])
    expect(search.missed.value).toBe('бахчевые')
  })

  it('takes the longer word while it is being typed, and another word outright', async () => {
    const { query, search } = harness()
    await ask(query, 'бах', [])
    await ask(query, 'бахчевые', [])
    expect(search.missed.value).toBe('бахчевые')

    await ask(query, 'дыня', [])
    expect(search.missed.value).toBe('дыня')
  })

  it('keeps it when the key would not start with what is left: «дет» of «детское» (review К)', async () => {
    // `deцkoe` does not start with `det` — the key folds «тс» by position, the text does not.
    const { query, search } = harness()
    await ask(query, 'детское питание', [])
    await ask(query, 'дет', [])
    expect(search.missed.value).toBe('детское питание')
  })

  it('hands the miss to a pick by another word, once, and forgets it (review И)', async () => {
    const { query, search } = harness()
    await ask(query, 'кефир', [])
    expect(search.takeMissed('молоко')).toBe('кефир')
    expect(search.takeMissed('хлеб')).toBeNull()
    expect(search.missed.value).toBeNull()
  })

  it.each([
    ['сыр косичка', 'сыр'],
    ['картошк', 'картошка'],
    ['Кефир', 'кефир '],
    ['сгущёнка варёная', 'сгущенка'],
    ['кока-кола лайт', 'кока кола'],
    ['moloko toplenoe', 'молоко'],
  ])(
    'hands no miss «%s» to a pick by «%s» — one starts the other (review Р-1, Е)',
    async (miss, found) => {
      const { query, search } = harness()
      await ask(query, miss, [])
      expect(search.takeMissed(found)).toBeNull()
      expect(search.missed.value).toBeNull()
    },
  )

  it('holds a far answer as a miss: the screen says «не нашли» there too (MOL-46)', async () => {
    const { query, search } = harness()
    await type(query, 'пельмени')
    await pause()
    calls.at(-1)?.answerFar([cream])
    await settle()
    expect(search.missed.value).toBe('пельмени')

    // Taken from that very answer, the item was found by the word itself — nothing to learn.
    expect(search.takeMissed('пельмени')).toBeNull()
  })

  it('holds an empty answer of an API older than `near` as a miss — it reads as near (review Р-5)', async () => {
    const { query, search } = harness()
    await type(query, 'бахчевые')
    await pause()
    calls.at(-1)?.answerOld([])
    await settle()

    expect(search.phase.value).toBe('empty')
    expect(search.missed.value).toBe('бахчевые')
  })

  it('must not fire on a near answer', async () => {
    const { query, search } = harness()
    await ask(query, 'молоко', [milk])
    expect(search.missed.value).toBeNull()
  })

  it('must not fire on a failure or offline — nothing was found to be missing', async () => {
    const { query, search } = harness()
    await type(query, 'бахчевые')
    await pause()
    calls.at(-1)?.fail()
    await settle()
    expect(search.missed.value).toBeNull()

    online(false)
    await type(query, 'дыня')
    expect(search.missed.value).toBeNull()
  })

  it('must not fire on an answer the next one replaced', async () => {
    const { query, search } = harness()
    await type(query, 'бахчевые')
    await pause()
    const first = calls.at(-1)
    await type(query, 'арбуз')
    await pause()
    first?.answer([])
    await settle()
    expect(search.missed.value).toBeNull()
  })
})
