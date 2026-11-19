<template>
  <span class="track-spot"
    ><span :style="{ flexGrow: at }"></span><span class="track-mark"><slot /></span
    ><span :style="{ flexGrow: level - at }"></span
  ></span>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { CHART_LEVEL } from '@molvia/model'

/**
 * A mark on a track at the server's place (MOL-348): the room before it and after it, in thousandths
 * of the track (`CHART_LEVEL`), and the mark itself with no width of its own, so it stands centred on
 * its place — a dot, a dashed line, a label. Grow, not offsets: the linter takes no `left: 50%`. One
 * for «Курсы по данным ЦБ РА» and the line «мой — ЦБ РА» (review №10).
 */
export default defineComponent({
  name: 'TrackSpot',
  props: {
    /** Thousandths of the track from its left end. */
    at: { type: Number, required: true },
  },
  setup() {
    return { level: CHART_LEVEL }
  },
})
</script>

<style scoped lang="scss">
.track-spot {
  display: flex;
  align-items: center;

  > span:not(.track-mark) {
    flex-basis: 0;
  }
}

.track-mark {
  display: flex;
  flex: none;
  justify-content: center;
  width: 0;
}
</style>
