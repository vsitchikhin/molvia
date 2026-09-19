<template>
  <dialog
    ref="dialog"
    class="sheet"
    :aria-labelledby="titleId"
    @cancel.prevent="close()"
    @close="closedNatively"
    @click="closeOnScrim"
  >
    <div class="panel">
      <header class="head">
        <div class="heading">
          <h2 :id="titleId" class="title"><slot name="title" /></h2>
          <p v-if="$slots.meta" class="meta"><slot name="meta" /></p>
        </div>
        <AppButton variant="icon" :label="t('sheet.close')" @click="close()">
          <IconClose />
        </AppButton>
      </header>

      <slot />

      <div v-if="$slots.footer" class="footer">
        <slot name="footer" />
      </div>
    </div>
  </dialog>
</template>

<script lang="ts">
import { defineComponent, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/mdi/close'
import AppButton from '@/components/AppButton.vue'
import { useKeyboardInset } from '@/composables/useKeyboardInset'
import { useSheetHistory } from '@/composables/useSheetHistory'

/**
 * The sheet of 0.1: it rises from the bottom over the screen, which stays visible behind the
 * scrim. A native modal `<dialog>` — the focus trap, the inert page, the backdrop and Esc come
 * from the platform, and focus goes back to whatever opened it when it closes.
 *
 * No grab handle on top: there is no drag gesture, and an element must not promise one.
 *
 * Five ways to close it, one way it closes. The ×, a tap on the scrim, Esc, Android's «back»
 * (which Chrome delivers to a modal dialog as `cancel`) and the browser's «back» or the iOS edge
 * swipe (a pop) — the first four step back off the sheet's entry in the history, and the pop that
 * follows is what closes it (`useSheetHistory`). A screen that must close the sheet and itself
 * at once — «Add to trip» over the search — calls `close(2)`.
 *
 * The page under an open sheet does not scroll (main.scss). The sheet is the one place where a
 * container scrolls rather than the page: a panel over the screen has no window of its own.
 */
export default defineComponent({
  name: 'BottomSheet',
  components: { AppButton, IconClose },
  props: {
    open: { type: Boolean, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    closed: () => true,
  },
  setup(props, { emit, expose }) {
    const { t } = useI18n()
    const dialog = ref<HTMLDialogElement | null>(null)
    const titleId = useId()

    // Whether the sheet is open as far as the screen is concerned. Not `dialog.open`: the browser
    // may close the dialog on its own (a second Esc), and the sheet is still to be put away —
    // its entry taken, the screen told — exactly once.
    const shown = ref(false)

    const history = useSheetHistory(() => {
      if (!shown.value) return
      shown.value = false
      if (dialog.value?.open) dialog.value.close()
      if (props.open) emit('update:open', false)
      // A tick later: a screen that opens the next sheet from `@closed` would otherwise set `open`
      // back to true in the same tick it went false, the prop would never change, and the sheet
      // would stay shut with the screen believing it open (MOL-18, adversarial А-6).
      void nextTick(() => {
        emit('closed')
      })
    })

    function show(): void {
      const element = dialog.value
      if (!element || shown.value) return
      shown.value = true
      element.showModal()
      history.lay()
    }

    /** Closes the sheet — and `steps - 1` screens under it — by stepping back through history. */
    function close(steps = 1): void {
      history.leave(steps)
    }

    // A tap on the scrim lands on the dialog itself: the panel fills the dialog's box, so any
    // tap inside the sheet lands on the panel or something in it.
    function closeOnScrim(event: MouseEvent): void {
      if (event.target === dialog.value) close()
    }

    // Chrome lets a page refuse Esc only once per user activation; a second Esc closes the dialog
    // regardless. The entry must still go, or «back» would land on a sheet that is gone.
    //
    // Not when it is open again: the `close` event of the last sheet arrives a task later, and a
    // sheet reopened in between would be taken for the one the browser shut (adversarial А-5).
    function closedNatively(): void {
      if (dialog.value?.open) return
      if (history.laid()) close()
    }

    useKeyboardInset(dialog, shown)

    watch(
      () => props.open,
      (open) => {
        if (open) show()
        else if (shown.value) close()
      },
    )
    onMounted(() => {
      if (props.open) show()
    })

    expose({ close })
    return { t, dialog, titleId, close, closeOnScrim, closedNatively }
  },
})
</script>

<style scoped lang="scss">
.sheet {
  /* The dialog is the sheet's box and nothing else, pinned to the bottom edge. */
  width: 100%;
  max-width: 100%;
  max-height: calc(var(--sheet-max-height) - var(--keyboard-inset));

  /* Lifted over the on-screen keyboard where the browser leaves it covering the page (iOS). */
  margin: auto 0 var(--keyboard-inset);
  padding: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border: none;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--text);

  /* Out from under the bottom edge and back — the exit too, where the browser can animate
     `display` and the top layer. Where it cannot, the sheet just disappears. */
  transform: translateY(100%);
  transition:
    transform var(--dur) var(--ease),
    overlay var(--dur) allow-discrete,
    display var(--dur) allow-discrete;

  &[open] {
    transform: none;

    @starting-style {
      transform: translateY(100%);
    }
  }

  &::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition:
      opacity var(--dur) var(--ease),
      overlay var(--dur) allow-discrete,
      display var(--dur) allow-discrete;
  }

  &[open]::backdrop {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }
}

.panel {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-8) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);

  > :last-child {
    flex: none;
    margin-left: auto;
  }
}

.heading {
  min-width: 0;
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-snug);
}

.meta {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

@media (prefers-reduced-motion: reduce) {
  .sheet,
  .sheet::backdrop {
    transition: none;
  }
}
</style>
