<template>
  <section class="state" :class="[toneClass, { inline }]" :role="role">
    <span class="circle" aria-hidden="true">
      <component :is="glyph" class="glyph" />
    </span>
    <h2 class="title">{{ title }}</h2>
    <p v-if="body" class="body">{{ body }}</p>
    <div v-if="$slots.default" class="extra">
      <slot />
    </div>
    <div v-if="$slots.action" class="action">
      <slot name="action" />
    </div>
  </section>
</template>

<script lang="ts">
import { computed, defineComponent, type Component, type PropType } from 'vue'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'

export type StateKind = 'empty' | 'error' | 'offline' | 'attention'

/**
 * The tones a screen may choose. `bad` is not one of them: it belongs to `error` alone and is
 * never asked for, so `tone="bad"` does not type-check anywhere — offline cannot be drawn red.
 */
export type StateTone = 'accent' | 'good' | 'warn'

// Which tones each kind may take. Error and attention take none: theirs is fixed.
const TONES: Record<StateKind, readonly StateTone[]> = {
  empty: ['accent', 'good'],
  offline: ['good', 'warn'],
  error: [],
  attention: [],
}

// What a kind that has a choice is drawn in when it was given none it takes. Offline falls
// to yellow, «the data may be old», which is true of every offline screen; green is a promise.
const FALLBACK = { empty: 'accent', offline: 'warn' } as const

function isKind(value: unknown): value is StateKind {
  return typeof value === 'string' && value in TONES
}

/**
 * What the types cannot say, since a prop's type does not depend on another prop's value:
 * an empty state brings its own icon, the others are drawn with theirs; a tone is given
 * exactly when the kind has a choice, and it is one of that kind's.
 */
function fits(kind: unknown, props: Record<string, unknown>): boolean {
  if (!isKind(kind)) return false
  const allowed = TONES[kind]
  const tone = props.tone as StateTone | undefined
  const toneFits =
    allowed.length === 0 ? tone === undefined : tone !== undefined && allowed.includes(tone)
  const iconFits = kind === 'empty' ? props.icon !== undefined : props.icon === undefined
  return toneFits && iconFits
}

/**
 * Every state of every screen that is not loading: empty, error, offline — and «attention»,
 * the device-identity notice that fits none of them. Twelve cards of the mockup are twelve
 * sets of props, not twelve components.
 *
 * The tone of the circle carries the meaning: accent is «start here», good is «all fine»,
 * warn is «the data is old» or «you need to know this», bad is an error and nothing else.
 * Offline is never red — the connection drops at the shelf all the time, and an app that
 * panics every time teaches people to ignore it.
 *
 * Texts arrive translated, never as a key prefix: a key assembled from a string is invisible
 * to the linter and to vue-tsc alike (MOL-16, О-12).
 *
 * Laid out to take the free height of the screen with the action at the bottom, under the
 * thumb; `inline` keeps it to its own height, for a notice above the content.
 */
export default defineComponent({
  name: 'ScreenState',
  props: {
    kind: { type: String as PropType<StateKind>, required: true, validator: fits },
    tone: { type: String as PropType<StateTone>, default: undefined },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
    title: { type: String, required: true },
    body: { type: String, default: undefined },
    inline: { type: Boolean, default: false },
  },
  setup(props) {
    const glyph = computed<Component | undefined>(() => {
      if (props.kind === 'offline') return IconCloudOff
      if (props.kind === 'empty') return props.icon
      return IconAlert
    })

    // A tone the kind does not take is drawn as the kind's own, never as given: the validator
    // only warns, and a warning in the console must not turn offline red on the screen.
    const toneClass = computed(() => {
      if (props.kind === 'error') return 'bad'
      if (props.kind === 'attention') return 'warn'
      const allowed = TONES[props.kind]
      return props.tone !== undefined && allowed.includes(props.tone)
        ? props.tone
        : FALLBACK[props.kind]
    })

    // Something went wrong or has to be known now; empty and offline interrupt nothing.
    const role = computed(() =>
      props.kind === 'error' || props.kind === 'attention' ? 'alert' : 'status',
    )

    return { glyph, toneClass, role }
  },
})
</script>

<style scoped lang="scss">
.state {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.inline {
  @include surface;

  flex: none;
  padding: var(--space-4);
}

.circle {
  display: grid;
  place-items: center;

  /* 38 with a 22 icon — the handoff's state circle */
  width: 2.375rem;
  height: 2.375rem;
  margin-bottom: var(--space-3);
  border-radius: 50%;
}

.glyph {
  width: 1.375rem;
  height: 1.375rem;
}

.accent .circle {
  background: var(--accent-tint);
  color: var(--accent-ink);
}

.good .circle {
  background: var(--good-tint);
  color: var(--good-ink);
}

.warn .circle {
  background: var(--warn-tint);
  color: var(--warn-ink);
}

.bad .circle {
  background: var(--bad-tint);
  color: var(--bad-ink);
}

.title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
}

.body {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  line-height: var(--leading-body);
}

.extra {
  margin-top: var(--space-2);
}

/* Pushed to the bottom of the free height: the thumb is there, not at the title. */
.action {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: var(--space-4);
}

.inline .action {
  margin-top: 0;
}
</style>
