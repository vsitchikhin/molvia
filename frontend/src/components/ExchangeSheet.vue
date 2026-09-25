<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('exchange.sheet.title') }}</template>
    <template #meta>{{ t('exchange.sheet.meta') }}</template>

    <form class="form" @submit.prevent="submit">
      <div v-for="side in sides" :key="side" class="pair">
        <AppField
          v-model="amounts[side]"
          :label="t(`exchange.sheet.${side}`)"
          kind="decimal"
          :error="amountErrors[side]"
          enterkeyhint="next"
        />
        <AppField
          v-model="currencies[side]"
          :label="t('exchange.sheet.currency')"
          kind="select"
          :options="currencyOptions"
          :error-text="
            side === 'received' && sameCurrency ? t('exchange.sheet.same_currency') : null
          "
        />
      </div>

      <AppField
        v-model="day"
        :label="t('exchange.sheet.day')"
        kind="date"
        min="2000-01-02"
        :max="today"
        :error="dayError"
        :error-text="dayInvalid ? t('exchange.sheet.bad_day') : null"
      />

      <div v-if="asksHeld">
        <AppField
          v-model="held"
          :label="t('exchange.sheet.held', { currency: sign(currencies.received) })"
          kind="decimal"
          :error="heldError"
          :aria-describedby="`${id}-held`"
        />
        <p :id="`${id}-held`" class="hint">
          {{ t('exchange.sheet.held_hint') }}
          <template v-if="estimate"> <br />{{ estimate }} </template>
        </p>
      </div>
    </form>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('exchange.failed') }}</p>
      <AppButton size="large" block :busy="sending" :disabled="sending" @click="submit">
        {{ sending ? t('exchange.sheet.saving') : t('exchange.sheet.save') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  currencySchema,
  currencySign,
  formatMoney,
  isPlausibleExchange,
  isRateDay,
  parseMoney,
  yerevanDate,
} from '@molvia/model'
import type { Currency, ErrorCode, ExchangeBody, ExchangesResponse, Money } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { newId } from '@/ids'

type Side = 'given' | 'received'

/**
 * «Записать обмен» (MOL-40): what was given and what was received, and the day — the rate is the
 * server's to work out. What was held before is asked only where it weighs anything: from the
 * second exchange of the pair the trips convert by (plan, Р-2).
 *
 * Not through a queue: an exchange is made at the exchanger, with a connection, and the person is
 * looking at the answer (Р-3). The identifier is made once per opening, so pressing «Сохранить»
 * again after a failure is the same exchange, never a second one.
 */
export default defineComponent({
  name: 'ExchangeSheet',
  components: { AppButton, AppField, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    overview: { type: Object as PropType<ExchangesResponse>, required: true },
    /** The write itself, bound by the screen: it lands the answer on the screen it came from. */
    record: {
      type: Function as PropType<(body: ExchangeBody) => Promise<unknown>>,
      required: true,
    },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const id = useId()
    const sides: readonly Side[] = ['given', 'received']

    const amounts = reactive<Record<Side, string>>({ given: '', received: '' })
    const currencies = reactive<Record<Side, Currency>>({ given: 'RUB', received: 'AMD' })
    const amountErrors = reactive<Record<Side, ErrorCode | null>>({ given: null, received: null })
    const today = ref(yerevanDate(new Date()))
    const day = ref(today.value)
    const held = ref('')
    const dayError = ref<ErrorCode | null>(null)
    const dayInvalid = ref(false)
    const heldError = ref<ErrorCode | null>(null)
    const sending = ref(false)
    const failed = ref(false)
    let exchangeId = newId()

    // Made afresh at every opening: the last exchange's numbers, or its error, are not this one's.
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const pair = props.overview.pair
        amounts.given = ''
        amounts.received = ''
        currencies.given = pair?.base ?? 'RUB'
        currencies.received = pair?.quote ?? 'AMD'
        amountErrors.given = null
        amountErrors.received = null
        today.value = yerevanDate(new Date())
        day.value = today.value
        held.value = ''
        dayError.value = null
        dayInvalid.value = false
        heldError.value = null
        failed.value = false
        exchangeId = newId()
      },
      { immediate: true },
    )

    const currencyOptions = currencySchema.options.map((currency) => ({
      value: currency,
      label: `${currencySign(currency, locale.value)} ${currency}`,
    }))

    const sign = (currency: Currency) => currencySign(currency, locale.value)
    const sameCurrency = computed(() => currencies.given === currencies.received)

    /** The exchanges of the pair this form is about, newest first — as the server lists them. */
    const ofPair = computed(() =>
      props.overview.exchanges.filter(
        (exchange) =>
          exchange.given.currency === currencies.given &&
          exchange.received.currency === currencies.received,
      ),
    )

    /**
     * Asked only where it weighs anything: when the wallet already has an exchange of this pair on
     * or before the chosen day — the chain is walked by days, not by the order of entry, and an
     * earlier day entered second is the first link, whose remainder is ignored (review С-3). A
     * choice of field, not a computation: the list is the server's.
     */
    const asksHeld = computed(() => {
      const { pair } = props.overview
      return (
        !!pair &&
        currencies.given === pair.base &&
        currencies.received === pair.quote &&
        ofPair.value.some((exchange) => exchange.exchangedOn <= day.value)
      )
    })

    /** The hint is about the latest exchange, so it fits only a day not before it. */
    const estimate = computed(() => {
      const hint = props.overview.heldEstimate
      const latest = ofPair.value.at(0)?.exchangedOn
      if (!hint || !asksHeld.value || (latest !== undefined && day.value < latest)) return null
      const amount = formatMoney(hint.held, locale.value)
      return hint.whole
        ? t('exchange.sheet.held_estimate', { amount })
        : t('exchange.sheet.held_estimate_last', { amount })
    })

    /** UX only: the server reads the same codecs and has the last word (CLAUDE.md). */
    function money(text: string, currency: Currency): Money | null {
      try {
        return parseMoney(text, currency)
      } catch {
        return null
      }
    }

    async function submit(): Promise<void> {
      if (sending.value) return
      failed.value = false
      dayError.value = null
      heldError.value = null
      // Cleared, or before the year the rates begin: said under the field, not as a lost
      // connection (adversarial Б2).
      dayInvalid.value = !isRateDay(day.value)
      const given = money(amounts.given, currencies.given)
      const received = money(amounts.received, currencies.received)
      amountErrors.given = given && given.minor > 0n ? null : ERROR.INVALID_AMOUNT
      amountErrors.received = received && received.minor > 0n ? null : ERROR.INVALID_AMOUNT
      const heldBefore =
        asksHeld.value && held.value.trim() ? money(held.value, currencies.received) : null
      if (asksHeld.value && held.value.trim() && !heldBefore) heldError.value = ERROR.INVALID_AMOUNT
      if (!given || !received || amountErrors.given || amountErrors.received) return
      // Amounts no rate in the band says — a zero too many — refused before the connection is
      // asked; the server refuses the same (adversarial А3).
      if (!isPlausibleExchange(given, received)) {
        amountErrors.received = ERROR.INVALID_RATE
        return
      }
      if (sameCurrency.value || heldError.value || dayInvalid.value) return

      sending.value = true
      try {
        await props.record({
          id: exchangeId,
          given,
          received,
          exchangedOn: day.value,
          ...(heldBefore ? { heldBefore } : {}),
        })
        emit('update:open', false)
      } catch (caught) {
        // The refusals a person can answer stay under their field; anything else is said once.
        if (caught instanceof ApiError && caught.code === ERROR.EXCHANGE_IN_FUTURE) {
          dayError.value = ERROR.EXCHANGE_IN_FUTURE
        } else if (caught instanceof ApiError && caught.code === ERROR.INVALID_RATE) {
          amountErrors.received = ERROR.INVALID_RATE
        } else {
          failed.value = true
        }
      } finally {
        sending.value = false
      }
    }

    return {
      t,
      id,
      sides,
      amounts,
      currencies,
      amountErrors,
      currencyOptions,
      sameCurrency,
      sign,
      today,
      day,
      dayError,
      dayInvalid,
      held,
      heldError,
      asksHeld,
      estimate,
      sending,
      failed,
      submit,
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--space-3);
}

.hint {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.failed {
  margin: 0 0 var(--space-3);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}
</style>
