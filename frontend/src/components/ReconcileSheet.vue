<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('accounts.reconcile.title') }}</template>
    <template #meta>
      {{ t('accounts.reconcile.meta', { name: account.name, currency: currencyName }) }}
    </template>

    <!-- The connection is the kit's line, first in the sheet over either step, said in the sheet's
         own region (MOL-181, Ф-19); drawn by the connection and gone with it. Over a count already
         answered it says what waits, not «сверить» (review Р2-4, adversarial А2б) — the write only
         where it is offered, not over «Сходится» or a difference written (Р3-1, Б1). -->
    <StatusStrip v-if="!online" class="status" kind="offline" :text="t(offlineLine)" />

    <!-- Step one: the fact, before the count — so as not to fit the number (В-4 MOL-43). -->
    <form v-if="!result" ref="form" class="form" novalidate @submit.prevent="check">
      <div class="field">
        <AppField
          v-model="fact"
          :label="t('accounts.reconcile.question')"
          kind="decimal"
          size="entry"
          question
          autocomplete="off"
          :error-text="factBad ? t('accounts.reconcile.no_fact') : null"
          :aria-describedby="`${factId}-hint`"
          data-field="fact"
          @update:model-value="factBad = false"
        >
          <template #suffix>{{ sign }}</template>
        </AppField>
        <p :id="`${factId}-hint`" class="hint">{{ t('accounts.reconcile.hint') }}</p>
      </div>
    </form>

    <!-- Step two: the server's count, the difference and what could have made it. -->
    <!-- Said through the app's one live region (MOL-19), and the focus comes here: the field and
         the button it was on are gone (review 20). -->
    <div v-else ref="resultBox" class="result" tabindex="-1">
      <template v-if="matched">
        <div class="matched">
          <span class="circle" aria-hidden="true"><IconCheck class="circle-icon" /></span>
          <p class="matched-title">{{ t('accounts.reconcile.match_title') }}</p>
          <p class="figure" :style="figureChars(money(result.counted))">
            {{ money(result.counted) }}
          </p>
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
        <p class="difference">
          <span class="difference-label">{{ t('accounts.reconcile.difference') }}</span>
          <span class="difference-figure" :style="figureChars(signed(result.difference))">{{
            signed(result.difference)
          }}</span>
        </p>
        <!-- What the difference waits for is said in words, never by dimming it (round 3, Н4; Ф-6). -->
        <p v-if="recountPending" class="hint">{{ t('accounts.reconcile.recounting') }}</p>
        <p v-if="tripsHeld" class="hint">{{ t('accounts.reconcile.trips_held') }}</p>
        <AppButton variant="ghost" @click="again">
          {{ t('accounts.reconcile.edit_fact') }}
        </AppButton>

        <template v-if="reasons.length > 0">
          <section>
            <SectionCaption as="h3">
              {{ t('accounts.reconcile.causes_title', { date: shortDay(result.since) }) }}
            </SectionCaption>
            <AppCard as="ul" list>
              <AppReveal group>
                <OperationRow
                  v-for="reason in reasons"
                  :key="`${reason.kind}-${reason.operation.id}-${reason.operation.side ?? ''}`"
                  v-bind="reasonRow(reason)"
                  @open="openReason(reason.operation)"
                />
              </AppReveal>
            </AppCard>
          </section>
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
        <span class="failed-words">{{
          t(failure === 'categories' ? 'accounts.reconcile.no_other' : 'accounts.reconcile.failed')
        }}</span>
        <!-- «Повторить» of «Прочее» writes: it waits as «Записать разницу» does (adversarial А1); a
             recount waits for the connection (В2). Not now rather than gone, so a focus on it stays
             (Б2), and saying why on itself (Ф-6, В1). -->
        <AppButton
          v-if="result"
          class="retry"
          variant="ghost"
          :inactive="retryWait !== null"
          @click="failure === 'categories' ? writeDifference() : recount(true)"
        >
          <template v-if="retryWait === 'retry_wait_online'" #icon><IconCloudOff /></template>
          {{ retryWait ? t(`accounts.reconcile.${retryWait}`) : t('state.retry') }}
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
        <AppButton
          size="large"
          block
          :busy="sending"
          :busy-label="t('accounts.reconcile.checking')"
          :inactive="!online && !sending"
          @click="check"
        >
          <template #icon><IconScale v-if="online || sending" /><IconCloudOff v-else /></template>
          {{ online ? t('accounts.reconcile.check') : t('accounts.reconcile.wait_online') }}
        </AppButton>
      </template>
      <template v-else>
        <template v-if="!matched && !written">
          <!-- Tinted over «Готово», never a second fill (Ф-12, Ф-15); not now, it says why (Ф-6, С-10). -->
          <AppButton
            variant="tinted"
            block
            :busy="writing"
            :busy-label="t('accounts.reconcile.writing')"
            :inactive="!writing && writeWait !== null"
            @click="writeDifference"
          >
            <template v-if="writeWait === 'write_wait_online' && !writing" #icon>
              <IconCloudOff />
            </template>
            {{
              writeWait && !writing
                ? t(`accounts.reconcile.${writeWait}`)
                : t('accounts.reconcile.write_difference')
            }}
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
import IconCheck from '~icons/mdi/check'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import IconHelp from '~icons/mdi/help-circle-outline'
import IconScale from '~icons/mdi/scale-balance'
import { currencySign, formatMoney } from '@molvia/model'
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
import AppField from '@/components/AppField.vue'
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationIncomeSheet from '@/components/OperationIncomeSheet.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import {
  operationRowProps,
  parseSigned,
  shortDay as dayOf,
  signedAmount,
} from '@/components/accounts'
import type { Removed } from '@/components/spending'
import { figureChars } from '@/components/figure'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useFieldRefusal } from '@/composables/useFieldRefusal'
import type { IncomeDraft } from '@/composables/useIncomes'
import { useReconnect } from '@/composables/useReconnect'
import { newId } from '@/ids'
import { useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite } from '@/stores/tripQueue'
import { reportFailure } from '@/failures'

type Reason = AccountCheckResponse['reasons'][number]
/**
 * The fact being typed, or the server's answer shown: the screen behind hides its balance while the
 * fact is typed (Ф-33).
 */
export type ReconcileStep = 'fact' | 'result'
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
    AppField,
    AppReveal,
    BottomSheet,
    IconCheck,
    IconCloudOff,
    IconHelp,
    IconScale,
    OperationIncomeSheet,
    OperationRow,
    OperationSheet,
    SectionCaption,
    StatusStrip,
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
    step: (step: ReconcileStep) => typeof step === 'string',
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
    const form = ref<HTMLFormElement | null>(null)
    const factField = () => form.value?.querySelector<HTMLInputElement>('[data-field="fact"]')
    function focusFact(): void {
      factField()?.focus()
    }
    // An empty fact is heard (adversarial А1): the field is focused with its error, or, holding the
    // focus already — Enter in it, a tap on «Сверить» Safari does not focus — says it.
    const refuse = useFieldRefusal()
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
    /** An answer was shown since the sheet last started afresh: the count was in sight. */
    let answered = false

    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        // Every opening is blind, whatever the screen was last told — a sheet mounted anew has no
        // answer to clear, and said nothing (review Р2-3).
        emit('step', 'fact')
        // What was typed stays while no answer came — closed to come back with the connection, as the
        // offline line promises (adversarial А2). Once an answer was shown, the next check starts
        // afresh, a fact typed after «Ввести другую сумму» too: it was typed with the count in sight (Б3).
        if (answered) fact.value = ''
        answered = false
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
        focusFact()
      },
    )

    // A fact typed is of its account: the screen reused for another one starts afresh.
    watch(
      () => props.account.id,
      () => {
        fact.value = ''
      },
    )

    const sign = computed(() => currencySign(props.account.currency, locale.value))
    const currencyName = computed(() => t(`spending.currency_name.${props.account.currency}`))
    const money = (value: Money) => signedAmount(value, locale.value)
    const signed = (value: Money) => signedAmount(value, locale.value, { plus: true })
    const shortDay = (day: string) => dayOf(day, locale.value)
    const matched = computed(() => result.value?.difference.minor === 0n)
    /** Offline, in words of what waits for the connection: the check, the write, or nothing. */
    const offlineLine = computed(() => {
      if (!result.value) return 'accounts.reconcile.offline'
      return matched.value || written.value
        ? 'accounts.reconcile.offline_counted'
        : 'accounts.reconcile.offline_result'
    })

    // The screen is told the step as it changes: an answer shows the balance behind, «Ввести другую
    // сумму» hides it again (Ф-33).
    watch(
      () => result.value === null,
      (none) => {
        emit('step', none ? 'fact' : 'result')
      },
    )

    async function ask(check: Check): Promise<boolean> {
      failure.value = null
      const mine = ++asking
      try {
        const answer = await api.checkAccount(props.account.id, check)
        if (mine !== asking) return false
        sent = check
        answered = true
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
        void refuse(factField)
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
      void nextTick(focusFact)
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

    /**
     * Why «Записать разницу» cannot be pressed now, in the words on it (Ф-6, С-10): the connection
     * first — nothing is recounted without it — then the answer «Покупки» waits for, which the line
     * above says too (owner's В-1 «а»), then a correction still on its way.
     */
    const writeWait = computed(() => {
      if (!props.online) return 'write_wait_online'
      if (tripsHeld.value) return 'write_after_answer'
      if (recountPending.value) return 'write_after_recount'
      return null
    })

    /**
     * Why «Повторить» of the footer cannot be pressed now, in the words on it: a write waits as the
     * write does, a recount for the connection alone (adversarial В1, В2).
     */
    const retryWait = computed(() => {
      if (failure.value === 'categories') {
        if (writeWait.value === 'write_wait_online') return 'retry_wait_online'
        if (writeWait.value === 'write_after_answer') return 'retry_after_answer'
        if (writeWait.value === 'write_after_recount') return 'retry_after_recount'
        return null
      }
      return props.online ? null : 'retry_wait_online'
    })

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

    /**
     * A reason in its own words (handoff 05): the row's circle is the operation's, its title and its
     * meta the check's — the title says the sum already, so the row has no tail.
     */
    function reasonRow(reason: Reason) {
      return {
        ...operationRowProps(reason.operation, {
          t,
          locale: locale.value,
          categories: props.categories,
          nameOf: props.nameOf,
          accountName: props.accountName,
        }),
        title: reasonTitle(reason),
        meta: reasonMeta(reason),
        amount: null,
        sub: null,
      }
    }
    function reasonTitle({ kind, operation }: Reason): string {
      const [own] = operation.amounts
      const amount = own
        ? formatMoney({ ...own, minor: own.minor < 0n ? -own.minor : own.minor }, locale.value)
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
        ? formatMoney({ ...own, minor: own.minor < 0n ? -own.minor : own.minor }, locale.value)
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
      const amount = formatMoney({ ...value.difference, minor: size }, locale.value)
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
      // Every way in waits as the button does: «Повторить» of «Прочее» wrote over a count its
      // neighbour called stale — the correction and «Прочее» the same money twice (adversarial А1).
      if (!value || writing.value || written.value || writeWait.value !== null || !sent) return
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
      figureChars,
      t,
      factId,
      fact,
      factBad,
      form,
      result,
      sending,
      failure,
      resultBox,
      removedReason,
      restoreReason,
      reasonRemoved,
      reasons,
      tripsHeld,
      writeWait,
      retryWait,
      offlineLine,
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
      reasonRow,
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

.status {
  margin-bottom: var(--space-4);
}

.field {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-2);
}

.hint,
.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;
}

.note {
  margin: var(--space-2) 0;
  text-align: center;
}

.matched {
  /* The figure measures itself against the sheet's column, not the window (`figure-fit`, MOL-321). */
  container-type: inline-size;
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
  @include figure-fit;

  margin: 0;
  font-variant-numeric: tabular-nums;
}

.mismatch {
  margin: 0;
  font-size: var(--text-callout);
}

.difference {
  /* The figure measures itself against the plate, and goes under its word only where the two cannot
     stand side by side (`figure-fit`, MOL-321). */
  container-type: inline-size;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.difference-label {
  flex: 1 1 min-content;
  color: var(--text-muted);
  font-size: var(--text-callout);
}

.difference-figure {
  @include display-type;
  @include figure-fit;

  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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

  font-size: var(--icon-md);
  color: var(--text-muted);
}

/* The words beside a short «Повторить» while they have 8rem; a long word of waiting goes under them,
   at the right, rather than squeezing both into columns at 320 (review Р5-1). */
.failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0 0 var(--space-2);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}

.failed-words {
  flex: 1 1 8rem;
  min-width: 0;
}

.retry {
  margin-left: auto;
}

.undo {
  margin-bottom: var(--space-2);
}
</style>
