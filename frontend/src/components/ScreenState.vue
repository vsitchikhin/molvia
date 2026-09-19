<template>
  <section ref="root" class="state" :class="[toneClass, { inline }]">
    <span class="circle" aria-hidden="true">
      <component :is="glyph" class="glyph" />
    </span>
    <!-- An alert holds the words only: a card read out with its buttons would say «Try again»
         as if it were the news. Anything polite goes to the app's live region instead. -->
    <div class="message" :role="role">
      <h2 class="title">{{ title }}</h2>
      <p v-if="body" class="body">{{ body }}</p>
    </div>
    <div v-if="$slots.default" class="extra">
      <slot />
    </div>
    <div v-if="kind === 'error' || $slots.action" class="action">
      <AppButton v-if="kind === 'error'" block @click="$emit('retry')">
        <template #icon><IconRefresh /></template>
        {{ t('state.retry') }}
      </AppButton>
      <slot name="action" />
    </div>
  </section>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Component,
  type PropType,
} from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconRefresh from '~icons/mdi/refresh'
import AppButton from '@/components/AppButton.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { focusScreenTitle } from '@/transitions'

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

// Own keys only: `in` walks the prototype, and «toString» would pass for a kind.
function isKind(value: unknown): value is StateKind {
  return typeof value === 'string' && Object.hasOwn(TONES, value)
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
 * An error always offers «Try again», drawn here and reported as `retry`: twelve copies of one
 * word would drift apart. Every other action is the screen's own and comes through `action`,
 * after the retry where there is one — the search's «Take from recent».
 *
 * Texts arrive translated, never as a key prefix: a key assembled from a string is invisible
 * to the linter and to vue-tsc alike (MOL-16, О-12).
 *
 * Laid out to take the free height of the screen with the action at the bottom, under the
 * thumb; `inline` keeps it to its own height, for a notice above the content — the surface
 * around it is the card's, not this block's.
 */
export default defineComponent({
  name: 'ScreenState',
  components: { AppButton, IconRefresh },
  props: {
    kind: { type: String as PropType<StateKind>, required: true, validator: fits },
    tone: { type: String as PropType<StateTone | undefined>, default: undefined },
    icon: { type: [Object, Function] as PropType<Component>, default: undefined },
    title: { type: String, required: true },
    body: { type: String, default: undefined },
    inline: { type: Boolean, default: false },
  },
  emits: ['retry'],
  setup(props) {
    const { t } = useI18n()
    const root = ref<HTMLElement | null>(null)
    const announce = useAnnouncer()

    const glyph = computed<Component | undefined>(() => {
      if (props.kind === 'offline') return IconCloudOff
      if (props.kind === 'empty') return props.icon
      return IconAlert
    })

    // A tone the kind does not take is drawn as the kind's own, never as given: the validator
    // only warns, and a warning in the console must not turn offline red on the screen.
    const toneClass = computed(() => {
      if (props.kind === 'error') return 'bad'
      if (!isKind(props.kind) || props.kind === 'attention') return 'warn'
      const allowed = TONES[props.kind]
      return props.tone !== undefined && allowed.includes(props.tone)
        ? props.tone
        : FALLBACK[props.kind]
    })

    // An error on the screen interrupts: the person was waiting for an answer that did not
    // come. Everything else is polite — and so is anything inline: a notice is drawn again over
    // every screen the person moves to, and an alert would cut off the heading each move has
    // just focused (MOL-19, A3, Р-9). Polite words go to the app's live region when there is
    // one; outside the app the block carries `status` itself.
    const alerts = computed(
      () => !props.inline && (props.kind === 'error' || props.kind === 'attention'),
    )
    const role = computed(() => {
      if (alerts.value) return 'alert'
      return announce ? undefined : 'status'
    })

    // Words taken back when they are replaced or the block goes: the region must not keep
    // saying what is no longer on the screen.
    let withdraw: (() => void) | undefined
    function speak(): void {
      withdraw?.()
      withdraw = undefined
      if (alerts.value || !announce) return
      withdraw = announce([props.title, props.body].filter(Boolean).join('. '))
    }
    onMounted(speak)
    watch(() => [props.title, props.body], speak)

    onBeforeUnmount(() => {
      withdraw?.()
      if (root.value?.contains(document.activeElement)) focusScreenTitle()
    })

    return { t, root, glyph, toneClass, role }
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
  flex: none;
}

.circle {
  display: grid;
  place-items: center;
  width: var(--state-circle);
  height: var(--state-circle);
  margin-bottom: var(--space-3);
  border-radius: 50%;
}

.glyph {
  width: var(--state-glyph);
  height: var(--state-glyph);
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
  overflow-wrap: anywhere;
}

.body {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  line-height: var(--leading-body);
  overflow-wrap: anywhere;
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
