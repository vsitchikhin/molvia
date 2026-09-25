<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{
      t(editing ? 'exchange.sheet.title_amend' : 'exchange.sheet.title')
    }}</template>
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

      <div v-if="showsHeld">
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

      <AppField
        v-model="note"
        :label="t('exchange.sheet.note')"
        :placeholder="t('exchange.sheet.note_placeholder')"
        :error-text="noteInvalid ? t('exchange.sheet.bad_note') : null"
        :maxlength="noteMax"
        enterkeyhint="done"
      />

      <!-- What the exchange said before: the rate of a past exchange is a fact, and the trace is
           what explains a trip that took another rate (MOL-42, В-3). -->
      <section v-if="editing && editing.history.length > 0" class="history">
        <h3 class="caption">{{ t('exchange.sheet.history') }}</h3>
        <ul class="versions">
          <li v-for="version in editing.history" :key="version.replacedAt.getTime()">
            {{ versionOf(version) }}
          </li>
        </ul>
      </section>
    </form>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('exchange.failed') }}</p>
      <!-- The version the other device wrote, here and not only in the list the sheet covers: a
           second «Сохранить» must not go over it unseen (round 2, Л4). -->
      <div v-if="conflict && editing" class="failed" role="alert">
        <p class="conflict">{{ t('exchange.sheet.amend_conflict') }}</p>
        <p class="conflict current">{{ currentOf(editing) }}</p>
      </div>
      <AppButton size="large" block :busy="sending" :disabled="sending" @click="submit">
        {{
          sending
            ? t('exchange.sheet.saving')
            : t(editing ? 'exchange.sheet.save_amend' : 'exchange.sheet.save')
        }}
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
  EXCHANGE_NOTE_MAX,
  currencySchema,
  currencySign,
  decimalFromMinor,
  exchangeNoteSchema,
  formatMoney,
  isPlausibleExchange,
  isRateDay,
  parseMoney,
  yerevanDate,
  yerevanMidnight,
} from '@molvia/model'
import type {
  Currency,
  ErrorCode,
  ExchangeAmendBody,
  ExchangeBody,
  ExchangeView,
  ExchangesResponse,
  Money,
} from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { shown } from '@/composables/useItemDetails'
import { purchaseDay } from '@/days'
import { newId } from '@/ids'

type Side = 'given' | 'received'

/**
 * «Записать обмен» (MOL-40): what was given and what was received, and the day — the rate is the
 * server's to work out. What was held before is asked only where it weighs anything (MOL-42, Р-2).
 *
 * The same sheet amends an exchange (MOL-42, В-3): opened on a row, it starts from what the row
 * says, shows the versions before it, and saves over the version it was opened on.
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
    /** Resolves how it ended: a conflict keeps the sheet open, over the version held now. */
    amend: {
      type: Function as PropType<
        (id: string, body: ExchangeAmendBody) => Promise<'saved' | 'conflict' | 'gone'>
      >,
      required: true,
    },
    /** The exchange being amended, or null for a new one. */
    editing: { type: Object as PropType<ExchangeView | null>, default: null },
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
    const note = ref('')
    const noteInvalid = ref(false)
    const dayError = ref<ErrorCode | null>(null)
    const dayInvalid = ref(false)
    const heldError = ref<ErrorCode | null>(null)
    const sending = ref(false)
    const failed = ref(false)
    const conflict = ref(false)
    let exchangeId = newId()

    // Made afresh at every opening: the last exchange's numbers, or its error, are not this one's.
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const pair = props.overview.pair
        const editing = props.editing
        const typed = (value: Money): string =>
          shown(decimalFromMinor(value), locale.value === 'ru' ? ',' : '.')
        amounts.given = editing ? typed(editing.given) : ''
        amounts.received = editing ? typed(editing.received) : ''
        currencies.given = editing?.given.currency ?? pair?.base ?? 'RUB'
        currencies.received = editing?.received.currency ?? pair?.quote ?? 'AMD'
        amountErrors.given = null
        amountErrors.received = null
        today.value = yerevanDate(new Date())
        day.value = editing?.exchangedOn ?? today.value
        held.value = editing?.heldBefore ? typed(editing.heldBefore) : ''
        note.value = editing?.note ?? ''
        noteInvalid.value = false
        dayError.value = null
        dayInvalid.value = false
        heldError.value = null
        failed.value = false
        conflict.value = false
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

    /**
     * The exchanges into the currency this form receives, newest first — as the server lists them,
     * whatever was given for it: dollars bought drams as roubles did (MOL-42).
     */
    const intoReceived = computed(() =>
      props.overview.exchanges.filter(
        (exchange) =>
          exchange.received.currency === currencies.received && exchange.id !== props.editing?.id,
      ),
    )

    /**
     * Asked only where it weighs anything (MOL-42, Р-2): not for the currency of conversion, which
     * always costs one, and only when that currency already came in by an exchange on or before
     * the chosen day that the wallet counts — before the day the currency of conversion changed,
     * only one paid in the new currency (round 2, Л1). The chain is walked by days, not by the order of
     * entry, so an earlier day entered second is the first link, whose remainder is ignored
     * (review С-3). A choice of field, not a computation: the list is the server's.
     */
    const asksHeld = computed(() => {
      const { pair, baseSince } = props.overview
      return (
        !!pair &&
        currencies.received !== pair.base &&
        intoReceived.value.some(
          ({ exchangedOn, given }) =>
            exchangedOn <= day.value &&
            (baseSince === null || exchangedOn >= baseSince || given.currency === pair.base),
        )
      )
    })

    /**
     * An amendment replaces the exchange whole, and a field not sent is cleared: so a remainder
     * the exchange already has is shown, whatever `asksHeld` says, for as long as the received
     * currency is the one it was said in. What is sent is what is seen (review С-2, Ж4).
     */
    const showsHeld = computed(
      () =>
        asksHeld.value ||
        (!!props.editing?.heldBefore && currencies.received === props.editing.received.currency),
    )

    /**
     * The hint is about the latest exchange, so it fits only a day not before it — and never an
     * amendment, whose exchange may be that latest one itself.
     */
    const estimate = computed(() => {
      if (props.editing) return null
      const hint = props.overview.heldEstimates.find(
        ({ held }) => held.currency === currencies.received,
      )
      const latest = intoReceived.value.at(0)?.exchangedOn
      if (!hint || !asksHeld.value || (latest !== undefined && day.value < latest)) return null
      const amount = formatMoney(hint.held, locale.value)
      return hint.whole
        ? t('exchange.sheet.held_estimate', { amount })
        : t('exchange.sheet.held_estimate_last', { amount })
    })

    /** «до 25 сент.: 20 000,00 ₽ → 100 000,00 ֏ · 16 сент. · ВТБ банкомат» */
    function versionOf(version: ExchangeView['history'][number]): string {
      const words = {
        until: purchaseDay(version.replacedAt, locale.value),
        amounts: t('exchange.row_amounts', {
          given: formatMoney(version.given, locale.value),
          received: formatMoney(version.received, locale.value),
        }),
        date: purchaseDay(yerevanMidnight(version.exchangedOn), locale.value),
      }
      return version.note
        ? t('exchange.sheet.version_note', { ...words, note: version.note })
        : t('exchange.sheet.version', words)
    }

    /** «Сейчас записано: 21 000,00 ₽ → 99 000,00 ֏ · 16 сент. · ВТБ банкомат» */
    function currentOf(exchange: ExchangeView): string {
      const words = {
        amounts: t('exchange.row_amounts', {
          given: formatMoney(exchange.given, locale.value),
          received: formatMoney(exchange.received, locale.value),
        }),
        date: purchaseDay(yerevanMidnight(exchange.exchangedOn), locale.value),
      }
      return exchange.note
        ? t('exchange.sheet.current_note', { ...words, note: exchange.note })
        : t('exchange.sheet.current', words)
    }

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
        showsHeld.value && held.value.trim() ? money(held.value, currencies.received) : null
      if (showsHeld.value && held.value.trim() && !heldBefore) {
        heldError.value = ERROR.INVALID_AMOUNT
      }
      // Empty is «no note»; anything typed must be a line the server keeps (MOL-42, В-4).
      const typedNote = note.value.trim() ? exchangeNoteSchema.safeParse(note.value) : null
      noteInvalid.value = typedNote !== null && !typedNote.success
      if (!given || !received || amountErrors.given || amountErrors.received) return
      // Amounts no rate in the band says — a zero too many — refused before the connection is
      // asked; the server refuses the same (adversarial А3).
      if (!isPlausibleExchange(given, received)) {
        amountErrors.received = ERROR.INVALID_RATE
        return
      }
      if (sameCurrency.value || heldError.value || dayInvalid.value || noteInvalid.value) return

      const fields = {
        given,
        received,
        exchangedOn: day.value,
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
          // goes over the version the screen now holds (review Ч-2).
          if (outcome === 'conflict') {
            conflict.value = true
            return
          }
        } else {
          await props.record({ id: exchangeId, ...fields })
        }
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
