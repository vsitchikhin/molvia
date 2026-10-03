<template>
  <li class="row">
    <!-- No `aria-label`: it would silence everything the row says. The verb is read first, as
         on the exchanges (MOL-42). -->
    <button class="body" type="button" @click="$emit('open', row)">
      <span class="badge" :style="badgeStyle" aria-hidden="true">
        <component :is="icon" class="glyph" />
      </span>
      <span class="text">
        <span class="verb">{{ verb }}</span>
        <span class="title">{{ title }}</span>
        <span v-if="meta" class="meta">{{ meta }}</span>
        <span v-if="mark" class="mark" :class="mark">
          <component :is="markIcon" class="mark-icon" aria-hidden="true" />{{ markText }}
        </span>
      </span>
      <span class="sums">
        <span class="amount">{{ amount }}</span>
        <span v-if="counted" class="counted">{{ counted }}</span>
      </span>
      <IconChevron v-if="row.kind === 'trip'" class="chevron" aria-hidden="true" />
    </button>
  </li>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCart from '~icons/mdi/cart-outline'
import IconChevron from '~icons/mdi/chevron-right'
import IconUpload from '~icons/mdi/cloud-upload-outline'
import { formatEstimate } from '@molvia/model'
import type { Currency, SpendingCategoryView } from '@molvia/model'
import { asTyped, categoryColour, categoryIcon } from '@/components/spending'
import type { JournalRow } from '@/components/spending'

/**
 * One line of the month's journal (MOL-82, handoff 01): a spending of one's own, or a finished
 * trip's purchases in one currency. The amount is as it was spent; beneath it, for another
 * currency, what the server counted it as — or that it could not.
 */
export default defineComponent({
  name: 'SpendingRow',
  components: { IconChevron },
  props: {
    row: { type: Object as PropType<JournalRow>, required: true },
    category: { type: Object as PropType<SpendingCategoryView | null>, default: null },
    categoryName: { type: String, required: true },
    spendCurrency: { type: String as PropType<Currency>, required: true },
    /** The day, where rows of different days stand together — «Не приняты» (MOL-159). */
    when: { type: String, default: '' },
  },
  emits: ['open'],
  setup(props) {
    const { t, locale } = useI18n()

    const manual = computed(() => (props.row.kind === 'manual' ? props.row : null))

    const icon = computed(() =>
      props.row.kind === 'trip' || !props.category
        ? markRaw(IconCart)
        : categoryIcon(props.category),
    )
    // A trip is another source, and says so by its colour: the accent, never the groceries' own.
    const badgeStyle = computed(() => {
      if (props.row.kind === 'trip' || !props.category)
        return { background: 'var(--accent-tint)', color: 'var(--accent-ink)' }
      const colour = categoryColour(props.category)
      return {
        color: colour,
        background: `color-mix(in oklch, ${colour} var(--cat-tint-share), var(--surface))`,
      }
    })

    const title = computed(() => {
      if (props.row.kind === 'trip')
        return t('spending.trip_row_title', { place: props.row.placeName })
      return props.row.spending.note ?? props.categoryName
    })
    const meta = computed(() => [props.when, line.value].filter(Boolean).join(' · '))
    const line = computed(() => {
      if (props.row.kind === 'trip')
        return t(
          'spending.trip_row_meta',
          { category: props.categoryName, n: props.row.items },
          props.row.items,
        )
      const { note, place } = props.row.spending
      // Without «что это» the title is already the category: the line under it is the place alone.
      if (note === null) return place ?? ''
      return place ? `${props.categoryName} · ${place}` : props.categoryName
    })
    const verb = computed(() =>
      props.row.kind === 'trip' ? t('spending.row_open_trip') : t('spending.row_open'),
    )

    const money = computed(() =>
      props.row.kind === 'trip' ? props.row.amount : props.row.spending.amount,
    )
    const amount = computed(() => asTyped(money.value, locale.value))
    const counted = computed(() => {
      if (money.value.currency === props.spendCurrency) return null
      // Not counted yet is not «не посчитано» — that says no rate of the day was known; a row still
      // on the phone says «Отправляем…» already (review Т-8).
      if (props.row.kind === 'manual' && props.row.local) return null
      const value = props.row.counted
      return value ? `≈ ${formatEstimate(value, locale.value)}` : t('spending.uncounted_row')
    })

    const mark = computed(() => manual.value?.mark ?? null)
    const markText = computed(() =>
      mark.value === 'refused'
        ? t('spending.refused')
        : mark.value === 'editing'
          ? t('spending.editing')
          : t('spending.pending'),
    )
    const markIcon = computed(() => markRaw(mark.value === 'refused' ? IconAlert : IconUpload))

    return { icon, badgeStyle, title, meta, verb, amount, counted, mark, markText, markIcon }
  },
})
</script>

<style scoped lang="scss">
.row + .row {
  border-top: var(--hairline) solid var(--border);
}

.body {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 3.75rem;
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
}

.glyph {
  @include icon;

  font-size: var(--icon);
}

.text {
  display: grid;
  flex: 1;
  justify-items: start;
  min-width: 0;
}

.verb {
  @include visually-hidden;
}

.title,
.meta {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  font-size: var(--text-headline);
}

.meta {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.mark {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-1);
  padding: 0 var(--space-2) 0 var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);

  &.refused {
    background: var(--bad-tint);
    color: var(--bad-ink);
  }
}

.mark-icon {
  @include icon;

  font-size: var(--icon-xs);
}

.sums {
  display: grid;
  flex: none;
  justify-items: end;
}

.amount {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.counted {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chevron {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}
</style>
