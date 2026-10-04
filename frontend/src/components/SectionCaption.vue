<template>
  <component :is="as" ref="root" class="section-caption" :class="{ inset }">
    <span v-if="$slots.mark" class="mark"><slot name="mark" /></span>
    <span class="words"><slot /></span>
    <span v-if="$slots.tail" class="tail"><slot name="tail" /></span>
  </component>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import type { PropType } from 'vue'

const TAGS = ['h2', 'h3', 'p', 'span'] as const
export type CaptionTag = (typeof TAGS)[number]

/**
 * The caps caption of the kit (Ф-12, MOL-175): 11/700, `text-muted`, and the one place caps are drawn
 * outside the verdict badge — the linter refuses `text-transform: uppercase` anywhere else.
 *
 *   as    — the tag: the screen knows whether this is a heading of its outline (`h2`, `h3` in a sheet)
 *           or only a label (`p`, `span` inside a card's head row);
 *   inset — inside a card, the title of the card itself: no 4 at the sides and no 8 below, the card's
 *           own padding and gap place it (В-1 «б»). Without it, a group's caption: 4 from the left and
 *           8 above its card, carried here, so the screens stop drawing 8, 12 and 16;
 *   #mark — before the words: the verdict's dot of 24 over a group of «Что брать»;
 *   #tail — after them, on the right, in words and figures, not caps: the month's sum of «Доходы».
 *
 * Both slots stand inside the tag, so a heading is named by all of it — «Сентябрь 120 000 ₽». The
 * space above the caption, 24 between groups, is the screen's. `focus()` is for the screen that sends
 * the focus to a caption once the row that held it is gone («Устройства»).
 */
export default defineComponent({
  name: 'SectionCaption',
  props: {
    as: {
      type: String as PropType<CaptionTag>,
      default: 'h2',
      validator: (tag: string) => (TAGS as readonly string[]).includes(tag),
    },
    inset: { type: Boolean, default: false },
  },
  expose: ['focus'],
  setup() {
    const root = ref<HTMLElement | null>(null)
    return {
      root,
      focus: () => {
        root.value?.focus()
      },
    }
  },
})
</script>

<style scoped lang="scss">
.section-caption {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;

  &:focus-visible {
    @include focus-ring;
  }
}

.inset {
  margin: 0;
  padding: 0;
}

span.section-caption {
  display: inline-flex;
}

.mark {
  display: inline-flex;
  flex: none;
}

.words {
  min-width: 0;
}

.tail {
  margin-left: auto;
  color: var(--text);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  letter-spacing: normal;
  text-transform: none;
}
</style>
