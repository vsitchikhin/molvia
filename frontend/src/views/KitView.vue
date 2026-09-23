<template>
  <AppScreen :title="t('dev.kit.title')">
    <section class="group">
      <h2 class="caption">{{ t('dev.kit.buttons') }}</h2>
      <div class="row">
        <AppButton>{{ t('item.save') }}</AppButton>
        <AppButton variant="secondary">{{ t('trip.finish') }}</AppButton>
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
        <AppButton busy>{{ t('settings.saving') }}</AppButton>
        <AppButton inactive>{{ t('settings.save') }}</AppButton>
        <AppButton disabled>{{ t('verdict.save') }}</AppButton>
      </div>
    </section>

    <section class="group">
      <h2 class="caption">{{ t('dev.kit.fields') }}</h2>
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
      <h2 class="caption">{{ t('dev.kit.badges') }}</h2>
      <div class="row">
        <VerdictBadge v-for="level in levels" :key="level" :level="level" />
        <VerdictBadge v-for="level in levels" :key="`${level}-dot`" :level="level" compact />
        <VerdictBadge v-for="level in levels" :key="`${level}-lg`" :level="level" compact large />
      </div>
    </section>

    <section class="group">
      <h2 class="caption">{{ t('dev.kit.cards') }}</h2>
      <AppCard as="ul" list>
        <li v-for="n in 12" :key="n" class="line">
          <span>{{ t('dev.kit.sample_milk') }}</span>
          <span class="figure">{{ figures.price }}</span>
        </li>
      </AppCard>
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
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ERROR,
  VERDICT_LEVEL,
  currencySign,
  formatMoney,
  money,
  SETTINGS_CITIES,
} from '@molvia/model'
import IconClose from '~icons/mdi/close'
import IconPlus from '~icons/mdi/plus'
import IconRefresh from '~icons/mdi/refresh'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import AppScreen from '@/components/AppScreen.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
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
    AppScreen,
    BottomSheet,
    IconClose,
    IconPlus,
    IconRefresh,
    SegmentedControl,
    VerdictBadge,
    VerdictCard,
  },
  setup() {
    const { t } = useI18n()
    const units = computed(() => [
      { value: 'kg', label: t('item.unit_kg') },
      { value: 'l', label: t('item.unit_l') },
      { value: 'piece', label: t('item.unit_piece') },
    ])
    return {
      t,
      ERROR,
      levels: Object.values(VERDICT_LEVEL),
      units,
      // The handoff's real receipt, through the formatters: the sign belongs to the currency.
      figures: { price: formatMoney(money(57000n, 'AMD')) },
      sign: currencySign('AMD'),
      quantity: ref('1'),
      price: ref('57о'),
      review: ref(''),
      city: ref(SETTINGS_CITIES[0]),
      cities: SETTINGS_CITIES.map((city) => ({ value: city, label: city })),
      date: ref('2026-09-19'),
      unit: ref('l'),
      sheetOpen: ref(false),
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

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.line {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-weight: var(--weight-medium);
}

.figure {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.name {
  margin: var(--space-2) 0 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}
</style>
