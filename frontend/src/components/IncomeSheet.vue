<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t(editing ? 'income.sheet.title_amend' : 'income.sheet.title') }}</template>
    <template #meta>{{ t('income.sheet.meta') }}</template>

    <form class="form" @submit.prevent="submit">
      <div class="pair">
        <AppField
          v-model="amount"
          :label="t('income.sheet.amount')"
          kind="decimal"
          :error="amountError"
          enterkeyhint="next"
        />
        <AppField
          v-model="currency"
          :label="t('income.sheet.currency')"
          kind="select"
          :options="currencyOptions"
        />
      </div>
      <!-- Money bought with the currency of conversion has a price the person knows: written as
           an exchange, the rate counts by it rather than by the bank (MOL-66, Р-6). -->
      <p v-if="currency !== overview.base" class="hint">
        {{ t('income.sheet.bought_hint', { base: sign(overview.base) }) }}
      </p>

      <AppField
        v-model="source"
        :label="t('income.sheet.source')"
        kind="select"
        :options="sourceOptions"
        :placeholder="t('income.sheet.source_placeholder')"
        :error-text="sourceMissing ? t('income.sheet.no_source') : null"
      />

      <AppField
        v-model="day"
        :label="t('income.sheet.day')"
        kind="date"
        min="2000-01-02"
        :max="today"
        :error="dayError"
        :error-text="dayInvalid ? t('income.sheet.bad_day') : null"
      />

      <div v-if="showsHeld">
        <AppField
          v-model="held"
          :label="t('income.sheet.held', { currency: sign(currency) })"
          kind="decimal"
          :error="heldError"
          :aria-describedby="`${id}-held`"
        />
        <p :id="`${id}-held`" class="hint">
          {{ t('income.sheet.held_hint') }}
          <template v-if="estimate"> <br />{{ estimate }} </template>
        </p>
      </div>

      <AppField
        v-model="note"
        :label="t('income.sheet.note')"
        :placeholder="t('income.sheet.note_placeholder')"
        :error-text="noteInvalid ? t('income.sheet.bad_note') : null"
        :maxlength="noteMax"
        enterkeyhint="done"
      />

      <section v-if="editing && editing.history.length > 0" class="history">
        <h3 class="caption">{{ t('income.sheet.history') }}</h3>
        <ul class="versions">
          <li v-for="version in editing.history" :key="version.replacedAt.getTime()">
            {{ versionOf(version) }}
          </li>
        </ul>
      </section>
    </form>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('income.failed') }}</p>
      <div v-if="conflict && editing" class="failed" role="alert">
        <p class="conflict">{{ t('income.sheet.amend_conflict') }}</p>
        <p class="conflict current">{{ currentOf(editing) }}</p>
      </div>
      <AppButton size="large" block :busy="sending" :disabled="sending" @click="submit">
        {{
          sending
            ? t('income.sheet.saving')
            : t(editing ? 'income.sheet.save_amend' : 'income.sheet.save')
        }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  EXCHANGE_NOTE_MAX,
  currencySchema,
  currencySign,
  decimalFromMinor,
  exchangeNoteSchema,
  formatMoney,
  incomeSourceSchema,
  isRateDay,
  parseMoney,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type {
  Currency,
  ErrorCode,
  IncomeAmendBody,
  IncomeBody,
  IncomeSource,
  IncomeView,
  IncomesResponse,
  Money,
} from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import type { AmendOutcome } from '@/composables/useExchanges'
import { shown } from '@/composables/useItemDetails'
import { purchaseDay } from '@/days'
import { newId } from '@/ids'

/**
 * «Записать доход» (MOL-66): how much came in, in which currency, from where and on which day. What
 * was held before is asked only where it weighs anything — a currency other than the one of
 * conversion that already has a price that day (В-1, as Р-2 of MOL-42 for an exchange).
 *
 * The same sheet amends an income: opened on a row, it starts from what the row says, shows the
 * versions before it and saves over the version it was opened on. Not through a queue: an income
 * is written with a connection, and the identifier is made once per opening, so «Сохранить» again
 * after a failure is the same income.
 */
export default defineComponent({
  name: 'IncomeSheet',
  components: { AppButton, AppField, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    overview: { type: Object as PropType<IncomesResponse>, required: true },
    record: {
      type: Function as PropType<(body: IncomeBody) => Promise<unknown>>,
      required: true,
    },
    amend: {
      type: Function as PropType<(id: string, body: IncomeAmendBody) => Promise<AmendOutcome>>,
      required: true,
    },
    /** The income being amended, or null for a new one. */
    editing: { type: Object as PropType<IncomeView | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const id = useId()

    const amount = ref('')
    const currency = ref<Currency>('RUB')
    const source = ref<IncomeSource | ''>('')
    const amountError = ref<ErrorCode | null>(null)
    const sourceMissing = ref(false)
    const today = ref(yerevanDate(new Date()))
    const day = ref(today.value)
    const held = ref('')
    const note = ref('')
    const noteInvalid = ref(false)
    const dayError = ref<ErrorCode | null>(null)
    const dayInvalid = ref(false)
    const heldError = ref<ErrorCode | null>(null)
    const sending = ref(false)
    const failed = ref(false)
    const conflict = ref(false)
    let incomeId = newId()

    const typed = (value: Money): string =>
      shown(decimalFromMinor(value), locale.value === 'ru' ? ',' : '.')

    // Made afresh at every opening: the last income's numbers, or its error, are not this one's.
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const editing = props.editing
        amount.value = editing ? typed(editing.amount) : ''
        // Most money comes in the currency it is counted in — the salary of the owner does.
        currency.value = editing?.amount.currency ?? props.overview.base
        source.value = editing?.source ?? ''
        amountError.value = null
        sourceMissing.value = false
        today.value = yerevanDate(new Date())
        day.value = editing?.receivedOn ?? today.value
        held.value = editing?.heldBefore ? typed(editing.heldBefore) : ''
        note.value = editing?.note ?? ''
        noteInvalid.value = false
        dayError.value = null
        dayInvalid.value = false
        heldError.value = null
        failed.value = false
        conflict.value = false
        incomeId = newId()
      },
      { immediate: true },
    )

    const currencyOptions = currencySchema.options.map((value) => ({
      value,
      label: `${currencySign(value, locale.value)} ${value}`,
    }))
    const sourceOptions = computed(() =>
      incomeSourceSchema.options.map((value) => ({
        value,
        label: t(`income.source.${value}`),
      })),
    )
    const sign = (value: Currency) => currencySign(value, locale.value)

    /** The money into `currency`, exchanges and incomes, newest first — this income aside. */
    const into = (value: Currency) =>
      props.overview.receipts.filter(
        (receipt) => receipt.currency === value && receipt.id !== props.editing?.id,
      )

    /**
     * Asked only where it weighs anything (MOL-66, В-1): the income is not in the currency of
     * conversion, which always costs one; that currency already has a price on the chosen day —
     * the latest money into it gave one (`priced`, from the server's walk); and the bank may value
     * this income — on or after the day the currency of conversion was chosen, since before it the
     * bank is never asked. A choice of field, not a computation: the flags are the server's.
     */
    const asksHeld = computed(() => {
      const { base, baseSince } = props.overview
      if (currency.value === base) return false
      if (!into(currency.value).find(({ on }) => on <= day.value)?.priced) return false
      return baseSince === null || day.value >= baseSince
    })

    /** The hint is about the latest money in, so it fits only a day not before it. */
    const estimate = computed(() => {
      if (props.editing) return null
      const hint = props.overview.heldEstimates.find(({ held }) => held.currency === currency.value)
      const latest = into(currency.value).at(0)?.on
      if (!hint || !asksHeld.value || (latest !== undefined && day.value < latest)) return null
      const value = formatMoney(hint.held, locale.value)
      if (hint.whole) return t('exchange.sheet.held_estimate', { amount: value })
      return t(
        hint.from === 'income'
          ? 'exchange.sheet.held_estimate_last_income'
          : 'exchange.sheet.held_estimate_last',
        { amount: value },
      )
    })

    /** A remainder the income already has is shown and kept while its currency is the one. */
    const showsHeld = computed(
      () =>
        asksHeld.value ||
        (!!props.editing?.heldBefore && currency.value === props.editing.amount.currency),
    )

    /** «до 25 сент.: 99 615,00 ₽ · Зарплата · 15 сент. · Викаса» */
    function versionOf(version: IncomeView['history'][number]): string {
      const words = {
        until: purchaseDay(version.replacedAt, locale.value),
        amount: formatMoney(version.amount, locale.value),
        source: t(`income.source.${version.source}`),
        date: purchaseDay(yerevanMidnight(version.receivedOn), locale.value),
      }
      return version.note
        ? t('income.sheet.version_note', { ...words, note: version.note })
        : t('income.sheet.version', words)
    }

    /** «Сейчас записано: 99 615,00 ₽ · Зарплата · 15 сент. · было до поступления … · Викаса» */
    function currentOf(income: IncomeView): string {
      const details = [
        formatMoney(income.amount, locale.value),
        t(`income.source.${income.source}`),
        purchaseDay(yerevanMidnight(income.receivedOn), locale.value),
        ...(income.heldBefore
          ? [
              t('income.sheet.current_held', {
                amount: formatMoney(income.heldBefore, locale.value),
              }),
            ]
          : []),
        ...(income.note ? [income.note] : []),
      ]
      return t('income.sheet.current', { details: details.join(' · ') })
    }

    /** UX only: the server reads the same codecs and has the last word (CLAUDE.md). */
    function money(text: string, value: Currency): Money | null {
      try {
        return parseMoney(text, value)
      } catch {
        return null
      }
    }

    async function submit(): Promise<void> {
      if (sending.value) return
      failed.value = false
      dayError.value = null
      heldError.value = null
      dayInvalid.value = !isRateDay(day.value)
      const parsed = money(amount.value, currency.value)
      amountError.value = parsed && parsed.minor > 0n ? null : ERROR.INVALID_AMOUNT
      const chosen = source.value
      sourceMissing.value = chosen === ''
      const heldBefore =
        showsHeld.value && held.value.trim() ? money(held.value, currency.value) : null
      if (showsHeld.value && held.value.trim() && !heldBefore) {
        heldError.value = ERROR.INVALID_AMOUNT
      }
      const typedNote = note.value.trim() ? exchangeNoteSchema.safeParse(note.value) : null
      noteInvalid.value = typedNote !== null && !typedNote.success
      if (!parsed || amountError.value || chosen === '') return
      if (heldError.value || dayInvalid.value || noteInvalid.value) return

      const fields = {
        amount: parsed,
        receivedOn: day.value,
        source: chosen,
        ...(heldBefore ? { heldBefore } : {}),
        ...(typedNote?.success ? { note: typedNote.data } : {}),
      }
      sending.value = true
      conflict.value = false
      try {
        const editing = props.editing
        if (editing) {
          const outcome = await props.amend(editing.id, { revision: editing.revision, ...fields })
          // Made over a version that moved on: what was typed stays, and the next «Сохранить»
          // goes over the version the screen now holds.
          if (outcome === 'conflict') {
            conflict.value = true
            return
          }
        } else {
          await props.record({ id: incomeId, ...fields })
        }
        emit('update:open', false)
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === ERROR.INCOME_IN_FUTURE) {
          dayError.value = ERROR.INCOME_IN_FUTURE
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
      amount,
      currency,
      source,
      amountError,
      sourceMissing,
      currencyOptions,
      sourceOptions,
      sign,
      today,
      day,
      dayError,
      dayInvalid,
      held,
      heldError,
      note,
      noteInvalid,
      noteMax: EXCHANGE_NOTE_MAX,
      versionOf,
      currentOf,
      asksHeld,
      showsHeld,
      estimate,
      conflict,
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

.caption {
  margin: 0 0 var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.versions {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0 0 0 var(--space-3);
  border-left: var(--hairline) solid var(--border-strong);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  list-style: none;
}

.conflict {
  margin: 0;
}

.current {
  margin-top: var(--space-1);
  font-weight: var(--weight-medium);
}

.failed {
  margin: 0 0 var(--space-3);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}
</style>
