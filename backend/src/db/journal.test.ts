import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { journalOf, stampsOutOfOrder } from './journal'

const folder = fileURLToPath(new URL('../../drizzle', import.meta.url))

describe('the journal of migrations', () => {
  it('stamps every migration later than the one before it, or drizzle skips it in silence', () => {
    expect(stampsOutOfOrder(journalOf(folder)).map((entry) => entry.tag)).toEqual([])
  })

  it('numbers them in order, each with its file', () => {
    const entries = journalOf(folder)
    expect(entries.map((entry) => entry.idx)).toEqual(entries.map((_, index) => index))
    expect(entries.map((entry) => entry.tag.slice(0, 4))).toEqual(
      entries.map((_, index) => String(index).padStart(4, '0')),
    )
  })

  it('finds a stamp that is not later than the one before', () => {
    const entries = [
      { idx: 0, when: 10, tag: '0000_a' },
      { idx: 1, when: 30, tag: '0001_b' },
      { idx: 2, when: 20, tag: '0002_c' },
      { idx: 3, when: 20, tag: '0003_d' },
    ]
    expect(stampsOutOfOrder(entries).map((entry) => entry.tag)).toEqual(['0002_c', '0003_d'])
  })
})
