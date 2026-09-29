<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('scanner.title') }}</template>

    <form v-if="typing" ref="form" class="typed" novalidate @submit.prevent="submitTyped">
      <AppField
        v-model="typed"
        kind="digits"
        :label="t('scanner.field')"
        :error="typedError"
        autocomplete="off"
        enterkeyhint="done"
        @update:model-value="typedError = null"
      />
    </form>

    <div v-else-if="viewing" class="viewfinder">
      <!-- The picture is for the eye alone: what it says, the hint below says in words. -->
      <video
        ref="video"
        class="video"
        playsinline
        muted
        autoplay
        disablepictureinpicture
        aria-hidden="true"
      ></video>
      <div class="overlay" aria-hidden="true">
        <div ref="frame" class="frame"></div>
      </div>
      <ScreenSkeleton v-if="kind !== 'live'" class="loading" :groups="[40]" />
      <p class="hint">{{ t('scanner.hint') }}</p>
      <AppButton
        v-if="torch !== null"
        class="torch"
        variant="icon"
        :label="t(torch ? 'scanner.torch_off' : 'scanner.torch_on')"
        :aria-pressed="torch"
        @click="setTorch(!torch)"
      >
        <IconTorchOff v-if="torch" />
        <IconTorch v-else />
      </AppButton>
    </div>

    <ScreenState
      v-else-if="refusal"
      :kind="refusal === 'error' || refusal === 'reader' ? 'error' : 'attention'"
      :title="t(REFUSALS[refusal].title)"
      :body="t(REFUSALS[refusal].body)"
      @retry="retry"
    >
      <template #action>
        <AppButton v-if="refusal === 'denied'" block @click="retry">
          {{ t('scanner.try_again') }}
        </AppButton>
        <AppButton
          block
          :variant="refusal === 'insecure' || refusal === 'none' ? 'primary' : 'secondary'"
          @click="toTyping"
        >
          <template #icon><IconKeyboard /></template>
          {{ t('scanner.manual') }}
        </AppButton>
      </template>
    </ScreenState>

    <template v-if="typing || viewing" #footer>
      <div v-if="typing" class="actions">
        <AppButton size="large" block @click="submitTyped">{{ t('scanner.done') }}</AppButton>
        <AppButton v-if="cameraMayWork" variant="secondary" block @click="toCamera">
          <template #icon><IconScan /></template>
          {{ t('scanner.scan') }}
        </AppButton>
      </div>
      <AppButton v-else variant="secondary" block @click="toTyping">
        <template #icon><IconKeyboard /></template>
        {{ t('scanner.manual') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { typedBarcode, type ErrorCode } from '@molvia/model'
import IconScan from '~icons/mdi/barcode-scan'
import IconTorch from '~icons/mdi/flashlight'
import IconTorchOff from '~icons/mdi/flashlight-off'
import IconKeyboard from '~icons/mdi/keyboard-outline'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { useCamera } from '@/composables/useCamera'
import { videoFrames } from '@/scanner/capture'

// The camera's refusals the sheet draws, each with its own way out (MOL-19). Keys written out
// whole: one assembled from a string is invisible to the linter and to vue-tsc (MOL-16, О-12).
const REFUSALS = {
  insecure: { title: 'scanner.insecure_title', body: 'scanner.insecure_body' },
  denied: { title: 'scanner.denied_title', body: 'scanner.denied_body' },
  none: { title: 'scanner.none_title', body: 'scanner.none_body' },
  error: { title: 'scanner.error_title', body: 'scanner.error_body' },
  // The reader, not the camera: its wasm would not load or its worker died. Words of its own — «another
  // app holds the camera» sent the person to close apps that were not at fault (review С-10).
  reader: { title: 'scanner.reader_title', body: 'scanner.reader_body' },
} as const
type Refusal = keyof typeof REFUSALS

/**
 * The barcode scanner (MOL-98): a live viewfinder in a sheet, and the digits typed by hand as the
 * way out of every state it can land in. Emits `read` with the code — as zxing reads it, or as
 * `typedBarcode` gives the typed digits, the same form either way — and closes. What the code is
 * for is the opener's: finding the item (MOL-99), binding it to one (MOL-100).
 *
 * The camera runs only while the sheet is open on the viewfinder, and the reader is warmed while
 * the camera starts, so the first frame that could be read is.
 */
export default defineComponent({
  name: 'BarcodeScannerSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    IconKeyboard,
    IconScan,
    IconTorch,
    IconTorchOff,
    ScreenSkeleton,
    ScreenState,
  },
  props: {
    open: { type: Boolean, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    read: (code: string) => typeof code === 'string',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const video = ref<HTMLVideoElement | null>(null)
    const frame = ref<HTMLElement | null>(null)
    const form = ref<HTMLFormElement | null>(null)
    const typing = ref(false)
    const typed = ref('')
    const typedError = ref<ErrorCode | null>(null)
    // Once the camera is known to be missing — no secure context, no camera — «Сканировать» is not
    // offered from the digits: it could only land on the same refusal.
    const cameraMissing = ref(false)

    const camera = useCamera(video)

    function done(code: string): void {
      emit('read', code)
      emit('update:open', false)
    }

    const scan = useBarcodeScan({
      live: computed(() => props.open && !typing.value && camera.kind.value === 'live'),
      frames: () => (video.value && frame.value ? videoFrames(video.value, frame.value) : null),
      onCode: (code) => {
        // A buzz where the phone has one (not iPhone): the code was taken, look at the screen. Not
        // for digits typed by hand — there the person is looking already (review С-11).
        if ('vibrate' in navigator) navigator.vibrate(40)
        done(code)
      },
    })

    const refusal = computed<Refusal | null>(() => {
      if (scan.failed.value) return 'reader'
      const kind = camera.kind.value
      return kind === 'insecure' || kind === 'denied' || kind === 'none' || kind === 'error'
        ? kind
        : null
    })
    const viewing = computed(() => !typing.value && refusal.value === null)

    watch(camera.kind, (kind) => {
      if (kind === 'insecure' || kind === 'none') cameraMissing.value = true
    })
    // A reader that failed leaves nothing for the camera to do: no video is drawn and no frame is
    // read, so it stops rather than run unseen under the error (review С-6, adversarial В).
    watch(scan.failed, (failed) => {
      if (failed) camera.stop()
    })

    // Every way back to the camera — opening the sheet, «Сканировать» from the digits, a retry —
    // starts the reader over only if it was the one that failed: one that was merely warming is
    // kept, or every tap would throw its load away (review С-7, С-8, adversarial Б).
    async function startCamera(): Promise<void> {
      if (scan.failed.value) scan.reset()
      // The video must be in the page before the stream is handed to it.
      await nextTick()
      scan.warm()
      await camera.start()
    }

    watch(
      () => props.open,
      (open) => {
        if (open) {
          typing.value = false
          typed.value = ''
          typedError.value = null
          // A camera missing last time may be there now — another browser, a camera plugged in.
          cameraMissing.value = false
          void startCamera()
        } else {
          camera.stop()
        }
      },
      { immediate: true },
    )

    function toTyping(): void {
      typing.value = true
      camera.stop()
      void nextTick(() => form.value?.querySelector('input')?.focus())
    }

    function toCamera(): void {
      typing.value = false
      void startCamera()
    }

    function retry(): void {
      void startCamera()
    }

    function submitTyped(): void {
      const result = typedBarcode(typed.value)
      if (result.ok) done(result.code)
      else typedError.value = result.error
    }

    return {
      t,
      REFUSALS,
      video,
      frame,
      form,
      typing,
      typed,
      typedError,
      viewing,
      refusal,
      kind: camera.kind,
      torch: camera.torch,
      setTorch: camera.setTorch,
      cameraMayWork: computed(() => !cameraMissing.value),
      toTyping,
      toCamera,
      retry,
      submitTyped,
    }
  },
})
</script>

<style scoped lang="scss">
.viewfinder {
  position: relative;
  height: var(--viewfinder-height);
  overflow: hidden;
  border-radius: var(--radius);
  background: var(--viewfinder-ground);
}

.video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.overlay {
  display: grid;
  position: absolute;
  inset: 0;
  place-items: center;
}

/* A wide band, as a linear code is: what lies around it is dimmed, and only the band is read. */
.frame {
  width: 84%;
  aspect-ratio: 3 / 1;
  border: 2px solid var(--viewfinder-ink);
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 100vmax var(--viewfinder-dim);
}

.loading {
  position: absolute;
  inset: 0;
  padding: var(--space-4);
}

.hint {
  position: absolute;
  right: 0;
  bottom: var(--space-4);
  left: 0;
  margin: 0;
  color: var(--viewfinder-ink);
  font-size: var(--text-footnote);
  text-align: center;
}

.torch {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

.typed,
.actions {
  display: grid;
  gap: var(--space-2);
}
</style>
