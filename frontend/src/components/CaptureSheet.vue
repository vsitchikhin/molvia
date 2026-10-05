<template>
  <BottomSheet :open="open" :on-closed="closed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.capture.title') }}</template>
    <template v-if="parts.length > 0" #meta>{{
      t('receipt.capture.parts', { n: parts.length }, parts.length)
    }}</template>

    <div class="body">
      <p v-if="!online" class="notice">
        <IconCloudOff class="notice-icon" aria-hidden="true" />
        {{ t('receipt.capture.offline') }}
      </p>
      <p v-if="problem" class="problem" role="alert">
        <IconImageOff class="notice-icon" aria-hidden="true" />
        {{ t(problem === 'bad_file' ? 'receipt.capture.bad_file' : 'receipt.capture.not_kept') }}
      </p>

      <ul v-if="parts.length === 0" class="hints">
        <li v-for="hint in HINTS" :key="hint.text" class="hint">
          <span class="hint-circle" aria-hidden="true"><component :is="hint.icon" /></span>
          {{ t(hint.text) }}
        </li>
      </ul>

      <template v-else>
        <p class="order">
          {{ t(parts.length === 1 ? 'receipt.capture.one_part' : 'receipt.capture.parts_order') }}
        </p>
        <ul class="grid">
          <li v-for="(part, index) in parts" :key="part.url" class="cell">
            <button
              type="button"
              class="thumb"
              :aria-label="t('receipt.capture.part_aria', { n: index + 1 })"
              @click="chosen = index"
            >
              <img :src="part.url" alt="" class="photo" />
              <span class="number" aria-hidden="true">{{ index + 1 }}</span>
            </button>
            <span class="caption" aria-hidden="true">{{
              t('receipt.capture.part', { n: index + 1 })
            }}</span>
          </li>
          <li v-if="parts.length < MAX" class="cell">
            <button type="button" class="thumb more" :disabled="preparing" @click="ask(more, null)">
              <IconCameraPlus class="more-icon" aria-hidden="true" />
            </button>
            <span class="caption accent" aria-hidden="true">{{
              t('receipt.capture.add_part')
            }}</span>
          </li>
        </ul>
        <p v-if="parts.length === MAX" class="order">{{ t('receipt.capture.max') }}</p>
      </template>
      <p v-if="preparing" class="order" role="status">{{ t('receipt.capture.preparing') }}</p>
    </div>

    <!-- The system's own camera and gallery (handoff 04): no viewfinder of ours. Not `hidden`:
         a file field put out of the layout is not opened by a script on every engine. -->
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
    <input
      ref="more"
      class="file"
      type="file"
      accept="image/*"
      tabindex="-1"
      aria-hidden="true"
      @change="taken"
    />

    <template #footer>
      <div v-if="parts.length === 0" class="pair">
        <!-- Not now while a photo is made ready: the work is the photo's, and the line above says it. -->
        <AppButton variant="secondary" size="large" :inactive="preparing" @click="ask(pick, null)">
          <template #icon><IconImage /></template>
          {{ t('receipt.capture.pick') }}
        </AppButton>
        <AppButton size="large" :inactive="preparing" @click="ask(take, null)">
          <template #icon><IconCamera /></template>
          {{ t('receipt.capture.take') }}
        </AppButton>
      </div>
      <template v-else>
        <!-- At work while it sends, in its own word; not now while a photo is made ready, which the
             line above says. -->
        <AppButton
          size="large"
          block
          :busy="sending"
          :busy-label="t('receipt.capture.send_busy')"
          :inactive="preparing"
          @click="send"
        >
          {{ t('receipt.capture.send') }}
        </AppButton>
        <p v-if="!online" class="under">{{ t('receipt.capture.send_offline') }}</p>
      </template>
    </template>
  </BottomSheet>

  <!-- «Края чека» (MOL-222): every shot, taken or picked, passes it before it is a part. -->
  <ReceiptEdgesSheet
    :open="edgesOpen"
    :source="edgesSource"
    :part="edgesPart"
    :on-closed="edgesClosed"
    @update:open="edgesOpen = $event"
    @done="edged"
    @closer="closer"
    @failed="edgesFailed"
  />

  <!-- «Часть 2 из 3» (4d): a sheet over the sheet — «‹», no × (Д-1). -->
  <BottomSheet :open="chosen !== null" back @update:open="(open) => !open && (chosen = null)">
    <template #title>{{
      t('receipt.capture.part_of', { n: (chosen ?? 0) + 1, total: parts.length })
    }}</template>
    <img v-if="chosenPart" :src="chosenPart.url" alt="" class="part-photo" />
    <template #footer>
      <div class="pair">
        <AppButton variant="danger-ghost" size="large" @click="removePart">
          {{ t('receipt.capture.remove_part') }}
        </AppButton>
        <AppButton
          size="large"
          :busy="preparing"
          :busy-label="t('receipt.capture.preparing')"
          @click="ask(take, chosen)"
        >
          {{ t('receipt.capture.retake') }}
        </AppButton>
      </div>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCamera from '~icons/mdi/camera-outline'
import IconCameraPlus from '~icons/mdi/camera-plus-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconCrop from '~icons/mdi/crop-free'
import IconImage from '~icons/mdi/image-outline'
import IconImageOff from '~icons/mdi/image-off-outline'
import IconLayers from '~icons/mdi/layers-outline'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import { LOCALES, RECEIPT_PARTS_MAX } from '@molvia/model'
import type { ReceiptCountry } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useOnline } from '@/composables/useOnline'
import { newId } from '@/ids'
import ReceiptEdgesSheet from '@/components/ReceiptEdgesSheet.vue'
import { decodePhoto, encodePhoto } from '@/receipts/photo'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

const HINTS = [
  { icon: IconReceipt, text: 'receipt.capture.hint_flat' },
  { icon: IconCrop, text: 'receipt.capture.hint_top' },
  { icon: IconLayers, text: 'receipt.capture.hint_parts' },
] as const

interface Part {
  readonly photo: Blob
  readonly url: string
}

/**
 * «Сфотографировать чек» (MOL-127, handoff 04): the system's camera or the gallery, up to four parts
 * top to bottom, each made ready on the phone before it is shown (`preparePhoto`), and «Отправить
 * чек» — which puts the photos on the shelf and the receipt in the queue, and closes at once: with a
 * connection or without one, the sheet never waits on the network (MOL-24).
 *
 * «Переснять» a receipt (`replacing`, П-3) is the same sheet: the new one is a new receipt, and the
 * one it replaces goes once the new one is in the queue.
 */
export default defineComponent({
  name: 'CaptureSheet',
  components: {
    AppButton,
    BottomSheet,
    ReceiptEdgesSheet,
    IconCamera,
    IconCameraPlus,
    IconCloudOff,
    IconImage,
    IconImageOff,
  },
  props: {
    open: { type: Boolean, required: true },
    country: { type: String as PropType<ReceiptCountry>, required: true },
    /** The receipt this one is taken again for: removed, without a strip, once this one is queued. */
    replacing: { type: String as PropType<string | null>, default: null },
    /** The sheet is put away — the opener unmounts it then, as it does a purchase's (MOL-24). */
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
    const take = ref<HTMLInputElement | null>(null)
    const pick = ref<HTMLInputElement | null>(null)
    const more = ref<HTMLInputElement | null>(null)
    const parts = ref<Part[]>([])
    const chosen = ref<number | null>(null)
    const problem = ref<'bad_file' | 'not_kept' | null>(null)
    const preparing = ref(false)
    const sending = ref(false)
    /** The shot decoded and waiting on «Края чека»; `edgesFor` — which part it is for. */
    const edgesOpen = ref(false)
    const edgesSource = shallowRef<HTMLCanvasElement | null>(null)
    let edgesFor: number | null = null
    const edgesPart = ref(1)
    /** Which part a file being taken is for: `null` — a new one at the end. */
    let target: number | null = null
    /** Whether the sheet was closed by «Отправить чек», and offline then. */
    let sentOffline: boolean | null = null

    const chosenPart = computed(() =>
      chosen.value === null ? null : (parts.value[chosen.value] ?? null),
    )

    function ask(input: HTMLInputElement | null, part: number | null): void {
      target = part
      problem.value = null
      input?.click()
    }

    async function taken(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      // Emptied at once, so the same photo chosen again is a change again.
      input.value = ''
      if (!file) return
      preparing.value = true
      try {
        const canvas = await decodePhoto(file)
        if (!canvas) {
          problem.value = 'bad_file'
          return
        }
        // the shot goes to «Края чека» (MOL-222): a part is the receipt cut out, never the frame
        releaseCanvas(edgesSource.value)
        edgesSource.value = canvas
        edgesFor = target
        edgesPart.value = (target ?? parts.value.length) + 1
        edgesOpen.value = true
      } finally {
        preparing.value = false
      }
    }

    function releaseCanvas(canvas: HTMLCanvasElement | null): void {
      if (!canvas) return
      canvas.width = 0
      canvas.height = 0
    }

    /** The receipt cut out and straight: encoded as it is sent, and a part — new, or in place. */
    async function edged(straight: HTMLCanvasElement): Promise<void> {
      const at = edgesFor
      edgesOpen.value = false
      preparing.value = true
      try {
        const prepared = await encodePhoto(straight)
        if (!prepared.ok) {
          problem.value = 'bad_file'
          return
        }
        const part: Part = { photo: prepared.photo, url: URL.createObjectURL(prepared.photo) }
        if (at !== null && parts.value[at]) {
          URL.revokeObjectURL(parts.value[at].url)
          parts.value = parts.value.map((one, index) => (index === at ? part : one))
          chosen.value = null
        } else if (parts.value.length < RECEIPT_PARTS_MAX) {
          parts.value = [...parts.value, part]
        }
      } finally {
        releaseCanvas(straight)
        preparing.value = false
      }
    }

    /** «Подойти ближе»: this shot is dropped and the camera asked again for the same part. */
    function closer(): void {
      edgesOpen.value = false
      ask(take.value, edgesFor)
    }

    /** The shot could not be cut out: given up, and said as a file that did not open (4g). */
    function edgesFailed(): void {
      edgesOpen.value = false
      problem.value = 'bad_file'
    }

    /** «Края чека» is away: its photo goes with it — taken, cut out or given up. */
    function edgesClosed(): void {
      releaseCanvas(edgesSource.value)
      edgesSource.value = null
    }

    function removePart(): void {
      const at = chosen.value
      if (at === null) return
      const part = parts.value[at]
      if (part) URL.revokeObjectURL(part.url)
      parts.value = parts.value.filter((_, index) => index !== at)
      chosen.value = null
    }

    async function send(): Promise<void> {
      if (sending.value || preparing.value || parts.value.length === 0) return
      sending.value = true
      try {
        const language = LOCALES.find((one) => one === locale.value) ?? 'ru'
        const kept = await queue.capture(
          {
            id: newId(),
            parts: parts.value.length,
            country: props.country,
            language,
            capturedAt: new Date(),
          },
          parts.value.map((part) => part.photo),
        )
        if (!kept) {
          problem.value = 'not_kept'
          return
        }
        if (props.replacing) queue.remove(props.replacing, true)
        sentOffline = !navigator.onLine
        emit('update:open', false)
      } finally {
        sending.value = false
      }
    }

    function forgetParts(): void {
      for (const part of parts.value) URL.revokeObjectURL(part.url)
      parts.value = []
      chosen.value = null
      problem.value = null
    }

    /** The sheet is away: what it held goes, and a receipt sent is told now (BottomSheet `onClosed`). */
    function closed(): void {
      const offline = sentOffline
      sentOffline = null
      // A closed sheet lets go of its photos: taking them again is one tap, and a blob held on is
      // memory held for nothing.
      forgetParts()
      if (offline !== null) emit('sent', offline)
      props.onClosed?.()
    }

    onBeforeUnmount(() => {
      forgetParts()
      releaseCanvas(edgesSource.value)
    })

    return {
      t,
      HINTS,
      MAX: RECEIPT_PARTS_MAX,
      online,
      take,
      pick,
      more,
      parts,
      chosen,
      chosenPart,
      problem,
      preparing,
      sending,
      ask,
      taken,
      edgesOpen,
      edgesSource,
      edgesPart,
      edged: (straight: HTMLCanvasElement) => void edged(straight),
      closer,
      edgesFailed,
      edgesClosed,
      removePart,
      send,
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

.order,
.under {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.under {
  margin-top: var(--space-2);
  text-align: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.cell {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.thumb {
  position: relative;
  aspect-ratio: 3 / 4;
  padding: 0;
  overflow: hidden;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }

  &.more {
    display: grid;
    place-items: center;
    border: 1.5px dashed var(--border-strong);
    color: var(--accent-ink);
    background: transparent;
  }
}

.photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.number {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  color: var(--text);
  background: var(--surface);
  font-size: var(--text-footnote);
  font-weight: var(--weight-bold);
  line-height: 1.375rem;
  text-align: center;
}

.more-icon {
  @include icon;

  font-size: var(--icon-md);
}

.caption {
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);

  &.accent {
    color: var(--accent-ink);
  }
}

.file {
  @include visually-hidden;
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-2);
}

.part-photo {
  display: block;
  width: 100%;
  max-height: 18.75rem;
  border-radius: var(--radius);
  object-fit: contain;
  background: var(--surface-2);
}
</style>
