<template>
  <svg class="ring" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
    <path v-for="sector in arcs" :key="sector.key" :d="sector.d" :fill="sector.colour" />
  </svg>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { arc } from 'd3-shape'
import { CHART_LEVEL } from '@molvia/model'

/** A sector as the ring draws it: its share of the ring in the server's levels, and a token colour. */
export interface RingSector {
  readonly key: string
  readonly colour: string
  readonly level: number
}

/** The gap between two sectors, in radians (handoff MOL-157, 03). */
const GAP = 0.045
/** A sector narrower than this many gaps goes without one: a gap would eat it (handoff 03). */
const GAPLESS_BELOW = 2.5
const TURN = Math.PI * 2

/**
 * The ring of a donut (MOL-156): clockwise from twelve o'clock in the order given. The geometry is
 * d3-shape's; the shares are the server's levels, so the phone divides nothing but a level into an
 * angle. Only a picture — what it says is said by the text beside it.
 */
export default defineComponent({
  name: 'DonutRing',
  props: {
    sectors: { type: Array as PropType<readonly RingSector[]>, required: true },
    /** How thick the ring is, of the hundred it is drawn in: 16 compact, 12 full (handoff 01, 03). */
    thickness: { type: Number, default: 16 },
  },
  setup(props) {
    const arcs = computed(() => {
      const shape = arc<{ startAngle: number; endAngle: number; padAngle: number }>()
        .innerRadius(50 - props.thickness)
        .outerRadius(50)
      const drawn = props.sectors.filter((sector) => sector.level > 0)
      let start = 0
      return drawn.map((sector) => {
        const sweep = (sector.level / CHART_LEVEL) * TURN
        const padAngle = drawn.length > 1 && sweep >= GAPLESS_BELOW * GAP ? GAP : 0
        const d = shape({ startAngle: start, endAngle: start + sweep, padAngle }) ?? ''
        start += sweep
        return { key: sector.key, colour: sector.colour, d }
      })
    })
    return { arcs }
  },
})
</script>

<style scoped lang="scss">
.ring {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
