<template>
  <AppScreen :title="title">
    <template v-if="detail && status === 'parsed' && !duplicate" #subtitle>
      <button
        class="place-line"
        :class="{ missing: !place }"
        type="button"
        :disabled="locked"
        @click="askPlace(false)"
      >
        <span>{{ placeLine }}</span>
        <IconChevronRight class="chevron" aria-hidden="true" />
      </button>
    </template>

    <ScreenSkeleton v-if="!detail && !gone && phase === 'loading'" :groups="[30, 72, 64, 70, 58]" />

    <ScreenState
      v-else-if="gone"
      kind="attention"
      :title="t('receipt.gone.title')"
      :body="t('receipt.gone.body')"
    >
      <template #action>
        <AppButton @click="goUp">{{ t('receipt.gone.action') }}</AppButton>
      </template>
    </ScreenState>

    <ScreenState
      v-else-if="!detail && phase === 'error'"
      kind="error"
      :title="t('receipt.review.error.title')"
      :body="t('receipt.review.error.body')"
      @retry="retry"
    />
    <ScreenState
      v-else-if="!detail && phase === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('receipt.review.error.title')"
      :body="t('receipt.review.offline')"
    />

    <template v-else-if="detail">
      <p v-if="stale === 'offline' || stale === 'error'" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />
        {{ t('receipt.review.offline') }}
      </p>

      <!-- Recorded elsewhere: the screen of a receipt exists only before it (handoff 05). -->
      <template v-if="status === 'recorded'">
        <ScreenState
          kind="attention"
          inline
          :title="t('receipt.gone.title')"
          :body="t('receipt.gone.body')"
        />
      </template>

      <!-- «Уже записан» (06): the same receipt — tax number and number — recorded before. -->
      <template v-else-if="duplicate">
        <ScreenState
          kind="attention"
          inline
          :title="t('receipt.duplicate.title', { day: dayOf(duplicate.recordedAt) })"
          :body="t('receipt.duplicate.body')"
        />
        <AppCard class="block" list>
          <PurchaseRow
            :icon="IconReceiptCheck"
            :title="detail.receipt.place?.name ?? title"
            :meta="
              t('purchases.recorded_receipt', {
                count: positions(detail.lines.length),
                day: dayOf(duplicate.recordedAt),
              })
            "
            @open="openTrip(duplicate.tripId)"
          />
        </AppCard>
      </template>

      <!-- «Не разобран» (06): the parts from this phone, top to bottom; «переснимите» says why. -->
      <template v-else-if="status === 'failed'">
        <ScreenState
          kind="attention"
          inline
          :title="t(reshoot ? 'receipt.failed.reshoot_title' : 'receipt.failed.title')"
          :body="t(reshoot ? 'receipt.failed.reshoot_body' : 'receipt.failed.body')"
        />
        <p class="caption">{{ t('receipt.failed.photos') }}</p>
        <p v-if="photos.length === 0" class="note">{{ t('receipt.failed.photos_elsewhere') }}</p>
        <figure v-for="(url, index) in photos" :key="url" class="part">
          <figcaption class="part-caption">
            {{ t('receipt.capture.part_of', { n: index + 1, total: photos.length }) }}
          </figcaption>
          <img :src="url" alt="" class="part-photo" loading="lazy" decoding="async" />
        </figure>
        <AppButton variant="danger-ghost" block class="delete" @click="remove">
          <template #icon><IconDelete /></template>
          {{ t('purchases.delete') }}
        </AppButton>
      </template>

      <!-- Still being read: opened by a link before its time. -->
      <template v-else-if="status !== 'parsed'">
        <ScreenState
          kind="attention"
          inline
          :title="t('purchases.group_working')"
          :body="t('purchases.queued.parsing')"
        />
      </template>

      <template v-else>
        <p v-if="refused" class="refused" role="alert">{{ refused }}</p>
        <p class="caption-plain">
          {{ t('receipt.review.count_hint', { count: positions(lines.length) }) }}
          <template v-if="checks > 0">
            · {{ t('receipt.review.issues_check', { n: checks }) }}</template
          >
        </p>
        <AppCard class="block" list>
          <ReceiptLineRow
            v-for="one in lines"
            :key="one.position"
            :line="one"
            :lang="lang"
            @open="!locked && openLine(one.position)"
          />
        </AppCard>
        <ReceiptTotal
          class="block"
          :balance="balance"
          :total="shownTotal"
          :rate="detail.rate"
          :day="rateDay"
          :suspect="suspect"
          @total="!locked && (totalOpen = true)"
        />
        <p class="note">
          <IconImageOff class="note-icon" aria-hidden="true" />
          {{ t('receipt.review.photo_note') }}
        </p>
        <!-- Not while «Записать» waits: the purchases are on their way, and a removal behind them
             would meet a recorded receipt (adversarial А1). -->
        <AppButton v-if="!locked" variant="danger-ghost" block class="delete" @click="remove">
          <template #icon><IconDelete /></template>
          {{ t('purchases.delete') }}
        </AppButton>
      </template>
    </template>

    <template v-if="detail && docked" #docked>
      <div class="dock">
        <template v-if="docked === 'record'">
          <p v-if="recording" class="under">{{ t('receipt.review.recording') }}</p>
          <AppButton
            v-else
            size="large"
            block
            :busy="sending"
            :inactive="balance.recorded === 0"
            @click="record"
          >
            {{ t('receipt.review.record', { n: balance.recorded }, balance.recorded) }}
          </AppButton>
          <p v-if="!online && !recording" class="under">{{ t('receipt.review.record_offline') }}</p>
        </template>
        <template v-else-if="docked === 'failed' && country">
          <ManualEntryButton />
          <AppButton variant="ghost" block @click="retake">
            <template #icon><IconCamera /></template>
            {{ t('receipt.capture.retake') }}
          </AppButton>
        </template>
        <AppButton
          v-else-if="docked === 'duplicate'"
          variant="secondary"
          size="large"
          block
          @click="remove"
        >
          <template #icon><IconDelete /></template>
          {{ t('purchases.delete') }}
        </AppButton>
      </div>
    </template>

    <ReceiptLineSheet
      v-if="openedLine && detail"
      :key="`${detail.receipt.id}-${openedLine.position}-${openings}`"
      :open="lineOpen"
      :line="openedLine"
      :total="lines.length"
      :currency="currency"
      :lang="lang"
      :place="linePlace"
      :country="detail.receipt.country"
      :digits="digits"
      :on-closed="lineClosed"
      @update:open="lineOpen = $event"
      @saved="saveLine"
    />
    <ReceiptPlaceSheet
      v-if="detail"
      v-model:open="placeOpen"
      :current="place"
      :read="!!detail.receipt.place && !placeChosen"
      :day="day"
      :action="
        recordAfterPlace
          ? t('receipt.review.record', { n: balance.recorded }, balance.recorded)
          : null
      "
      :on-closed="placeClosed"
      @chosen="choosePlace"
    />
    <ReceiptTotalSheet
      v-if="detail"
      v-model:open="totalOpen"
      :currency="currency"
      :current="shownTotal"
      :corrected="!!draft?.total"
      @saved="saveTotal"
    />
    <!-- Mounted until it is put away, as from the strip: the sheet tells «sent» from its `onClosed`,
         and unmounted on `update:open` it told nobody (review 2). -->
    <CaptureSheet
      v-if="country && detail && retakeMounted"
      v-model:open="retaking"
      :country="country"
      :replacing="detail.receipt.id"
      :on-closed="() => (retakeMounted = false)"
      @sent="retaken"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconCamera from '~icons/mdi/camera-outline'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconDelete from '~icons/mdi/delete-outline'
import IconImageOff from '~icons/mdi/image-off-outline'
import IconReceiptCheck from '~icons/mdi/receipt-text-check-outline'
import { RECEIPT_CURRENCY, receiptDigits, yerevanDate } from '@molvia/model'
import type { Money } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import CaptureSheet from '@/components/CaptureSheet.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import PurchaseRow from '@/components/PurchaseRow.vue'
import ReceiptLineRow from '@/components/ReceiptLineRow.vue'
import ReceiptLineSheet from '@/components/ReceiptLineSheet.vue'
import ReceiptPlaceSheet from '@/components/ReceiptPlaceSheet.vue'
import ReceiptTotal from '@/components/ReceiptTotal.vue'
import ReceiptTotalSheet from '@/components/ReceiptTotalSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useOnline } from '@/composables/useOnline'
import { useReceipt } from '@/composables/useReceipt'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { calendarDay, dayOfAnyYear, localDay } from '@/days'
import { newId } from '@/ids'
import { afterStep, useNavigation } from '@/navigation'
import { photoShelf } from '@/receipts/photoShelf'
import { recordBody, reviewBalance, reviewDay, reviewLines, reviewPlace } from '@/receipts/review'
import { useActorStore } from '@/stores/actor'
import { useReceiptDraftsStore } from '@/stores/receiptDrafts'
import { placeIdOf } from '@/stores/receiptDrafts'
import type { LineDraft, PlaceDraft } from '@/stores/receiptDrafts'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

/** The language a receipt of a country is printed in, for the system's face to pick its glyphs. */
const PRINTED_LANG = { AM: 'hy' } as const

/**
 * A receipt before it is recorded (MOL-127, handoff 05, 06): its place and day, its lines as read
 * with the person's edits over them, the arithmetic of the model (В-6), and «Записать N» — which
 * goes through the queue under a trip the phone names, so a double tap and a repeat are one record.
 * After it the screen gives way to the purchases (`router.replace`): «back» goes to «Покупки», and
 * this screen is in the history no more. Not read, recorded before, removed elsewhere — each its
 * own state; the edits live on the phone and need no connection (Т-9).
 */
export default defineComponent({
  name: 'ReceiptView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    CaptureSheet,
    IconCamera,
    IconChevronRight,
    IconCloudOff,
    IconDelete,
    IconImageOff,
    ManualEntryButton,
    PurchaseRow,
    ReceiptLineRow,
    ReceiptLineSheet,
    ReceiptPlaceSheet,
    ReceiptTotal,
    ReceiptTotalSheet,
    ScreenSkeleton,
    ScreenState,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const { goUp } = useNavigation()
    const actor = useActorStore()
    const queue = useReceiptQueueStore()
    const drafts = useReceiptDraftsStore()
    const online = useOnline()
    const { country } = useReceiptCapture()
    const id = computed(() => String(route.params.receiptId ?? '').toLowerCase())
    const kept = useReceipt(id)
    const detail = computed(() => kept.answer.value)
    const draft = computed(() => drafts.draftOf(id.value))

    const status = computed(() => detail.value?.receipt.status ?? null)
    const duplicate = computed(() =>
      status.value === 'parsed' ? (detail.value?.duplicateOf ?? null) : null,
    )
    const reshoot = computed(() => detail.value?.receipt.failure === 'reshoot')
    const lang = computed(() => (detail.value ? PRINTED_LANG[detail.value.receipt.country] : 'hy'))
    const currency = computed(() => RECEIPT_CURRENCY[detail.value?.receipt.country ?? 'AM'])
    const taken = computed(() => localDay(detail.value?.receipt.capturedAt ?? new Date()))

    const lines = computed(() => (detail.value ? reviewLines(detail.value, draft.value) : []))
    const balance = computed(() =>
      detail.value
        ? reviewBalance(detail.value, lines.value, draft.value)
        : { lines: null, difference: null, suspect: null, recorded: 0 },
    )
    const place = computed(() => (detail.value ? reviewPlace(detail.value, draft.value) : null))
    const placeChosen = computed(() => !!draft.value?.place)
    const day = computed(() =>
      detail.value ? reviewDay(detail.value, draft.value, taken.value) : taken.value,
    )
    const shownTotal = computed<Money | null>(
      () => draft.value?.total ?? detail.value?.receipt.total ?? null,
    )
    const suspect = computed(() => {
      const at = balance.value.suspect
      return at === null ? null : (lines.value[at]?.name ?? null)
    })
    const checks = computed(() => lines.value.filter((one) => one.check && !one.skip).length)
    /** The digits the receipt prints its sums to (П-2): the line's «кол-во × цена» is rounded so. */
    const digits = computed(() => {
      const one = detail.value
      if (!one) return 0
      return receiptDigits(currency.value, [
        one.receipt.total,
        ...one.lines.flatMap((line) => [line.price, line.sum, line.discount]),
      ])
    })
    /**
     * «≈ … по курсу» names the day of the rate the server sent, never the day chosen (review 19) —
     * in the rate's own zone, as every rate is printed: `asOf` is Yerevan's midnight, the evening
     * before in UTC, and a phone west of it would say the day before (review 32).
     */
    const rateDay = computed(() => {
      const asOf = detail.value?.rate?.asOf
      return asOf ? yerevanDate(asOf) : day.value
    })

    const dayOf = (at: Date | string) =>
      typeof at === 'string'
        ? calendarDay(at, locale.value, { day: 'numeric', month: 'short' })
        : dayOfAnyYear(at, locale.value)
    const positions = (n: number): string => t('trip.items_count', { n }, n)

    const title = computed(() => {
      const one = detail.value
      if (!one) return t('receipt.review.title_loading')
      return place.value?.name ?? t('receipt.review.title_no_place', { day: dayOf(day.value) })
    })
    const placeLine = computed(() => {
      const one = detail.value
      if (!one || !place.value) return t('receipt.review.place_missing')
      const tin = one.receipt.header?.tin
      const time = one.receipt.header?.time
      const words = {
        city: place.value.city,
        inn: tin ?? '',
        day: dayOf(day.value),
        time: time ?? '',
      }
      if (!tin) return t('receipt.review.place_line_no_tin', words)
      return time && !placeChosen.value
        ? t('receipt.review.place_line_time', words)
        : t('receipt.review.place_line', words)
    })

    // The record waiting in the queue, and a refusal of one: the screen is the place to put it right.
    const recording = computed(() =>
      queue.pending.some((write) => write.kind === 'record' && write.id === id.value),
    )
    const refused = computed(() => {
      const refusal = queue.rejected.find(
        (item) => item.write.kind === 'record' && item.write.id === id.value,
      )
      return refusal ? t('receipt.review.refused', { reason: t(refusal.code) }) : null
    })
    /**
     * While «Записать» waits in the queue — or is being sent — the receipt is what was sent: an edit
     * made now would not reach the server (review 5), nor would a removal (adversarial А1).
     */
    const locked = computed(() => recording.value || sending.value)
    const docked = computed(() => {
      if (!detail.value) return null
      if (status.value === 'failed') return 'failed'
      if (duplicate.value) return 'duplicate'
      if (status.value === 'parsed') return 'record'
      return null
    })

    // The photos of a receipt not read, from this phone (Т-4): the server gives none back.
    const photos = ref<string[]>([])
    function letGo(): void {
      for (const url of photos.value) URL.revokeObjectURL(url)
      photos.value = []
    }
    watch(
      () => [status.value, id.value] as const,
      async ([now, asked]) => {
        letGo()
        const owner = actor.id
        if (now !== 'failed' || !owner) return
        const parts = await photoShelf(owner).parts(asked)
        if (status.value === 'failed' && id.value === asked)
          photos.value = parts.map((part) => URL.createObjectURL(part))
      },
      { immediate: true },
    )
    onBeforeUnmount(letGo)

    // Recorded on another phone while this one looked: its purchases are where to go.
    watch(
      () => detail.value?.receipt,
      (receipt) => {
        if (receipt?.status === 'recorded' && receipt.tripId)
          void router.replace({ name: 'purchase', params: { tripId: receipt.tripId } })
      },
    )

    // The line sheet: mounted per opening, so each line starts from its own figures.
    const opened = ref<number | null>(null)
    const openedLine = computed(() =>
      opened.value === null ? null : (lines.value[opened.value] ?? null),
    )
    const linePlace = computed(() => {
      const chosen = place.value
      if (!chosen) return null
      return { id: placeIdOf(chosen), name: chosen.name, city: chosen.city }
    })
    const lineOpen = ref(false)
    const openings = ref(0)
    function openLine(position: number): void {
      opened.value = position
      openings.value += 1
      lineOpen.value = true
    }

    const placeOpen = ref(false)
    const recordAfterPlace = ref(false)
    const totalOpen = ref(false)
    const retaking = ref(false)
    const retakeMounted = ref(false)
    const sending = ref(false)
    let recordOnClose = false

    function askPlace(andRecord: boolean): void {
      recordAfterPlace.value = andRecord
      placeOpen.value = true
    }

    async function record(): Promise<void> {
      const one = detail.value
      if (!one || sending.value || recording.value) return
      const body = recordBody(one, draft.value, lines.value, newId(), taken.value)
      if (!body) {
        askPlace(true)
        return
      }
      sending.value = true
      try {
        queue.record(one.receipt.id, body)
        if (!navigator.onLine) {
          await goUp()
          return
        }
        await queue.flush()
        // The answer may come after the person left: only this very review gives way to the
        // purchases, never a screen they moved to meanwhile (adversarial А5).
        if (route.name !== 'purchase-receipt' || id.value !== one.receipt.id) return
        const note = queue.recorded.find((done) => done.receiptId === one.receipt.id)
        if (note) {
          drafts.forget(one.receipt.id)
          await router.replace({
            name: 'purchase',
            params: { tripId: note.tripId },
            state: { recorded: note.count },
          })
          return
        }
        // Held — the server broke or the connection went: it waits in the queue (Р-5).
        if (queue.pending.some((write) => write.kind === 'record' && write.id === one.receipt.id))
          await goUp()
      } finally {
        sending.value = false
      }
    }

    function remove(): void {
      const one = detail.value
      if (!one) return
      queue.remove(one.receipt.id)
      void goUp()
    }

    return {
      t,
      IconReceiptCheck,
      detail,
      draft,
      phase: kept.phase,
      stale: kept.stale,
      gone: kept.gone,
      retry: () => void kept.retry(),
      status,
      duplicate,
      reshoot,
      lang,
      currency,
      lines,
      balance,
      place,
      placeChosen,
      day,
      shownTotal,
      suspect,
      checks,
      title,
      placeLine,
      dayOf,
      positions,
      recording,
      refused,
      docked,
      photos,
      online,
      country,
      opened,
      openedLine,
      linePlace,
      lineOpen,
      openings,
      openLine,
      placeOpen,
      recordAfterPlace,
      totalOpen,
      retaking,
      sending,
      askPlace,
      record,
      remove,
      goUp: () => void goUp(),
      locked,
      digits,
      rateDay,
      retakeMounted,
      retake: () => {
        retakeMounted.value = true
        retaking.value = true
      },
      // The receipt this one replaced is gone: so is its screen, once the sheet's step has landed.
      retaken: () => {
        afterStep(() => void goUp())
      },
      openTrip: (tripId: string) => void router.push({ name: 'purchase', params: { tripId } }),
      lineClosed: () => {
        opened.value = null
      },
      saveLine: (line: LineDraft) => {
        if (opened.value !== null) drafts.setLine(id.value, opened.value, line)
      },
      choosePlace: (chosen: PlaceDraft, purchasedOn: string) => {
        drafts.setPlace(id.value, chosen, purchasedOn)
        recordOnClose = recordAfterPlace.value
      },
      placeClosed: () => {
        recordAfterPlace.value = false
        if (recordOnClose) {
          recordOnClose = false
          void record()
        }
      },
      saveTotal: (total: Money | null) => {
        drafts.setTotal(id.value, total)
      },
    }
  },
})
</script>

<style scoped lang="scss">
.place-line {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--touch-target);
  padding: 0;
  border: 0;
  color: var(--text-muted);
  background: none;
  text-align: left;
  font: inherit;
  font-size: var(--text-callout);
  cursor: pointer;

  &.missing {
    color: var(--accent-ink);
    font-weight: var(--weight-medium);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.chevron {
  @include icon;

  font-size: var(--icon);
}

.strip {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  color: var(--text-muted);
  background: var(--surface-2);
  font-size: var(--text-footnote);
}

.strip-icon,
.note-icon {
  @include icon;

  font-size: var(--icon-sm);
}

.refused {
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius);
  color: var(--warn-ink);
  background: var(--warn-tint);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.caption-plain,
.note {
  margin: 0 var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.note {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-top: var(--space-6);
}

.caption {
  margin: var(--space-6) var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.block {
  margin-bottom: var(--space-3);
}

.part {
  margin: 0 0 var(--space-4);
}

.part-caption {
  margin-bottom: var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.part-photo {
  display: block;
  width: 100%;
  height: auto;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  object-fit: contain;
}

.delete {
  margin-top: var(--space-2);
}

.dock {
  @include appear;

  display: grid;
  gap: var(--space-1);
  padding: var(--space-3) 0;
}

.under {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}
</style>
