<template>
  <component
    :is="card ? AppCard : 'section'"
    :ref="setRoot"
    :as="card ? 'section' : undefined"
    class="state"
    :class="[toneClass, { inline, card }]"
  >
    <span v-if="glyph" class="circle" aria-hidden="true">
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
    <!-- A screen-wide error draws its buttons in the screen's strip, where every screen has its
         main action (К-1, Ф-15); anywhere else — the login, a sheet — at the bottom of its own. -->
    <Teleport
      v-if="kind === 'error' || $slots.action"
      :to="dockTarget"
      :disabled="!dockTarget"
      defer
    >
      <div ref="actions" class="action" :class="{ docked: dockTarget }">
        <!-- A version waits: the error may well be the old code reading the new server's answer,
             and the reload loses nothing (MOL-132, В-2). -->
        <AppButton
          v-if="kind === 'error' && updating && !card"
          block
          :size="dockTarget ? 'large' : 'regular'"
          :busy="applying"
          :busy-label="t('update.applying')"
          @click="update.apply()"
        >
          <template #icon><IconUpdate /></template>
          {{ t('update.apply') }}
        </AppButton>
        <AppButton
          v-if="kind === 'error'"
          :block="!card"
          :size="dockTarget && !updating ? 'large' : 'regular'"
          :variant="card ? 'ghost' : updating ? 'secondary' : 'primary'"
          ref="retryButton"
          :class="{ word: card }"
          @click="$emit('retry')"
        >
          <template #icon><IconRefresh /></template>
          {{ t('state.retry') }}
        </AppButton>
        <slot name="action" />
        <AppButton v-if="reportable" variant="ghost" block aria-haspopup="dialog" @click="report">
          <template #icon><IconReport /></template>
          {{ t('state.report') }}
        </AppButton>
      </div>
    </Teleport>
  </component>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  watchEffect,
  type Component,
  type ComponentPublicInstance,
  type PropType,
} from 'vue'
import { getActivePinia } from 'pinia'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconAttention from '~icons/mdi/alert-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconReport from '~icons/mdi/message-alert-outline'
import IconRefresh from '~icons/mdi/refresh'
import IconUpdate from '~icons/mdi/update'
import { lastRefusal } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useStateStrip } from '@/composables/useStateStrip'
import { useUpdateAnnouncement } from '@/composables/useUpdateAnnouncement'
import { usePwaUpdate } from '@/pwaUpdate'
import { useActorStore } from '@/stores/actor'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'
import { focusScreenTitle } from '@/transitions'

export type StateKind = 'empty' | 'error' | 'offline' | 'attention'

/**
 * The tones a screen may choose — for offline alone. `bad` is not one of them: it belongs to
 * `error` alone and is never asked for, so `tone="bad"` does not type-check anywhere — offline
 * cannot be drawn red.
 */
export type StateTone = 'good' | 'warn'

// Which tones each kind may take. Only offline has a choice; empty is one quiet form whatever it
// says (Ф-16, К-8), and error and attention are fixed.
const TONES: Record<StateKind, readonly StateTone[]> = {
  empty: [],
  offline: ['good', 'warn'],
  error: [],
  attention: [],
}

// What offline is drawn in when it was given no tone it takes: yellow, «the data may be old»,
// which is true of every offline screen; green is a promise.
const FALLBACK: StateTone = 'warn'

// Own keys only: `in` walks the prototype, and «toString» would pass for a kind.
function isKind(value: unknown): value is StateKind {
  return typeof value === 'string' && Object.hasOwn(TONES, value)
}

/**
 * What the types cannot say, since a prop's type does not depend on another prop's value:
 * an empty state brings its own icon and the others are drawn with theirs; a tone is given
 * exactly when the kind has a choice, and it is one of that kind's.
 *
 * Every empty state has its circle, on `--surface-2` (Ф-16): MOL-77 took the circle away from
 * three of them because a terracotta one over an action read as a button and was tapped; a
 * circle of the page's own quiet fill does not, and one form is what the eye learns.
 */
function fits(kind: unknown, props: Record<string, unknown>): boolean {
  if (!isKind(kind)) return false
  const allowed = TONES[kind]
  const tone = props.tone as StateTone | undefined
  const toneFits =
    allowed.length === 0 ? tone === undefined : tone !== undefined && allowed.includes(tone)
  const iconFits = (kind === 'empty') === (props.icon !== undefined)
  return toneFits && iconFits
}

/**
 * Every state of every screen that is not loading: empty, error, offline — and «attention»,
 * the device-identity notice that fits none of them. Twelve cards of the mockup are twelve
 * sets of props, not twelve components.
 *
 * Four kinds, told apart by form and confirmed by colour (41 v2, Ф-35): empty is a quiet circle
 * with the screen's own icon, error a red one with a ring, attention a yellow triangle, offline
 * the cloud. Offline is green or yellow and never red — the connection drops at the shelf all
 * the time, and an app that panics every time teaches people to ignore it.
 *
 * An error always offers «Try again», drawn here and reported as `retry`: twelve copies of one
 * word would drift apart. Every other action is the screen's own and comes through `action`,
 * after the retry where there is one — the search's «Take from recent». While a new version of the
 * app waits, the error offers it first, «Обновить», and the retry second (MOL-132).
 *
 * An error of the whole screen draws those buttons in the screen's strip (`useStateStrip`, К-1,
 * Ф-15): «Повторить» stood at the bottom of the free height — on each screen at its own — and over
 * a strip with a live action it was a second filled button. The strip is then the error's alone:
 * the screen's own action and «Вышла новая версия» step aside, so «Обновить» is offered once (8c).
 * The login and a sheet have no strip, and keep them at the bottom of the block.
 *
 * Last, quieter than both, «Сообщить о проблеме» (MOL-147, Р-5): the sheet «Написать разработчику»
 * on «Сломалось», with the code of the API's last refusal before the error was shown (В-1). Only where the screen as a
 * whole failed — not a section's `inline` error (сверка С-1) — only for somebody known, which
 * leaves out the login, and never inside a sheet, since a sheet over a sheet the history does not
 * hold. Drawn here, so no screen has to remember it.
 *
 * Texts arrive translated, never as a key prefix: a key assembled from a string is invisible
 * to the linter and to vue-tsc alike (MOL-16, О-12).
 *
 * Laid out to take the free height of the screen with an action of its own at the bottom, under
 * the thumb; `inline` keeps it to its own height, for a notice above the content — the surface
 * around it is the card's, not this block's. An `inline` error is that card itself, the quiet one
 * (К-13, 77 v2 2c): «Повторить» a ghost the width of its word, and no «Обновить», which the strip's
 * own row already offers while the screen works.
 */
export default defineComponent({
  name: 'ScreenState',
  components: { AppButton, IconRefresh, IconReport, IconUpdate },
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
    // The root is a card's component for a section's error, a plain element otherwise.
    function setRoot(el: Element | ComponentPublicInstance | null): void {
      const node = el instanceof Element ? el : (el?.$el as unknown)
      root.value = node instanceof HTMLElement ? node : null
    }
    const actions = ref<HTMLElement | null>(null)
    const retryButton = ref<ComponentPublicInstance | null>(null)
    const announce = useAnnouncer()

    // The strip is asked for while the block is an error of the whole screen, and let go as it
    // stops being one; the first to ask holds it, and the next takes it once that one lets go.
    const strip = useStateStrip()
    const me = Symbol('screen-state')
    watchEffect(() => {
      if (!strip) return
      if (props.kind === 'error' && !props.inline) strip.claim(me)
      else strip.release(me)
    })
    const dockTarget = computed(() => (strip?.owner.value === me ? strip.target.value : null))
    // A screen has one error of its own: a second one while the first holds the strip is drawn as a
    // section's, the quiet card — its own filled «Повторить» and «Обновить» were a second pair
    // (adversarial А4, 8c).
    const second = computed(
      () => strip?.owner.value != null && strip.owner.value !== me && !props.inline,
    )
    const card = computed(() => props.kind === 'error' && (props.inline || second.value))

    // Moved between the strip and the block — the error turned a section's or the screen's where it
    // stands — the buttons are other nodes or the same ones moved, and either way the focus fell to
    // the body (adversarial А2). It goes back to «Повторить», or to the first button of the block.
    watch(
      [dockTarget, card],
      () => {
        const focused = document.activeElement
        if (!(focused instanceof HTMLElement) || !actions.value?.contains(focused)) return
        const wasRetry = retryButton.value?.$el === focused
        void nextTick(() => {
          const retry = retryButton.value?.$el as unknown
          const next = wasRetry && retry instanceof HTMLElement ? retry : null
          ;(next ?? actions.value?.querySelector('button'))?.focus()
        })
      },
      { flush: 'pre' },
    )

    // The error offers «Обновить» in the row's place, and says the version out loud as the row did
    // (adversarial А3); a quiet card offers none — the row stands — and says nothing.
    useUpdateAnnouncement(() => props.kind === 'error' && !card.value)

    const glyph = computed<Component | undefined>(() => {
      if (props.kind === 'offline') return IconCloudOff
      if (props.kind === 'empty') return props.icon
      if (props.kind === 'attention') return IconAttention
      return IconAlert
    })

    // A tone the kind does not take is drawn as the kind's own, never as given: the validator
    // only warns, and a warning in the console must not turn offline red on the screen.
    const toneClass = computed(() => {
      if (props.kind === 'error') return 'bad'
      if (props.kind === 'empty') return 'quiet'
      if (props.kind !== 'offline') return 'warn'
      return props.tone !== undefined && TONES.offline.includes(props.tone) ? props.tone : FALLBACK
    })

    // An error on the screen interrupts: the person was waiting for an answer that did not
    // come. Everything else is polite — and so is anything inline: a notice is drawn again over
    // every screen the person moves to, and an alert would cut off the heading each move has
    // just focused (MOL-19, A3, Р-9). Polite words go to the app's live region when there is
    // one; outside the app the block carries `status` itself.
    const alerts = computed(
      () =>
        !props.inline && !second.value && (props.kind === 'error' || props.kind === 'attention'),
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
      strip?.release(me)
      // The buttons may stand in the strip, out of the block: a focus on them goes with them too.
      const focused = document.activeElement
      if (root.value?.contains(focused) || actions.value?.contains(focused)) focusScreenTitle()
    })

    const update = usePwaUpdate()
    const updating = computed(() => ['ready', 'applying'].includes(update.phase.value))
    const applying = computed(() => update.phase.value === 'applying')

    // A block drawn outside the app — a component on its own, the kit — has no stores to ask.
    const pinia = getActivePinia()
    const actor = pinia ? useActorStore(pinia) : null
    const feedback = pinia ? useFeedbackSheetStore(pinia) : null
    const inDialog = ref(false)
    onMounted(() => {
      inDialog.value = root.value?.closest('dialog') != null
    })
    // The code is the one the error was shown with, not whatever failed by the tap: a person reads
    // the screen a while before writing, and another call may fail meanwhile (review №1).
    let shownAt = Date.now()
    watch(
      () => props.kind,
      (kind) => {
        if (kind === 'error') shownAt = Date.now()
      },
    )
    function report(): void {
      feedback?.open({ from: 'error', code: lastRefusal(shownAt) })
    }
    const reportable = computed(
      () =>
        props.kind === 'error' &&
        !card.value &&
        actor?.state === 'ready' &&
        feedback !== null &&
        !inDialog.value,
    )

    return {
      t,
      AppCard,
      setRoot,
      card,
      actions,
      retryButton,
      dockTarget,
      glyph,
      toneClass,
      role,
      update,
      updating,
      applying,
      reportable,
      report,
    }
  },
})
</script>

<style scoped lang="scss">
.state {
  @include appear;

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
  @include icon;

  font-size: var(--state-glyph);
}

.quiet .circle {
  background: var(--surface-2);
  color: var(--text-muted);
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

/* The quiet card's «Повторить»: the width of its word, the word in line with the text above. */
.card .action {
  align-items: flex-start;
  padding-top: var(--space-2);
}

.word {
  margin-left: calc(var(--space-4) * -1);
}

/* In the strip, whose margins and column are the frame's (К-9). */
.action.docked {
  margin-top: 0;
  padding-top: 0;
}

.inline .action {
  margin-top: 0;
}
</style>
