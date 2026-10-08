<template>
  <BottomSheet :open="open" :back="back" @update:open="$emit('update:open', $event)">
    <template #title>{{
      t(editingId || editing ? 'transfer.title_amend' : 'transfer.title')
    }}</template>
    <template #meta>{{ t('transfer.meta') }}</template>

    <ScreenSkeleton v-if="loading" :groups="[72, 52, 52, 46]" />
    <!-- The transfer could not be read: said here, never a sheet that rises and goes (А6). -->
    <ScreenState
      v-else-if="unread === 'offline'"
      kind="offline"
      tone="warn"
      inline
      :title="t('spending.offline.title')"
      :body="t('transfer.unread_offline')"
    />
    <ScreenState
      v-else-if="unread === 'gone'"
      kind="attention"
      inline
      :title="t('transfer.vanished_title')"
      :body="t('transfer.unread_gone')"
    />
    <ScreenState
      v-else-if="unread === 'error'"
      kind="error"
      inline
      :title="t('transfer.unavailable')"
      @retry="load"
    />
    <form v-else class="form" novalidate @submit.prevent="submit">
      <StatusStrip v-if="!online" kind="offline" :text="t('transfer.offline')" />

      <div class="field">
        <label :for="amountId" class="label">{{ t('transfer.amount') }}</label>
        <div class="well" :class="{ bad: amountBad }">
          <input
            :id="amountId"
            v-model="amount"
            class="entry"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :readonly="sending"
            :aria-invalid="amountBad ? 'true' : undefined"
            @input="amountBad = false"
          />
          <span v-if="source" class="sign" aria-hidden="true">{{ sign }}</span>
        </div>
        <p v-if="amendedLine" class="hint">{{ amendedLine }}</p>
      </div>

      <div class="accounts">
        <AccountRow
          :label="t('transfer.from')"
          :account="source"
          :empty="t('transfer.pick')"
          @open="openPicker('from')"
        />
        <AccountRow
          :label="t('transfer.to')"
          :account="target"
          :empty="noPeer ? t('transfer.no_peer_value', { sign }) : t('transfer.pick')"
          :disabled="!source || noPeer"
          :invalid="toGone"
          @open="openPicker('to')"
        />
        <div v-if="noPeer" class="no-peer">
          <span>{{ t('transfer.no_peer', { currency: currencyIn }) }}</span>
          <AppButton variant="ghost" :inactive="!online" @click="addOpen = true">
            <template #icon><IconPlus /></template>
            {{ t('spending.rest_add') }}
          </AppButton>
        </div>
      </div>

      <div class="field">
        <AppField
          v-model="fee"
          :label="`${t('transfer.fee')} ${t('spending.sheet.optional')}`"
          kind="decimal"
          :error="feeBad ? invalidAmount : null"
          :readonly="sending"
          :aria-describedby="`${amountId}-fee`"
        />
        <p :id="`${amountId}-fee`" class="hint">{{ feeHint }}</p>
      </div>

      <div class="pair">
        <AppField
          v-model="day"
          :label="t('transfer.day')"
          kind="date"
          min="2000-01-02"
          :max="today"
          :display="dayWords"
          :readonly="sending"
          :error-text="dayBad ? t('error.transfer_in_future') : null"
          @update:model-value="dayBad = false"
        />
        <AppField
          v-model="note"
          :label="t('transfer.note')"
          :placeholder="t('transfer.note_placeholder')"
          :maxlength="noteMax"
          :readonly="sending"
          :error-text="noteBad ? t('exchange.sheet.bad_note') : null"
          enterkeyhint="done"
        />
      </div>
    </form>

    <template v-if="!unread" #footer>
      <!-- Where the exchange's sheet says it: one place for every sheet (MOL-253, Р-7). -->
      <div v-if="failure" class="refusal" role="alert">
        <IconAlert class="refusal-icon" aria-hidden="true" />
        <div>
          <p class="refusal-title">{{ failureTitle }}</p>
          <p class="refusal-body">{{ failureBody }}</p>
        </div>
      </div>
      <AppButton
        size="large"
        block
        :inactive="reason !== null"
        :busy="sending"
        :busy-label="t(editing ? 'transfer.saving' : 'transfer.sending')"
        @click="submit"
      >
        <template #icon>
          <IconCloudOff v-if="!online" />
          <IconCheck v-else-if="editing" />
          <IconTransfer v-else />
        </template>
        {{ reason ?? mainWord }}
      </AppButton>
      <template v-if="editing && !loading && failure !== 'vanished'">
        <AppButton
          variant="danger-ghost"
          block
          :inactive="(!online && !removing) || sending"
          :busy="removing"
          :busy-label="t('transfer.removing')"
          @click="remove"
        >
          <template #icon><IconTrash /></template>
          {{ online ? t('transfer.remove') : t('transfer.remove_wait') }}
        </AppButton>
        <p class="remove-note">{{ t('transfer.remove_note') }}</p>
      </template>
    </template>
  </BottomSheet>
  <AccountPickerSheet
    v-model:open="pickerOpen"
    :title="t(picking === 'from' ? 'transfer.from' : 'transfer.to')"
    :accounts="live"
    :currency="source?.currency ?? spendCurrency"
    :strict="picking === 'to'"
    :group-all="picking === 'from'"
    :allow-none="false"
    :exclude="picking === 'to' && source ? [source.id] : []"
    :selected="picking === 'from' ? fromId : toId"
    :note="pickerNote"
    @pick="pick"
  />
  <AccountSheet
    v-model:open="addOpen"
    back
    :account="null"
    :spend-currency="source?.currency ?? spendCurrency"
    :online="online"
    @done="added"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconTransfer from '~icons/mdi/bank-transfer'
import IconCheck from '~icons/mdi/check'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconPlus from '~icons/mdi/plus'
import IconTrash from '~icons/mdi/trash-can-outline'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  EXCHANGE_NOTE_MAX,
  currencySign,
  decimalFromMinor,
  exchangeNoteSchema,
  isRateDay,
  parseMoney,
} from '@molvia/model'
import type { Currency, Money, MoneyAccountView, TransferView } from '@molvia/model'
import AccountPickerSheet from '@/components/AccountPickerSheet.vue'
import AccountRow from '@/components/AccountRow.vue'
import AccountSheet from '@/components/AccountSheet.vue'
import type { AccountOutcome } from '@/components/AccountSheet.vue'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import { pageOrder, shortDay } from '@/components/accounts'
import { asTyped } from '@/components/spending'
import { shown } from '@/composables/useItemDetails'
import { useReconnect } from '@/composables/useReconnect'
import { useTransfers } from '@/composables/useTransfers'
import { localDay } from '@/days'
import { reportFailure } from '@/failures'
import { newId } from '@/ids'
import { useAccountsStore } from '@/stores/accounts'

/** How the sheet ended, for the screen under it: said, or offered back by «Вернуть». */
export type TransferOutcome =
  | { readonly kind: 'saved'; readonly transfer: TransferView; readonly created: boolean }
  | { readonly kind: 'removed'; readonly transfer: TransferView }

/**
 * «Перевод» (MOL-253, handoff 02): money moved between two of one's own accounts of one currency —
 * the sum, «Откуда», «Куда» of the same currency only, an optional fee, the day and a note. The
 * fee is an ordinary spending of «Прочее» from the source, which the hint says; the transfer itself
 * is in no month. Opened on a row it amends the transfer and offers «Удалить перевод».
 *
 * Not through a queue: a transfer is written with a connection, and the person waits for the answer,
 * as for an exchange. The identifier is made once per opening, so «Перевести» pressed again after a
 * failure is the same transfer, never a second one. «Перевести» says what it still needs, in order
 * (Ф-6): the source, a second account of its currency, the sum, the target — or the connection.
 */
export default defineComponent({
  name: 'TransferSheet',
  components: {
    AccountPickerSheet,
    AccountRow,
    AccountSheet,
    AppButton,
    AppField,
    BottomSheet,
    IconAlert,
    IconCheck,
    IconCloudOff,
    IconPlus,
    IconTransfer,
    IconTrash,
    ScreenSkeleton,
    ScreenState,
    StatusStrip,
  },
  props: {
    open: { type: Boolean, required: true },
    /** Opened over another sheet — a fee's row in a check: «‹» back, no ×. */
    back: { type: Boolean, default: false },
    /** The source the sheet opens on: an account's own screen; null on «Счета». */
    from: { type: String as PropType<string | null>, default: null },
    /** The transfer amended — opened on a row of a journal or on its fee in «Траты». */
    editingId: { type: String as PropType<string | null>, default: null },
    online: { type: Boolean, default: true },
    /** The currency a new account starts in when nothing else says one. */
    spendCurrency: { type: String as PropType<Currency>, default: 'AMD' },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    done: (outcome: TransferOutcome) => typeof outcome === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const amountId = useId()
    const store = useAccountsStore()
    const transfers = useTransfers()

    const amount = ref('')
    const fee = ref('')
    const today = ref(localDay())
    const day = ref(today.value)
    const note = ref('')
    const fromId = ref<string | null>(null)
    const toId = ref<string | null>(null)
    const editing = ref<TransferView | null>(null)
    const loading = ref(false)
    const unread = ref<'error' | 'offline' | 'gone' | null>(null)
    const amountBad = ref(false)
    const feeBad = ref(false)
    const dayBad = ref(false)
    const noteBad = ref(false)
    const toGone = ref(false)
    const failure = ref<'failed' | 'gone' | 'conflict' | 'written' | 'vanished' | null>(null)
    const goneName = ref('')
    const sending = ref(false)
    const removing = ref(false)
    const pickerOpen = ref(false)
    const picking = ref<'from' | 'to'>('from')
    const addOpen = ref(false)
    let transferId = newId()

    /** Every account the page knows — a removed one too, which an amended transfer may name. */
    const byId = (id: string | null): MoneyAccountView | null =>
      id === null ? null : (store.accounts.find((account) => account.id === id) ?? null)
    /** What a picker offers: live accounts only (MOL-115, Р-22). */
    const live = computed(() => pageOrder(store.accounts))
    const source = computed(() => byId(fromId.value))
    const target = computed(() => byId(toId.value))
    const peers = computed(() =>
      live.value.filter(
        (account) => account.currency === source.value?.currency && account.id !== fromId.value,
      ),
    )
    const noPeer = computed(
      () => source.value !== null && peers.value.length === 0 && !target.value,
    )

    /** The one account «Куда» can be, put in by the screen, as every default is (Р-6). */
    function settleTarget(): void {
      const chosen = target.value
      if (chosen && chosen.currency === source.value?.currency && chosen !== source.value) return
      toId.value = peers.value.length === 1 ? (peers.value[0]?.id ?? null) : null
    }

    const typed = (value: Money): string =>
      shown(decimalFromMinor(value), locale.value === 'ru' ? ',' : '.')

    function fill(transfer: TransferView | null): void {
      editing.value = transfer
      amount.value = transfer ? typed(transfer.amount) : ''
      fee.value = transfer?.fee ? typed(transfer.fee) : ''
      day.value = transfer?.transferredOn ?? today.value
      note.value = transfer?.note ?? ''
      fromId.value = transfer?.fromAccountId ?? props.from
      toId.value = transfer?.toAccountId ?? null
      if (!transfer) settleTarget()
    }

    // Made afresh at every opening: the last transfer's numbers, or its refusal, are not this one's.
    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        today.value = localDay()
        amountBad.value = false
        feeBad.value = false
        dayBad.value = false
        noteBad.value = false
        toGone.value = false
        failure.value = null
        pickerOpen.value = false
        transferId = newId()
        fill(null)
        await load()
      },
      { immediate: true },
    )
    // Back online, a transfer that did not open is read again by itself (review Р2-2, frontend.md).
    useReconnect(() => {
      if (props.open && (unread.value === 'error' || unread.value === 'offline')) void load()
    })

    /**
     * The transfer a row opened, read from the server — it is amended only with a connection. Not
     * read, the sheet says why where it stands (adversarial А6): offline is decided after the failure.
     */
    async function load(): Promise<void> {
      const id = props.editingId
      unread.value = null
      if (id === null) return
      loading.value = true
      try {
        const transfer = await transfers.load(id)
        if (props.open && props.editingId === id) fill(transfer)
      } catch (caught) {
        if (props.open && props.editingId === id) {
          // Removed on another phone while this journal was not read again: said as such, no
          // «Повторить» that would get the same 404 for ever, and the journal read again (А11).
          if (caught instanceof ApiError && caught.answered && caught.code === ERROR.NOT_FOUND) {
            unread.value = 'gone'
            void transfers.heard()
            return
          }
          unread.value = navigator.onLine ? 'error' : 'offline'
        }
        reportFailure(caught, 'screen')
      } finally {
        loading.value = false
      }
    }

    const sign = computed(() =>
      source.value ? currencySign(source.value.currency, locale.value) : '',
    )
    const currencyIn = computed(() =>
      source.value ? t(`accounts.currency_in.${source.value.currency}`) : '',
    )

    /** UX only: the server reads the same codecs and has the last word (CLAUDE.md). */
    function money(text: string): Money | null {
      const currency = source.value?.currency
      if (!currency || !text.trim()) return null
      try {
        const value = parseMoney(text, currency)
        return value.minor > 0n ? value : null
      } catch {
        return null
      }
    }

    const feeHint = computed(() => {
      const account = source.value
      if (!account) return t('transfer.fee_hint_none')
      const hint = t('transfer.fee_hint', { name: account.name })
      const sum = money(amount.value)
      const charge = money(fee.value)
      if (!sum || !charge) return hint
      const total = { minor: sum.minor + charge.minor, currency: sum.currency }
      return `${hint} · ${t('transfer.fee_total', { amount: asTyped(total, locale.value) })}`
    })

    /** What «Перевести» still needs, the first missing in order (Ф-6); null when it can go. */
    const reason = computed<string | null>(() => {
      if (failure.value === 'vanished') return t('transfer.vanished_button')
      if (!props.online)
        return t(editing.value ? 'transfer.wait_online_save' : 'transfer.wait_online')
      if (!source.value) return t('transfer.need_from')
      if (noPeer.value) return t('transfer.need_peer', { currency: currencyIn.value })
      if (!money(amount.value) && !amount.value.trim()) return t('transfer.need_amount')
      if (!target.value) return t('transfer.need_to')
      return null
    })

    const mainWord = computed(() => {
      if (editing.value) return t('transfer.save')
      const sum = money(amount.value)
      return t('transfer.send', { amount: sum ? asTyped(sum, locale.value) : '' }).trim()
    })

    const amendedLine = computed(() => {
      const at = editing.value?.amendedAt
      if (!at) return null
      const date = new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(
        at,
      )
      return t('transfer.amended', { date })
    })

    const dayWords = computed(() => {
      if (!isRateDay(day.value)) return null
      return day.value === today.value ? t('transfer.today') : shortDay(day.value, locale.value)
    })

    /** «2 500 $ → «Доллары» · комиссия 20 $ · 8 окт. · заметка» — what is recorded now. */
    function currentOf(transfer: TransferView): string {
      const to = byId(transfer.toAccountId)?.name ?? ''
      return [
        `${asTyped(transfer.amount, locale.value)} → «${to}»`,
        ...(transfer.fee
          ? [t('transfer.current_fee', { amount: asTyped(transfer.fee, locale.value) })]
          : []),
        shortDay(transfer.transferredOn, locale.value),
        ...(transfer.note ? [transfer.note] : []),
      ].join(' · ')
    }

    const failureTitle = computed(() => {
      if (failure.value === 'conflict') return t('transfer.conflict_title')
      if (failure.value === 'written') return t('transfer.written_title')
      if (failure.value === 'vanished') return t('transfer.vanished_title')
      return t('transfer.failed')
    })

    const failureBody = computed(() => {
      const held = editing.value
      if (failure.value === 'gone') return t('transfer.gone', { name: goneName.value })
      if (failure.value === 'vanished') return t('transfer.vanished')
      if (failure.value === 'conflict' && held)
        return t('transfer.amend_conflict', { details: currentOf(held) })
      if (failure.value === 'written' && held)
        return t('transfer.written', {
          amount: asTyped(held.amount, locale.value),
          name: byId(held.toAccountId)?.name ?? '',
        })
      return t('transfer.failed_retry')
    })

    const pickerNote = computed(() => {
      if (picking.value === 'from') return t('accounts.picker.note_transfer_from')
      return source.value
        ? t('accounts.picker.note_transfer_to', {
            currency: currencyIn.value,
            name: source.value.name,
          })
        : null
    })

    function openPicker(side: 'from' | 'to'): void {
      picking.value = side
      pickerOpen.value = true
    }

    function pick(id: string | null): void {
      if (id === null) return
      if (picking.value === 'to') {
        toId.value = id
        toGone.value = false
        return
      }
      const before = source.value?.currency
      fromId.value = id
      // Another currency, or the target itself as the source: «Куда» is chosen again (handoff 02).
      if (toId.value === id || before !== source.value?.currency) toId.value = null
      settleTarget()
    }

    function added(outcome: AccountOutcome): void {
      if (outcome.kind !== 'added') return
      const made = byId(outcome.id)
      if (made && made.currency === source.value?.currency) toId.value = made.id
    }

    async function submit(): Promise<void> {
      if (sending.value || reason.value !== null) return
      const giver = source.value
      const taker = target.value
      if (!giver || !taker) return
      failure.value = null
      const sum = money(amount.value)
      amountBad.value = sum === null
      const charge = fee.value.trim() ? money(fee.value) : null
      feeBad.value = fee.value.trim() !== '' && charge === null
      const typedNote = note.value.trim() ? exchangeNoteSchema.safeParse(note.value) : null
      noteBad.value = typedNote !== null && !typedNote.success
      dayBad.value = !isRateDay(day.value) || day.value > today.value
      if (!sum || feeBad.value || noteBad.value || dayBad.value) return

      const fields = {
        fromAccountId: giver.id,
        toAccountId: taker.id,
        amount: sum,
        ...(charge ? { fee: charge } : {}),
        transferredOn: day.value,
        ...(typedNote?.success ? { note: typedNote.data } : {}),
      }
      sending.value = true
      try {
        const held = editing.value
        const transfer = held
          ? await transfers.amend(held.id, { revision: held.revision, ...fields })
          : await transfers.record({ id: transferId, ...fields })
        emit('done', { kind: 'saved', transfer, created: held === null })
        emit('update:open', false)
      } catch (caught) {
        const code = caught instanceof ApiError ? caught.code : null
        // The API's own word, not a code inferred from a bare status — a shop's portal answers 404 too
        // (transport.ts, adversarial А10).
        const said = caught instanceof ApiError && caught.answered
        if (code === ERROR.TRANSFER_ACCOUNT) {
          // Gone or given another currency on another phone: the page says which, and that side is
          // chosen again — the sum, the fee and the note stay (state 6).
          await store.refresh()
          const gone = [giver, taker].find(
            (account) =>
              !live.value.some((one) => one.id === account.id && one.currency === giver.currency),
          )
          goneName.value = (gone ?? taker).name
          if (gone === giver) fromId.value = null
          toId.value = null
          toGone.value = true
          failure.value = 'gone'
          settleTarget()
        } else if (code === ERROR.TRANSFER_IN_FUTURE) {
          dayBad.value = true
        } else if (code === ERROR.CONFLICT && said) {
          // Amended on another phone meanwhile — or, for a new one, written already under this name
          // with other figures, its answer lost (review С-1, adversarial А5): what is recorded now is
          // said, the figures typed stay, and «Сохранить» writes them over it — never a second one.
          const id = editing.value?.id ?? transferId
          try {
            const now = await transfers.load(id)
            failure.value = editing.value ? 'conflict' : 'written'
            editing.value = now
            if (failure.value === 'written') void transfers.heard()
          } catch {
            failure.value = 'failed'
          }
        } else if (code === ERROR.NOT_FOUND && said && editing.value) {
          // Removed on another phone: there is nothing to save, and saying «try again» would loop
          // for ever (adversarial А8). Its rows go from the journal under the sheet.
          failure.value = 'vanished'
          void transfers.heard()
        } else {
          failure.value = 'failed'
        }
      } finally {
        sending.value = false
      }
    }

    async function remove(): Promise<void> {
      const held = editing.value
      if (!held || removing.value || !props.online) return
      failure.value = null
      removing.value = true
      try {
        await transfers.remove(held.id)
        emit('done', { kind: 'removed', transfer: held })
        emit('update:open', false)
      } catch {
        failure.value = 'failed'
      } finally {
        removing.value = false
      }
    }

    return {
      t,
      amountId,
      amount,
      fee,
      today,
      day,
      note,
      noteMax: EXCHANGE_NOTE_MAX,
      fromId,
      toId,
      source,
      target,
      live,
      noPeer,
      loading,
      unread,
      load,
      amountBad,
      feeBad,
      dayBad,
      noteBad,
      toGone,
      failure,
      failureTitle,
      failureBody,
      editing,
      sending,
      removing,
      pickerOpen,
      picking,
      pickerNote,
      addOpen,
      sign,
      currencyIn,
      feeHint,
      reason,
      mainWord,
      amendedLine,
      dayWords,
      invalidAmount: ERROR.INVALID_AMOUNT,
      openPicker,
      pick,
      added,
      submit,
      remove,
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.field,
.accounts {
  display: grid;
  gap: var(--space-2);
}

.label {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.well {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 4.5rem;
  padding: 0 var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);

  &:focus-within {
    box-shadow:
      inset 0 0 0 var(--hairline) var(--accent),
      0 0 0 2px var(--accent-tint);
  }

  &.bad {
    box-shadow: inset 0 0 0 2px var(--bad);
  }
}

.entry {
  @include display-type;

  flex: 1;
  width: 0;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-size: var(--text-entry);
  font-variant-numeric: tabular-nums;
  outline: none;
}

.sign {
  @include display-type;

  flex: none;
  color: var(--text-muted);
  font-size: var(--text-entry-sign);
}

.hint,
.remove-note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.remove-note {
  margin-top: var(--space-1);
  text-align: center;
}

.no-peer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 0 0 0 var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-3);
}

.refusal {
  display: flex;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--bad-tint);
}

.refusal-icon {
  @include icon;

  font-size: var(--icon-sm);
  color: var(--bad-ink);
}

.refusal-title {
  margin: 0;
  color: var(--bad-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.refusal-body {
  margin: var(--space-1) 0 0;
  color: var(--text);
  font-size: var(--text-footnote);
}
</style>
