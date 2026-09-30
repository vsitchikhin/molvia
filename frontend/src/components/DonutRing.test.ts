import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DonutRing from './DonutRing.vue'

/** The angle, clockwise from twelve, of a point of a path — d3 draws with y down, x to the right. */
function angleOf(x: number, y: number): number {
  const angle = Math.atan2(x, -y)
  return angle < 0 ? angle + Math.PI * 2 : angle
}

/** The first point of a path, and the point where its outer arc ends. */
function ends(d: string): { start: number; end: number } {
  const numbers = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number)
  const [x0 = 0, y0 = 0] = numbers
  // «M x0 y0 A r r 0 large sweep x1 y1 …»: the end of the first arc is the 8th and 9th numbers.
  const x1 = numbers[7] ?? 0
  const y1 = numbers[8] ?? 0
  return { start: angleOf(x0, y0), end: angleOf(x1, y1) }
}

function ring(levels: number[]) {
  return mount(DonutRing, {
    props: {
      sectors: levels.map((level, index) => ({
        key: String(index),
        colour: 'var(--accent)',
        level,
      })),
    },
  })
}

describe('DonutRing (MOL-156)', () => {
  it('draws one sector as a whole ring, with no edge cut into it', () => {
    const paths = ring([1000]).findAll('path')
    expect(paths).toHaveLength(1)
    // A whole ring is two circles; a sector would draw its edges with «L».
    expect(paths[0]?.attributes('d')).not.toMatch(/L/)
  })

  it('leaves a gap of 0,045 rad at the outer edge between two sectors, half on each side', () => {
    const [first, second] = ring([500, 500])
      .findAll('path')
      .map((path) => ends(path.attributes('d') ?? ''))
    expect(first?.start).toBeCloseTo(0.0225, 3)
    expect(first?.end).toBeCloseTo(Math.PI - 0.0225, 3)
    expect((second?.start ?? 0) - (first?.end ?? 0)).toBeCloseTo(0.045, 3)
  })

  it('cuts no gap into a sector narrower than two and a half gaps, and draws none of no level', () => {
    // 17 of 1000 is 0,107 rad, under 2,5 × 0,045 = 0,1125.
    const paths = ring([983, 17, 0]).findAll('path')
    expect(paths).toHaveLength(2)
    const narrow = ends(paths[1]?.attributes('d') ?? '')
    // It ends at twelve o'clock, where the angle turns over to zero.
    const sweep = (narrow.end - narrow.start + Math.PI * 2) % (Math.PI * 2)
    expect(sweep).toBeCloseTo((17 / 1000) * Math.PI * 2, 3)
  })
})
