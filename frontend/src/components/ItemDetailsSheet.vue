<template>
  <BottomSheet ref="sheet" v-model:open="open" :on-closed="onClosed">
    <template #title>{{ entry.name }}</template>
    <template v-if="entry.note" #meta>{{ entry.note }}</template>

    <div ref="form" class="form">
      <div class="row">
        <AppField
          v-model="quantity"
          class="quantity"
          :label="t('item.quantity')"
          kind="decimal"
          :error="errors.quantity"
          data-field="quantity"
          @blur="leaveField('quantity')"
        />
        <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
      </div>

      <AppField
        v-model="amount"
        :label="t('item.price')"
        kind="decimal"
        :error="errors.amount"
        data-field="amount"
        @blur="leaveField('amount')"
      >
        <template #suffix>
          <span class="currency">
            <select v-model="currency" class="currency-select" :aria-label="t('item.currency')">
              <option v-for="option in currencies" :key="option.value" :value="option.value">
                {{ option.sign }}
              </option>
            </select>
            <IconMenuDown class="currency-caret" aria-hidden="true" />
          </span>
        </template>
      </AppField>

      <div class="per-unit">
        <span class="per-unit-label">{{ t('item.unit_price_label') }}</span>
        <span class="per-unit-value">{{ perUnit ?? '—' }}</span>
      </div>
      <p v-if="!perUnit" class="caption">{{ t('item.unit_price_pending') }}</p>
      <!-- The price of the package needs no quantity: a weight not yet known still has its
           price in roubles (adversarial A6). -->
      <p v-if="converted" class="caption">
        <span>{{ t('money.converted_package', { amount: converted }) }}</span>
        <span class="note">{{ t('money.converted_note') }}</span>
      </p>
    </div>

    <template #footer>
      <template v-if="tripId">
        <AppButton size="large" block @click="submit">
          {{ editing ? t('item.save_edit') : t('item.save') }}
        </AppButton>
        <AppButton v-if="editing" variant="danger-ghost" block @click="remove">
          {{ t('item.delete') }}
        </AppButton>
        <p v-if="!online" class="caption offline">{{ t('item.offline_note') }}</p>
      </template>
      <template v-else>
        <p class="no-trip">{{ t('item.no_trip.body') }}</p>
        <AppButton size="large" block @click="leave">{{ t('item.no_trip.action') }}</AppButton>
      </template>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconMenuDown from '~icons/mdi/menu-down'
import { currencySchema, currencySign, formatEstimate, formatUnitPrice } from '@molvia/model'
import type { BaseUnit, CatalogueEntry, Money, TripExpenseView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { useItemDetails } from '@/composables/useItemDetails'
import type { DetailsField, RetryPurchase } from '@/composables/useItemDetails'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'

const UNITS: readonly BaseUnit[] = ['kg', 'l', 'piece']

/**
 * «Сколько, в чём, почём» for one item: the sheet every purchase goes through (MOL-24).
 *
 * It opens itself when mounted — the screen mounts it on a pick and unmounts it from `onClosed` —
 * so each opening has its own state and its own purchase identifier.
 *
 * Nothing is required but the item: the main action is always live, and blank fields mean «later».
 * What was typed and is not a number is not sent without it (В-5). A write goes to the trip queue
 * and the sheet closes at once — with a connection or without one, the same path (В-2).
 *
 * `closeSteps` is how many layers the write puts away: two over the search — the sheet and the
 * screen under it, back to the trip — one over the trip itself.
 */
export default defineComponent({
  name: 'ItemDetailsSheet',
  components: { AppButton, AppField, BottomSheet, IconMenuDown, SegmentedControl },
  props: {
    entry: { type: Object as PropType<CatalogueEntry>, required: true },
    /** What was typed before the item was picked; it goes with the purchase (MOL-11). */
    query: { type: String as PropType<string | null>, default: null },
    /** The row being amended; none when a purchase is being added. */
    expense: { type: Object as PropType<TripExpenseView | null>, default: null },
    /** A purchase the server refused, opened to be corrected and sent again (MOL-22, В-3). */
    retry: { type: Object as PropType<RetryPurchase | null>, default: null },
    closeSteps: { type: Number as PropType<1 | 2>, default: 1 },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    added: (entry: CatalogueEntry) => typeof entry === 'object',
    saved: () => true,
    removed: () => true,
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const trips = useTripStore()
    const queue = useTripQueueStore()

    const open = ref(true)
    const form = ref<HTMLElement | null>(null)
    // Both places that know whether a trip is going on: without the queue the sheet would say
    // «start a trip first» at a shelf where one was started with no signal (MOL-22, Р-2).
    const { trip, tripId, currency } = useCurrentTrip()
    const editing = computed(() => props.expense !== null)

    /**
     * The trip's total and what is still queued for it: a price must fit beside both (A9). The
     * purchase of this sheet is not counted — once queued it would be counted twice.
     */
    function occupied(): Money[] {
      const id = tripId.value
      if (!id) return []
      const held: Money[] = [...(trip.value?.total ?? [])]
      for (const write of queue.pending) {
        if (write.kind !== 'add' || write.tripId !== id || !write.body.amount) continue
        if (write.body.id === details.expenseId) continue
        const amount = write.body.amount
        const index = held.findIndex((money) => money.currency === amount.currency)
        if (index === -1) held.push(amount)
        else {
          const sum = (held[index]?.minor ?? 0n) + amount.minor
          held[index] = { minor: sum, currency: amount.currency }
        }
      }
      return held
    }

    const details = useItemDetails({
      entry: props.entry,
      trip: () => trip.value,
      occupied,
      // A trip the server has not answered yet has no rate and no total, so the price starts in
      // the person's own currency — the one the server will give the trip anyway.
      currency: currency.value,
      expense: props.expense,
      retry: props.retry,
      separator: locale.value === 'ru' ? ',' : '.',
    })

    const units = computed(() => UNITS.map((value) => ({ value, label: t(`item.unit_${value}`) })))
    const currencies = computed(() =>
      currencySchema.options.map((value) => ({ value, sign: currencySign(value, locale.value) })),
    )

    const perUnit = computed(() => {
      const price = details.unitPrice.value
      if (!price) return null
      return t('item.unit_price_value', {
        amount: formatUnitPrice(price, locale.value),
        unit: t(`item.unit_${price.unit}`),
      })
    })
    const converted = computed(() => {
      const money = details.converted.value
      return money ? formatEstimate(money, locale.value) : null
    })

    // Read out through the app's one live region, not a region of its own born with the sheet —
    // those are often not read (CLAUDE.md, MOL-19). Once typing pauses, not on every keystroke.
    const announce = useAnnouncer()
    let withdraw: (() => void) | undefined
    let pause: ReturnType<typeof setTimeout> | undefined
    watch(perUnit, (value) => {
      clearTimeout(pause)
      pause = setTimeout(() => {
        withdraw?.()
        withdraw = value ? announce?.(t('item.unit_price_announced', { value })) : undefined
      }, 700)
    })
    onUnmounted(() => {
      clearTimeout(pause)
      withdraw?.()
    })

    // Read now and on every change, not narrowed from a check made before: whether the note shows
    // is a statement about this moment.
    const online = ref(navigator.onLine)
    const listen = () => {
      online.value = navigator.onLine
    }
    onMounted(() => {
      window.addEventListener('online', listen)
      window.addEventListener('offline', listen)
      // The server is asked every time the sheet opens: the trip in memory is for when it cannot
      // be asked, not instead of asking — finished or started anew on another device, it would
      // otherwise take purchases for ever (review Р-2). A failure keeps the memory (В-6).
      trips.load().catch(() => undefined)
    })
    onUnmounted(() => {
      window.removeEventListener('online', listen)
      window.removeEventListener('offline', listen)
    })

    let done = false
    const sheet = ref<{ close: (steps?: number) => void } | null>(null)

    function close(steps: number): void {
      // `close(2)` is the sheet's own: the screen under it goes along in the same step back, and
      // the sheet tells `open` itself once the pop lands.
      if (steps > 1 && sheet.value) sheet.value.close(steps)
      else open.value = false
    }

    function focus(field: DetailsField): void {
      form.value?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus()
    }

    function submit(): void {
      if (done || !tripId.value) return
      const wrong = details.validate()
      if (wrong) {
        focus(wrong)
        return
      }
      done = true

      if (props.expense) {
        const patch = details.patch()
        if (patch) {
          queue.enqueue({
            kind: 'update',
            tripId: tripId.value,
            expenseId: props.expense.id,
            patch,
          })
          emit('saved')
        }
        close(props.closeSteps)
        return
      }

      queue.enqueue({
        kind: 'add',
        tripId: tripId.value,
        body: details.body(props.query),
        entry: props.entry,
      })
      emit('added', props.entry)
      close(props.closeSteps)
    }

    function remove(): void {
      if (done || !tripId.value || !props.expense) return
      done = true
      queue.enqueue({ kind: 'remove', tripId: tripId.value, expenseId: props.expense.id })
      emit('removed')
      close(props.closeSteps)
    }

    function leave(): void {
      close(props.closeSteps)
    }

    return {
      t,
      open,
      form,
      sheet,
      quantity: details.quantity,
      unit: details.unit,
      amount: details.amount,
      currency: details.currency,
      errors: details.errors,
      leaveField: details.leave,
      units,
      currencies,
      perUnit,
      converted,
      online,
      tripId,
      editing,
      submit,
      remove,
      leave,
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: var(--space-3);
  align-items: start;
}

.currency {
  position: relative;
  display: flex;
  align-items: center;
}

.currency-select {
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  padding: 0 var(--space-4) 0 var(--space-1);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  appearance: none;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

.currency-caret {
  position: absolute;
  right: 0;
  pointer-events: none;
}

.per-unit {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--good-tint);
  color: var(--good-ink);
}

.per-unit-label {
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.per-unit-value {
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.caption {
  margin: calc(var(--space-2) * -1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
}

.note::before {
  content: ' · ';
}

.offline {
  margin: 0;
  text-align: center;
  font-size: var(--text-footnote);
}

.no-trip {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--accent-tint);
  color: var(--accent-ink);
  font-weight: var(--weight-medium);
}
</style>
