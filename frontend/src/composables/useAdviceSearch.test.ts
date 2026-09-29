import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { AdviceResponse, AdviceRow, AdviceSearchResponse } from '@molvia/model'
import { searchRemembered, useAdviceSearch } from '@/composables/useAdviceSearch'
import type { AdviceSearch } from '@/composables/useAdviceSearch'

const adviceSearch = vi.fn<(query: string) => Promise<AdviceSearchResponse>>()
vi.mock('@/api', () => ({ api: { adviceSearch: (query: string) => adviceSearch(query) } }))

const row = (itemId: string, name: string): AdviceRow => ({
  level: 'never',
  itemId,
  name,
  rating: '1.0',
  ratingsCount: 1,
  review: null,
  isMine: true,
})

const lori = row('cccccccc-0000-4000-8000-000000000001', 'Сыр Лори')
const lavash = row('cccccccc-0000-4000-8000-000000000002', 'Лаваш армянский')
const milk = row('cccccccc-0000-4000-8000-000000000003', 'Молоко «Ашхар» 3,2%')
const rows = [lori, lavash, milk]
const names = (text: string) => searchRemembered(rows, text).map((found) => found.name)

describe('searchRemembered — the list on the phone, searched with no connection (В-3)', () => {
  it('finds by the start of a word, in the list`s own order', () => {
    expect(names('сыр')).toEqual(['Сыр Лори'])
    expect(names('лор')).toEqual(['Сыр Лори'])
    expect(names('арм')).toEqual(['Лаваш армянский'])
  })

  it('the transliteration holds: the key is the domain`s own', () => {
    expect(names('syr')).toEqual(['Сыр Лори'])
    expect(names('lavash')).toEqual(['Лаваш армянский'])
    expect(names('ashhar')).toEqual(['Молоко «Ашхар» 3,2%'])
  })

  it('every word typed must start a word of the name', () => {
    expect(names('сыр лори')).toEqual(['Сыр Лори'])
    expect(names('сыр лаваш')).toEqual([])
  })

  // «сыыр» is found: the key folds a doubled letter itself. A typo past the key is the server's.
  it('must not fire: a typo the key does not fold, or the middle of a word', () => {
    expect(names('сыыр')).toEqual(['Сыр Лори'])
    expect(names('сор')).toEqual([])
    expect(names('ори')).toEqual([])
  })

  // Review Р-9: the key folds letters across the start of a word — `deцkoe`, `maцun` — and a key
  // cut short is not its start; the text typed or the key spelt out finds them.
  it('a word whose key folds letters is found by its start, as the catalogue`s search finds it', () => {
    const more = [
      row('cccccccc-0000-4000-8000-000000000004', 'Детское питание'),
      row('cccccccc-0000-4000-8000-000000000005', 'Братская сосиска'),
      row('cccccccc-0000-4000-8000-000000000006', 'Пхали'),
      row('cccccccc-0000-4000-8000-000000000007', 'Мацун'),
    ]
    const find = (text: string) => searchRemembered(more, text).map((found) => found.name)
    expect(find('дет')).toEqual(['Детское питание'])
    expect(find('брат')).toEqual(['Братская сосиска'])
    expect(find('пх')).toEqual(['Пхали'])
    expect(find('mat')).toEqual(['Мацун'])
    expect(find('matsun')).toEqual(['Мацун'])
  })

  it('nothing typed that draws finds nothing, not everything', () => {
    expect(names('   ')).toEqual([])
  })

  it('answers each row with the row itself: the verdict as the list had it', () => {
    expect(searchRemembered(rows, 'сыр')).toEqual([
      { itemId: lori.itemId, name: lori.name, advice: lori },
    ])
  })
})

// Review Р-19: the rhythm of the search, which the screen's tests do not reach.
describe('useAdviceSearch — the rhythm', () => {
  const answer = (name: string): AdviceSearchResponse => ({
    geography: { country: 'AM', city: 'Гюмри' },
    scope: 'own',
    near: true,
    items: [{ itemId: lori.itemId, name, advice: null }],
  })
  const list: AdviceResponse = {
    geography: { country: 'AM', city: 'Гюмри' },
    scope: 'own',
    rows,
    total: rows.length,
  }

  function held<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })
    return { promise, resolve, reject }
  }

  function harness() {
    const query = ref('')
    let search!: AdviceSearch
    const view = mount(
      defineComponent(() => {
        search = useAdviceSearch(query, () => list)
        return () => h('div')
      }),
    )
    return { query, search, view }
  }

  function online(value: boolean): void {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
  }

  beforeEach(() => {
    adviceSearch.mockReset()
    online(true)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a late answer to an older query does not replace the newer one', async () => {
    const first = held<AdviceSearchResponse>()
    adviceSearch.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer('newer'))
    const { query, search } = harness()

    query.value = 'сы'
    await vi.waitFor(() => {
      expect(adviceSearch).toHaveBeenCalledTimes(1)
    })
    query.value = 'сыр'
    await vi.waitFor(() => {
      expect(search.found.value[0]?.name).toBe('newer')
    })
    first.resolve(answer('older'))
    await flushPromises()

    expect(search.found.value[0]?.name).toBe('newer')
  })

  it('cleared while a search is out — idle, and the answer that lands is dropped', async () => {
    const out = held<AdviceSearchResponse>()
    adviceSearch.mockReturnValueOnce(out.promise)
    const { query, search } = harness()

    query.value = 'сыр'
    await vi.waitFor(() => {
      expect(adviceSearch).toHaveBeenCalledTimes(1)
    })
    query.value = ''
    await flushPromises()
    out.resolve(answer('late'))
    await flushPromises()

    expect(search.phase.value).toBe('idle')
    expect(search.found.value).toEqual([])
  })

  it('a failure with a connection is an error; without one, the list on the phone', async () => {
    adviceSearch.mockRejectedValue(new Error('HTTP 502'))
    const { query, search } = harness()
    query.value = 'сыр'
    await vi.waitFor(() => {
      expect(search.phase.value).toBe('error')
    })

    online(false)
    const second = harness()
    second.query.value = 'сыр'
    await flushPromises()
    expect(second.search.phase.value).toBe('memory')
    expect(second.search.found.value.map((found) => found.name)).toEqual(['Сыр Лори'])
  })

  it('back online, what the phone found is asked of the server', async () => {
    online(false)
    adviceSearch.mockResolvedValue(answer('from the server'))
    const { query, search } = harness()
    query.value = 'сыр'
    await flushPromises()
    expect(search.phase.value).toBe('memory')

    online(true)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => {
      expect(search.found.value[0]?.name).toBe('from the server')
    })
  })
})
