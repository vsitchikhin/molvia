<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('accounts.reconcile.title') }}</template>
    <template #meta>
      {{ t('accounts.reconcile.meta', { name: account.name, currency: currencyName }) }}
    </template>

    <!-- Step one: the fact, before the count — so as not to fit the number (В-4 MOL-43). -->
    <form v-if="!result" class="form" novalidate @submit.prevent="check">
      <p v-if="!online" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />{{ t('accounts.reconcile.offline') }}
      </p>
      <div class="field">
        <label :for="factId" class="question">{{ t('accounts.reconcile.question') }}</label>
        <div class="well" :class="{ bad: factBad }">
          <input
            :id="factId"
            ref="factInput"
            v-model="fact"
            class="entry"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :aria-invalid="factBad ? 'true' : undefined"
            :aria-describedby="`${factId}-hint`"
            @input="factBad = false"
          />
          <span class="sign" aria-hidden="true">{{ sign }}</span>
        </div>
        <p v-if="factBad" class="error" role="alert">
          <IconAlert class="alert" aria-hidden="true" />{{ t('accounts.reconcile.no_fact') }}
        </p>
        <p :id="`${factId}-hint`" class="hint">{{ t('accounts.reconcile.hint') }}</p>
      </div>
    </form>

    <!-- Step two: the server's count, the difference and what could have made it. -->
    <div v-else class="result" aria-live="polite">
      <p v-if="!online" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />{{ t('accounts.reconcile.offline') }}
      </p>
      <template v-if="matched">
        <div class="matched">
          <span class="circle" aria-hidden="true"><IconCheck class="circle-icon" /></span>
          <p class="matched-title">{{ t('accounts.reconcile.match_title') }}</p>
          <p class="figure">{{ money(result.counted) }}</p>
          <p class="hint">
            {{ t('accounts.reconcile.match_body', { date: shortDay(result.checkedOn) }) }}
          </p>
        </div>
      </template>
      <template v-else>
        <p class="mismatch">
          {{
            t('accounts.reconcile.mismatch', {
              app: money(result.counted),
              fact: money(result.fact),
            })
          }}
        </p>
        <p class="difference" :class="{ stale: recountPending }">
          <span class="difference-label">{{ t('accounts.reconcile.difference') }}</span>
          <span class="difference-figure">{{ signed(result.difference) }}</span>
        </p>
        <AppButton variant="ghost" @click="again">
          {{ t('accounts.reconcile.edit_fact') }}
        </AppButton>

        <template v-if="result.reasons.length > 0">
          <h3 class="caption">
            {{ t('accounts.reconcile.causes_title', { date: shortDay(result.since) }) }}
          </h3>
          <AppCard as="ul" list>
            <OperationRow
              v-for="reason in result.reasons"
              :key="`${reason.kind}-${reason.operation.id}-${reason.operation.side ?? ''}`"
              :operation="reason.operation"
              :categories="categories"
              :name-of="nameOf"
              :account-name="accountName"
              :title="reasonTitle(reason)"
              :meta="reasonMeta(reason)"
              @open="openReason"
            />
          </AppCard>
          <p class="hint">{{ t('accounts.reconcile.causes_hint') }}</p>
        </template>
        <div v-else class="none">
          <IconHelp class="none-icon" aria-hidden="true" />
          <div>
            <p class="none-title">{{ t('accounts.reconcile.no_causes_title') }}</p>
            <p class="hint">
              {{
                t('accounts.reconcile.no_causes_body', {
                  date: shortDay(result.since),
                  currency: t(`accounts.currency_in.${account.currency}`),
                })
              }}
            </p>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <p v-if="failed" class="failed" role="alert">{{ t('accounts.sheet.failed') }}</p>
      <template v-if="!result">
        <AppButton size="large" block :busy="sending" :disabled="sending || !online" @click="check">
          <template #icon><IconScale v-if="online" /><IconCloudOff v-else /></template>
          {{ online ? t('accounts.reconcile.check') : t('accounts.reconcile.wait_online') }}
        </AppButton>
      </template>
      <template v-else>
        <template v-if="!matched && !written">
          <AppButton
            variant="secondary"
            block
            :disabled="writing || !online || recountPending"
            @click="writeDifference"
          >
            {{ t('accounts.reconcile.write_difference') }}
          </AppButton>
          <p class="note">{{ writeNote }}</p>
        </template>
        <AppButton size="large" block @click="finish">
          <template #icon><IconCheck /></template>
          {{ t('accounts.done') }}
        </AppButton>
      </template>
    </template>
  </BottomSheet>
  <OperationSheet
    v-model:open="reasonOpen"
    :operation="reasonOperation"
    back
    :online="online"
    @saved="reasonSaved"
  />
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCheck from '~icons/mdi/check'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconHelp from '~icons/mdi/help-circle-outline'
import IconScale from '~icons/mdi/scale-balance'
import { currencySign } from '@molvia/model'
import type {
  AccountCheckResponse,
  AccountOperationView,
  Money,
  MoneyAccountView,
  SpendingCategoryView,
} from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import { parseSigned, shortDay as dayOf, signedAmount } from '@/components/accounts'
import { asTyped } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useReconnect } from '@/composables/useReconnect'
import { newId } from '@/ids'
import { useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'

type Reason = AccountCheckResponse['reasons'][number]

/**
 * «Сверка» (MOL-123, handoff 05): the check looks for the reason before it offers to close the
 * difference (В-4 MOL-43). First the fact, with nothing of the app's count on the screen or in what
 * is read aloud; then the server's answer — «сходится», or the difference, neutral either way, and
 * the operations that could have made it. A reason is put right in its own sheet over this one, and
 * the same check is sent again (Р-19): the phone never works out a difference. «Записать разницу»
 * comes last and second, writes one «Прочее» with the note «сверка» for the server's sum, and then
 * sends the same check once more, so that it comes out even and moves the window (В-5 MOL-115).
 */
export default defineComponent({
  name: 'ReconcileSheet',
  components: {
    AppButton,
    AppCard,
    BottomSheet,
    IconAlert,
    IconCheck,
    IconCloudOff,
    IconHelp,
    IconScale,
    OperationRow,
    OperationSheet,
  },
  props: {
    open: { type: Boolean, required: true },
    account: { type: Object as PropType<MoneyAccountView>, required: true },
    online: { type: Boolean, default: true },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    accountName: {
      type: Function as PropType<(id: string) => string | null>,
      required: true,
    },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const store = useAccountsStore()
    const spendings = useSpendingQueueStore()
    const trips = useTripQueueStore()
    const announce = useAnnouncer()
    const factId = useId()

    const fact = ref('')
    const factBad = ref(false)
    const factInput = ref<HTMLInputElement | null>(null)
    const result = ref<AccountCheckResponse | null>(null)
    const sending = ref(false)
    const failed = ref(false)
    /** A reason was put right and the count has not been asked again yet. */
    const recountPending = ref(false)
    const writing = ref(false)
    const written = ref(false)
    /** The check as sent: the same fact goes under the same name, another under a new one (Р-19). */
    let sent: { id: string; fact: Money } | null = null
    /** The name of «Прочее · сверка» for this difference: a second tap writes the same one. */
    let differenceId = newId()

    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        fact.value = ''
        factBad.value = false
        result.value = null
        failed.value = false
        recountPending.value = false
        written.value = false
        sent = null
        await nextTick()
        factInput.value?.focus()
      },
    )

    const sign = computed(() => currencySign(props.account.currency, locale.value))
    const currencyName = computed(() => t(`spending.currency_name.${props.account.currency}`))
    const money = (value: Money) => signedAmount(value, locale.value)
    const signed = (value: Money) => signedAmount(value, locale.value, { plus: true })
    const shortDay = (day: string) => dayOf(day, locale.value)
    const matched = computed(() => result.value?.difference.minor === 0n)

    async function ask(check: { id: string; fact: Money }): Promise<boolean> {
      failed.value = false
      try {
        const answer = await api.checkAccount(props.account.id, check)
        sent = check
        result.value = answer
        differenceId = newId()
        written.value = false
        // The account's «сверено» and, when it came out even, its window moved.
        void store.refresh()
        return true
      } catch {
        failed.value = true
        return false
      }
    }

    async function check(): Promise<void> {
      if (sending.value || !props.online) return
      const value = parseSigned(fact.value, props.account.currency)
      if (!value) {
        factBad.value = true
        factInput.value?.focus()
        return
      }
      const same = sent?.fact.minor === value.minor ? sent.id : newId()
      sending.value = true
      await ask({ id: same, fact: value })
      sending.value = false
    }

    function again(): void {
      result.value = null
      void nextTick(() => factInput.value?.focus())
    }

    /** The same check once more, after a reason was put right or the difference written. */
    async function recount(say: boolean): Promise<void> {
      if (!sent || !navigator.onLine) return
      const before = result.value
      if (!(await ask(sent))) return
      recountPending.value = false
      if (say && before && result.value) announce?.(t('accounts.reconcile.recounted'))
    }

    // A spending is put right through the queue, a trip too: its answer comes after the sheet, and
    // the count is asked again once it has — any landing will do, the check is cheap.
    let recountOnLanding = false
    /**
     * The check to send again once «Прочее · сверка» has reached the server — kept apart from the
     * sheet's own state: the sheet is closed by then, and may be opened on another check before the
     * queue is through (В-5 MOL-115: without the repeat the window of an account with «≈» stays).
     */
    let repeatAfterLanding: { id: string; fact: Money } | null = null
    watch(
      () => [spendings.landed, trips.landed],
      () => {
        if (spendings.pending.length > 0) return
        const repeat = repeatAfterLanding
        repeatAfterLanding = null
        if (repeat) void repeatQuietly(repeat)
        if (!recountOnLanding) return
        recountOnLanding = false
        void recount(props.open)
      },
    )

    async function repeatQuietly(check: { id: string; fact: Money }): Promise<void> {
      try {
        await api.checkAccount(props.account.id, check)
      } catch {
        // Not repeated: the next check of the account counts again from its last even one.
      } finally {
        void store.refresh()
      }
    }
    useReconnect(() => {
      if (recountPending.value) void recount(props.open)
    })

    const reasonOpen = ref(false)
    const reasonOperation = ref<AccountOperationView | null>(null)
    function openReason(operation: AccountOperationView): void {
      reasonOperation.value = operation
      reasonOpen.value = true
    }
    function reasonSaved(): void {
      recountPending.value = true
      const kind = reasonOperation.value?.kind
      if (kind === 'income' || kind === 'exchange') void recount(true)
      else recountOnLanding = true
    }

    function reasonTitle({ kind, operation }: Reason): string {
      const [own] = operation.amounts
      const amount = own
        ? asTyped({ ...own, minor: own.minor < 0n ? -own.minor : own.minor }, locale.value)
        : ''
      if (kind === 'unassigned')
        return t(`accounts.reconcile.cause_no_account_${operation.kind}`, { amount })
      if (kind === 'unpriced')
        return t('accounts.reconcile.cause_trip_unpriced', { date: shortDay(operation.day) })
      const title =
        operation.kind === 'trip'
          ? t('spending.trip_row_title', { place: operation.place ?? '' })
          : (operation.note ?? categoryName(operation.categoryId))
      if (kind === 'noDebited')
        return t('accounts.reconcile.cause_no_charged', {
          title,
          sign: own ? currencySign(own.currency, locale.value) : '',
        })
      return t('accounts.reconcile.cause_uncounted', { title })
    }

    function reasonMeta({ kind, operation }: Reason): string {
      const [own] = operation.amounts
      const amount = own
        ? asTyped({ ...own, minor: own.minor < 0n ? -own.minor : own.minor }, locale.value)
        : ''
      if (kind === 'unpriced')
        return t(
          'accounts.reconcile.cause_trip_unpriced_meta',
          { place: operation.place ?? '', n: operation.unpriced },
          operation.unpriced,
        )
      if (kind === 'noDebited')
        return t('accounts.reconcile.cause_no_charged_meta', {
          amount,
          date: shortDay(operation.day),
        })
      const what =
        operation.kind === 'income'
          ? t(`income.source.${operation.source ?? 'other'}`)
          : operation.kind === 'exchange'
            ? t('accounts.account.exchange')
            : operation.kind === 'trip'
              ? (operation.place ?? '')
              : (operation.note ?? categoryName(operation.categoryId))
      return kind === 'uncounted'
        ? `${amount} · ${shortDay(operation.day)}`
        : `${what} · ${shortDay(operation.day)}`
    }

    function categoryName(id: string | null): string {
      const found = props.categories.find((category) => category.id === id)
      return found ? props.nameOf(found) : t('spending.category.other')
    }

    const writeNote = computed(() => {
      const value = result.value
      if (!value) return ''
      const size = value.difference.minor < 0n ? -value.difference.minor : value.difference.minor
      const amount = asTyped({ ...value.difference, minor: size }, locale.value)
      return t(
        value.difference.minor < 0n
          ? 'accounts.reconcile.write_out_note'
          : 'accounts.reconcile.write_in_note',
        { amount, name: props.account.name },
      )
    })

    /**
     * «Прочее · сверка»: an ordinary spending or income, for the sum the server gave, on this
     * account, through the routes that write them — a spending through its queue. Then the same
     * check again, once what was written has reached the server.
     */
    async function writeDifference(): Promise<void> {
      const value = result.value
      if (!value || writing.value || written.value || !sent) return
      const other = props.categories.find((category) => category.preset === 'other')
      const size = {
        ...value.difference,
        minor: value.difference.minor < 0n ? -value.difference.minor : value.difference.minor,
      }
      writing.value = true
      failed.value = false
      try {
        if (value.difference.minor < 0n) {
          if (!other) throw new Error('no «Прочее»')
          spendings.record({
            id: differenceId,
            spentOn: value.checkedOn,
            amount: size,
            categoryId: other.id,
            note: t('accounts.reconcile.note'),
            accountId: props.account.id,
          })
          repeatAfterLanding = sent
        } else {
          await api.recordIncome({
            id: differenceId,
            receivedOn: value.checkedOn,
            amount: size,
            source: 'other',
            note: t('accounts.reconcile.note'),
            accountId: props.account.id,
          })
          void repeatQuietly(sent)
        }
        written.value = true
        announce?.(t('accounts.reconcile.written', { amount: signed(value.difference) }))
        emit('update:open', false)
      } catch {
        failed.value = true
      } finally {
        writing.value = false
      }
    }

    function finish(): void {
      const value = result.value
      if (value)
        announce?.(
          t(
            value.difference.minor === 0n
              ? 'accounts.reconcile.saved_match'
              : 'accounts.reconcile.saved_mismatch',
          ),
        )
      emit('update:open', false)
    }

    return {
      t,
      factId,
      fact,
      factBad,
      factInput,
      result,
      sending,
      failed,
      recountPending,
      writing,
      written,
      sign,
      currencyName,
      money,
      signed,
      shortDay,
      matched,
      check,
      again,
      reasonOpen,
      reasonOperation,
      openReason,
      reasonSaved,
      reasonTitle,
      reasonMeta,
      writeNote,
      writeDifference,
      finish,
    }
  },
})
</script>

<style scoped lang="scss">
.form,
.result {
  display: grid;
  gap: var(--space-4);
}

.strip {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}

.strip-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.field {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}

.question {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.well {
  display: flex;
  align-items: center;
  min-height: 4.5rem;
  padding: 0 var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 var(--hairline) var(--border);

  &:focus-within {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  &.bad {
    box-shadow: inset 0 0 0 2px var(--bad);
  }
}

.entry {
  flex: 1;
  width: 0;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--text-entry);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.sign {
  flex: none;
  color: var(--text-muted);
  font-family: var(--font-display);
  font-size: var(--text-entry-sign);
  font-weight: 800;
}

.error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.alert {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.hint,
.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.note {
  margin: var(--space-2) 0;
  text-align: center;
}

.matched {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  text-align: center;
}

.circle {
  display: grid;
  place-items: center;
  width: var(--state-circle);
  height: var(--state-circle);
  border-radius: var(--radius-pill);
  background: var(--good-tint);
  color: var(--good-ink);
}

.circle-icon {
  width: 2rem;
  height: 2rem;
}

.matched-title,
.none-title {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.mismatch {
  margin: 0;
  font-size: var(--text-callout);
}

.difference {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-2);

  &.stale {
    opacity: var(--opacity-stale);
  }
}

.difference-label {
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.difference-figure {
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.none {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.none-icon {
  flex: none;
  width: 1.5rem;
  height: 1.5rem;
  color: var(--text-muted);
}

.failed {
  margin: 0 0 var(--space-2);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}
</style>
