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
        <span class="figure" :style="figureChars(money(target.row.amount))">{{
          money(target.row.amount)
        }}</span>
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
      <!-- The answer's shape (Ф-13): four rows «name · sum» in the card of the items. -->
      <ScreenSkeleton v-if="items === 'loading'">
        <ul class="items">
          <li v-for="n in 4" :key="n" class="item ghost-item">
            <span class="ghost-line"><span class="ghost-bar ghost-name"></span></span>
            <span class="ghost-line"><span class="ghost-bar ghost-amount"></span></span>
          </li>
        </ul>
      </ScreenSkeleton>
      <p v-else-if="items === 'offline'" class="note">
        {{ t('spending.sheet.trip_items_offline') }}
      </p>
      <!-- A section's error is the kit's quiet card (MOL-180, owner's В-1 «а» of MOL-199). -->
      <ScreenState
        v-else-if="items === 'error'"
        kind="error"
        inline
        :title="t('spending.sheet.trip_items_error')"
        @retry="retryItems"
      />
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

    <form v-else ref="form" class="form" novalidate @submit.prevent="submit">
      <!-- The kit's strip, in the sheet's words (Ф-14, MOL-181): never red, and «Сохранить трату» works. -->
      <StatusStrip v-if="!online" kind="offline" :text="t('spending.sheet.offline')" />
      <p v-if="refusalText" class="refused" role="alert">{{ refusalText }}</p>

      <AppField
        v-model="amount"
        :label="t('spending.sheet.amount')"
        kind="decimal"
        size="entry"
        autocomplete="off"
        :placeholder="t('spending.sheet.amount_placeholder')"
        :error-text="amountBad ? t('spending.sheet.bad_amount') : null"
        data-field="amount"
        @update:model-value="amountBad = false"
      >
        <template #suffix>{{ sign(currency) }}</template>
      </AppField>

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
      <div v-if="showsAccounts" class="field">
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
      </div>

      <CategoryChips
        v-model="categoryId"
        :categories="chips"
        :name-of="nameOf"
        :legend="t('spending.sheet.category')"
        :more-label="t('spending.sheet.more')"
        :error="categoryBad ? t('spending.sheet.bad_category') : null"
        @update:model-value="categoryBad = false"
        @more="moreOpen = true"
        @lift="lead = $event"
      />

      <!-- The day, the note and the place behind one line (MOL-199, Ф-17): almost never changed, they
           took three fields under the chips and pushed the form off the screen. -->
      <NavRow
        field
        :icon="IconCalendar"
        :label="details"
        :aria-label="t('spending.sheet.details_label', { value: details })"
        :invalid="dayBad || noteBad || placeBad"
        @click="openDetails(null)"
      />

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
  <CategoryPickerSheet
    v-model:open="moreOpen"
    :categories="chips"
    :name-of="nameOf"
    :selected="categoryId"
    @pick="pickCategory"
    @add="$emit('add-category')"
  />
  <SpendingDetailsSheet
    v-model:open="detailsOpen"
    v-model:day="day"
    v-model:note="note"
    v-model:place="place"
    :latest="latest"
    :display="dayWords"
    :day-bad="dayBad"
    :note-bad="noteBad"
    :place-bad="placeBad"
    :focus="detailsFocus"
    @update:day="dayBad = false"
    @update:note="noteBad = false"
    @update:place="placeBad = false"
  />
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconCalendar from '~icons/mdi/calendar-blank-outline'
import IconCart from '~icons/mdi/cart-outline'
import IconCheck from '~icons/mdi/check'
import IconDelete from '~icons/mdi/trash-can-outline'
import IconInfo from '~icons/mdi/information-outline'
import { ApiError } from '@molvia/client'
import {
  ERROR,
  convertAcross,
  currencySchema,
  currencySign,
  decimalFromMinor,
  drawsNothing,
  formatEstimate,
  formatMoney,
  formatQuantity,
  isWireCode,
  parseMoney,
  spendingIn,
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
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import ChargedField from '@/components/ChargedField.vue'
import NavRow from '@/components/NavRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import SpendingDetailsSheet from '@/components/SpendingDetailsSheet.vue'
import { defaultAccount, pageOrder } from '@/components/accounts'
import { figureChars } from '@/components/figure'
import {
  bankWords,
  categoryColour,
  chipOrder,
  detailsLine,
  groceriesOf,
  rateWords,
} from '@/components/spending'
import type {
  JournalRow,
  Removed,
  SpendingDetailsField,
  SpendingTarget,
} from '@/components/spending'
import { shown } from '@/composables/useItemDetails'
import { calendarDay, localDay, shiftDay } from '@/days'
import { afterStep, useNavigation } from '@/navigation'
import { newId } from '@/ids'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useFieldRefusal } from '@/composables/useFieldRefusal'
import { useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import type { SpendingFields } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { reportFailure } from '@/failures'

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
    CategoryPickerSheet,
    ChargedField,
    IconCart,
    IconCheck,
    IconDelete,
    IconInfo,
    NavRow,
    ScreenSkeleton,
    ScreenState,
    SegmentedControl,
    SpendingDetailsSheet,
    StatusStrip,
  },
  props: {
    open: { type: Boolean, required: true },
    /** Opened over another sheet — a check, «не попали» (MOL-123): «‹» back to it, no ×. */
    back: { type: Boolean, default: false },
    target: { type: Object as PropType<SpendingTarget>, required: true },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    /** The ids the chips stand first by, the most used first (MOL-198); none — the list's order. */
    frequent: { type: Array as PropType<readonly string[]>, default: () => [] },
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
    const form = ref<HTMLFormElement | null>(null)
    const amountField = () => form.value?.querySelector<HTMLInputElement>('[data-field="amount"]')
    function focusAmount(): void {
      amountField()?.focus()
    }
    const refuse = useFieldRefusal()
    const detailsOpen = ref(false)
    /** The field «Дата, заметка, место» opens on: the first wrong one, none for a tap on its line. */
    const detailsFocus = ref<SpendingDetailsField | null>(null)
    const items = ref<TripItem[] | 'loading' | 'offline' | 'error'>('loading')
    /** Which read of the items is the latest: an answer of an earlier one changes nothing. */
    let reading = 0
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

    /** The live categories, and the one this spending already has even when it was taken out. */
    const choice = computed(() =>
      props.categories.filter(
        (category) => !category.archived || category.id === manual.value?.spending.categoryId,
      ),
    )

    // The order of the chips, taken when the sheet opens (MOL-198): an answer landing while it is up
    // moves none of them — one that comes after is put at the end, one gone is taken out.
    const order = ref(chipOrder(choice.value, props.frequent).map((category) => category.id))
    // The chosen one standing first: put there at the opening, on a return from «Ещё…» — by a choice
    // there, by «‹», Esc or «back» alike (adversarial А4) — and for one just made, never by a tap on a
    // chip, which would move the chips under the finger (В-2 «а»). The list «Ещё…» stands in the order
    // of the chips, the chosen one first there too (adversarial А2).
    const lead = ref<string | null>(null)
    const moreOpen = ref(false)
    watch(moreOpen, (open, was) => {
      if (was && !open) lead.value = categoryId.value
    })
    watch(choice, (live) => {
      const ids = chipOrder(live, props.frequent).map((category) => category.id)
      const kept = order.value.filter((id) => ids.includes(id))
      order.value = [...kept, ...ids.filter((id) => !kept.includes(id))]
    })
    const byId = (id: string) => choice.value.find((category) => category.id === id)
    const listed = computed(() => order.value.flatMap((id) => byId(id) ?? []))
    // The one place the chosen one is put first: the chips and the list «Ещё…» alike — the chips ask it
    // of the sheet when a measure would lay the chosen one past their rows (`lift`, review 2, Р2-А1).
    const chips = computed(() => {
      const first = lead.value === null ? undefined : byId(lead.value)
      return first ? [first, ...listed.value.filter((one) => one !== first)] : listed.value
    })
    function pickCategory(id: string): void {
      categoryId.value = id
      categoryBad.value = false
      lead.value = id
    }

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
        // The chips stand as this opening finds them, the chosen one first, until the sheet is up
        // again (MOL-198, owner's В-2 «а»).
        order.value = chipOrder(choice.value, props.frequent).map((category) => category.id)
        lead.value = categoryId.value
        moreOpen.value = false
        detailsOpen.value = false
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
          focusAmount()
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
        if (categoryId.value !== null) return
        categoryId.value = groceriesOf(categories)
        lead.value = categoryId.value
      },
    )

    watch(
      () => props.made,
      (made) => {
        if (made) {
          categoryId.value = made
          categoryBad.value = false
          lead.value = made
        }
      },
    )

    async function loadTrip(row: TripRow): Promise<void> {
      const mine = ++reading
      items.value = 'loading'
      try {
        const trip = await api.trip(row.tripId)
        // Another trip opened meanwhile: this answer is not its account (review 8). Nor is a read the
        // sheet made before the one in hand — the same trip opened again, or «Повторить» over a server
        // that hung: its answer would put back what the later one replaced (self-review 1 of MOL-199).
        if (mine !== reading) return
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
        reportFailure(error, 'screen')
        if (mine !== reading) return
        const answered = error instanceof ApiError && error.answered
        items.value = !answered && !navigator.onLine ? 'offline' : 'error'
      }
    }

    /** «Повторить» of the items (Ф-15): the trip read again — the same read the opening made. */
    function retryItems(): void {
      if (props.target.kind === 'trip') void loadTrip(props.target.row)
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

    const currencyOptions = computed(() =>
      currencySchema.options.map((value) => ({
        value,
        label: sign(value),
        spoken: t(`spending.currency_name.${value}`),
      })),
    )

    /** A day the server takes: a calendar day from 2000 on, and not after `latest`. */
    const dayGood = computed(() => isRateDay(day.value) && day.value <= latest.value)

    const details = computed(() =>
      detailsLine(
        { day: day.value, note: note.value, place: place.value },
        locale.value,
        today.value,
        t('spending.sheet.details_none'),
      ),
    )

    function openDetails(focus: SpendingDetailsField | null): void {
      detailsFocus.value = focus
      detailsOpen.value = true
    }

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
      const held = keptRate(value)
      if (held !== undefined) return held
      const rate = props.rate
      if (value.currency === props.spendCurrency && !rate) return null
      if (!rate || (value.currency !== rate.base && value.currency !== rate.quote))
        return t('spending.sheet.conversion_later')
      const into = convertAcross(value, rate)
      return into ? conversionWords(into, rate) : null
    })

    /**
     * A spending the server holds keeps the rate of its own day while its day and currency stay —
     * the server keeps it so on «Сохранить» (`amendSpending`, Р-5 of MOL-73). So its «≈» is that
     * rate's, by the rule the row's «≈» is counted by, `spendingIn` (Е-10, MOL-184): the running
     * month's rate made one spending «≈ 15 051 ֏» in the journal and «≈ 15 077 ֏» here. With no
     * snapshot that counts — none was known when it was written, or one from before a move — the
     * server counts the row by the rate of its day as it reads the month, and takes that same rate on
     * «Сохранить»; it does not send the rate, so the sheet says the row's figure while the amount is
     * untouched, and «Посчитаем по курсу дня траты» once it is put right (owner's «а», review Р2-2,
     * adversarial А1). `undefined` where it is not that spending: one still on the phone, one in the
     * spending currency, a day or a currency changed — counted as one typed anew.
     */
    function keptRate(value: Money): string | null | undefined {
      const row = manual.value
      const spending = row && !row.local ? row.spending : null
      if (
        !spending ||
        spending.amount.currency === props.spendCurrency ||
        value.currency !== spending.amount.currency ||
        day.value !== spending.spentOn
      )
        return undefined
      const into =
        spending.rate && spendingIn({ amount: value, rate: spending.rate }, props.spendCurrency)
      if (into && spending.rate) return conversionWords(into, spending.rate)
      return row?.counted && value.minor === spending.amount.minor
        ? t('spending.sheet.conversion_counted', {
            amount: formatEstimate(row.counted, locale.value),
          })
        : t('spending.sheet.conversion_later')
    }

    function conversionWords(into: Money, rate: ExchangeRate): string {
      const words = {
        amount: formatEstimate(into, locale.value),
        rate: rateWords(rate, locale.value, t),
      }
      if (rate.source === 'personal') return t('spending.sheet.conversion_mine', words)
      const bank = bankWords(rate.base, rate.quote, t)
      // As on «Деньги»: a fallback names the pair's bank as silent, not as its source (review 1).
      return rate.source === 'fallback'
        ? t('spending.sheet.conversion_fallback', { ...words, bank })
        : t('spending.sheet.conversion_official', { ...words, bank })
    }

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

    // Nothing typed is what draws nothing — the measure of the line «Дата, заметка, место» too: a pasted
    // U+200B read «без заметки» there and was refused here (self-review 6 of MOL-199).
    function text(value: string): { value?: string; bad: boolean } {
      if (drawsNothing(value)) return { bad: false }
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
        // The first field that is wrong gets the focus (handoff 02), in the order of the form: the sum,
        // «списано», a chip — and only then the fields behind «Дата, заметка, место», whose sheet opens
        // on the wrong one (MOL-199). Opened over an error above it, it would hide the error.
        // Heard either way, by the field's own error (adversarial А1, Р2-А1): a focus already in
        // «списано» moves nothing, and the sheet's own form is looked in, never the document's.
        if (!value) void refuse(amountField)
        else if (charge === 'bad' || !chosen)
          void refuse(() => form.value?.querySelector<HTMLElement>('[aria-invalid="true"]'))
        else openDetails(dayBad.value ? 'day' : typedNote.bad ? 'note' : 'place')
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
              icon: null,
              archived: false,
            },
          ),
        amount: formatMoney(row.spending.amount, locale.value),
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
      figureChars,
      t,
      amount,
      currency,
      categoryId,
      chips,
      lead,
      moreOpen,
      pickCategory,
      details,
      detailsOpen,
      detailsFocus,
      openDetails,
      IconCalendar,
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
      form,
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
      submit,
      remove,
      dismiss,
      toTrip,
      openTrip,
      afterClose,
      retryItems,
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

/* 24 between the groups, 8 within one — a label, its field, its error or hint (Ф-10). A column, not a
   grid: a block of it grows and goes by `AppReveal`, which takes a flex column's gap back with the
   block — a grid's stays and jumped (MOL-151, adversarial Б2). */
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.conversion {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.refused {
  @include appear;

  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--bad-tint);
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}

/* «Покупки ›» goes under the words only where it cannot stand beside them (MOL-321): at 200 % it stood
   15 px past the sheet. */
.shop {
  display: flex;
  flex-wrap: wrap;
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

/* Quiet (Ф-4): the whole card is pressed, and the accent is «Покупки ›» alone. */
.shop-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--text-muted);

  svg {
    @include icon;

    font-size: var(--state-glyph);
  }
}

.shop-text {
  display: grid;
  flex: 1 1 min-content;
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
  margin-left: auto;
  color: var(--accent-ink);
  font-weight: var(--weight-bold);
}

.summary {
  /* The figure measures itself against the card (`figure-fit`, MOL-321). */
  container-type: inline-size;
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

/* The category goes under the sum only where the two cannot stand side by side (MOL-321, adversarial Б4):
   the sum fits its card by `figure-fit`, and beside it the badge took the sheet 18 px sideways at 150 %. */
.total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin: 0;

  > .figure {
    flex: 1 1 min-content;
  }
}

.figure {
  @include display-type;
  @include figure-fit;

  font-variant-numeric: tabular-nums;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  min-width: 0;
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

/* A row of bars stands as tall as a row of the answer: each bar in the middle of a line of the words it
   stands for, at their size and leading (MOL-178). */
.ghost-item {
  align-items: center;
}

.ghost-line {
  display: flex;
  align-items: center;
  height: calc(1em * var(--leading-body));
}

.ghost-bar {
  @include skeleton-bar;

  height: var(--skeleton-line);
}

/* The uneven cycle of a list's bars (MOL-178), so four rows do not read as one block. */
.ghost-name {
  width: 9rem;

  .ghost-item:nth-child(2) & {
    width: 11rem;
  }

  .ghost-item:nth-child(3) & {
    width: 7rem;
  }
}

.ghost-amount {
  width: 3.5rem;

  .ghost-item:nth-child(even) & {
    width: 2.75rem;
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
