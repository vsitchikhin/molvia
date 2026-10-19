<template>
  <BottomSheet :open="open" :back="back" @update:open="$emit('update:open', $event)">
    <template #title>{{
      t(editing ? 'exchange.sheet.title_amend' : 'exchange.sheet.title')
    }}</template>
    <template #meta>{{ t('exchange.sheet.meta') }}</template>

    <!-- First in the sheet (MOL-181). An amendment opens without a connection (MOL-189, С-19): what
         waits for it is said once here, and the buttons say it on themselves. From an account's
         journal there is no removing (В-1 «а»), and the words name only the amendment. -->
    <StatusStrip
      v-if="waiting"
      class="status"
      kind="offline"
      :text="t(removable ? 'exchange.sheet.offline' : 'exchange.sheet.offline_amend')"
    />
    <!-- The list read again after a conflict did not come (MOL-187 №8): «Повторить» of the screen is
         under this sheet, so the sheet has its own. -->
    <StatusStrip
      v-else-if="conflict && stale"
      class="status"
      kind="unanswered"
      :text="t('exchange.sheet.unanswered')"
      :attempt="attempt"
    >
      <template #action>
        <AppButton variant="ghost" @click="$emit('retry')">{{ t('state.retry') }}</AppButton>
      </template>
    </StatusStrip>

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
        <!-- The account of this side, under its own pair; only accounts of its currency (06). -->
        <AccountRow
          v-if="showsAccounts"
          class="side-account"
          :label="
            t(side === 'given' ? 'accounts.picker.row_given' : 'accounts.picker.row_received')
          "
          :account="sideAccount[side]"
          @open="openPicker(side)"
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

      <!-- How the money was changed, optional (MOL-137, В-1): the card then also says how this
           exchange stood against its own channel, not only against the best of the day. -->
      <SegmentedControl
        v-model="channel"
        :options="channelOptions"
        :legend="t('exchange.sheet.channel')"
        fit
      />

      <AppReveal>
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
          <HeldFromAccounts
            :currency="currencies.received"
            :day="day"
            :except="editing?.id ?? null"
            @fill="fillHeld"
          />
        </div>
      </AppReveal>

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
        <SectionCaption as="h3">{{ t('exchange.sheet.history') }}</SectionCaption>
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
      <!-- Read again and not answered — the server or the connection — the version the sheet holds is
           the one from before the conflict: «Сейчас записано» by it would be untrue (MOL-187 №8). -->
      <div v-if="conflict && base" class="failed" role="alert">
        <p class="conflict">
          {{
            behind ? t('exchange.sheet.amend_conflict_stale') : t('exchange.sheet.amend_conflict')
          }}
        </p>
        <p v-if="!behind" class="conflict current">{{ currentOf(base) }}</p>
      </div>
      <AppButton
        size="large"
        block
        :busy="sending"
        :busy-label="t('exchange.sheet.saving')"
        :inactive="waiting || busy"
        @click="submit"
      >
        <template v-if="editing" #icon><IconCheck /></template>
        {{ saveWord }}
      </AppButton>
      <!-- Removing lives here, not on the card (MOL-189, Ф-34) — only where the screen offers
           «Вернуть» after it (owner's В-1 «а»). Not filled: one filled button in a sheet. -->
      <AppButton
        v-if="editing && removable"
        variant="danger-ghost"
        block
        :inactive="waiting || busy || sending"
        @click="askRemove"
      >
        <template #icon><IconDelete /></template>
        {{ waiting ? t('exchange.sheet.remove_offline') : t('exchange.sheet.remove') }}
      </AppButton>
    </template>
  </BottomSheet>
  <AccountPickerSheet
    v-model:open="pickerOpen"
    :title="
      t(pickerSide === 'given' ? 'accounts.picker.row_given' : 'accounts.picker.row_received')
    "
    :accounts="accounts.accounts"
    :currency="currencies[pickerSide]"
    strict
    :selected="sideId[pickerSide]"
    @pick="pickSide"
  />
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref, toRef, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  EXCHANGE_NOTE_MAX,
  currencySchema,
  currencySign,
  decimalFromMinor,
  exchangeChannelSchema,
  exchangeNoteSchema,
  formatMoney,
  isPlausibleExchange,
  isRateDay,
  parseMoney,
} from '@molvia/model'
import type {
  Currency,
  ErrorCode,
  ExchangeAmendBody,
  ExchangeChannel,
  ExchangeBody,
  ExchangeView,
  ExchangesResponse,
  Money,
} from '@molvia/model'
import IconCheck from '~icons/mdi/check'
import IconDelete from '~icons/mdi/trash-can-outline'
import AccountPickerSheet from '@/components/AccountPickerSheet.vue'
import AccountRow from '@/components/AccountRow.vue'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import HeldFromAccounts from '@/components/HeldFromAccounts.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import { useAccountChoice } from '@/composables/useAccountChoice'
import { useOnline } from '@/composables/useOnline'
import { useAccountsStore } from '@/stores/accounts'
import { shown } from '@/composables/useItemDetails'
import { calendarDay, localDay, purchaseDay } from '@/days'
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
  components: {
    AccountPickerSheet,
    AccountRow,
    AppButton,
    AppField,
    AppReveal,
    BottomSheet,
    HeldFromAccounts,
    IconCheck,
    IconDelete,
    SectionCaption,
    SegmentedControl,
    StatusStrip,
  },
  props: {
    open: { type: Boolean, required: true },
    /** Opened over another sheet — a check, «не попали» (MOL-123): «‹» back to it, no ×. */
    back: { type: Boolean, default: false },
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
    /** The screen offers «Вернуть» after a removal, so the amendment may offer removing (В-1 «а»). */
    removable: { type: Boolean, default: false },
    /** A write of the screen in the air — a removal, «Вернуть»: the buttons wait for it (Р-3). */
    busy: { type: Boolean, default: false },
    /** The list read again failed, the server or the connection: it is the one from before. */
    behind: { type: Boolean, default: false },
    /** …and the connection is up: the server did not answer, and «Повторить» may help. */
    stale: { type: Boolean, default: false },
    /** Reads that failed so far: a new one says the strip's same words again (MOL-181, C1). */
    attempt: { type: Number, default: 0 },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** «Удалить обмен» — the exchange as the server holds it, to ask «Удалить обмен?» over. */
    remove: (exchange: ExchangeView) => typeof exchange === 'object',
    retry: () => true,
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const id = useId()
    const sides: readonly Side[] = ['given', 'received']

    const amounts = reactive<Record<Side, string>>({ given: '', received: '' })
    const currencies = reactive<Record<Side, Currency>>({ given: 'RUB', received: 'AMD' })
    const amountErrors = reactive<Record<Side, ErrorCode | null>>({ given: null, received: null })
    const today = ref(localDay())
    const day = ref(today.value)
    const held = ref('')
    const note = ref('')
    const noteInvalid = ref(false)
    // '' is «не указано»: a radio cannot be unchecked, so «not said» is a segment of its own.
    const channel = ref<ExchangeChannel | ''>('')
    const dayError = ref<ErrorCode | null>(null)
    const dayInvalid = ref(false)
    const heldError = ref<ErrorCode | null>(null)
    const sending = ref(false)
    const failed = ref(false)
    const conflict = ref(false)
    /**
     * A conflict was met at this opening: from then on the version is the list's, whatever the next
     * «Сохранить» met — a refusal under a field, an answer lost — until the sheet opens again. Let go
     * with `conflict`, the words, a refused save went back over the version opened (MOL-189 №1).
     */
    const rebased = ref(false)
    let exchangeId = newId()
    const online = useOnline()
    /**
     * An amendment waits for the connection, and says so (MOL-189, С-19, Ф-6) — never while it is at
     * work: a line that drops while the write hangs is not «not now» (MOL-225, Р1-А3). A new exchange
     * is never opened offline, and is left as it was.
     */
    const waiting = computed(() => !!props.editing && !online.value && !sending.value)
    /**
     * The version an amendment goes over: the one opened, and after a conflict the one the list now
     * holds — which, read again and not answered, is still the old one, and `behind` says so (MOL-187
     * №8, MOL-188 №5). Followed here, so the screens and the journal's sheets need not.
     */
    const base = computed(() => {
      const editing = props.editing
      if (!editing || !rebased.value) return editing
      return props.overview.exchanges.find((row) => row.id === editing.id) ?? editing
    })
    const saveWord = computed(() => {
      if (waiting.value) return t('exchange.sheet.save_offline')
      return t(props.editing ? 'exchange.sheet.save_amend' : 'exchange.sheet.save')
    })
    function askRemove(): void {
      if (base.value) emit('remove', base.value)
    }
    const accounts = useAccountsStore()
    const givenChoice = useAccountChoice(toRef(currencies, 'given'), true)
    const receivedChoice = useAccountChoice(toRef(currencies, 'received'), true)
    const choices = { given: givenChoice, received: receivedChoice }
    const pickerOpen = ref(false)
    const pickerSide = ref<Side>('given')
    const showsAccounts = computed(() => givenChoice.shows.value || receivedChoice.shows.value)
    const sideAccount = computed(() => ({
      given: givenChoice.account.value,
      received: receivedChoice.account.value,
    }))
    const sideId = computed(() => ({
      given: givenChoice.accountId.value,
      received: receivedChoice.accountId.value,
    }))
    function openPicker(side: Side): void {
      pickerSide.value = side
      pickerOpen.value = true
    }
    function pickSide(id: string | null): void {
      choices[pickerSide.value].pick(id)
    }

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
        today.value = localDay()
        day.value = editing?.exchangedOn ?? today.value
        held.value = editing?.heldBefore ? typed(editing.heldBefore) : ''
        note.value = editing?.note ?? ''
        // A new exchange starts from the way the last one was made: usually no tap at all.
        channel.value = (editing ? editing.channel : props.overview.exchanges[0]?.channel) ?? ''
        noteInvalid.value = false
        dayError.value = null
        dayInvalid.value = false
        heldError.value = null
        failed.value = false
        conflict.value = false
        rebased.value = false
        exchangeId = newId()
        pickerOpen.value = false
        givenChoice.reset(editing ? editing.givenAccountId : undefined)
        receivedChoice.reset(editing ? editing.receivedAccountId : undefined)
      },
      { immediate: true },
    )

    function fillHeld(value: Money): void {
      held.value = shown(decimalFromMinor(value), locale.value === 'ru' ? ',' : '.')
    }

    const currencyOptions = currencySchema.options.map((currency) => ({
      value: currency,
      label: `${currencySign(currency, locale.value)} ${currency}`,
    }))

    const channelOptions = computed(() => [
      { value: '', label: '—', spoken: t('exchange.sheet.channel_none') },
      ...exchangeChannelSchema.options.map((value) => ({
        value,
        label: t(`exchange.sheet.channel_${value}`),
      })),
    ])

    const sign = (currency: Currency) => currencySign(currency, locale.value)
    const sameCurrency = computed(() => currencies.given === currencies.received)

    /**
     * The money into `currency`, exchanges and incomes alike (MOL-66), newest first — as the server
     * lists it — this exchange aside.
     */
    const into = (currency: Currency) =>
      props.overview.receipts.filter(
        (receipt) => receipt.currency === currency && receipt.id !== props.editing?.id,
      )

    /** Whether `currency` has a price on the chosen day: the latest money into it gave one. */
    const hasPrice = (currency: Currency): boolean =>
      !!into(currency).find(({ on }) => on <= day.value)?.priced

    /**
     * Asked only where it weighs anything (MOL-42, Р-2), and that takes two things (round 5, О1):
     *
     * - the received currency *has* a price on the chosen day — the latest exchange or income into
     *   it on or before that day gave it one (`priced`, from the server's walk: a chain made before a change
     *   of the currency of conversion does, a link of the old reckoning does not; round 3, П-1, М1;
     *   round 4, Н2) — and is not the currency of conversion, which always costs one;
     * - this exchange will *give* it one: paid in the currency of conversion, or in a currency with a
     *   price that day, or — on or after the day it was chosen — in anything the bank can price.
     *   Before that day the bank is never asked, and a link paid otherwise makes the price unknown:
     *   what was held then weighs nothing. Whether the bank has a fresh rate of that day the phone
     *   cannot know; a week of its silence is the one case left asking in vain.
     *
     * The chain is walked by days, not by the order of entry (review С-3). A choice of field, not a
     * computation: the flags are the server's.
     */
    const asksHeld = computed(() => {
      const { pair, baseSince } = props.overview
      if (!pair || currencies.received === pair.base || !hasPrice(currencies.received)) return false
      return (
        currencies.given === pair.base ||
        hasPrice(currencies.given) ||
        baseSince === null ||
        day.value >= baseSince
      )
    })

    /**
     * The hint is about the latest exchange, so it fits only a day not before it — and never an
     * amendment, whose exchange may be that latest one itself.
     */
    const estimate = computed(() => {
      if (props.editing) return null
      const hint = props.overview.heldEstimates.find(
        ({ held }) => held.currency === currencies.received,
      )
      const latest = into(currencies.received).at(0)?.on
      if (!hint || !asksHeld.value || (latest !== undefined && day.value < latest)) return null
      const amount = formatMoney(hint.held, locale.value)
      if (hint.whole) return t('exchange.sheet.held_estimate', { amount })
      return t(
        hint.from === 'income'
          ? 'exchange.sheet.held_estimate_last_income'
          : 'exchange.sheet.held_estimate_last',
        { amount },
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

    /** «до 25 сент.: 20 000,00 ₽ → 100 000,00 ֏ · 16 сент. · ВТБ банкомат» */
    function versionOf(version: ExchangeView['history'][number]): string {
      const words = {
        until: purchaseDay(version.replacedAt, locale.value),
        amounts: t('exchange.row_amounts', {
          given: formatMoney(version.given, locale.value),
          received: formatMoney(version.received, locale.value),
        }),
        date: calendarDay(version.exchangedOn, locale.value, { day: 'numeric', month: 'short' }),
      }
      // The channel too: changed alone, it made a version that read as the one after it (review).
      const note = [
        ...(version.channel ? [t(`exchange.sheet.channel_${version.channel}`)] : []),
        ...(version.note ? [version.note] : []),
      ].join(' · ')
      return note
        ? t('exchange.sheet.version_note', { ...words, note })
        : t('exchange.sheet.version', words)
    }

    /**
     * «Сейчас записано: 21 000,00 ₽ → 99 000,00 ֏ · 16 сент. · было до обмена 30 000,00 ֏ · ВТБ»
     * — every field an amendment replaces, the remainder too: it moves the rate, and a change of it
     * alone made on the other phone read as «nothing changed» (round 3, М2).
     */
    function currentOf(exchange: ExchangeView): string {
      const details = [
        t('exchange.row_amounts', {
          given: formatMoney(exchange.given, locale.value),
          received: formatMoney(exchange.received, locale.value),
        }),
        calendarDay(exchange.exchangedOn, locale.value, { day: 'numeric', month: 'short' }),
        ...(exchange.heldBefore
          ? [
              t('exchange.sheet.current_held', {
                amount: formatMoney(exchange.heldBefore, locale.value),
              }),
            ]
          : []),
        ...(exchange.channel ? [t(`exchange.sheet.channel_${exchange.channel}`)] : []),
        ...(exchange.note ? [exchange.note] : []),
      ]
      return t('exchange.sheet.current', { details: details.join(' · ') })
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
      // The field's «done» submits the form too, past the button that is not now.
      if (sending.value || waiting.value || props.busy) return
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
        channel: channel.value === '' ? null : channel.value,
        // Said whenever there are accounts: left out, the server keeps the ones it has (Р-26).
        ...(showsAccounts.value
          ? {
              givenAccountId: givenChoice.accountId.value,
              receivedAccountId: receivedChoice.accountId.value,
            }
          : {}),
      }
      // After a conflict, the version the list now holds.
      const editing = base.value
      sending.value = true
      conflict.value = false
      try {
        if (editing) {
          const outcome = await props.amend(editing.id, { revision: editing.revision, ...fields })
          // Made over a version that moved on: what was typed stays, and the next «Сохранить»
          // goes over the version the screen now holds (review Ч-2).
          if (outcome === 'conflict') {
            conflict.value = true
            rebased.value = true
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
      accounts,
      showsAccounts,
      sideAccount,
      sideId,
      pickerOpen,
      pickerSide,
      openPicker,
      pickSide,
      fillHeld,
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
      channel,
      channelOptions,
      versionOf,
      currentOf,
      asksHeld,
      showsHeld,
      estimate,
      conflict,
      sending,
      failed,
      submit,
      waiting,
      base,
      saveWord,
      askRemove,
    }
  },
})
</script>

<style scoped lang="scss">
.status {
  margin-bottom: var(--space-4);
}

.form {
  /* A column, not a grid: a block of it grows and goes by `AppReveal`, which takes a flex
     column's gap back with the block — a grid's stays and jumped (MOL-151, adversarial Б2). */
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: var(--space-3);
}

.side-account {
  grid-column: 1 / -1;
}

.hint {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
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
