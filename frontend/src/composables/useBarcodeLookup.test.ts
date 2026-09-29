import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import { useBarcodeLookup } from '@/composables/useBarcodeLookup'

/** One lookup the test answers by hand, with the signal the composable passed. */
interface Call {
  readonly code: string
  readonly signal: AbortSignal | undefined
  answer(entry: CatalogueEntry | null): void
  fail(error?: Error): void
}

const calls: Call[] = []
vi.mock('@/api', () => ({
  api: {
    catalogueByBarcode: (code: string, options?: { signal?: AbortSignal }) =>
      new Promise<CatalogueEntry | null>((resolve, reject) => {
        calls.push({
          code,
          signal: options?.signal,
          answer: resolve,
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
const kefir = entry('Кефир')

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const mounted: { unmount(): void }[] = []

/** The composable in a component, with what it found and what the device knows by code. */
function harness(known: Record<string, CatalogueEntry> = {}) {
  const found: [CatalogueEntry, string][] = []
  let lookup!: ReturnType<typeof useBarcodeLookup>
  const wrapper = mount(
    defineComponent({
      setup() {
        lookup = useBarcodeLookup({
          found: (item, code) => found.push([item, code]),
          local: (code) => known[code] ?? null,
        })
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return { lookup, found, wrapper }
}

/** Lets an answer given by hand reach the composable. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  calls.length = 0
  online(true)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

describe('the item a code belongs to (MOL-99)', () => {
  it('hands on the item found with its code, and goes back to idle', async () => {
    const { lookup, found } = harness()

    lookup.lookUp('4850000000007')
    expect(lookup.phase.value).toBe('loading')
    expect(calls.map((call) => call.code)).toEqual(['4850000000007'])
    calls[0]?.answer(milk)
    await settle()

    expect(found).toEqual([[milk, '4850000000007']])
    expect(lookup.phase.value).toBe('idle')
    expect(lookup.code.value).toBeNull()
  })

  it('says the code is missing, and which one', async () => {
    const { lookup, found } = harness()

    lookup.lookUp('4850000000014')
    calls[0]?.answer(null)
    await settle()

    expect(lookup.phase.value).toBe('missing')
    expect(lookup.code.value).toBe('4850000000014')
    expect(found).toEqual([])
  })

  it('offline, finds what the device found by that code — and asks nothing', () => {
    online(false)
    const { lookup, found } = harness({ '4850000000007': milk })

    lookup.lookUp('4850000000007')

    expect(calls).toEqual([])
    expect(found).toEqual([[milk, '4850000000007']])
    expect(lookup.phase.value).toBe('idle')
  })

  it('offline, says so when the device knows no item by the code — never red', () => {
    online(false)
    const { lookup, found } = harness({ '4850000000007': milk })

    lookup.lookUp('4850000000014')

    expect(lookup.phase.value).toBe('offline')
    expect(found).toEqual([])
  })

  it('reads a connection lost on the way as offline, decided after the failure (MOL-19)', async () => {
    const { lookup } = harness()

    lookup.lookUp('4850000000014')
    online(false)
    calls[0]?.fail()
    await settle()

    expect(lookup.phase.value).toBe('offline')
  })

  it('under an error, still finds what the device knows before saying so', async () => {
    const { lookup, found } = harness({ '4850000000007': milk })

    lookup.lookUp('4850000000007')
    calls[0]?.fail()
    await settle()

    expect(found).toEqual([[milk, '4850000000007']])
    expect(lookup.phase.value).toBe('idle')
  })

  it('under an error the device cannot answer, is red, and «Повторить» asks the same code again', async () => {
    const { lookup, found } = harness()

    lookup.lookUp('4850000000007')
    calls[0]?.fail()
    await settle()
    expect(lookup.phase.value).toBe('error')

    lookup.retry()
    expect(lookup.phase.value).toBe('loading')
    expect(calls.map((call) => call.code)).toEqual(['4850000000007', '4850000000007'])
    calls[1]?.answer(milk)
    await settle()

    expect(found).toEqual([[milk, '4850000000007']])
  })

  describe('must not hand on an answer nobody waits for', () => {
    it('a lookup cleared by typing', async () => {
      const { lookup, found } = harness()

      lookup.lookUp('4850000000007')
      lookup.clear()
      expect(calls[0]?.signal?.aborted).toBe(true)
      calls[0]?.answer(milk)
      await settle()

      expect(found).toEqual([])
      expect(lookup.phase.value).toBe('idle')
    })

    it('a lookup a newer code replaced', async () => {
      const { lookup, found } = harness()

      lookup.lookUp('4850000000007')
      lookup.lookUp('4850000000014')
      calls[0]?.answer(milk)
      calls[1]?.answer(kefir)
      await settle()

      expect(found).toEqual([[kefir, '4850000000014']])
    })

    it('a failure of a lookup a newer code replaced', async () => {
      const { lookup } = harness()

      lookup.lookUp('4850000000007')
      lookup.lookUp('4850000000014')
      calls[0]?.fail()
      await settle()

      expect(lookup.phase.value).toBe('loading')
    })

    it('a lookup whose screen was left', async () => {
      const { lookup, found, wrapper } = harness()

      lookup.lookUp('4850000000007')
      wrapper.unmount()
      mounted.splice(0)
      expect(calls[0]?.signal?.aborted).toBe(true)
      calls[0]?.answer(milk)
      await settle()

      expect(found).toEqual([])
    })
  })

  it('retries nothing when no code was looked up', () => {
    const { lookup } = harness()

    lookup.retry()

    expect(calls).toEqual([])
    expect(lookup.phase.value).toBe('idle')
  })
})
