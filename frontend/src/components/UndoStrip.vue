<template>
  <div
    class="undo"
    @focusin="enter"
    @focusout="release"
    @pointerenter="hold(true)"
    @pointerleave="hold(false)"
    @pointerdown="hold(true)"
  >
    <span class="count" aria-hidden="true">{{ left }}</span>
    <span class="text">{{ text }}</span>
    <AppButton ref="button" variant="secondary" class="restore" @click="restore">
      <template #icon><IconUndo /></template>
      {{ action }}
    </AppButton>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import IconUndo from '~icons/mdi/undo-variant'
import AppButton from '@/components/AppButton.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'

/**
 * «Удалено · Вернуть» (MOL-82, handoff 02): what was removed without a question, and ten seconds
 * to take it back. The count stands still while a finger rests on the strip or the focus is in
 * it — a person reaching for the button must not lose it on the way. Shared: «Обмен денег» and
 * «Доходы» are the next to take it.
 *
 * The words are said once as the strip comes; the focus goes to «Вернуть», since the row it was
 * opened from is gone. What happens after — back or final — is the screen's to say.
 */
export default defineComponent({
  name: 'UndoStrip',
  components: { AppButton, IconUndo },
  props: {
    /** «Удалено: барбер · 5 000 ֏» — what the strip shows. */
    text: { type: String, required: true },
    /** What is said as it comes: the text and how long there is to take it back. */
    announcement: { type: String, required: true },
    action: { type: String, required: true },
    seconds: { type: Number, default: 10 },
    /**
     * Shown again — on the next screen, the same removal: the words were said and the focus given
     * the first time, and taking them again moved the person's focus for a thing already known.
     */
    quiet: { type: Boolean, default: false },
  },
  /** `tick`: what is left, every second, held or not — a screen taking the strip over goes on from it. */
  emits: ['restore', 'expire', 'tick'],
  setup(props, { emit }) {
    const left = ref(props.seconds)
    const button = ref<ComponentPublicInstance | null>(null)
    let held = false
    let focused = false
    let timer: ReturnType<typeof setInterval> | undefined
    let unsay: (() => void) | undefined
    const announce = useAnnouncer()

    function tick(): void {
      if (!held && !focused) left.value -= 1
      emit('tick', left.value)
      if (left.value <= 0) {
        clearInterval(timer)
        emit('expire')
      }
    }

    function hold(value: boolean): void {
      held = value
    }

    /**
     * The focus the strip puts on «Вернуть» itself does not stop the count: it would stand still
     * until the person tapped somewhere else, with «Трата» hidden under it all that time. Only a
     * focus the person brought here does.
     */
    let placing = false
    function enter(): void {
      if (!placing) focused = true
    }

    function release(event: FocusEvent): void {
      const next = event.relatedTarget
      focused = next instanceof Node && (event.currentTarget as Element).contains(next)
    }

    function restore(): void {
      clearInterval(timer)
      emit('restore')
    }

    onMounted(async () => {
      timer = setInterval(tick, 1000)
      if (props.quiet) return
      unsay = announce?.(props.announcement)
      await nextTick()
      const element = button.value?.$el as HTMLElement | undefined
      placing = true
      element?.focus()
      placing = false
    })
    onBeforeUnmount(() => {
      clearInterval(timer)
      unsay?.()
    })

    return { left, button, hold, enter, release, restore }
  },
})
</script>

<style scoped lang="scss">
.undo {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 3.5rem;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-md);
}

.count {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 2px var(--border-strong);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-callout);
  overflow-wrap: anywhere;
}

.restore {
  flex: none;
}
</style>
