<template>
  <BottomSheet :open="open" :on-closed="closed" @update:open="$emit('update:open', $event)">
    <template #title>{{
      t(pasting ? 'purchases.capture_link' : 'receipt.capture.title')
    }}</template>

    <div ref="body" class="body">
      <p v-if="!online" class="notice">
        <IconCloudOff class="notice-icon" aria-hidden="true" />
        {{ t('receipt.capture.offline') }}
      </p>
      <p v-if="notKept" class="problem" role="alert">{{ t('receipt.capture.not_kept') }}</p>

      <template v-if="pasting">
        <ol class="steps">
          <li>{{ t('receipt.link.step_qr') }}</li>
          <li>{{ t('receipt.link.step_copy') }}</li>
          <li>{{ t('receipt.link.step_paste') }}</li>
        </ol>

        <AppField
          v-model="text"
          :label="t('receipt.link.field')"
          :error-text="refusal === null ? null : t(`receipt.link.refusal.${refusal}`)"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="send"
          @keydown.enter.prevent="send"
        />

        <p class="quiet">
          <span>{{ t('receipt.qr.or_take') }}</span>
          <AppButton variant="ghost" @click="takeAgain">{{ t('receipt.qr.take') }}</AppButton>
        </p>
      </template>

      <template v-else>
        <p v-if="outcome" class="problem" role="alert">
          <IconQrcodeRemove class="notice-icon" aria-hidden="true" />
          <span class="problem-words">
            <b>{{ outcomeTitle }}</b>
            <span v-if="outcome === 'missed'">{{ t('receipt.qr.missed_body') }}</span>
          </span>
        </p>

        <template v-else>
          <ul class="hints">
            <li v-for="hint in HINTS" :key="hint.text" class="hint">
              <span class="hint-circle" aria-hidden="true"><component :is="hint.icon" /></span>
              {{ t(hint.text) }}
            </li>
          </ul>

          <p class="quiet">
            <span>{{ t('receipt.qr.have_link') }}</span>
            <AppButton variant="ghost" :inactive="reading" @click="paste">{{
              t('receipt.qr.paste_short')
            }}</AppButton>
          </p>
        </template>
      </template>
    </div>

    <!-- The system's own camera and gallery, as the photo's sheet (handoff 04): no viewfinder of
         ours — a receipt's QR wants the photo's pixels, not a live frame's (MOL-223). -->
    <input
      ref="take"
      class="file"
      type="file"
      accept="image/*"
      capture="environment"
      tabindex="-1"
      aria-hidden="true"
      @change="taken"
    />
    <input
      ref="pick"
      class="file"
      type="file"
      accept="image/*"
      tabindex="-1"
      aria-hidden="true"
      @change="taken"
    />

    <template #footer>
      <template v-if="pasting">
        <AppButton
          size="large"
          block
          :busy="sending"
          :busy-label="t('receipt.capture.send_busy')"
          @click="send"
        >
          {{ t('receipt.capture.send') }}
        </AppButton>
        <p v-if="!online" class="under">{{ t('receipt.capture.send_offline') }}</p>
      </template>
      <!-- After a miss or a refusal the link is the way on, the camera the second try (В-2). -->
      <div v-else-if="outcome" class="pair">
        <AppButton variant="secondary" size="large" :inactive="reading" @click="paste">
          {{ t('receipt.qr.paste') }}
        </AppButton>
        <AppButton
          size="large"
          :busy="reading"
          :busy-label="t('receipt.qr.reading')"
          @click="ask(take, 'take')"
        >
          {{ t(outcome === 'missed' ? 'receipt.qr.retake' : 'receipt.qr.take_other') }}
        </AppButton>
      </div>
      <!-- The one pressed says the work, the other is not now (MOL-225, Р1-А1). -->
      <div v-else class="pair">
        <AppButton
          variant="secondary"
          size="large"
          :busy="reading && pressed === 'pick'"
          :busy-label="t('receipt.qr.reading')"
          :inactive="reading && pressed !== 'pick'"
          @click="ask(pick, 'pick')"
        >
          <template #icon><IconImage /></template>
          {{ t('receipt.capture.pick') }}
        </AppButton>
        <AppButton
          size="large"
          :busy="reading && pressed === 'take'"
          :busy-label="t('receipt.qr.reading')"
          :inactive="reading && pressed !== 'take'"
          @click="ask(take, 'take')"
        >
          <template #icon><IconCamera /></template>
          {{ t('receipt.qr.take') }}
        </AppButton>
      </div>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCamera from '~icons/mdi/camera-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconImage from '~icons/mdi/image-outline'
import IconLock from '~icons/mdi/lock-outline'
import IconQrcode from '~icons/mdi/qrcode-scan'
import IconQrcodeRemove from '~icons/mdi/qrcode-remove'
import IconSun from '~icons/mdi/white-balance-sunny'
import { LOCALES, serbianReceiptLink } from '@molvia/model'
import type { ReceiptLinkRefusal } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet, { DOUBLE_TAP } from '@/components/BottomSheet.vue'
import { useOnline } from '@/composables/useOnline'
import { reportFailure } from '@/failures'
import { newId } from '@/ids'
import { decodePhoto } from '@/receipts/photo'
import { createReceiptQrReader, receiptLinkOnPhoto } from '@/receipts/qrReader'
import type { ReceiptQrReader } from '@/receipts/qrReader'
import { ReaderFailed } from '@/scanner/barcodeReader'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

const HINTS = [
  { icon: IconQrcode, text: 'receipt.qr.hint_qr' },
  { icon: IconSun, text: 'receipt.qr.hint_light' },
  { icon: IconLock, text: 'receipt.qr.hint_private' },
] as const

/** How the last shot ended, when it sent nothing: no link on it, a refusal, a file that did not open. */
type Outcome = 'missed' | 'bad_file' | 'not_sale' | 'refund'

/**
 * A Serbian receipt (MOL-233, MOL-232): «Сфотографировать чек» as for any receipt, but the photo is
 * read here, for its QR code — the tax office's link — and only the link goes, through the receipts'
 * queue; the photo never leaves the phone and is let go as soon as it is read (owner's В-1 «а»). No
 * code on the shot — how to take it, and the link pasted, as MOL-232 had it (В-2 «а»): the system
 * camera opens the tax office's page, whose address is copied here. The link is checked on the phone
 * by the very function the server checks it by, and «Отправить чек» puts it in the queue and closes:
 * with a connection or without one, the sheet never waits on the network (MOL-24). The tax office is
 * asked by the server — the page cannot read its answer.
 */
export default defineComponent({
  name: 'LinkReceiptSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    IconCamera,
    IconCloudOff,
    IconImage,
    IconQrcodeRemove,
  },
  props: {
    open: { type: Boolean, required: true },
    /** The sheet is put away — the opener unmounts it then, as the capture sheet's. */
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** Queued; called once the sheet is away, so the screen may move. */
    sent: (offline: boolean) => typeof offline === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const queue = useReceiptQueueStore()
    const online = useOnline()
    const body = ref<HTMLElement | null>(null)
    const take = ref<HTMLInputElement | null>(null)
    const pick = ref<HTMLInputElement | null>(null)
    const pasting = ref(false)
    const text = ref('')
    const tried = ref(false)
    const notKept = ref(false)
    const sending = ref(false)
    const reading = ref(false)
    const pressed = ref<'take' | 'pick' | null>(null)
    const outcome = ref<Outcome | null>(null)
    let sentOffline: boolean | null = null

    // The worker starts with the sheet, so the wasm is loaded while the camera is up.
    let reader: ReceiptQrReader | null = createReceiptQrReader()
    reader.warm().catch(() => undefined)

    const read = computed(() => serbianReceiptLink(text.value))
    // Said once there is something to judge: a paste at once, an empty field only after «Отправить».
    const refusal = computed<ReceiptLinkRefusal | null>(() => {
      if (read.value.ok || (text.value.trim() === '' && !tried.value)) return null
      return read.value.reason
    })
    const outcomeTitle = computed(() => {
      switch (outcome.value) {
        case 'missed':
          return t('receipt.qr.missed_title')
        case 'bad_file':
          return t('receipt.capture.bad_file')
        case 'not_sale':
        case 'refund':
          return t(`receipt.link.refusal.${outcome.value}`)
        default:
          return ''
      }
    })

    function ask(input: HTMLInputElement | null, which: 'take' | 'pick'): void {
      if (reading.value) return
      pressed.value = which
      notKept.value = false
      input?.click()
    }

    /** A worker that failed is a defect of ours: reported, and the shot is a miss — the link stays. */
    function readerFailed(error: unknown): void {
      reportFailure(
        error instanceof ReaderFailed && error.cause instanceof Error ? error.cause : error,
        'scanner',
      )
      reader?.dispose()
      reader = createReceiptQrReader()
    }

    async function taken(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      // Emptied at once, so the same photo chosen again is a change again.
      input.value = ''
      if (!file || reading.value) return
      // the button whose field this is says the work, whatever was tapped to open it
      pressed.value = input === pick.value ? 'pick' : 'take'
      reading.value = true
      try {
        const photo = await decodePhoto(file)
        if (!photo) {
          outcome.value = 'bad_file'
          return
        }
        let found: Awaited<ReturnType<typeof receiptLinkOnPhoto>> = { kind: 'none' }
        try {
          if (reader) found = await receiptLinkOnPhoto(photo, reader)
        } catch (error) {
          readerFailed(error)
        } finally {
          // The photo is not kept anywhere: read, and let go (Т-3).
          photo.width = 0
          photo.height = 0
        }
        if (found.kind === 'link') {
          outcome.value = null
          if (await queued(found.link.link)) return
        } else {
          outcome.value = found.kind === 'refused' ? found.reason : 'missed'
        }
      } finally {
        reading.value = false
      }
    }

    /** The link into the receipts' queue; the sheet stays at work for a double tap, then goes. */
    async function queued(link: string): Promise<boolean> {
      const language = LOCALES.find((one) => one === locale.value) ?? 'ru'
      const kept = queue.sendLink({
        id: newId(),
        link,
        country: 'RS',
        language,
        capturedAt: new Date(),
      })
      if (!kept) {
        notKept.value = true
        return false
      }
      sentOffline = !navigator.onLine
      // Queued at once, with no photo to keep: the sheet stays at work for a double tap, so the second
      // tap lands on the busy button and never through a sheet going down onto the tab bar (А3) — as a
      // photo's sheet stays while its photos are kept.
      sending.value = true
      await new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP))
      emit('update:open', false)
      return true
    }

    async function send(): Promise<void> {
      // a double click is one receipt, never two of one link (adversarial А3)
      if (sending.value) return
      tried.value = true
      const link = read.value
      if (!link.ok) return
      await queued(link.link)
    }

    /** «Вставить»: the field of MOL-232 in this sheet, focused — the paste is the next tap. */
    async function paste(): Promise<void> {
      if (reading.value) return
      pasting.value = true
      notKept.value = false
      await nextTick()
      body.value?.querySelector('input')?.focus()
    }

    /** «Снять QR» from the field: the camera again, the field kept as typed. */
    function takeAgain(): void {
      pasting.value = false
      outcome.value = null
      ask(take.value, 'take')
    }

    function closed(): void {
      const offline = sentOffline
      sentOffline = null
      pasting.value = false
      text.value = ''
      tried.value = false
      notKept.value = false
      sending.value = false
      outcome.value = null
      if (offline !== null) emit('sent', offline)
      props.onClosed?.()
    }

    onBeforeUnmount(() => {
      reader?.dispose()
      reader = null
    })

    return {
      t,
      HINTS,
      online,
      body,
      take,
      pick,
      pasting,
      text,
      refusal,
      notKept,
      sending,
      reading,
      pressed,
      outcome,
      outcomeTitle,
      ask,
      taken: (event: Event) => void taken(event),
      send: () => void send(),
      paste: () => void paste(),
      takeAgain,
      closed,
    }
  },
})
</script>

<style scoped lang="scss">
.body {
  display: grid;
  gap: var(--space-3);
}

.notice,
.problem {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-callout);
}

.notice {
  color: var(--text-muted);
  background: var(--surface-2);
}

.problem {
  color: var(--warn-ink);
  background: var(--warn-tint);
}

.problem-words {
  display: grid;
  gap: var(--space-1);

  b {
    font-weight: var(--weight-medium);
  }
}

.notice-icon {
  @include icon;

  font-size: var(--icon-sm);
}

.hints {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.hint {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--text-callout);
}

.hint-circle {
  display: grid;
  flex: none;
  place-items: center;
  width: var(--state-circle);
  height: var(--state-circle);
  border-radius: 50%;
  color: var(--text-muted);
  background: var(--surface-2);

  svg {
    @include icon;

    font-size: var(--state-glyph);
  }
}

.quiet {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  margin: 0;
  padding-left: var(--space-3);
  border-radius: var(--radius);
  color: var(--text-muted);
  background: var(--surface-2);
  font-size: var(--text-callout);
}

.steps {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding-left: var(--space-6);
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.file {
  @include visually-hidden;
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}

.under {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}
</style>
