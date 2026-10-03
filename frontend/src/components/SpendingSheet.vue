<template>
  <BottomSheet
    :open="open"
    :back="back"
    :on-closed="afterClose"
    @update:open="$emit('update:open', $event)"
  >
    <template #title>{{ title }}</template>
    <template v-if="meta" #meta>{{ meta }}</template>

    <!-- A trip's spending is read here and amended in the trip (handoff 02, 4c). -->
    <div v-if="target.kind === 'trip'" class="summary">
      <p class="total">
        <span class="figure">{{ money(target.row.amount) }}</span>
        <span class="badge">
          <span class="dot" :style="{ background: tripColour }" aria-hidden="true"></span>
          {{ tripCategory }}
        </span>
      </p>
      <!-- The account of the trip: chosen here and saved at once, through the trip's queue (handoff
           06, 6h). Drawn once the trip is read — what it is on now is the server's. -->
      <AppReveal>
        <div v-if="showsAccounts && tripView" class="accounts" @focusout="saveTripCharge">
          <AccountRow
            :label="t('accounts.picker.row_trip')"
            :account="account"
            @open="pickerOpen = true"
          />
          <AppReveal>
            <ChargedField
              v-if="charged && account"
              v-model="debited"
              :account="account"
              :bad="debitedBad"
              @update:model-value="debitedBad = false"
            />
          </AppReveal>
          <p class="note">{{ t('accounts.trip_hint') }}</p>
        </div>
      </AppReveal>
      <p v-if="items === 'loading'" class="note">{{ t('state.loading') }}</p>
      <p v-else-if="items === 'offline'" class="note">
        {{ t('spending.sheet.trip_items_offline') }}
      </p>
      <p v-else-if="items === 'error'" class="note">{{ t('spending.sheet.trip_items_error') }}</p>
      <ul v-else class="items">
        <li v-for="item in items" :key="item.id" class="item">
          <span class="item-name">
            {{ item.name }} <span class="quantity">{{ item.quantity }}</span>
          </span>
          <span class="item-amount">{{ item.amount }}</span>
        </li>
      </ul>
      <p class="info">
        <IconInfo class="info-icon" aria-hidden="true" />{{ t('spending.sheet.trip_note') }}
      </p>
    </div>

    <form v-else class="form" novalidate @submit.prevent="submit">
      <p v-if="!online" class="strip offline">{{ t('spending.sheet.offline') }}</p>
      <p v-if="refusalText" class="strip refused" role="alert">{{ refusalText }}</p>

      <div class="field">
        <label :for="amountId" class="label">{{ t('spending.sheet.amount') }}</label>
        <div class="well" :class="{ bad: amountBad }">
          <input
            :id="amountId"
            ref="amountInput"
            v-model="amount"
            class="entry"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :placeholder="t('spending.sheet.amount_placeholder')"
            :aria-invalid="amountBad ? 'true' : undefined"
            :aria-describedby="amountBad ? `${amountId}-error` : undefined"
            @input="amountBad = false"
          />
          <span class="sign" aria-hidden="true">{{ sign(currency) }}</span>
        </div>
        <p v-if="amountBad" :id="`${amountId}-error`" class="error">
          <IconAlert class="alert" aria-hidden="true" />{{ t('spending.sheet.bad_amount') }}
        </p>
      </div>

      <div class="field">
        <SegmentedControl
          v-model="currency"
          :options="currencyOptions"
          :legend="t('spending.sheet.currency')"
          hide-legend
        />
        <AppReveal>
          <p v-if="conversion" class="conversion">{{ conversion }}</p>
        </AppReveal>
      </div>

      <!-- Where the money came from, beside the sum it is about (handoff 06). No account at all —
           no row: the sheet is as it was before accounts. -->
      <template v-if="showsAccounts">
        <AccountRow
          :label="t('accounts.picker.row_spending')"
          :account="account"
          @open="pickerOpen = true"
        />
        <AppReveal>
          <ChargedField
            v-if="charged && account"
            v-model="debited"
            :account="account"
            :estimate="chargedEstimate"
            :bad="debitedBad"
            @update:model-value="debitedBad = false"
          />
        </AppReveal>
      </template>

      <CategoryChips
        v-model="categoryId"
        :categories="choice"
        :name-of="nameOf"
        :legend="t('spending.sheet.category')"
        :add-label="t('spending.sheet.add_category')"
        :error="categoryBad ? t('spending.sheet.bad_category') : null"
        @update:model-value="categoryBad = false"
        @add="$emit('add-category')"
      />

      <AppField
        v-model="day"
        :label="t('spending.sheet.date')"
        kind="date"
        min="2000-01-02"
        :max="latest"
        :display="dayWords"
        :error-text="dayBad ? t('spending.sheet.bad_day') : null"
        @update:model-value="dayBad = false"
      />

      <AppField
        v-model="note"
        :label="t('spending.sheet.note')"
        :placeholder="t('spending.sheet.note_placeholder')"
        :maxlength="textMax"
        :error-text="noteBad ? t('spending.sheet.bad_text') : null"
        enterkeyhint="next"
      >
        <template #label-extra>
          <span class="optional">{{ t('spending.sheet.optional') }}</span>
        </template>
      </AppField>
      <AppField
        v-model="place"
        :label="t('spending.sheet.place')"
        :placeholder="t('spending.sheet.place_placeholder')"
        :maxlength="textMax"
        :error-text="placeBad ? t('spending.sheet.bad_text') : null"
        enterkeyhint="done"
      >
        <template #label-extra>
          <span class="optional">{{ t('spending.sheet.optional') }}</span>
        </template>
      </AppField>

      <!-- Last in the form and never in the footer: a second action must not argue with
           «Сохранить» under the thumb (handoff 02). Nothing typed goes to the trip — there a
           purchase starts from an item, not from a sum. -->
      <button v-if="target.kind === 'add'" type="button" class="shop" @click="toTrip">
        <span class="shop-icon" aria-hidden="true"><IconCart /></span>
        <span class="shop-text">
          <span class="shop-title">{{ t('spending.sheet.shop_title') }}</span>
          <span class="shop-body">{{ t('spending.sheet.shop_body') }}</span>
        </span>
        <span class="shop-action">{{ t('spending.sheet.shop_action') }}</span>
      </button>
    </form>

    <template #footer>
      <AppButton v-if="target.kind === 'trip'" size="large" block @click="openTrip">
        <template #icon><IconCart /></template>
        {{ t('spending.sheet.trip_open') }}
      </AppButton>
      <template v-else>
        <AppButton size="large" block @click="submit">
          <template #icon><IconCheck /></template>
          {{ t('spending.sheet.save') }}
        </AppButton>
        <AppButton v-if="refusal" variant="danger-ghost" block @click="dismiss">
          {{ t('spending.sheet.dismiss') }}
        </AppButton>
        <AppButton
          v-else-if="target.kind === 'manual'"
          variant="danger-ghost"
          block
          @click="remove"
        >
          <template #icon><IconDelete /></template>
          {{ t('spending.sheet.remove') }}
        </AppButton>
      </template>
    </template>
  </BottomSheet>
  <AccountPickerSheet
    v-model:open="pickerOpen"
    :title="t(target.kind === 'trip' ? 'accounts.picker.row_trip' : 'accounts.picker.row_spending')"
    :accounts="accounts.accounts"
    :currency="operationCurrency"
    :selected="accountId"
    @pick="pick"
  />
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCart from '~icons/mdi/cart-outline'
import IconCheck from '~icons/mdi/check'
import IconDelete from '~icons/mdi/trash-can-outline'
import IconInfo from '~icons/mdi/information-outline'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  SPENDING_TEXT_MAX,
  convertAcross,
  currencySchema,
  currencySign,
  decimalFromMinor,
  formatEstimate,
  formatMoney,
  formatQuantity,
  isWireCode,
  parseMoney,
  spendingTextSchema,
  isRateDay,
} from '@molvia/model'
import type { Currency, ExchangeRate, Money, SpendingCategoryView, TripView } from '@molvia/model'
import { api } from '@/api'
import AccountPickerSheet from '@/components/AccountPickerSheet.vue'
import AccountRow from '@/components/AccountRow.vue'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import ChargedField from '@/components/ChargedField.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { defaultAccount, pageOrder } from '@/components/accounts'
import { asTyped, categoryColour, groceriesOf, rateWords } from '@/components/spending'
import type { JournalRow, Removed, SpendingTarget } from '@/components/spending'
import { shown } from '@/composables/useItemDetails'
import { calendarDay, localDay, shiftDay } from '@/days'
import { afterStep, useNavigation } from '@/navigation'
import { newId } from '@/ids'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import type { SpendingFields } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'

type TripRow = Extract<JournalRow, { kind: 'trip' }>

interface TripItem {
  readonly id: string
  readonly name: string
  readonly quantity: string
  readonly amount: string
}

/**
 * The sheet of a spending (MOL-82, handoff 02): «Новая трата», one's own amended, or a finished
 * trip's line read. It never waits on the network — every write goes through the queue (MOL-24)
 * and the sheet closes at once; a refusal comes back as «Не принята» on the row, and the sheet
 * opened on it names it (Р-4). The numbers typed are checked on «Сохранить», not under the finger.
 */
export default defineComponent({
  name: 'SpendingSheet',
  components: {
    AccountPickerSheet,
    AccountRow,
    AppButton,
    AppField,
    AppReveal,
    BottomSheet,
    CategoryChips,
    ChargedField,
    IconAlert,
    IconCart,
    IconCheck,
    IconDelete,
    IconInfo,
    SegmentedControl,
  },
  props: {
    open: { type: Boolean, required: true },
    /** Opened over another sheet — a check, «не попали» (MOL-123): «‹» back to it, no ×. */
    back: { type: Boolean, default: false },
    target: { type: Object as PropType<SpendingTarget>, required: true },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    spendCurrency: { type: String as PropType<Currency>, required: true },
    /** The rate of the running month — «мой курс на сегодня» — between the two currencies. */
    rate: { type: Object as PropType<ExchangeRate | null>, default: null },
    online: { type: Boolean, default: true },
    /** A category just made from this sheet: chosen as soon as it exists (В-1). */
    made: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    'add-category': () => true,
    saved: (saved: { id: string; spentOn: string }) => typeof saved.id === 'string',
    /** The account of a trip, or its «списано», went into the trip's queue from the summary. */
    paid: () => true,
    removed: (removed: Removed) => typeof removed === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const router = useRouter()
    const { goTab } = useNavigation()
    const queue = useSpendingQueueStore()
    const amountId = useId()

    const amount = ref('')
    const currency = ref<Currency>('AMD')
    const categoryId = ref<string | null>(null)
    const today = ref(localDay())
    const day = ref(today.value)
    /**
     * The latest day the sheet lets through: the phone's today, or the day of the spending being
     * amended when that is later — a correction of a check or a spending from a phone further east
     * is dated by a day this one has not reached, and its note must still be amendable (MOL-121,
     * adversarial Л). The server takes up to `latestDay`.
     */
    const kept = ref<string | null>(null)
    const latest = computed(() =>
      kept.value !== null && kept.value > today.value ? kept.value : today.value,
    )
    const note = ref('')
    const place = ref('')
    const amountBad = ref(false)
    const categoryBad = ref(false)
    const noteBad = ref(false)
    const dayBad = ref(false)
    const placeBad = ref(false)
    const amountInput = ref<HTMLInputElement | null>(null)
    const items = ref<TripItem[] | 'loading' | 'offline' | 'error'>('loading')
    let after: (() => void) | null = null

    // The account (MOL-123, handoff 06): the screen puts the default in, the server never guesses.
    const accounts = useAccountsStore()
    const trips = useTripQueueStore()
    const announce = useAnnouncer()
    const accountId = ref<string | null>(null)
    /** Chosen by the person — a change of currency no longer moves it. */
    const byHand = ref(false)
    const debited = ref('')
    const debitedBad = ref(false)
    const pickerOpen = ref(false)
    /** «Списано» the spending was opened with — sent back as it was when its account is unknown. */
    let knownDebited: Money | null = null
    /** The trip as the server holds it, for its account and currencies. */
    const tripView = ref<TripView | null>(null)
    const account = computed(
      () => accounts.accounts.find((one) => one.id === accountId.value) ?? null,
    )
    const showsAccounts = computed(
      () => pageOrder(accounts.accounts).length > 0 || account.value !== null,
    )
    const operationCurrency = computed<Currency>(() =>
      props.target.kind === 'trip'
        ? (tripView.value?.currency ?? props.target.row.amount.currency)
        : currency.value,
    )
    /**
     * «Списано со счёта» where the money was in another currency than the account's — for a trip,
     * the trip's own or any of its purchases' (Р-30 MOL-115).
     */
    const charged = computed(() => {
      const held = account.value
      if (!held) return false
      if (props.target.kind !== 'trip') return held.currency !== currency.value
      const trip = tripView.value
      return (
        held.currency !== operationCurrency.value ||
        (trip?.expenses.some(
          (expense) => expense.amount && expense.amount.currency !== held.currency,
        ) ??
          false)
      )
    })

    const money = (value: Money) => formatMoney(value, locale.value)
    const sign = (value: Currency) => currencySign(value, locale.value)
    const typed = (value: Money) =>
      shown(decimalFromMinor(value), locale.value === 'ru' ? ',' : '.')

    const manual = computed(() => (props.target.kind === 'manual' ? props.target.row : null))
    const refusal = computed(() => manual.value?.refusal ?? null)

    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        after = null
        today.value = localDay()
        kept.value = manual.value?.spending.spentOn ?? null
        // A refused write opens on what the person typed, not on what the server holds: their
        // correction is the thing to fix and send again (requirement 15). The categories and the
        // revision stay the row's.
        const refused = refusal.value?.write
        const typedBody =
          refused?.kind === 'record' || refused?.kind === 'amend' ? refused.body : null
        const spending = typedBody
          ? {
              ...manual.value?.spending,
              amount: typedBody.amount,
              spentOn: typedBody.spentOn,
              categoryId: typedBody.categoryId,
              note: typedBody.note ?? null,
              place: typedBody.place ?? null,
            }
          : manual.value?.spending
        amount.value = spending ? typed(spending.amount) : ''
        currency.value = spending?.amount.currency ?? props.spendCurrency
        categoryId.value = spending?.categoryId ?? null
        // The month looked at is a view, not a context of input: a new spending is today's.
        day.value = spending?.spentOn ?? today.value
        note.value = spending?.note ?? ''
        place.value = spending?.place ?? ''
        // A record with no purchases handed over (MOL-78, В-1): its shop and day, in «Продукты».
        const prefill = props.target.kind === 'add' ? props.target.prefill : undefined
        if (prefill) {
          categoryId.value = groceriesOf(props.categories)
          day.value = prefill.day
          place.value = prefill.place
        }
        amountBad.value = false
        categoryBad.value = false
        noteBad.value = false
        placeBad.value = false
        dayBad.value = false
        debitedBad.value = false
        pickerOpen.value = false
        tripView.value = null
        // An amendment keeps the account it was written with, a removed one too, until changed.
        const typedAccount = typedBody?.accountId
        byHand.value = props.target.kind !== 'add'
        accountId.value =
          typedAccount !== undefined
            ? typedAccount
            : spending
              ? (spending.accountId ?? null)
              : (defaultAccount(accounts.accounts, currency.value)?.id ?? null)
        const typedDebited = typedBody?.debited ?? spending?.debited ?? null
        knownDebited = typedDebited
        debited.value = typedDebited ? typed(typedDebited) : ''
        if (props.target.kind === 'trip') void loadTrip(props.target.row)
        // The keyboard comes up for a new spending — the sum is what it is opened for — and not
        // for an amendment, where the person came to look first.
        if (props.target.kind === 'add') {
          await nextTick()
          amountInput.value?.focus()
        }
      },
      { immediate: true },
    )

    // A new spending follows its currency to the first account of it — until one is chosen by hand;
    // and the accounts may only arrive after the sheet has opened.
    watch([currency, () => accounts.accounts], () => {
      if (!props.open || props.target.kind !== 'add' || byHand.value) return
      const next = defaultAccount(accounts.accounts, currency.value)?.id ?? null
      if (next !== accountId.value) debited.value = ''
      accountId.value = next
    })

    // The categories may come after the sheet has opened on a record handed over.
    watch(
      () => props.categories,
      (categories) => {
        if (!props.open || props.target.kind !== 'add' || !props.target.prefill) return
        categoryId.value ??= groceriesOf(categories)
      },
    )

    watch(
      () => props.made,
      (made) => {
        if (made) {
          categoryId.value = made
          categoryBad.value = false
        }
      },
    )

    async function loadTrip(row: TripRow): Promise<void> {
      items.value = 'loading'
      try {
        const trip = await api.trip(row.tripId)
        // Another trip opened meanwhile: this answer is not its account (review 8).
        if (props.target.kind !== 'trip' || props.target.row.tripId !== row.tripId) return
        tripView.value = trip
        accountId.value = trip.accountId
        debited.value = trip.debited ? typed(trip.debited) : ''
        items.value = trip.expenses
          .filter((expense) => expense.amount?.currency === row.amount.currency)
          .map((expense) => ({
            id: expense.id,
            name: expense.item.name,
            quantity: expense.quantity ? formatQuantity(expense.quantity, locale.value) : '',
            amount: expense.amount ? money(expense.amount) : '',
          }))
      } catch (error) {
        const answered = error instanceof ApiError && error.answered
        items.value = !answered && !navigator.onLine ? 'offline' : 'error'
      }
    }

    const title = computed(() => {
      if (props.target.kind === 'trip')
        return t('spending.trip_row_title', { place: props.target.row.placeName })
      return t(
        props.target.kind === 'add' ? 'spending.sheet.title_add' : 'spending.sheet.title_edit',
      )
    })
    // A calendar day, whatever the zone of the phone (review Т-1).
    const dayOf = (value: string) => calendarDay(value, locale.value)
    const meta = computed(() => {
      if (props.target.kind === 'trip') {
        const { row, day: finished } = props.target
        const date = calendarDay(finished, locale.value, {
          weekday: 'short',
          day: 'numeric',
          month: 'long',
        })
        return t('spending.sheet.trip_meta', { date, n: row.items }, row.items)
      }
      const spending = manual.value?.spending
      return spending ? t('spending.sheet.meta_edit', { date: dayOf(spending.spentOn) }) : null
    })

    const groceries = computed(
      () => props.categories.find((category) => category.preset === 'groceries') ?? null,
    )
    const tripCategory = computed(() =>
      groceries.value ? props.nameOf(groceries.value) : t('spending.category.groceries'),
    )
    const tripColour = computed(() =>
      groceries.value ? categoryColour(groceries.value) : 'var(--cat-groceries)',
    )

    /** The live categories, and the one this spending already has even when it was taken out. */
    const choice = computed(() =>
      props.categories.filter(
        (category) => !category.archived || category.id === manual.value?.spending.categoryId,
      ),
    )

    const currencyOptions = computed(() =>
      currencySchema.options.map((value) => ({
        value,
        label: sign(value),
        spoken: t(`spending.currency_name.${value}`),
      })),
    )

    /** A day the server takes: a calendar day from 2000 on, and not after `latest`. */
    const dayGood = computed(() => isRateDay(day.value) && day.value <= latest.value)

    // A cleared field — «Сбросить» of the iOS picker — is no day to name, and a date nobody can
    // print must not take the sheet down with it (adversarial Д2).
    const dayWords = computed(() => {
      if (!isRateDay(day.value)) return ''
      const date = dayOf(day.value)
      if (day.value === today.value) return t('spending.sheet.date_today', { date })
      if (day.value === shiftDay(today.value, -1))
        return t('spending.sheet.date_yesterday', { date })
      return date
    })

    function parsed(): Money | null {
      try {
        const value = parseMoney(amount.value, currency.value)
        return value.minor > 0n ? value : null
      } catch {
        return null
      }
    }

    /**
     * «≈ 1 082 ₽ по моему курсу 4,62 ֏ за 1 ₽» while typing — the model's own conversion, the one
     * exception MOL-24 allows the phone. Only between the two currencies the running month's rate
     * joins; a third is counted by the rate of its day, by the server (Р-5).
     */
    const conversion = computed(() => {
      const value = parsed()
      if (!value) return null
      const rate = props.rate
      if (value.currency === props.spendCurrency && !rate) return null
      if (!rate || (value.currency !== rate.base && value.currency !== rate.quote))
        return t('spending.sheet.conversion_later')
      const into = convertAcross(value, rate)
      if (!into) return null
      const words = {
        amount: formatEstimate(into, locale.value),
        rate: rateWords(rate, locale.value, t),
      }
      return rate.source === 'personal'
        ? t('spending.sheet.conversion_mine', words)
        : t('spending.sheet.conversion_official', words)
    })

    /** «≈ 2 140,91 ₽» — what the server would count, where the account's rate joins the two. */
    const chargedEstimate = computed(() => {
      const value = parsed()
      const rate = account.value?.rate
      if (!value || !rate) return null
      return convertAcross(value, rate)
    })

    function parsedCharge(): Money | null | 'bad' {
      const held = account.value
      if (!held || !charged.value || !debited.value.trim()) return null
      try {
        const value = parseMoney(debited.value, held.currency)
        return value.minor > 0n ? value : 'bad'
      } catch {
        return 'bad'
      }
    }

    function pick(id: string | null): void {
      if (id === accountId.value) return
      accountId.value = id
      byHand.value = true
      debited.value = ''
      debitedBad.value = false
      if (props.target.kind === 'trip') {
        payTrip(null)
        // What the server now holds: the new account, and no «списано» for it yet (review 2).
        if (tripView.value) tripView.value = { ...tripView.value, accountId: id, debited: null }
        const name = accounts.accounts.find((one) => one.id === id)?.name
        announce?.(
          name ? t('accounts.picker.trip_saved', { name }) : t('accounts.picker.trip_saved_none'),
        )
      }
    }

    /** The account of a trip, whole, through the trip's queue: at once, no «Сохранить» (6h). */
    function payTrip(charge: Money | null): void {
      if (props.target.kind !== 'trip') return
      trips.enqueue({
        kind: 'payment',
        tripId: props.target.row.tripId,
        body: { accountId: accountId.value, debited: accountId.value ? charge : null },
      })
      // A check over this summary counts again once it lands (review 1).
      emit('paid')
    }

    /** «Списано» of a trip is saved once the field is left, if it changed. */
    function saveTripCharge(event: FocusEvent): void {
      const leaving = event.currentTarget as HTMLElement | null
      if (leaving?.contains(event.relatedTarget as Node | null)) return
      // Nothing to say about an account the phone does not know — least of all by a look (review 4).
      if (!account.value || !charged.value) return
      const charge = parsedCharge()
      if (charge === 'bad') {
        debitedBad.value = true
        return
      }
      const before = tripView.value?.debited ?? null
      if (
        (charge?.minor ?? null) === (before?.minor ?? null) &&
        (charge?.currency ?? null) === (before?.currency ?? null)
      )
        return
      payTrip(charge)
      if (tripView.value) tripView.value = { ...tripView.value, debited: charge }
    }

    const refusalText = computed(() => {
      const item = refusal.value
      if (!item) return null
      if (item.code === ERROR.CONFLICT) return t('spending.sheet.refused_conflict')
      const reason =
        isWireCode(item.code) && item.code.startsWith('error.') ? t(item.code) : item.code
      return t('spending.sheet.refused', { reason })
    })

    const textMax = SPENDING_TEXT_MAX

    function text(value: string): { value?: string; bad: boolean } {
      if (!value.trim()) return { bad: false }
      const checked = spendingTextSchema.safeParse(value)
      return checked.success ? { value: checked.data, bad: false } : { bad: true }
    }

    async function submit(): Promise<void> {
      const value = parsed()
      amountBad.value = !value
      // One of the chips on screen: a category the server has refused as unknown stands on no
      // chip, and sending it again earns the same refusal (adversarial Ж).
      const chosen = choice.value.find((category) => category.id === categoryId.value) ?? null
      categoryBad.value = chosen === null
      dayBad.value = !dayGood.value
      const typedNote = text(note.value)
      const typedPlace = text(place.value)
      noteBad.value = typedNote.bad
      placeBad.value = typedPlace.bad
      const charge = parsedCharge()
      debitedBad.value = charge === 'bad'
      if (
        !value ||
        !chosen ||
        dayBad.value ||
        typedNote.bad ||
        typedPlace.bad ||
        charge === 'bad'
      ) {
        await nextTick()
        // The first field that is wrong gets the focus (handoff 02).
        if (!value) amountInput.value?.focus()
        else
          document
            .querySelector<HTMLInputElement>('.chips-field input, .form [aria-invalid="true"]')
            ?.focus()
        return
      }
      const fields: SpendingFields = {
        spentOn: day.value,
        amount: value,
        categoryId: chosen.id,
        ...(typedNote.value === undefined ? {} : { note: typedNote.value }),
        ...(typedPlace.value === undefined ? {} : { place: typedPlace.value }),
        // Always said once accounts exist: left out, the server keeps the account it has (Р-26).
        ...(showsAccounts.value
          ? {
              accountId: accountId.value,
              // An account this phone does not know — made or marked on another — keeps the
              // «списано» it was written with: a note amended here must not undo it (review 4).
              debited: !accountId.value ? null : account.value ? charge : knownDebited,
            }
          : {}),
      }
      const row = manual.value
      const refused = refusal.value
      if (refused) queue.dismiss(refused)
      const id = row?.spending.id ?? newId()
      if (!row) queue.record({ id, ...fields })
      // A refused record goes again as a record; one still waiting is amended over the revision
      // its record makes, which folds into it while nobody has begun to send it (review Т-4).
      else if (refused?.write.kind === 'record') queue.record({ id: row.spending.id, ...fields })
      else if (row.local) queue.amend(row.spending.id, 1, fields)
      // «Сохраните ещё раз поверх»: over what the server holds when it leaves, asked of it then —
      // the revision on screen may be the very one that conflicted (adversarial round 6, О).
      else
        queue.amend(
          row.spending.id,
          row.spending.revision,
          fields,
          refused?.write.kind === 'amend' && refused.code === ERROR.CONFLICT,
        )
      // Told once the sheet is away: a move of the month made while it was open was undone by the
      // step back that closes it (adversarial И).
      after = () => {
        emit('saved', { id, spentOn: fields.spentOn })
      }
      emit('update:open', false)
    }

    function remove(): void {
      const row = manual.value
      if (!row) return
      const undo = queue.remove(row.spending.id)
      emit('removed', {
        undo,
        title:
          row.spending.note ??
          props.nameOf(
            props.categories.find((one) => one.id === row.spending.categoryId) ?? {
              id: '',
              preset: 'other',
              name: null,
              colour: null,
              archived: false,
            },
          ),
        amount: asTyped(row.spending.amount, locale.value),
      })
      emit('update:open', false)
    }

    function dismiss(): void {
      if (refusal.value) queue.dismiss(refusal.value)
      emit('update:open', false)
    }

    /**
     * «Покупки ›»: the sheet goes first, then the tab — after the sheet's own step has landed
     * (`afterStep`, review Р-11): told it is closed from inside that step, a tab tapped there was
     * dropped as a second tap, and the person stayed on «Деньги».
     */
    function toTrip(): void {
      after = () => {
        afterStep(() => void goTab('purchases'))
      }
      emit('update:open', false)
    }

    function openTrip(): void {
      if (props.target.kind !== 'trip') return
      const tripId = props.target.row.tripId
      // Back to the screen it was opened from — «Траты» since MOL-159 (`meta.from`, MOL-82 В-3).
      const from =
        router.currentRoute.value.name === 'money-spendings' ? 'money-spendings' : 'money'
      after = () => void router.push({ name: 'purchase', params: { tripId }, query: { from } })
      emit('update:open', false)
    }

    function afterClose(): void {
      const next = after
      after = null
      next?.()
    }

    return {
      t,
      amountId,
      amount,
      currency,
      categoryId,
      day,
      today,
      latest,
      note,
      place,
      amountBad,
      categoryBad,
      noteBad,
      placeBad,
      dayBad,
      amountInput,
      items,
      money,
      sign,
      title,
      meta,
      tripCategory,
      tripColour,
      choice,
      currencyOptions,
      dayWords,
      conversion,
      accounts,
      accountId,
      account,
      showsAccounts,
      operationCurrency,
      charged,
      chargedEstimate,
      debited,
      debitedBad,
      pickerOpen,
      tripView,
      pick,
      saveTripCharge,
      refusal,
      refusalText,
      textMax,
      submit,
      remove,
      dismiss,
      toTrip,
      openTrip,
      afterClose,
    }
  },
})
</script>

<style scoped lang="scss">
.accounts {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form {
  /* A column, not a grid: a block of it grows and goes by `AppReveal`, which takes a flex
     column's gap back with the block — a grid's stays and jumped (MOL-151, adversarial Б2). */
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
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

  /* An input is as wide as its `size` in its own font — at 40 px that is wider than the phone. */
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

.conversion {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.optional {
  margin-left: var(--space-1);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}

.strip {
  @include appear;

  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-footnote);

  &.offline {
    background: var(--warn-tint);
    color: var(--warn-ink);
  }

  &.refused {
    background: var(--bad-tint);
    color: var(--bad-ink);
  }
}

.shop {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 3.75rem;
  padding: var(--space-3);
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

.shop-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  background: var(--accent-tint);
  color: var(--accent-ink);

  svg {
    @include icon;

    font-size: var(--state-glyph);
  }
}

.shop-text {
  display: grid;
  flex: 1;
  min-width: 0;
}

.shop-title {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.shop-body {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.shop-action {
  flex: none;
  color: var(--accent-ink);
  font-weight: var(--weight-bold);
}

.summary {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

.total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;
}

.figure {
  @include display-type;

  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--badge-height);
  padding: 0 var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

.items {
  margin: 0;
  padding: 0;
  border-radius: var(--radius);
  background: var(--surface-2);
  list-style: none;
}

.item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);

  & + & {
    border-top: var(--hairline) solid var(--border);
  }
}

.item-name {
  min-width: 0;
  font-size: var(--text-callout);
  overflow-wrap: anywhere;
}

.quantity {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.item-amount {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.note,
.info {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.info {
  display: flex;
  gap: var(--space-2);
}

.info-icon {
  @include icon;

  font-size: var(--icon-sm);
}
</style>
