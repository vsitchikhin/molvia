import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeEverywhere } from '@/stores/storage'

/**
 * A localStorage that is full: it reads what it holds, removes freely — removing needs no quota —
 * and takes a write only if it fits into what was freed. sessionStorage works.
 */
// Restored by defining the originals back: happy-dom refuses to delete an own property of storage.
const originalSet = localStorage.setItem.bind(localStorage)
const originalRemove = localStorage.removeItem.bind(localStorage)
const working = originalSet
let room = 0

function fill(): void {
  Object.defineProperty(localStorage, 'setItem', {
    configurable: true,
    writable: true,
    value: (key: string, value: string) => {
      if (value.length > room) throw new Error('QuotaExceededError')
      room -= value.length
      working(key, value)
    },
  })
  const remove = originalRemove
  Object.defineProperty(localStorage, 'removeItem', {
    configurable: true,
    writable: true,
    value: (key: string) => {
      room += localStorage.getItem(key)?.length ?? 0
      remove(key)
    },
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  room = 0
})

afterEach(() => {
  for (const [name, value] of [
    ['setItem', originalSet],
    ['removeItem', originalRemove],
  ] as const) {
    Object.defineProperty(localStorage, name, { configurable: true, writable: true, value })
  }
})

describe('writeEverywhere', () => {
  it('says yes only when every shelf took the write', () => {
    expect(writeEverywhere('k', 'now')).toBe(true)
    fill()
    expect(writeEverywhere('k', 'later')).toBe(false)
    expect(sessionStorage.getItem('k')).toBe('later')
  })

  it('removes a refusing shelf’s past when told nothing of it is true', () => {
    localStorage.setItem('k', 'past')
    fill()
    writeEverywhere('k', 'present')
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('leaves a past that is still true alone, even on a shelf that takes nothing (Г1)', () => {
    localStorage.setItem('k', 'still true')
    fill()
    writeEverywhere('k', 'still true and more', (past) => past)
    expect(localStorage.getItem('k')).toBe('still true')
  })

  it('writes back the part still true into the room its removal freed (Р-13)', () => {
    localStorage.setItem('k', 'sent,waiting')
    fill()
    writeEverywhere('k', 'waiting,new', (past) => past.split(',')[1] ?? null)
    expect(localStorage.getItem('k')).toBe('waiting')
  })
})
