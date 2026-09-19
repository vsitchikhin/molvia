<template>
  <span
    class="badge"
    :class="[shape.form, { dot: compact, large: compact && large }]"
    :role="compact ? 'img' : undefined"
    :aria-label="compact ? t(shape.name) : undefined"
  >
    <component :is="shape.icon" class="icon" aria-hidden="true" />
    <span v-if="!compact" class="word">{{ t(shape.word) }}</span>
  </span>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VerdictLevel } from '@molvia/model'
import IconCheckBold from '~icons/mdi/check-bold'
import IconCloseThick from '~icons/mdi/close-thick'
import IconTilde from '~icons/mdi/tilde'

/**
 * How each level is told apart without colour: a fill, an outline, an outline with the word
 * struck through — and a different icon each. Colour only repeats what the shape already says,
 * so a greyscale screenshot, a colour-blind eye and a dim shop all read the same three.
 *
 * No level uses the accent. Terracotta means «you can tap this», and in a list of results it
 * would read as a promoted item — there are no paid places, ever.
 */
const SHAPES = {
  take: {
    form: 'filled',
    icon: markRaw(IconCheckBold),
    word: 'advice.badge_take',
    name: 'advice.group_take',
  },
  if_cheap: {
    form: 'outlined',
    icon: markRaw(IconTilde),
    word: 'advice.badge_if_cheap',
    name: 'advice.group_if_cheap',
  },
  never: {
    form: 'outlined struck',
    icon: markRaw(IconCloseThick),
    word: 'advice.badge_never',
    name: 'advice.group_never',
  },
} satisfies Record<VerdictLevel, { form: string; icon: object; word: string; name: string }>

/**
 * The verdict at a glance: a pill with its word, or — `compact` — a circle with the icon alone.
 * The circle has no visible word, so it is an image named by the full phrase («Only if cheap»),
 * not by the capitalised short one the pill prints. Not a control: nothing here is tappable.
 */
export default defineComponent({
  name: 'VerdictBadge',
  props: {
    level: { type: String as PropType<VerdictLevel>, required: true },
    compact: { type: Boolean, default: false },
    /** The circle beside a group's title in «What to buy»: 24 rather than the row's 22. */
    large: { type: Boolean, default: false },
  },
  setup(props) {
    const { t } = useI18n()
    return { t, shape: computed(() => SHAPES[props.level]) }
  },
})
</script>

<style scoped lang="scss">
.badge {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--badge-gap);
  height: var(--badge-height);
  padding: 0 var(--space-3) 0 var(--space-2);
  border-radius: var(--radius-pill);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  line-height: 1;
  letter-spacing: var(--tracking-caps);
  white-space: nowrap;
}

.icon {
  /* 14 — the handoff's icon inside a badge */
  width: 0.875rem;
  height: 0.875rem;
}

.filled {
  background: var(--good);
  color: var(--on-accent);
}

/* 1.5px, not the hairline: at badge size a 1px outline disappears in bad light. */
.outlined {
  border: 1.5px solid;
}

.outlined:not(.struck) {
  border-color: var(--warn);
  color: var(--warn-ink);
}

.struck {
  border-color: var(--bad);
  color: var(--bad-ink);

  .word {
    text-decoration: line-through;
  }
}

.dot {
  justify-content: center;
  width: var(--badge-dot);
  height: var(--badge-dot);
  padding: 0;
}

.large {
  width: var(--badge-dot-lg);
  height: var(--badge-dot-lg);
}
</style>
