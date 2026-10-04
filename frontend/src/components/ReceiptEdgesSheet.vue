<template>
  <!-- «Края чека» (MOL-222, brief 12 of MOL-118): a sheet over the capture sheet — «‹», no × (Д-1).
       On the kit until the handoff comes (MOL-127 В-1). -->
  <BottomSheet :open="open" back :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.edges.title') }}</template>
    <template #meta>{{ t('receipt.capture.part', { n: part }) }}</template>

    <div v-if="photo" ref="stage" class="stage" :style="stageStyle">
      <canvas ref="view" class="view" aria-hidden="true" />
      <svg
        class="frame"
        :viewBox="`0 0 ${photo.width} ${photo.height}`"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path class="dim" fill-rule="evenodd" :d="dimPath" />
        <polygon class="edge" :points="points" vector-effect="non-scaling-stroke" />
      </svg>
      <button
        v-for="(corner, index) in quad"
        :key="index"
        type="button"
        class="handle"
        data-drags
        :class="{ held: held === index }"
        :style="{
          left: `${(corner.x / photo.width) * 100}%`,
          top: `${(corner.y / photo.height) * 100}%`,
        }"
        :aria-label="t('receipt.edges.corner', { corner: t(CORNERS[index] ?? CORNERS[0]) })"
        :disabled="busy"
        @pointerdown="grab(index, $event)"
        @pointermove="drag(index, $event)"
        @pointerup="letGo"
        @pointercancel="letGo"
        @keydown="nudge(index, $event)"
      >
        <span class="dot" aria-hidden="true" />
      </button>
      <canvas
        v-show="held !== null"
        ref="loupe"
        class="loupe"
        :class="{ low: loupeBelow }"
        :style="loupeStyle"
        aria-hidden="true"
      />
    </div>

    <p class="hint">{{ t(found ? 'receipt.edges.hint' : 'receipt.edges.not_found') }}</p>
    <p v-if="narrow" class="narrow" role="status">{{ t('receipt.edges.narrow') }}</p>

    <template #footer>
      <div class="pair">
        <template v-if="narrow">
          <AppButton variant="secondary" size="large" @click="$emit('closer')">
            {{ t('receipt.edges.closer') }}
          </AppButton>
          <AppButton size="large" @click="keep">{{ t('receipt.edges.keep') }}</AppButton>
        </template>
        <template v-else>
          <AppButton variant="secondary" size="large" :inactive="busy" @click="turn">
            <template #icon><IconRotate /></template>
            {{ t('receipt.edges.turn') }}
          </AppButton>
          <AppButton size="large" :busy="busy" @click="done">{{
            t('receipt.edges.done')
          }}</AppButton>
        </template>
      </div>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconRotate from '~icons/mdi/rotate-right'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import {
  RECEIPT_PHOTO_NARROW,
  proposeCorners,
  straighten,
  turnedCorners,
  turnedPhoto,
} from '@/receipts/straighten'
import { orderCorners } from '@/receipts/warp'
import type { Point, Quad } from '@/receipts/warp'

const CORNERS = [
  'receipt.edges.corners.top_left',
  'receipt.edges.corners.top_right',
  'receipt.edges.corners.bottom_right',
  'receipt.edges.corners.bottom_left',
] as const

/** The long side the photo is drawn at on the screen: sharp on a phone, light on its memory. */
const VIEW_SIDE = 1280
/** How much nearer the loupe shows the corner than the photo on the screen. */
const LOUPE_ZOOM = 3
/** A key press moves a corner by this share of the photo's side; with Shift, five times. */
const NUDGE = 0.005

/**
 * «Края чека» (MOL-222, Т-1…Т-4): the photo with four corners the phone proposed (Т-2), each moved by
 * a finger — a loupe over it, since the finger hides the corner — or by the arrow keys; «Повернуть» a
 * quarter clockwise; «Готово» straightens the receipt off the page and hands it on, unless it came
 * out narrower than a till's grid can be read at — then «Чек мелкий» asks first, and sends nothing.
 * «‹» and the system's «back» take the shot away: no part is added.
 */
export default defineComponent({
  name: 'ReceiptEdgesSheet',
  components: { AppButton, BottomSheet, IconRotate },
  props: {
    open: { type: Boolean, required: true },
    /** The decoded photo, upright by its EXIF; the sheet never changes the one it is given. */
    source: { type: Object as PropType<HTMLCanvasElement | null>, default: null },
    /** Which part of the receipt this is, from 1. */
    part: { type: Number, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** The receipt cut out and straight, at most `RECEIPT_PHOTO_SIDE` long. */
    done: (receipt: HTMLCanvasElement) => receipt instanceof HTMLCanvasElement,
    /** «Подойти ближе»: this shot is dropped, and the camera asked again. */
    closer: () => true,
    /** The photo could not be read or straightened: the shot is given up, said by the opener. */
    failed: () => true,
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const stage = ref<HTMLElement | null>(null)
    const view = ref<HTMLCanvasElement | null>(null)
    const loupe = ref<HTMLCanvasElement | null>(null)
    /** The photo as it stands — the source, or the source turned: the corners are in its pixels. */
    const photo = shallowRef<HTMLCanvasElement | null>(null)
    const quad = ref<Quad>([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ])
    const found = ref(true)
    const held = ref<number | null>(null)
    const busy = ref(false)
    /** The receipt straightened, waiting on «Оставить так» for being narrow. */
    const narrowed = shallowRef<HTMLCanvasElement | null>(null)
    const narrow = computed(() => narrowed.value !== null)

    /** A canvas this sheet made — a turn — is let go here; the source is the opener's. */
    function release(canvas: HTMLCanvasElement | null): void {
      if (canvas && canvas !== props.source) {
        canvas.width = 0
        canvas.height = 0
      }
    }

    function draw(): void {
      const canvas = view.value
      const from = photo.value
      if (!canvas || !from) return
      const scale = Math.min(1, VIEW_SIDE / Math.max(from.width, from.height))
      canvas.width = Math.round(from.width * scale)
      canvas.height = Math.round(from.height * scale)
      canvas.getContext('2d')?.drawImage(from, 0, 0, canvas.width, canvas.height)
    }

    async function show(from: HTMLCanvasElement): Promise<void> {
      if (photo.value !== from) release(photo.value)
      photo.value = from
      const proposed = proposeCorners(from)
      quad.value = proposed.quad
      found.value = proposed.found
      await nextTick()
      draw()
    }

    watch(
      () => [props.open, props.source] as const,
      ([open, source]) => {
        if (!open || !source) return
        release(narrowed.value)
        narrowed.value = null
        busy.value = false
        void show(source)
      },
      { immediate: true },
    )

    // as wide as the sheet, unless that makes it taller than the viewfinder's height: then narrower,
    // the proportions kept — the corners are drawn over it in shares of its box
    const stageStyle = computed(() => {
      const from = photo.value
      if (!from) return {}
      const ratio = from.width / from.height
      return {
        aspectRatio: `${String(from.width)} / ${String(from.height)}`,
        width: `min(100%, calc(var(--viewfinder-height) * ${String(ratio)}))`,
      }
    })

    const points = computed(() => quad.value.map((p) => `${String(p.x)},${String(p.y)}`).join(' '))
    const dimPath = computed(() => {
      const from = photo.value
      if (!from) return ''
      const [a, b, c, d] = quad.value
      const at = (p: Point) => `${String(p.x)} ${String(p.y)}`
      return `M0 0H${String(from.width)}V${String(from.height)}H0Z M${at(a)} L${at(b)} L${at(c)} L${at(d)} Z`
    })

    /** Where a finger is on the photo, in its pixels, kept inside it. */
    function photoPoint(event: PointerEvent): Point | null {
      const box = stage.value?.getBoundingClientRect()
      const from = photo.value
      if (!box || !from || box.width === 0 || box.height === 0) return null
      const x = ((event.clientX - box.left) / box.width) * from.width
      const y = ((event.clientY - box.top) / box.height) * from.height
      return { x: Math.min(from.width, Math.max(0, x)), y: Math.min(from.height, Math.max(0, y)) }
    }

    function move(index: number, to: Point): void {
      narrowed.value = null
      quad.value = quad.value.map((p, i) => (i === index ? to : p)) as unknown as Quad
    }

    const loupeAt = ref<Point>({ x: 0, y: 0 })
    const loupeBelow = computed(() => {
      const from = photo.value
      return !!from && loupeAt.value.y < from.height * 0.2
    })
    const loupeStyle = computed(() => {
      const from = photo.value
      if (!from) return {}
      return {
        left: `${String((loupeAt.value.x / from.width) * 100)}%`,
        top: `${String((loupeAt.value.y / from.height) * 100)}%`,
      }
    })

    function drawLoupe(at: Point): void {
      loupeAt.value = at
      const canvas = loupe.value
      const from = photo.value
      const box = stage.value?.getBoundingClientRect()
      if (!canvas || !from || !box) return
      const side = canvas.clientWidth || 96
      canvas.width = side
      canvas.height = side
      const context = canvas.getContext('2d')
      if (!context) return
      // what a side of the loupe covers of the photo, at LOUPE_ZOOM times the screen's scale
      const span = (side / LOUPE_ZOOM) * (from.width / box.width)
      context.drawImage(from, at.x - span / 2, at.y - span / 2, span, span, 0, 0, side, side)
    }

    function grab(index: number, event: PointerEvent): void {
      if (busy.value) return
      held.value = index
      ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
      const corner = quad.value[index]
      if (corner) drawLoupe(corner)
    }

    function drag(index: number, event: PointerEvent): void {
      if (held.value !== index) return
      const to = photoPoint(event)
      if (!to) return
      move(index, to)
      drawLoupe(to)
    }

    function letGo(): void {
      if (held.value === null) return
      held.value = null
      // a corner dragged across another stays a receipt, not a bow tie
      quad.value = orderCorners(quad.value)
    }

    function nudge(index: number, event: KeyboardEvent): void {
      const from = photo.value
      const corner = quad.value[index]
      if (!from || !corner || busy.value) return
      const step = Math.max(from.width, from.height) * NUDGE * (event.shiftKey ? 5 : 1)
      const by: Record<string, Point> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      }
      const delta = by[event.key]
      if (!delta) return
      event.preventDefault()
      move(index, {
        x: Math.min(from.width, Math.max(0, corner.x + delta.x)),
        y: Math.min(from.height, Math.max(0, corner.y + delta.y)),
      })
    }

    async function turn(): Promise<void> {
      const from = photo.value
      if (!from || busy.value) return
      const next = turnedPhoto(from)
      if (!next) return
      const corners = turnedCorners(quad.value, from)
      release(from)
      photo.value = next
      quad.value = corners
      narrowed.value = null
      await nextTick()
      draw()
    }

    async function done(): Promise<void> {
      const from = photo.value
      if (!from || busy.value) return
      busy.value = true
      try {
        const straight = await straighten(from, orderCorners(quad.value))
        if (!props.open) return
        if (!straight) {
          emit('failed')
          return
        }
        if (straight.width < RECEIPT_PHOTO_NARROW) {
          narrowed.value = straight
          return
        }
        emit('done', straight)
      } finally {
        busy.value = false
      }
    }

    function keep(): void {
      const straight = narrowed.value
      if (!straight) return
      narrowed.value = null
      emit('done', straight)
    }

    onBeforeUnmount(() => {
      release(photo.value)
      release(narrowed.value)
    })

    return {
      t,
      CORNERS,
      stage,
      view,
      loupe,
      photo,
      quad,
      found,
      held,
      busy,
      narrow,
      points,
      dimPath,
      stageStyle,
      loupeBelow,
      loupeStyle,
      grab,
      drag,
      letGo,
      nudge,
      turn: () => void turn(),
      done: () => void done(),
      keep,
    }
  },
})
</script>

<style scoped lang="scss">
.stage {
  position: relative;
  margin: 0 auto;
  border-radius: var(--radius);
  background: var(--viewfinder-ground);
  touch-action: none;
}

.view,
.frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius);
}

.dim {
  fill: var(--viewfinder-dim);
}

.edge {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
}

.handle {
  position: absolute;
  display: grid;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  transform: translate(-50%, -50%);
  cursor: grab;
  touch-action: none;

  &:focus-visible {
    outline: var(--hairline) solid var(--accent);
    outline-offset: calc(var(--space-1) * -1);
  }
}

.dot {
  width: var(--badge-dot);
  height: var(--badge-dot);
  border: var(--space-1) solid var(--accent);
  border-radius: 50%;
  background: var(--viewfinder-ink);
  box-shadow: var(--shadow-sm);
}

.held .dot {
  background: var(--accent);
}

.loupe {
  position: absolute;
  width: calc(var(--touch-target) * 2);
  height: calc(var(--touch-target) * 2);
  border: var(--space-1) solid var(--viewfinder-ink);
  border-radius: 50%;
  box-shadow: var(--shadow-md);
  transform: translate(-50%, calc(-100% - var(--touch-target)));
  pointer-events: none;

  &.low {
    transform: translate(-50%, var(--touch-target));
  }
}

.hint {
  margin: var(--space-3) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.narrow {
  margin: var(--space-3) 0 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  color: var(--warn-ink);
  background: var(--warn-tint);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}
</style>
