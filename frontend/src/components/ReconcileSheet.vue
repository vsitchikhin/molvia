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
    <!-- Said through the app's one live region (MOL-19), and the focus comes here: the field and
         the button it was on are gone (review 20). -->
    <div v-else ref="resultBox" class="result" tabindex="-1">
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
        <!-- A muted difference says what it waits for (adversarial round 3, Н4). -->
        <p v-if="recountPending" class="hint">{{ t('accounts.reconcile.recounting') }}</p>
        <p v-if="tripsHeld" class="hint">{{ t('accounts.reconcile.trips_held') }}</p>
        <AppButton variant="ghost" @click="again">
          {{ t('accounts.reconcile.edit_fact') }}
        </AppButton>

        <template v-if="reasons.length > 0">
          <h3 class="caption">
            {{ t('accounts.reconcile.causes_title', { date: shortDay(result.since) }) }}
          </h3>
          <AppCard as="ul" list>
            <AppReveal group>
              <OperationRow
                v-for="reason in reasons"
                :key="`${reason.kind}-${reason.operation.id}-${reason.operation.side ?? ''}`"
                :operation="reason.operation"
                :categories="categories"
                :name-of="nameOf"
                :account-name="accountName"
                :title="reasonTitle(reason)"
                :meta="reasonMeta(reason)"
                plain
                @open="openReason"
              />
            </AppReveal>
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
      <!-- Offline or the server: decided after the failure, and offline is never red (MOL-19).
           Offline is said above, by the connection itself, and goes with it (review 34). -->
      <div v-if="failure === 'error' || failure === 'categories'" class="failed" role="alert">
        <span>{{
          t(failure === 'categories' ? 'accounts.reconcile.no_other' : 'accounts.reconcile.failed')
        }}</span>
        <AppButton
          v-if="result"
          variant="ghost"
          @click="failure === 'categories' ? writeDifference() : recount(true)"
        >
          {{ t('state.retry') }}
        </AppButton>
      </div>
      <!-- A reason removed from its own sheet over this one comes back here (MOL-82's ten seconds). -->
      <UndoStrip
        v-if="removedReason"
        :key="removedReason.stamp"
        class="undo"
        :text="t('spending.removed', removedReason)"
        :announcement="t('spending.removed_announced', removedReason)"
        :action="t('spending.restore')"
        @restore="restoreReason"
        @expire="removedReason = null"
      />
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
            :disabled="writing || !online || recountPending || tripsHeld"
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
    @removed="reasonRemoved"
  />
  <!-- A difference above zero is an income, and an income answers «сколько было до» (В-5). -->
  <OperationIncomeSheet
    v-if="incomeDraft"
    v-model:open="incomeOpen"
    :draft="incomeDraft"
    @saved="incomeSaved"
    @unavailable="incomeUnavailable"
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
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationIncomeSheet from '@/components/OperationIncomeSheet.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { parseSigned, shortDay as dayOf, signedAmount } from '@/components/accounts'
import { asTyped } from '@/components/spending'
import type { Removed } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import type { IncomeDraft } from '@/composables/useIncomes'
import { useReconnect } from '@/composables/useReconnect'
import { newId } from '@/ids'
import { useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite } from '@/stores/tripQueue'
import { reportFailure } from '@/failures'

type Reason = AccountCheckResponse['reasons'][number]
/** A check as this sheet sends it: the day is the request's (MOL-121). */
interface Check {
  readonly id: string
  readonly fact: Money
}

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
    AppReveal,
    BottomSheet,
    IconAlert,
    IconCheck,
    IconCloudOff,
    IconHelp,
    IconScale,
    OperationIncomeSheet,
    OperationRow,
    OperationSheet,
    UndoStrip,
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
    /** Why the last ask did not answer — read after the failure, never before (MOL-19, A1). */
    const failure = ref<'offline' | 'error' | 'categories' | null>(null)
    const resultBox = ref<HTMLElement | null>(null)
    const removedReason = ref<(Removed & { stamp: number }) | null>(null)
    const incomeDraft = ref<IncomeDraft | null>(null)
    const incomeOpen = ref(false)
    /** A reason was put right and the count has not been asked again yet. */
    const recountPending = ref(false)
    const writing = ref(false)
    const written = ref(false)
    /** The check as sent: the same fact goes under the same name, another under a new one (Р-19). */
    let sent: Check | null = null
    /** The check last asked — its answer may be lost after the server wrote it (review 6). */
    let tried: Check | null = null
    /** Which answer is awaited: a recount landing late must not take the sheet back (review 3). */
    let asking = 0
    /** The name of «Прочее · сверка» for this difference: a second tap writes the same one. */
    let differenceId = newId()

    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        fact.value = ''
        factBad.value = false
        result.value = null
        failure.value = null
        removedReason.value = null
        recountPending.value = false
        written.value = false
        sent = null
        tried = null
        asking += 1
        recountOnLanding = false
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

    async function ask(check: Check): Promise<boolean> {
      failure.value = null
      const mine = ++asking
      try {
        const answer = await api.checkAccount(props.account.id, check)
        if (mine !== asking) return false
        sent = check
        result.value = answer
        differenceId = newId()
        written.value = false
        // What still waits in a queue is not in this count: the difference stays muted and is asked
        // again once it lands — a trip's removal among it, whose reason is hidden (review 33).
        const waiting = !landedAll()
        recountPending.value = waiting
        recountOnLanding = waiting
        // The account's «сверено» and, when it came out even, its window moved.
        void store.refresh()
        return true
      } catch (error) {
        reportFailure(error, 'screen')
        if (mine === asking) failure.value = navigator.onLine ? 'error' : 'offline'
        return false
      }
    }

    /** What step two says, aloud: the result and its figure (review 20). */
    function sayResult(answer: AccountCheckResponse): void {
      announce?.(
        answer.difference.minor === 0n
          ? `${t('accounts.reconcile.match_title')}. ${money(answer.counted)}`
          : `${t('accounts.reconcile.mismatch', { app: money(answer.counted), fact: money(answer.fact) })}. ${t('accounts.reconcile.difference')} ${signed(answer.difference)}`,
      )
    }

    async function check(): Promise<void> {
      if (sending.value || !props.online) return
      const value = parseSigned(fact.value, props.account.currency)
      if (!value) {
        factBad.value = true
        factInput.value?.focus()
        return
      }
      const earlier = [sent, tried].find((one) => one?.fact.minor === value.minor)
      tried = { id: earlier?.id ?? newId(), fact: value }
      sending.value = true
      const answered = await ask(tried)
      sending.value = false
      if (!answered || !result.value) return
      sayResult(result.value)
      await nextTick()
      resultBox.value?.focus()
    }

    function again(): void {
      // A recount still on its way is about the fact being replaced.
      asking += 1
      recountOnLanding = false
      recountPending.value = false
      result.value = null
      void nextTick(() => factInput.value?.focus())
    }

    /** The same check once more, after a reason was put right or the difference written. */
    async function recount(say: boolean): Promise<void> {
      if (!sent || !result.value || !navigator.onLine) return
      // A failure keeps the difference stale and «Повторить» beside it: nothing is written over a
      // count that was not asked (review 15).
      if (!(await ask(sent))) return
      if (say) {
        announce?.(t('accounts.reconcile.recounted'))
        sayResult(result.value)
      }
    }

    /**
     * Whether what was put right has reached the server: no spending, no account of a trip and no
     * trip's removal or return still waiting. Not «some queue landed» — a spending landing first
     * recounted before the trip's account did, and «Записать разницу» wrote the same money a second
     * time (review 15, adversarial В); a trip being removed is hidden from the reasons while the
     * server still counts it (review 33).
     */
    function landedAll(): boolean {
      return (
        spendings.pending.length === 0 &&
        !trips.pending.some((write) => countsMoney(write) && tripsSend(write))
      )
    }

    /**
     * A write of a trip that may move what an account counts: its account, its removal or return, and
     * a purchase added, amended or removed — a priced one moves the balance of the account the trip is
     * on and takes its «списано» off (Р-32); the sauce found at home and added the same evening was
     * written as «Прочее» and then again with the trip (adversarial round 6, Н8). A start or a finish
     * moves no money.
     */
    function countsMoney({ kind }: QueuedWrite): boolean {
      return kind !== 'start' && kind !== 'finish'
    }

    /**
     * Whether the trip queue sends this write by itself. Not while it stands on a question of
     * «Поход» — another trip open, a missing context — which only the person answers, with no
     * timer; and never a write of a trip the server refused. Waited on, such a write held every
     * check of every account, with nothing to say why (adversarial round 3, Н4): it is named instead.
     */
    function tripsSend({ tripId }: QueuedWrite): boolean {
      return trips.elsewhere === null && trips.needsContext === null && !trips.orphaned(tripId)
    }

    /**
     * A write held so shuts «Записать разницу», whichever account it names: counted without it, the
     * difference is honest, but written as «Прочее» it was the trip's money, and the trip's own came
     * after the answer on «Поход» — twice (review 36, adversarial round 4, Н5). Any trip's: a payment
     * names only the account it moves to, never the one it takes the trip off, and a removal names
     * none (review 37, round 5, Н6). The check itself is not held (Н4) and says why.
     */
    const tripsHeld = computed(() =>
      trips.pending.some((write) => countsMoney(write) && !tripsSend(write)),
    )

    // A spending is put right through the queue, a trip too: its answer comes after the sheet, and
    // the count is asked again once it has — any landing will do, the check is cheap. The queues
    // emptying count too: a write set aside lands nowhere.
    let recountOnLanding = false
    watch(
      () => [spendings.landed, trips.wrote, landedAll()],
      () => {
        if (!recountOnLanding || !landedAll()) return
        recountOnLanding = false
        void recount(props.open)
      },
    )

    // A write held on «Поход» moves once the person has answered there, or the question settled by
    // itself: from then it is waited on like any other — the difference muted until it lands, and
    // the same check asked again then (review 36, 37; adversarial round 5, Н7).
    watch(tripsHeld, (held, was) => {
      if (!was || held || !result.value) return
      recountPending.value = true
      // Gone without being sent — a refused trip taken away in another window — leaves nothing to
      // land: asked again at once (review, sixth pass).
      if (landedAll()) void recount(props.open)
      else recountOnLanding = true
    })

    useReconnect(() => {
      if (recountPending.value && landedAll()) void recount(props.open)
    })

    const reasonOpen = ref(false)
    const reasonOperation = ref<AccountOperationView | null>(null)
    function openReason(operation: AccountOperationView): void {
      reasonOperation.value = operation
      reasonOpen.value = true
    }
    /** A reason removed from its sheet: offered back here, and the difference is stale again. */
    function reasonRemoved(removed: Removed): void {
      removedReason.value = { ...removed, stamp: Date.now() }
      recountPending.value = true
      recountOnLanding = true
    }
    function restoreReason(): void {
      const removed = removedReason.value
      if (!removed) return
      spendings.restore(removed.undo)
      removedReason.value = null
      recountPending.value = true
      recountOnLanding = true
      announce?.(t('spending.restored'))
    }

    /** A trip whose removal waits in the queue is shown nowhere (MOL-76), a reason neither. */
    const reasons = computed(() =>
      (result.value?.reasons ?? []).filter(
        ({ operation }) => operation.kind !== 'trip' || !trips.removing.has(operation.id),
      ),
    )

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
     * «Прочее · сверка» for the sum the server gave, on this account. Below zero it is a spending,
     * written at once through its queue and the same check sent again once it has landed. Above zero
     * it is an income, and its sheet opens filled over this one — the person answers «сколько было
     * до», or the income would become the price of the whole currency (owner's decision В-5).
     */
    async function writeDifference(): Promise<void> {
      const value = result.value
      if (!value || writing.value || written.value || tripsHeld.value || !sent) return
      const size = {
        ...value.difference,
        minor: value.difference.minor < 0n ? -value.difference.minor : value.difference.minor,
      }
      if (value.difference.minor > 0n) {
        incomeDraft.value = {
          // Named once per answer, as the spending is: an income whose answer was lost and a
          // second «Записать разницу» are one income, not two (adversarial round 2, Н3).
          id: differenceId,
          amount: size,
          source: 'other',
          note: t('accounts.reconcile.note'),
          accountId: props.account.id,
          receivedOn: value.checkedOn,
        }
        incomeOpen.value = true
        return
      }
      writing.value = true
      failure.value = null
      const other = await otherCategory()
      // The answer may have moved on meanwhile: the difference written is the one still shown.
      if (!other || result.value !== value) {
        writing.value = false
        // Offline is not red; the categories are named, and «Повторить» writes, not recounts (35).
        if (!other) failure.value = navigator.onLine ? 'categories' : 'offline'
        return
      }
      spendings.record({
        id: differenceId,
        spentOn: value.checkedOn,
        amount: size,
        categoryId: other.id,
        note: t('accounts.reconcile.note'),
        accountId: props.account.id,
      })
      // Sent again once this spending has landed, whatever becomes of the sheet (В-5 MOL-115).
      store.repeatAfter(differenceId, props.account.id, sent)
      written.value = true
      writing.value = false
      announce?.(t('accounts.reconcile.written', { amount: signed(value.difference) }))
      emit('update:open', false)
    }

    /**
     * «Прочее» of the owner. None known — no list kept on this phone and the screen's unanswered —
     * is asked here once more (review 35): «Повторить» of a check recounted, and wrote nothing.
     */
    async function otherCategory(): Promise<SpendingCategoryView | null> {
      const isOther = (category: SpendingCategoryView) => category.preset === 'other'
      const known = props.categories.find(isOther)
      if (known) return known
      try {
        return (await api.spendingCategories()).categories.find(isOther) ?? null
      } catch (error) {
        reportFailure(error, 'screen')
        return null
      }
    }

    /** The income is written: the same check once more, here — it comes out even (В-5 MOL-115). */
    function incomeSaved(): void {
      const value = result.value
      if (value) announce?.(t('accounts.reconcile.written', { amount: signed(value.difference) }))
      written.value = true
      recountPending.value = true
      void recount(true)
    }
    function incomeUnavailable(): void {
      incomeOpen.value = false
      // failure reported where it failed: the income sheet's own load (MOL-144).
      failure.value = navigator.onLine ? 'error' : 'offline'
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
      failure,
      resultBox,
      removedReason,
      restoreReason,
      reasonRemoved,
      reasons,
      tripsHeld,
      incomeDraft,
      incomeOpen,
      incomeSaved,
      incomeUnavailable,
      recount,
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
  @include appear;

  display: grid;
  gap: var(--space-4);
}

.strip {
  @include appear;

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
  @include icon;

  font-size: var(--icon-sm);
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
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);

  &:focus-within {
    box-shadow: inset 0 0 0 2px var(--accent);
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
  @include icon;

  font-size: var(--icon-sm);
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
  @include icon;

  font-size: var(--state-glyph);
}

.matched-title,
.none-title {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.figure {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
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
  transition: opacity var(--dur) var(--ease-out);

  &.stale {
    opacity: var(--opacity-stale);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}

.difference-label {
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.difference-figure {
  @include display-type;

  font-size: var(--text-figure);
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
  @include icon;

  font-size: var(--icon-sm);
  color: var(--text-muted);
}

.failed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}

.undo {
  margin-bottom: var(--space-2);
}
</style>
