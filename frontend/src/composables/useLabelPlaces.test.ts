import { describe, expect, it } from 'vitest'
import { apart, LABEL_SPACE_PX, laidOn } from '@/composables/useLabelPlaces'

const box = (left: number, right: number, top = 0, bottom = 10) => ({ left, right, top, bottom })

describe('laidOn', () => {
  it('centres a label on a point, and lays it from the point only past an edge, never at it', () => {
    // A field of 100, a label of 20: centred on 10 it starts at exactly 0 — within, so centred.
    expect(laidOn(10, 10, 20, 100)).toEqual({ left: 0, right: 20, edge: null })
    expect(laidOn(9, 9, 20, 100)).toEqual({ left: 9, right: 29, edge: 'start' })
    expect(laidOn(90, 90, 20, 100)).toEqual({ left: 80, right: 100, edge: null })
    expect(laidOn(91, 91, 20, 100)).toEqual({ left: 71, right: 91, edge: 'end' })
  })

  it('centres a label on a column, and lays it from the column’s own edge inward', () => {
    // A column of 6 at 0 and at 94 of a field of 100; a label of 50 is wider than either.
    expect(laidOn(0, 6, 50, 100)).toEqual({ left: 0, right: 50, edge: 'start' })
    expect(laidOn(94, 100, 50, 100)).toEqual({ left: 50, right: 100, edge: 'end' })
    // One column in: from the column's start, not the field's.
    expect(laidOn(6, 12, 50, 100)).toEqual({ left: 6, right: 56, edge: 'start' })
    expect(laidOn(88, 94, 50, 100)).toEqual({ left: 44, right: 94, edge: 'end' })
    // A label narrower than its column stays centred in it.
    expect(laidOn(40, 60, 10, 100)).toEqual({ left: 45, right: 55, edge: null })
  })

  it('a label wider than the whole field starts at its anchor, never past the left edge', () => {
    expect(laidOn(50, 50, 120, 100)).toEqual({ left: 50, right: 170, edge: 'start' })
  })
})

describe('apart', () => {
  it('across: the least room exactly is apart, a pixel less is not', () => {
    expect(LABEL_SPACE_PX).toBe(8)
    expect(apart(box(0, 10), box(17, 30))).toBe(false)
    expect(apart(box(0, 10), box(18, 30))).toBe(true)
    expect(apart(box(0, 10), box(19, 30))).toBe(true)
    // Either order.
    expect(apart(box(18, 30), box(0, 10))).toBe(true)
    expect(apart(box(17, 30), box(0, 10))).toBe(false)
  })

  it('one over the other: the same room, whatever they share across', () => {
    expect(apart(box(0, 50, 0, 10), box(20, 70, 17, 27))).toBe(false)
    expect(apart(box(0, 50, 0, 10), box(20, 70, 18, 28))).toBe(true)
    expect(apart(box(20, 70, 18, 28), box(0, 50, 0, 10))).toBe(true)
    expect(apart(box(20, 70, 17, 27), box(0, 50, 0, 10))).toBe(false)
  })

  it('a label is never apart from itself', () => {
    const one = box(0, 10)
    expect(apart(one, one)).toBe(false)
  })
})
