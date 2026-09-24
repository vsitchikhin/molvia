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
        :max="today"
        :error="dayError"
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
          <template v-if="estimate">
            <br />{{ t('exchange.sheet.held_estimate', { amount: estimate }) }}
          </template>
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

    const asksHeld = computed(() => {
      const { pair, wallet } = props.overview
      return (
        !!pair && !!wallet && currencies.given === pair.base && currencies.received === pair.quote
      )
    })

    const estimate = computed(() =>
      props.overview.heldEstimate ? formatMoney(props.overview.heldEstimate, locale.value) : null,
    )

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
      const given = money(amounts.given, currencies.given)
      const received = money(amounts.received, currencies.received)
      amountErrors.given = given && given.minor > 0n ? null : ERROR.INVALID_AMOUNT
      amountErrors.received = received && received.minor > 0n ? null : ERROR.INVALID_AMOUNT
      const heldBefore =
        asksHeld.value && held.value.trim() ? money(held.value, currencies.received) : null
      if (asksHeld.value && held.value.trim() && !heldBefore) heldError.value = ERROR.INVALID_AMOUNT
      if (!given || !received || amountErrors.given || amountErrors.received) return
      if (sameCurrency.value || heldError.value) return

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
