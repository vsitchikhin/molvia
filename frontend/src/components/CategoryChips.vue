<template>
  <fieldset ref="field" class="chips-field" :aria-describedby="error ? errorId : undefined">
    <legend class="legend">{{ legend }}</legend>
    <div class="chips" :class="{ bad: !!error, laid: rows !== null }">
      <div v-for="(row, index) in shownRows" :key="index" class="row">
        <label
          v-for="category in row"
          :key="category.id"
          class="chip"
          :class="{ on: category.id === modelValue }"
        >
          <input
            class="radio"
            type="radio"
            :name="name"
            :value="category.id"
            :checked="category.id === modelValue"
            :aria-invalid="error ? 'true' : undefined"
            @change="$emit('update:modelValue', category.id)"
          />
          <span class="dot" :style="{ background: colourOf(category) }" aria-hidden="true"></span>
          <span class="name">{{ nameOf(category) }}</span>
        </label>
        <button
          v-if="index === shownRows.length - 1"
          type="button"
          class="chip more"
          aria-haspopup="dialog"
          @click="$emit('more')"
        >
          {{ moreLabel }}
        </button>
      </div>
    </div>
    <!-- The chips as they would stand, each at its own width, unseen: the browser alone knows how many
         fit two rows — a name, a font, a phone of 320 (MOL-198). -->
    <div class="ruler-box" aria-hidden="true" inert>
      <div ref="ruler" class="ruler">
        <span v-for="category in categories" :key="category.id" class="chip">
          <span class="dot"></span><span class="name">{{ nameOf(category) }}</span>
        </span>
        <span class="chip more">{{ moreLabel }}</span>
      </div>
    </div>
    <AppReveal>
      <p v-if="error" :id="errorId" class="error">
        <IconAlert class="alert" aria-hidden="true" />{{ error }}
      </p>
    </AppReveal>
  </fieldset>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from 'vue'
import type { PropType } from 'vue'
import IconAlert from '~icons/mdi/alert-circle-outline'
import type { SpendingCategoryView } from '@molvia/model'
import AppReveal from '@/components/AppReveal.vue'
import { categoryColour, chipsInTwoRows } from '@/components/spending'
import type { ChipRows } from '@/components/spending'

/**
 * The categories of a spending as chips in two rows, «Ещё…» last in the second (MOL-82, MOL-198,
 * Ф-17): 21 chips in six rows pushed the sheet's form off the screen. Radios in a fieldset, so arrows
 * move the choice among the chips shown and the group is read by its legend; the rest are in the list
 * «Ещё…» opens. Nothing is chosen until the person chooses — guessing a category is not allowed.
 *
 * The order is the sheet's (`chipOrder`), by frequency, taken when it opens: a tap here moves no chip.
 * How many stand is the browser's measure of the chips at their widths, again when the field's width
 * changes or a face comes; until there is one — a sheet still shut, a test with no layout — they all
 * stand, as before. **The chosen one never leaves the rows** (adversarial А1): a measure that would lay
 * it past them — the phone turned, a name grown longer by an answer — stands it first, as the sheet
 * does at its opening (owner's В-2 «а»); a chip chosen by a tap is in the rows already and moves none. Chosen is «here», the accent, not the category's colour — a fill and a ring, never
 * a weight: every chip is at 600, so the row does not reflow on a tap (Ф-5, MOL-174); its dot stands on
 * a ring of `surface`, where on the tint ten light categories fell under 3:1 (MOL-172 А2).
 */
export default defineComponent({
  name: 'CategoryChips',
  components: { AppReveal, IconAlert },
  props: {
    modelValue: { type: String as PropType<string | null>, default: null },
    /** In the order they stand. */
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    legend: { type: String, required: true },
    moreLabel: { type: String, required: true },
    error: { type: String as PropType<string | null>, default: null },
  },
  emits: ['update:modelValue', 'more'],
  setup(props) {
    const field = ref<HTMLElement | null>(null)
    const ruler = ref<HTMLElement | null>(null)
    // The order the rows stand in — the sheet's, or with the chosen one lifted first — and how many.
    const laid = ref<{ order: string[]; rows: ChipRows } | null>(null)
    const rows = computed(() => laid.value?.rows ?? null)
    const shownIds = computed(() => {
      const now = laid.value
      return now ? now.order.slice(0, now.rows.first + now.rows.second) : null
    })

    function measure(): void {
      const box = field.value
      const chips = ruler.value
      if (!box || !chips) return
      const width = box.getBoundingClientRect().width
      // A shut sheet lays nothing out: the last measure stands until it opens.
      if (width <= 0) return
      const sizes = [...chips.children].map((chip) => chip.getBoundingClientRect().width)
      const more = sizes.pop() ?? 0
      const gap = parseFloat(getComputedStyle(chips).columnGap) || 0
      const widthOf = new Map(props.categories.map((category, at) => [category.id, sizes[at] ?? 0]))
      const layOut = (order: string[]) =>
        chipsInTwoRows(
          order.map((id) => widthOf.get(id) ?? 0),
          width,
          more,
          gap,
        )
      let order = props.categories.map((category) => category.id)
      let laidOut = layOut(order)
      const chosen = props.modelValue
      if (chosen !== null && order.indexOf(chosen) >= laidOut.first + laidOut.second) {
        order = [chosen, ...order.filter((id) => id !== chosen)]
        laidOut = layOut(order)
      }
      laid.value = { order, rows: laidOut }
    }

    let observer: ResizeObserver | null = null
    // A chip measured in a fallback face is narrower or wider than the one drawn a moment later — and a
    // face may come after the sheet has opened, which changes no width of the field.
    const faceCame = (): void => {
      measure()
    }
    onMounted(() => {
      if (typeof ResizeObserver !== 'undefined' && field.value) {
        observer = new ResizeObserver(() => {
          measure()
        })
        observer.observe(field.value)
      }
      if ('fonts' in document) document.fonts.addEventListener('loadingdone', faceCame)
      measure()
    })
    onBeforeUnmount(() => {
      observer?.disconnect()
      if ('fonts' in document) document.fonts.removeEventListener('loadingdone', faceCame)
    })
    watch(
      () => props.categories.map((category) => props.nameOf(category)).join('\n'),
      async () => {
        await nextTick()
        measure()
      },
    )
    // Chosen from outside the rows — the list, one just made — is laid in; one in the rows moves none.
    watch(
      () => props.modelValue,
      (chosen) => {
        if (chosen !== null && shownIds.value !== null && !shownIds.value.includes(chosen))
          measure()
      },
    )

    const shownRows = computed(() => {
      const now = laid.value
      if (!now) return [props.categories]
      const byId = new Map(props.categories.map((category) => [category.id, category]))
      const ordered = now.order.flatMap((id) => byId.get(id) ?? [])
      return [
        ordered.slice(0, now.rows.first),
        ordered.slice(now.rows.first, now.rows.first + now.rows.second),
      ]
    })

    return {
      field,
      ruler,
      rows,
      shownRows,
      name: useId(),
      errorId: useId(),
      colourOf: categoryColour,
    }
  },
})
</script>

<style scoped lang="scss">
.chips-field {
  position: relative;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.legend {
  margin-bottom: var(--space-2);
  padding: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.chips {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* Before a measure the one row wraps, as every chip stood before; measured, a row is exactly what fits,
   and a fraction of a pixel the browser rounds the other way never sends «Ещё…» to a third. */
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;

  .laid & {
    flex-wrap: nowrap;
  }
}

.chip {
  position: relative;
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: var(--space-2);
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  min-height: var(--touch-target);
  padding: 0 var(--space-4) 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);
  color: var(--text);
  font: inherit;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);

  &.on {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  &:has(.radio:focus-visible),
  &.more:focus-visible {
    @include focus-ring;
  }
}

.bad .chip:not(.more, .on) {
  box-shadow: inset 0 0 0 var(--hairline) var(--bad);
}

.radio {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.dot {
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);

  /* On the tint ten light categories and three dark fell under 3:1; on `surface` each holds it. */
  .on & {
    box-shadow: 0 0 0 2px var(--surface);
  }
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.more {
  flex: none;
  padding: 0 var(--space-4);
}

/* A box of no size around the ruler: unseen, it lays the chips out at their own widths and adds nothing
   to scroll. */
.ruler-box {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}

.ruler {
  display: flex;
  gap: var(--space-2);
  width: max-content;
}

.error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.alert {
  @include icon;

  font-size: var(--icon-sm);
}

@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: none;
  }
}
</style>
