<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.line.title') }}</template>
    <template #meta>{{ meta }}</template>

    <div class="form">
      <div v-if="skip" class="plate quiet">{{ t('receipt.line.skipped') }}</div>

      <div class="plate printed-box">
        <span class="caps">{{ t('receipt.line.printed') }}</span>
        <span class="printed" :lang="lang">{{ line.line.printed }}</span>
        <span v-if="line.line.translation" class="translation">{{
          t('receipt.line.translation', { text: line.line.translation })
        }}</span>
      </div>

      <!-- The item: one of the catalogue, «Другой ›» for another; a new one is named here and made
           by «Записать» itself (Р-1 of MOL-113). -->
      <div v-if="item.id" class="field">
        <span class="label">{{ t('receipt.line.product') }}</span>
        <button class="product" :class="{ check: checking }" type="button" @click="picking = true">
          <span class="product-name">{{ item.name }}</span>
          <span class="product-other"
            >{{ t('receipt.line.product_other')
            }}<IconChevronRight class="other-chevron" aria-hidden="true"
          /></span>
        </button>
        <p v-if="checking && line.line.translation" class="plate warn">
          {{ t('receipt.line.check_warn', { text: line.line.translation }) }}
        </p>
      </div>
      <div v-else class="field">
        <AppField v-model="name" :label="t('receipt.line.name')" :maxlength="NAME_MAX">
          <template #label-extra
            ><span class="tag">{{ t('receipt.review.tag_new') }}</span></template
          >
        </AppField>
        <p class="hint">{{ t('receipt.line.name_note') }}</p>
        <AppButton variant="ghost" block @click="picking = true">
          <template #icon><IconMagnify /></template>
          {{ t('receipt.line.find') }}
        </AppButton>
      </div>

      <div class="row">
        <AppField
          v-model="quantity"
          class="quantity"
          :label="t('item.quantity')"
          kind="decimal"
          :error="quantityBad ? ERROR.INVALID_QUANTITY : null"
          data-field="quantity"
        />
        <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
      </div>

      <AppField
        v-model="amount"
        :label="t('receipt.line.price')"
        kind="decimal"
        :error="amountBad ? ERROR.INVALID_AMOUNT : null"
        data-field="amount"
      >
        <template #suffix
          ><span class="sign">{{ sign }}</span></template
        >
      </AppField>
      <p v-if="discountHint" class="hint">{{ discountHint }}</p>
      <p v-else-if="weightHint" class="hint">{{ weightHint }}</p>
      <p v-if="remembered" class="hint">{{ remembered }}</p>

      <!-- «За единицу» and «Тут дешевле» in its box, as on the sheet of a purchase (MOL-92: one sheet
           on every way in). The figure is `unitPrice` of the model, the server's own (В-6). -->
      <div class="per-unit-box">
        <div class="per-unit">
          <span class="per-unit-label">{{ t('item.unit_price_label') }}</span>
          <span class="per-unit-value">{{ perUnit ?? '—' }}</span>
        </div>
        <p v-if="itemHint" :key="itemHint.text" class="cheaper" :class="`cheaper-${itemHint.kind}`">
          <span>{{ itemHint.text }}</span>
        </p>
        <p v-if="alternativeHint" :key="alternativeHint" class="cheaper cheaper-alternative">
          <span>{{ alternativeHint }}</span>
        </p>
      </div>

      <p v-if="mismatch" class="plate warn">{{ mismatch }}</p>
    </div>

    <template #footer>
      <AppButton v-if="skip" size="large" block @click="unskip">{{
        t('receipt.line.unskip')
      }}</AppButton>
      <template v-else>
        <AppButton size="large" block @click="save">{{ t('receipt.line.save') }}</AppButton>
        <AppButton variant="ghost" block @click="leaveOut">{{ t('receipt.line.skip') }}</AppButton>
      </template>
    </template>
  </BottomSheet>

  <ItemPickSheet
    v-model:open="picking"
    :printed="line.line.printed"
    :translation="line.line.translation"
    :start="item.name"
    @picked="picked"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconMagnify from '~icons/mdi/magnify'
import {
  ERROR,
  currencySign,
  decimalFromMilli,
  drawsNothing,
  formatMoney,
  formatQuantity,
  formatUnitPrice,
  newItemSchema,
  parseMoney,
  parseQuantity,
  pastedLine,
  priceInDoubt,
  unitPrice,
} from '@molvia/model'
import type {
  BaseUnit,
  Currency,
  Money,
  Quantity,
  ReceiptCountry,
  SettingsGeography,
} from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ItemPickSheet from '@/components/ItemPickSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { formatRating, unitPriceText } from '@/components/adviceRow'
import { receiptText } from '@/components/receipt'
import { useCheaperHint } from '@/composables/useCheaperHint'
import { shown } from '@/composables/useItemDetails'
import { calendarDay } from '@/days'
import type { ReviewLine } from '@/receipts/review'
import type { LineDraft } from '@/stores/receiptDrafts'

const UNITS: readonly BaseUnit[] = ['kg', 'l', 'piece']
/** As an item's own schema bounds its name. */
const NAME_MAX = 200

/**
 * «Строка чека» (handoff 05): one line of a receipt being looked at — as printed and its gloss, the
 * item, how much, what the line cost «как в чеке», the price per unit and «Тут дешевле» — and «Не
 * записывать эту строку». It writes nothing: «Сохранить» hands the line to the receipt's draft on the
 * phone (Т-9), and the whole receipt goes with «Записать N». Mounted per opening, so each line starts
 * from its own figures.
 */
export default defineComponent({
  name: 'ReceiptLineSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    IconChevronRight,
    IconMagnify,
    ItemPickSheet,
    SegmentedControl,
  },
  props: {
    open: { type: Boolean, required: true },
    line: { type: Object as PropType<ReviewLine>, required: true },
    total: { type: Number, required: true },
    currency: { type: String as PropType<Currency>, required: true },
    lang: { type: String, required: true },
    /** The place the receipt is at: «Тут дешевле» compares within its city. */
    place: {
      type: Object as PropType<{ id: string | null; name: string; city: string } | null>,
      default: null,
    },
    country: { type: String as PropType<ReceiptCountry>, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    saved: (line: LineDraft) => typeof line === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const separator = locale.value === 'ru' ? ',' : '.'
    const start = props.line
    const item = ref<{ id: string | null; name: string }>({ id: start.itemId, name: start.name })
    const name = ref(start.itemId ? '' : start.name)
    const quantity = ref(start.quantity ? shown(decimalFromMilli(start.quantity), separator) : '')
    const unit = ref<BaseUnit>(start.quantity?.unit ?? 'piece')
    const amount = ref(start.amount ? receiptText(start.amount, locale.value) : '')
    const skip = ref(start.skip)
    const picking = ref(false)
    const quantityBad = ref(false)
    const amountBad = ref(false)
    /** «проверьте» holds until the person settles the item one way or another. */
    const settled = ref(false)

    const units = computed(() => UNITS.map((value) => ({ value, label: t(`item.unit_${value}`) })))

    function typedQuantity(): Quantity | null | 'bad' {
      if (!quantity.value.trim()) return null
      try {
        return parseQuantity(quantity.value.trim(), unit.value)
      } catch {
        return 'bad'
      }
    }
    function typedAmount(): Money | null | 'bad' {
      if (!amount.value.trim()) return null
      try {
        return parseMoney(amount.value.replace(/\s/gu, ''), props.currency)
      } catch {
        return 'bad'
      }
    }
    const parsedQuantity = computed(() => {
      const value = typedQuantity()
      return value === 'bad' ? null : value
    })
    const parsedAmount = computed(() => {
      const value = typedAmount()
      return value === 'bad' ? null : value
    })
    const price = computed(() => {
      const money = parsedAmount.value
      const many = parsedQuantity.value
      if (!money || !many || many.milli <= 0n) return null
      try {
        return unitPrice(money, many)
      } catch {
        return null
      }
    })
    const perUnit = computed(() =>
      price.value
        ? t('item.unit_price_value', {
            amount: formatUnitPrice(price.value, locale.value),
            unit: t(`item.unit_${price.value.unit}`),
          })
        : null,
    )

    // «Тут дешевле» (MOL-92) asks about the item the line found, at the receipt's place and city.
    const hintItem = start.itemId
    const geography = computed<SettingsGeography | null>(() =>
      props.place ? { country: props.country, city: props.place.city } : null,
    )
    const { hint } = useCheaperHint({
      itemId: hintItem ?? '',
      record: () => (hintItem && geography.value ? { where: geography.value } : null),
      except: null,
      here: () => props.place?.id ?? null,
      typed: () => price.value,
      typedQuantity: () => parsedQuantity.value,
      currency: () => props.currency,
      unit: () => unit.value,
    })
    const shortDay = (day: string) =>
      calendarDay(day, locale.value, { day: '2-digit', month: '2-digit' })
    const sameItem = computed(() => hintItem !== null && item.value.id === hintItem)
    const itemHint = computed(() => {
      const found = sameItem.value ? hint.value.item : null
      if (!found) return null
      return {
        kind: found.kind,
        text: t(`item.cheaper.${found.kind}${found.here ? '_here' : ''}`, {
          place: found.place.name,
          price: unitPriceText(found.place.unitPrice, t, locale.value),
          day: shortDay(found.place.day),
        }),
      }
    })
    const alternativeHint = computed(() => {
      const other = sameItem.value ? hint.value.alternative : null
      if (!other) return null
      return t('item.cheaper.alternative', {
        name: other.name,
        price: unitPriceText(other.place.unitPrice, t, locale.value),
        place: other.place.name,
        day: shortDay(other.place.day),
        rating: formatRating(other.rating, locale.value),
      })
    })

    const figures = start.line
    const discountHint = computed(() =>
      figures.discount && figures.price
        ? t('receipt.line.discount_hint', {
            price: formatMoney(figures.price, locale.value),
            discount: formatMoney(figures.discount, locale.value),
          })
        : null,
    )
    const weightHint = computed(() => {
      const many = parsedQuantity.value
      if (!many || many.unit === 'piece' || !figures.price) return null
      return t('receipt.line.weight_hint', {
        qty: `${formatQuantity(many, locale.value)} ${t(`item.unit_${many.unit}`)}`,
        price: formatMoney(figures.price, locale.value),
      })
    })
    const remembered = computed(() =>
      figures.rememberedPrice && priceInDoubt(figures.price, figures.rememberedPrice)
        ? t('receipt.line.remembered', {
            price: formatMoney(figures.rememberedPrice, locale.value),
          })
        : null,
    )
    const mismatch = computed(() => {
      if (!start.mismatch || !figures.quantity || !figures.price || !figures.sum) return null
      return t('receipt.line.mismatch', {
        printed: formatMoney(figures.sum, locale.value),
        qty: `${formatQuantity(figures.quantity, locale.value)} ${t(`item.unit_${figures.quantity.unit}`)}`,
        price: formatMoney(figures.price, locale.value),
        sum: start.amount ? formatMoney(start.amount, locale.value) : '—',
      })
    })

    function draft(skipped: boolean): LineDraft | null {
      const many = typedQuantity()
      const money = typedAmount()
      quantityBad.value = many === 'bad'
      amountBad.value = money === 'bad'
      if (many === 'bad' || money === 'bad') return null
      let chosen: LineDraft['item']
      if (item.value.id) chosen = { id: item.value.id, name: item.value.name }
      else {
        const typed = pastedLine(name.value)
        const valid = !drawsNothing(typed) && newItemSchema.shape.name.safeParse(typed).success
        chosen = { name: valid ? typed : item.value.name }
      }
      return { item: chosen, quantity: many, amount: money, skip: skipped }
    }

    function finish(skipped: boolean): void {
      const line = draft(skipped)
      if (!line) return
      emit('saved', line)
      emit('update:open', false)
    }

    return {
      t,
      ERROR,
      NAME_MAX,
      item,
      name,
      quantity,
      unit,
      amount,
      skip,
      picking,
      quantityBad,
      amountBad,
      units,
      perUnit,
      itemHint,
      alternativeHint,
      discountHint,
      weightHint,
      remembered,
      mismatch,
      checking: computed(() => start.check && !settled.value && item.value.id === start.itemId),
      sign: computed(() => currencySign(props.currency, locale.value)),
      meta: computed(() =>
        props.place
          ? t('receipt.line.meta', {
              n: start.position + 1,
              total: props.total,
              place: props.place.name,
            })
          : t('receipt.line.meta_no_place', { n: start.position + 1, total: props.total }),
      ),
      picked: (chosen: { id: string; name: string } | { name: string }) => {
        settled.value = true
        if ('id' in chosen) item.value = { id: chosen.id, name: chosen.name }
        else {
          item.value = { id: null, name: chosen.name }
          name.value = chosen.name
        }
        picking.value = false
      },
      save: () => {
        finish(false)
      },
      leaveOut: () => {
        finish(true)
      },
      unskip: () => {
        skip.value = false
      },
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
}

.plate {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  font-size: var(--text-footnote);

  &.quiet {
    color: var(--text-muted);
    background: var(--surface-2);
  }

  &.warn {
    color: var(--warn-ink);
    background: var(--warn-tint);
    font-weight: var(--weight-medium);
  }
}

.printed-box {
  display: grid;
  gap: var(--space-1);
  background: var(--surface-2);
}

.caps {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.printed {
  font-family: var(--font-printed);
  font-size: var(--text-body);
  overflow-wrap: anywhere;
}

.translation,
.hint {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.hint {
  margin: calc(var(--space-2) * -1) 0 0;
}

.field {
  display: grid;
  gap: var(--space-2);
}

.label {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.product {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  min-height: var(--touch-target-lg);
  padding: var(--space-2) var(--space-4);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text);
  background: var(--surface-2);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &.check {
    border-color: var(--warn);
    box-shadow: inset 0 0 0 0.5px var(--warn);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.product-name {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.product-other {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--accent-ink);
  font-weight: var(--weight-medium);
}

.other-chevron {
  @include icon;

  font-size: var(--icon);
}

.tag {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-pill);
  color: var(--text);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: var(--space-3);
  align-items: start;
}

.sign {
  padding: 0 var(--space-3);
  color: var(--text-muted);
}

.per-unit-box {
  overflow: hidden;
  border-radius: var(--radius);
  color: var(--good-ink);
  background: var(--good-tint);
}

.per-unit {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
  min-height: var(--touch-target-lg);
  padding: var(--space-3) var(--space-4);
}

.per-unit-label {
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.per-unit-value {
  @include display-type;

  font-size: var(--text-title);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* As on the purchase's sheet: never red — red is «не брать нигде». */
.cheaper {
  margin: 0;
  padding: var(--space-2) var(--space-4) var(--space-3);
  border-top: var(--hairline) solid var(--border);
  font-size: var(--text-callout);
  line-height: var(--leading-snug);
  overflow-wrap: anywhere;
}

.cheaper-there {
  color: var(--warn-ink);
  background: var(--warn-tint);
}

.cheaper-best,
.cheaper-same,
.cheaper-alternative {
  color: var(--text);
  background: var(--surface-2);
}
</style>
