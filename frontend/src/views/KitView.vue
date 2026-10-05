<template>
  <AppScreen :title="t('dev.kit.title')">
    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.buttons') }}</SectionCaption>
      <div class="row">
        <AppButton>{{ t('item.save') }}</AppButton>
        <AppButton variant="secondary">{{ t('trip.finish') }}</AppButton>
        <AppButton variant="tinted">{{ t('spending.restore') }}</AppButton>
        <AppButton variant="ghost">{{ t('verdict.skip') }}</AppButton>
        <AppButton variant="danger-ghost">{{ t('item.delete') }}</AppButton>
        <AppButton variant="icon" :label="t('sheet.close')"><IconClose /></AppButton>
      </div>
      <div class="row">
        <AppButton variant="ghost">
          <template #icon><IconPlus /></template>
          {{ t('trip.add_item') }}
        </AppButton>
        <AppButton variant="secondary">
          <template #icon><IconRefresh /></template>
          {{ t('state.retry') }}
        </AppButton>
        <AppButton inactive>{{ t('settings.save') }}</AppButton>
        <AppButton disabled>{{ t('verdict.save') }}</AppButton>
      </div>
    </section>

    <!-- MOL-225: at work is the button's own word in its own look, as wide as the wider word. -->
    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.busy') }}</SectionCaption>
      <label class="toggle">
        <AppSwitch :checked="working" @toggle="working = $event" />
        {{ t('dev.kit.busy') }}
      </label>
      <div class="row">
        <AppButton :busy="working" :busy-label="t('settings.saving')">
          {{ t('item.save') }}
        </AppButton>
        <AppButton variant="secondary" :busy="working" :busy-label="t('settings.saving')">
          <template #icon><IconRefresh /></template>
          {{ t('state.retry') }}
        </AppButton>
        <AppButton variant="tinted" :busy="working" :busy-label="t('settings.saving')">
          {{ t('spending.restore') }}
        </AppButton>
        <AppButton variant="ghost" :busy="working" :busy-label="t('settings.saving')">
          {{ t('verdict.skip') }}
        </AppButton>
        <AppButton variant="danger-ghost" :busy="working" :busy-label="t('settings.saving')">
          {{ t('item.delete') }}
        </AppButton>
        <AppButton
          variant="icon"
          :label="t('sheet.close')"
          :busy="working"
          :busy-label="t('settings.saving')"
        >
          <IconClose />
        </AppButton>
      </div>
    </section>

    <!-- Ф-5, Ф-6 (MOL-174): chosen is a form, not only a hue; not now is one look in every control —
         in the focus order, `text-muted`, no opacity. -->
    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.selection') }}</SectionCaption>
      <div class="row">
        <AppButton inactive>{{ t('settings.save') }}</AppButton>
        <AppButton variant="secondary" inactive>{{ t('trip.finish') }}</AppButton>
        <AppButton variant="tinted" inactive>{{ t('spending.restore') }}</AppButton>
        <AppButton variant="ghost" inactive>{{ t('verdict.skip') }}</AppButton>
        <AppButton variant="danger-ghost" inactive>{{ t('item.delete') }}</AppButton>
        <AppButton variant="icon" :label="t('sheet.close')" inactive><IconClose /></AppButton>
      </div>
      <SegmentedControl v-model="unit" :legend="t('dev.kit.segment_fit')" :options="units" fit />
      <SegmentedControl
        v-model="unit"
        :legend="t('dev.kit.segment_inactive')"
        :options="units"
        inactive
      />
      <div class="row">
        <label v-for="toggle in toggles" :key="toggle.key" class="toggle">
          <AppSwitch
            :checked="toggle.on"
            :inactive="toggle.inactive"
            @toggle="toggle.on = $event"
          />
          {{ t(`dev.kit.${toggle.key}`) }}
        </label>
      </div>
      <MonthSwitcher :month="month" current="2026-10" @change="month = $event" />
      <CategoryChips
        v-model="category"
        :categories="categories"
        :name-of="categoryName"
        :legend="t('spending.sheet.category')"
        :add-label="t('spending.sheet.add_category')"
      />
    </section>

    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.fields') }}</SectionCaption>
      <AppField v-model="quantity" :label="t('item.quantity')" kind="decimal" />
      <AppField
        v-model="price"
        :label="t('item.price')"
        kind="decimal"
        :error="ERROR.INVALID_AMOUNT"
      >
        <template #suffix>{{ sign }}</template>
      </AppField>
      <AppField v-model="review" :label="t('verdict.review_label')" kind="multiline" />
      <AppField v-model="date" :label="t('dev.kit.date')" kind="date" readonly />
      <AppField v-model="city" :label="t('settings.city')" kind="select" :options="cities" />
      <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
    </section>

    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.search') }}</SectionCaption>
      <div>
        <SectionCaption as="h3">{{ t('dev.kit.search_clear') }}</SectionCaption>
        <SearchField
          v-model="searchAdvice"
          :label="t('advice.search.label')"
          :placeholder="t('advice.search.placeholder')"
          clearable
        />
      </div>
      <div>
        <SectionCaption as="h3">{{ t('dev.kit.search_scan') }}</SectionCaption>
        <SearchField
          v-model="searchItem"
          :label="t('item.search_title')"
          :placeholder="t('item.search_placeholder')"
          :hint="t('item.search_hint')"
        >
          <template #trailing>
            <!-- Named apart from the kit's own scanner below, which the scanner's e2e opens by name. -->
            <AppButton variant="icon" :label="t('dev.kit.search_scanner')"
              ><IconBarcode
            /></AppButton>
          </template>
        </SearchField>
      </div>
      <div>
        <SectionCaption as="h3">{{ t('dev.kit.search_readonly') }}</SectionCaption>
        <SearchField
          :model-value="t('dev.kit.search_sample')"
          :label="t('dev.kit.search_readonly')"
          readonly
        />
      </div>
    </section>

    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.badges') }}</SectionCaption>
      <div class="row">
        <VerdictBadge v-for="level in levels" :key="level" :level="level" />
        <VerdictBadge v-for="level in levels" :key="`${level}-dot`" :level="level" compact />
        <VerdictBadge v-for="level in levels" :key="`${level}-lg`" :level="level" compact large />
      </div>
    </section>

    <!-- The icon scale (Ф-9, MOL-173): one shape at every step, for a screen to be checked by — not a
         chevron, which reads as a row's. The step's class is on the wrapper — a class of this page on
         a child's root would reach AppButton's own `.icon` — and written out: a class from `:class`
         sizes nothing to the linter. -->
    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.icons') }}</SectionCaption>
      <div class="row">
        <span class="icon-step step-icon-xs">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon-xs'] }}</span>
        </span>
        <span class="icon-step step-icon-sm">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon-sm'] }}</span>
        </span>
        <span class="icon-step step-icon">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon'] }}</span>
        </span>
        <span class="icon-step step-icon-button">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon-button'] }}</span>
        </span>
        <span class="icon-step step-state-glyph">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['state-glyph'] }}</span>
        </span>
        <span class="icon-step step-icon-md">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon-md'] }}</span>
        </span>
        <span class="icon-step step-icon-back">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon-back'] }}</span>
        </span>
        <span class="icon-step step-icon-tab">
          <IconShape class="sample" aria-hidden="true" />
          <span class="px">{{ iconPx['icon-tab'] }}</span>
        </span>
      </div>
    </section>

    <!-- Rows and captions (MOL-175): every state of a row, the chevron only where something goes
         on (В-14), the three captions, an entry, a note and a tag. -->
    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.rows') }}</SectionCaption>
      <!-- В-14: rows that go on and rows that act stand in cards of their own, never mixed. -->
      <div>
        <SectionCaption as="h3">{{ t('dev.kit.caption_goes_on') }}</SectionCaption>
        <AppCard as="ul" list>
          <li>
            <ListRow
              :icon="IconWallet"
              :title="t('dev.kit.row_cash')"
              :meta="t('accounts.for_spending')"
              next
            >
              <template #tail>{{ figures.balance }}</template>
            </ListRow>
          </li>
          <li>
            <ListRow
              :icon="IconCart"
              :title="t('dev.kit.row_long')"
              :meta="t('dev.kit.row_long_meta')"
              wrap
              next
            />
          </li>
          <li>
            <ListRow
              as="router-link"
              :to="{ query: { followed: 'live' } }"
              :icon="IconDevices"
              :title="t('dev.kit.row_link')"
              :meta="t('dev.kit.row_link_meta')"
              next
            />
          </li>
          <li>
            <ListRow
              as="router-link"
              :to="{ query: { followed: 'inactive' } }"
              :icon="IconDevices"
              :title="t('dev.kit.row_link_inactive')"
              :meta="t('dev.kit.row_link_offline')"
              next
              inactive
            />
          </li>
        </AppCard>
      </div>
      <div>
        <SectionCaption as="h3">{{ t('dev.kit.caption_acts') }}</SectionCaption>
        <AppCard as="ul" list>
          <li>
            <ListRow
              :icon="IconDownload"
              :title="t('settings.export.label')"
              :meta="t('dev.kit.row_download_meta')"
            />
          </li>
          <li>
            <ListRow
              :icon="IconDelete"
              :title="t('settings.erase.label')"
              :meta="t('dev.kit.row_erase_meta')"
              danger
            />
          </li>
          <li>
            <ListRow
              as="div"
              :icon="IconPhone"
              :title="t('dev.kit.row_device')"
              :meta="t('dev.kit.row_device_meta')"
            >
              <template #tail>
                <AppButton variant="danger-ghost">{{ t('devices.end') }}</AppButton>
              </template>
            </ListRow>
          </li>
        </AppCard>
      </div>
      <div>
        <SectionCaption as="h3">{{ t('accounts.picker.row_trip') }}</SectionCaption>
        <AppCard list role="radiogroup" :aria-label="t('accounts.picker.row_trip')">
          <ListRow
            v-for="account in accounts"
            :key="account.id"
            role="radio"
            :title="account.name"
            :meta="account.meta"
            :selected="picked === account.id"
            @click="picked = account.id"
          >
            <template #tail>{{ account.balance }}</template>
          </ListRow>
        </AppCard>
      </div>
      <div>
        <SectionCaption as="h3">{{ t('item.group_found') }}</SectionCaption>
        <AppCard as="ul" list role="listbox" :aria-label="t('item.group_found')">
          <ListRow
            v-for="(found, index) in foundRows"
            :id="`kit-found-${String(index)}`"
            :key="found"
            as="li"
            role="option"
            :title="found"
            :meta="t('dev.kit.sample_meta')"
            :active="index === 0"
            :selected="false"
            wrap
            next
          />
        </AppCard>
      </div>
      <div>
        <SectionCaption as="h3">
          <template #mark><VerdictBadge level="take" compact large /></template>
          {{ t('advice.group_take') }}
        </SectionCaption>
        <AppCard>{{ t('dev.kit.sample_milk') }}</AppCard>
      </div>
      <div>
        <SectionCaption as="h3"
          >{{ t('dev.kit.caption_month') }}<template #tail>{{ figures.month }}</template>
        </SectionCaption>
        <AppCard as="ul" list>
          <li>
            <NavRow
              :to="{ query: { followed: 'entry' } }"
              :icon="IconDevices"
              :label="t('devices.title')"
              value="3"
            />
          </li>
          <li>
            <NavRow
              :icon="IconWallet"
              :label="t('accounts.picker.row_spending')"
              :value="t('dev.kit.row_cash')"
              @click="sheetOpen = true"
            />
          </li>
        </AppCard>
      </div>
      <AppNote>{{ t('dev.kit.note_plain') }}</AppNote>
      <AppNote tone="warn" :icon="IconAlert">{{ t('dev.kit.note_warn') }}</AppNote>
      <div class="row">
        <AppTag>{{ t('accounts.savings_tag') }}</AppTag>
        <AppTag tone="warn" :icon="IconUpload">{{ t('spending.pending') }}</AppTag>
        <AppTag tone="bad">{{ t('spending.refused') }}</AppTag>
      </div>
    </section>

    <!-- One row of an operation (MOL-176): every row with its chevron and its amount in one column,
         the words put together by the same functions the screens use. -->
    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.operations') }}</SectionCaption>
      <AppCard as="ul" list>
        <OperationRow v-for="(row, index) in operations" :key="index" v-bind="row" />
      </AppCard>
      <OperationSkeleton form="rows" :count="3" />
    </section>

    <section class="group">
      <SectionCaption class="caption">{{ t('dev.kit.cards') }}</SectionCaption>
      <AppCard as="section" tone="take">
        <VerdictBadge level="take" />
        <p class="name">{{ t('dev.kit.sample_milk') }}</p>
      </AppCard>
      <VerdictCard :card="verdictCard" />
      <VerdictCard :card="verdictCard" :draft="verdictDraft" />
    </section>

    <AppButton block @click="sheetOpen = true">{{ t('dev.kit.open_sheet') }}</AppButton>

    <BottomSheet v-model:open="sheetOpen">
      <template #title>{{ t('dev.kit.sample_milk') }}</template>
      <template #meta>{{ t('dev.kit.sample_meta') }}</template>
      <AppField v-model="quantity" :label="t('item.quantity')" kind="decimal" autofocus />
      <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
      <AppField v-model="price" :label="t('item.price')" kind="decimal">
        <template #suffix>{{ sign }}</template>
      </AppField>
      <template #footer>
        <AppButton size="large" block @click="sheetOpen = false">{{ t('item.save') }}</AppButton>
      </template>
    </BottomSheet>

    <!-- The scanner, until a screen opens it (MOL-99): for end-to-end and for a real phone. -->
    <section class="group">
      <AppButton block variant="secondary" @click="scannerOpen = true">
        {{ t('item.barcode.scan') }}
      </AppButton>
      <p v-if="scanned" class="scanned">{{ t('dev.kit.scanned', { code: scanned }) }}</p>
    </section>
    <BarcodeScannerSheet v-model:open="scannerOpen" @read="scanned = $event" />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ERROR,
  VERDICT_LEVEL,
  currencySign,
  formatMoney,
  money,
  COUNTRY_CITIES,
} from '@molvia/model'
import type { AccountOperationView, SpendingCategoryView } from '@molvia/model'
import IconAlert from '~icons/mdi/alert-outline'
import IconBarcode from '~icons/mdi/barcode-scan'
import IconCart from '~icons/mdi/cart-outline'
import IconDevices from '~icons/mdi/cellphone-link'
import IconPhone from '~icons/mdi/cellphone'
import IconClose from '~icons/mdi/close'
import IconUpload from '~icons/mdi/cloud-upload-outline'
import IconDelete from '~icons/mdi/delete-outline'
import IconDownload from '~icons/mdi/download-outline'
import IconPlus from '~icons/mdi/plus'
import IconRefresh from '~icons/mdi/refresh'
import IconShape from '~icons/mdi/shape-outline'
import IconWallet from '~icons/mdi/wallet-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import AppNote from '@/components/AppNote.vue'
import AppScreen from '@/components/AppScreen.vue'
import AppSwitch from '@/components/AppSwitch.vue'
import AppTag from '@/components/AppTag.vue'
import BarcodeScannerSheet from '@/components/BarcodeScannerSheet.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import ListRow from '@/components/ListRow.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import NavRow from '@/components/NavRow.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSkeleton from '@/components/OperationSkeleton.vue'
import SearchField from '@/components/SearchField.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { operationRowProps, shortDay } from '@/components/accounts'
import { journalRowProps } from '@/components/spending'
import type { JournalRow } from '@/components/spending'
import VerdictBadge from '@/components/VerdictBadge.vue'
import VerdictCard from '@/components/VerdictCard.vue'

/**
 * Every piece of the kit in its states, on one page, and a sheet in a real history — reached in
 * development only (`/_kit`, router.ts). It is how the kit is looked at in both schemes before
 * any screen uses it, and what the end-to-end tests of the sheet run against.
 *
 * The list is long on purpose: the page has to scroll for a test to show the sheet leaves the
 * scroll where it was.
 */
export default defineComponent({
  name: 'KitView',
  components: {
    AppButton,
    AppCard,
    AppField,
    AppNote,
    AppScreen,
    AppSwitch,
    AppTag,
    BarcodeScannerSheet,
    BottomSheet,
    CategoryChips,
    IconBarcode,
    IconClose,
    IconPlus,
    IconRefresh,
    IconShape,
    ListRow,
    MonthSwitcher,
    NavRow,
    OperationRow,
    OperationSkeleton,
    SearchField,
    SectionCaption,
    SegmentedControl,
    VerdictBadge,
    VerdictCard,
  },
  setup() {
    const { t, locale } = useI18n()
    const categories: SpendingCategoryView[] = (['groceries', 'cafe', 'transport'] as const).map(
      (preset, index) => ({
        id: `00000000-0000-4000-8000-00000000010${String(index)}`,
        preset,
        name: null,
        colour: null,
        archived: false,
      }),
    )
    const [groceries, cafe, transport] = categories
    const categoryName = (category: SpendingCategoryView) =>
      t(`spending.category.${category.preset ?? 'other'}`)

    /** «Траты» and an account's journal, through the functions the screens use (MOL-176). */
    const operations = computed(() => {
      const spent = (row: JournalRow, category: SpendingCategoryView | undefined) =>
        journalRowProps(row, {
          t,
          locale: locale.value,
          category: category ?? null,
          categoryName: category ? categoryName(category) : t('spending.category.other'),
          spendCurrency: 'AMD',
        })
      const manual = (
        id: number,
        amount: bigint,
        currency: 'AMD' | 'RUB',
        category: SpendingCategoryView | undefined,
        patch: Partial<Extract<JournalRow, { kind: 'manual' }>> & { note?: string; place?: string },
      ): JournalRow => ({
        kind: 'manual',
        key: String(id),
        spending: {
          id: `00000000-0000-4000-8000-00000000020${String(id)}`,
          spentOn: '2026-09-30',
          amount: money(amount, currency),
          categoryId: category?.id ?? '',
          note: patch.note ?? null,
          place: patch.place ?? null,
          rate: null,
          accountId: null,
          debited: null,
          revision: 1,
          amendedAt: null,
        },
        counted: patch.counted ?? null,
        mark: patch.mark ?? null,
        refusal: null,
        local: patch.local ?? false,
      })
      const logged = (patch: Partial<AccountOperationView>) =>
        operationRowProps(
          {
            kind: 'spending',
            id: '00000000-0000-4000-8000-000000000301',
            side: null,
            day: '2026-09-25',
            at: new Date('2026-09-25T09:00:00Z'),
            accountId: 'card',
            amounts: [],
            moved: null,
            approximate: false,
            debited: null,
            inBalance: true,
            unpriced: 0,
            revision: 1,
            items: null,
            categoryId: null,
            note: null,
            place: null,
            source: null,
            counterpart: null,
            ...patch,
          },
          {
            t,
            locale: locale.value,
            categories,
            nameOf: categoryName,
            accountName: () => t('dev.kit.row_cash'),
            inAccount: true,
          },
        )
      return [
        spent(
          manual(1, 120000n, 'AMD', transport, {
            place: 'Yandex Go',
            mark: 'waiting',
            local: true,
          }),
          transport,
        ),
        spent(
          manual(2, 45000n, 'RUB', cafe, { place: 'Coffeeman', counted: money(208000n, 'AMD') }),
          cafe,
        ),
        spent(manual(3, 4500n, 'RUB', cafe, {}), cafe),
        spent(
          {
            kind: 'trip',
            key: 'trip',
            tripId: 'trip',
            placeName: 'SAS',
            items: 5,
            amount: money(348000n, 'AMD'),
            counted: null,
          },
          groceries,
        ),
        spent(manual(4, 1240050n, 'AMD', groceries, { note: t('dev.kit.row_long') }), groceries),
        spent(manual(5, 180000n, 'AMD', transport, { mark: 'refused' }), transport),
        logged({
          kind: 'income',
          source: 'salary',
          amounts: [money(9961500n, 'RUB')],
          moved: money(9961500n, 'RUB'),
        }),
        logged({
          kind: 'exchange',
          side: 'given',
          amounts: [money(-3246753n, 'RUB')],
          moved: money(-3246753n, 'RUB'),
          counterpart: { accountId: 'cash', amount: money(15600000n, 'AMD') },
        }),
        logged({
          categoryId: groceries?.id ?? null,
          place: 'Yandex Lavka',
          amounts: [money(-233185n, 'RUB')],
          moved: money(-989100n, 'AMD'),
          approximate: true,
          debited: money(989100n, 'AMD'),
        }),
        // A ruble card, paid in drams with no «списано» typed; kopecks from a dram card; a trip paid in
        // two currencies — the longest lines under an amount, which once left the title no width at all
        // and pushed the chevron past the card (adversarial А1, А2).
        logged({
          categoryId: transport?.id ?? null,
          amounts: [money(-12000000n, 'AMD')],
          moved: money(-2400000n, 'RUB'),
          approximate: true,
        }),
        logged({
          categoryId: cafe?.id ?? null,
          amounts: [money(-2499950n, 'RUB')],
          moved: money(-11999760n, 'AMD'),
          approximate: true,
        }),
        logged({
          kind: 'trip',
          place: 'SAS',
          items: 4,
          amounts: [money(-233185n, 'RUB'), money(-2499n, 'EUR')],
          moved: money(-1105000n, 'AMD'),
          approximate: true,
        }),
        // A salary with its kopecks: an amount wider than the tail's share (adversarial round 2, Б2).
        logged({
          kind: 'income',
          source: 'salary',
          amounts: [money(12345678n, 'RUB')],
          moved: money(12345678n, 'RUB'),
        }),
        // A reason of a check: its title says the sum, the row has no tail (review Р2-1).
        {
          ...logged({ kind: 'trip', place: 'SAS', items: 4, unpriced: 2 }),
          title: t('accounts.reconcile.cause_trip_unpriced', {
            date: shortDay('2026-09-25', locale.value),
          }),
          meta: t('accounts.reconcile.cause_trip_unpriced_meta', { place: 'SAS', n: 2 }, 2),
          amount: null,
          sub: null,
        },
      ]
    })
    const units = computed(() => [
      { value: 'kg', label: t('item.unit_kg') },
      { value: 'l', label: t('item.unit_l') },
      { value: 'piece', label: t('item.unit_piece') },
    ])
    return {
      t,
      ERROR,
      levels: Object.values(VERDICT_LEVEL),
      iconPx: {
        'icon-xs': 14,
        'icon-sm': 18,
        icon: 20,
        'icon-button': 22,
        'state-glyph': 22,
        'icon-md': 24,
        'icon-back': 26,
        'icon-tab': 27,
      },
      units,
      // The handoff's real receipt, through the formatters: the sign belongs to the currency.
      figures: {
        balance: formatMoney(money(4230000n, 'AMD')),
        month: formatMoney(money(12000000n, 'RUB')),
      },
      // Icons a row draws at its own step are handed to it as components.
      IconAlert,
      IconCart,
      IconDelete,
      IconDevices,
      IconDownload,
      IconPhone,
      IconUpload,
      IconWallet,
      accounts: computed(() => [
        {
          id: 'card',
          name: t('dev.kit.row_card'),
          meta: t('accounts.savings'),
          balance: formatMoney(money(11820000n, 'AMD')),
        },
        {
          id: 'cash',
          name: t('dev.kit.row_cash'),
          meta: t('accounts.for_spending'),
          balance: formatMoney(money(4230000n, 'AMD')),
        },
      ]),
      picked: ref('card'),
      foundRows: computed(() => [t('dev.kit.sample_milk'), t('dev.kit.row_long')]),
      sign: currencySign('AMD'),
      searchAdvice: ref(''),
      searchItem: ref(t('dev.kit.search_sample')),
      quantity: ref('1'),
      price: ref('57о'),
      review: ref(''),
      city: ref<string>(COUNTRY_CITIES.AM[0]),
      cities: COUNTRY_CITIES.AM.map((city) => ({ value: city, label: city })),
      date: ref('2026-09-19'),
      unit: ref('l'),
      working: ref(false),
      toggles: reactive([
        { key: 'switch_off', on: false, inactive: false },
        { key: 'switch_on', on: true, inactive: false },
        { key: 'switch_inactive_off', on: false, inactive: true },
        { key: 'switch_inactive_on', on: true, inactive: true },
      ]),
      // The current month at the edge: «›» is the inactive arrow.
      month: ref('2026-10'),
      categories,
      categoryName,
      operations,
      category: ref<string | null>('00000000-0000-4000-8000-000000000101'),
      sheetOpen: ref(false),
      scannerOpen: ref(false),
      scanned: ref(''),
      // The verdict card blank, and as a refused draft comes back: a score, words, the error.
      verdictCard: computed(() => ({
        itemId: '00000000-0000-4000-8000-000000000001',
        name: t('dev.kit.sample_milk'),
        placeName: 'SAS',
        boughtAt: new Date(Date.now() - 86_400_000),
      })),
      verdictDraft: computed(() => ({
        card: { itemId: '', name: '', placeName: '', boughtAt: new Date() },
        score: 2 as const,
        review: t('verdict.review_placeholder'),
        state: 'typing' as const,
        error: ERROR.INTERNAL,
      })),
    }
  },
})
</script>

<style scoped lang="scss">
.group {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

/* A section's caption stands 8 above what it names, as on a screen: the section's gap takes 4 back. */
.caption {
  margin-bottom: calc(var(--space-2) - var(--space-3));
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--touch-target);
  font-size: var(--text-callout);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.figure {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.icon-step {
  display: inline-grid;
  justify-items: center;
  gap: var(--space-1);
  min-width: var(--touch-target);
}

.sample {
  @include icon;
}

.step-icon-xs .sample {
  font-size: var(--icon-xs);
}

.step-icon-sm .sample {
  font-size: var(--icon-sm);
}

.step-icon .sample {
  font-size: var(--icon);
}

.step-icon-button .sample {
  font-size: var(--icon-button);
}

.step-state-glyph .sample {
  font-size: var(--state-glyph);
}

.step-icon-md .sample {
  font-size: var(--icon-md);
}

.step-icon-back .sample {
  font-size: var(--icon-back);
}

.step-icon-tab .sample {
  font-size: var(--icon-tab);
}

.px {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-variant-numeric: tabular-nums;
}

.scanned {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.name {
  @include display-type;

  margin: var(--space-2) 0 0;
  font-size: var(--text-title);
  line-height: var(--leading-tight);
}
</style>
