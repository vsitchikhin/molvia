<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ title }}</template>
    <template #meta>{{ t('accounts.picker.meta') }}</template>

    <div>
      <div class="groups" role="radiogroup" :aria-label="title">
        <section v-for="section in sections" :key="section.key">
          <SectionCaption as="h3">{{ section.title }}</SectionCaption>
          <AppCard as="ul" list>
            <li v-for="account in section.accounts" :key="account.id">
              <ListRow
                role="radio"
                :title="account.name"
                :meta="subOf(account)"
                :selected="selected === account.id"
                @click="pick(account.id)"
              >
                <template #tail>
                  <span
                    class="balance"
                    :class="{
                      negative: account.balance.minor < 0n,
                      chosen: selected === account.id,
                    }"
                  >
                    {{ balanceOf(account) }}
                  </span>
                </template>
              </ListRow>
            </li>
          </AppCard>
        </section>
        <AppCard v-if="allowNone" as="ul" list>
          <li>
            <ListRow
              role="radio"
              :title="t('accounts.picker.none')"
              :meta="t('accounts.picker.none_hint')"
              :selected="selected === null"
              @click="pick(null)"
            />
          </li>
        </AppCard>
      </div>
      <p class="footnote">{{ footnote }}</p>
    </div>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Currency, MoneyAccountView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { pickerGroups, signedAmount } from '@/components/accounts'
import ListRow from '@/components/ListRow.vue'
import SectionCaption from '@/components/SectionCaption.vue'

/**
 * «Счёт» — the choice of an account, over the sheet of an operation (MOL-123, handoff 06): the
 * accounts of the operation's currency, the others where «списано» can cover them — a spending and
 * a trip — and «Без счёта». A list of radios, each with what it holds now, since at the shelf one
 * picks where there is enough. A choice closes the sheet: there is nothing to confirm.
 */
export default defineComponent({
  name: 'AccountPickerSheet',
  components: { AppCard, BottomSheet, ListRow, SectionCaption },
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, required: true },
    accounts: { type: Array as PropType<MoneyAccountView[]>, required: true },
    currency: { type: String as PropType<Currency>, required: true },
    /** An income and an exchange take only accounts of their own currency. */
    strict: { type: Boolean, default: false },
    selected: { type: String as PropType<string | null>, default: null },
    /** Accounts never offered — the source, for «Куда» of a transfer (MOL-253). */
    exclude: { type: Array as PropType<readonly string[]>, default: () => [] },
    /** «Без счёта» among the choices; a transfer has none (MOL-253). */
    allowNone: { type: Boolean, default: true },
    /** Every currency, a group each, `currency` first — «Откуда» of a transfer (MOL-253). */
    groupAll: { type: Boolean, default: false },
    /** The footnote, when the sheet has its own words for it. */
    note: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    pick: (id: string | null) => id === null || typeof id === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const offered = computed(() =>
      props.accounts.filter((account) => !props.exclude.includes(account.id)),
    )
    const groups = computed(() => pickerGroups(offered.value, props.currency, props.strict))
    const sectionOf = (currency: Currency, accounts: MoneyAccountView[]) => ({
      key: currency,
      title: t('accounts.picker.group_same', { currency: t(`accounts.currency_in.${currency}`) }),
      accounts,
    })
    const sections = computed(() =>
      props.groupAll
        ? [props.currency, ...new Set(groups.value.other.map(({ currency }) => currency))]
            .map((currency) => sectionOf(currency, pickerGroups(offered.value, currency, true).own))
            .filter((section) => section.accounts.length > 0)
        : [
            {
              key: 'own',
              title: t('accounts.picker.group_same', {
                currency: t(`accounts.currency_in.${props.currency}`),
              }),
              accounts: groups.value.own,
            },
            { key: 'other', title: t('accounts.picker.group_other'), accounts: groups.value.other },
          ].filter((section) => section.accounts.length > 0),
    )
    const subOf = (account: MoneyAccountView) =>
      account.savings
        ? t('accounts.currency_savings', { currency: account.currency })
        : account.currency
    const balanceOf = (account: MoneyAccountView) => signedAmount(account.balance, locale.value)
    const footnote = computed(() => {
      if (props.note !== null) return props.note
      if (!props.strict) return t('accounts.picker.note_loose')
      const currency = t(`accounts.currency_in.${props.currency}`)
      return groups.value.own.length > 0
        ? t('accounts.picker.note_strict', { currency })
        : t('accounts.picker.note_strict_none', { currency })
    })
    function pick(id: string | null): void {
      emit('pick', id)
      emit('update:open', false)
    }
    return { t, sections, subOf, balanceOf, footnote, pick }
  },
})
</script>

<style scoped lang="scss">
/* The groups 24 apart, a caption 8 over its card (its own margin), the footnote 8 under the last card
   (handoff 116 v2/06, `picker-light.png`): one child of the sheet, whose own gap of 16 would part them. */
.groups {
  display: grid;
  gap: var(--space-6);
  margin-top: var(--space-2);
}

.balance {
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-weight: var(--weight-regular);

  &.negative {
    color: var(--bad-ink);
  }
}

/* Muted text is under 4.5:1 on a tint (MOL-172): on the chosen row the balance is ink, as the kit
   makes its meta. By the sheet's own choice, never the kit's class of the row, which is no contract. */
.balance.chosen:not(.negative) {
  color: var(--text);
}

.footnote {
  margin: var(--space-2) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;
}
</style>
