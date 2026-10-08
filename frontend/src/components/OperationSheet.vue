<template>
  <template v-if="operation">
    <template v-if="target">
      <SpendingSheet
        :open="open"
        :back="back"
        :target="target"
        :categories="categories"
        :name-of="nameOf"
        :spend-currency="spendCurrency"
        :online="online"
        :made="made"
        @update:open="$emit('update:open', $event)"
        @add-category="newCategoryOpen = true"
        @saved="$emit('saved')"
        @paid="$emit('saved')"
        @removed="$emit('removed', $event)"
      />
      <NewCategorySheet
        v-model:open="newCategoryOpen"
        over
        :categories="categories"
        @created="made = $event"
      />
    </template>
    <OperationIncomeSheet
      v-else-if="operation.kind === 'income'"
      :id="operation.id"
      :key="operation.id"
      :open="open"
      @update:open="$emit('update:open', $event)"
      @saved="$emit('saved')"
      @unavailable="unavailable"
    />
    <!-- A transfer and its fee open the transfer: they are amended together (MOL-253, Р-5). -->
    <TransferSheet
      v-else-if="transferId"
      :open="open"
      :back="back"
      :editing-id="transferId"
      :online="online"
      @update:open="$emit('update:open', $event)"
      @done="$emit('transfer', $event)"
    />
    <OperationExchangeSheet
      v-else-if="operation.kind === 'exchange'"
      :id="operation.id"
      :key="operation.id"
      :open="open"
      @update:open="$emit('update:open', $event)"
      @saved="$emit('saved')"
      @unavailable="unavailable"
    />
  </template>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccountOperationView, Currency } from '@molvia/model'
import NewCategorySheet from '@/components/NewCategorySheet.vue'
import OperationExchangeSheet from '@/components/OperationExchangeSheet.vue'
import OperationIncomeSheet from '@/components/OperationIncomeSheet.vue'
import SpendingSheet from '@/components/SpendingSheet.vue'
import TransferSheet from '@/components/TransferSheet.vue'
import type { TransferOutcome } from '@/components/TransferSheet.vue'
import type { Removed, SpendingTarget } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useOwnCategories } from '@/composables/useOwnCategories'
import { useActorStore } from '@/stores/actor'

/**
 * The operation of a row of an account's journal, «не попали» or a check, opened in its own sheet —
 * the same one everywhere (MOL-123, handoff 04): a spending in «Трата», a trip in its summary, an
 * income and an exchange in theirs, a transfer and its fee in the transfer's (MOL-253). That is also
 * where its account is chosen. Over another sheet it has «‹» back, and no × (В-4).
 */
export default defineComponent({
  name: 'OperationSheet',
  components: {
    NewCategorySheet,
    OperationExchangeSheet,
    OperationIncomeSheet,
    SpendingSheet,
    TransferSheet,
  },
  props: {
    open: { type: Boolean, required: true },
    operation: { type: Object as PropType<AccountOperationView | null>, default: null },
    back: { type: Boolean, default: false },
    online: { type: Boolean, default: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    saved: () => true,
    removed: (removed: Removed) => typeof removed === 'object',
    transfer: (outcome: TransferOutcome) => typeof outcome === 'object',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const actor = useActorStore()
    const announce = useAnnouncer()
    const { categories, nameOf } = useOwnCategories()
    const spendCurrency = computed<Currency>(() => actor.settings?.spendCurrency ?? 'AMD')
    const newCategoryOpen = ref(false)
    const made = ref<string | null>(null)
    watch(
      () => props.operation,
      () => {
        made.value = null
      },
    )

    /** A spending and a trip open in the sheet of «Деньги», built from the row as it was read. */
    const target = computed<SpendingTarget | null>(() => {
      const operation = props.operation
      if (!operation) return null
      const [own] = operation.amounts
      const amount = own
        ? { ...own, minor: own.minor < 0n ? -own.minor : own.minor }
        : { minor: 0n, currency: spendCurrency.value }
      if (operation.kind === 'trip')
        return {
          kind: 'trip',
          day: operation.day,
          row: {
            kind: 'trip',
            key: operation.id,
            tripId: operation.id,
            placeName: operation.place ?? '',
            items: operation.items ?? 0,
            amount,
            counted: null,
          },
        }
      if (operation.kind !== 'spending' || !operation.categoryId || operation.transferId !== null)
        return null
      return {
        kind: 'manual',
        row: {
          kind: 'manual',
          key: operation.id,
          spending: {
            id: operation.id,
            spentOn: operation.day,
            amount,
            categoryId: operation.categoryId,
            note: operation.note,
            place: operation.place,
            rate: null,
            accountId: operation.accountId,
            debited: operation.debited,
            transferId: operation.transferId,
            revision: operation.revision ?? 1,
            amendedAt: null,
          },
          counted: null,
          mark: null,
          refusal: null,
          local: false,
        },
      }
    })

    /** An income or an exchange that could not be read: said, and the tap taken back. */
    function unavailable(): void {
      if (!props.open) return
      announce?.(t(navigator.onLine ? 'accounts.account.error.title' : 'spending.offline.title'))
      emit('update:open', false)
    }

    /** The transfer a row opens: its own, or the one a fee was taken for. */
    const transferId = computed(() => {
      const operation = props.operation
      if (!operation) return null
      return operation.kind === 'transfer' ? operation.id : operation.transferId
    })

    return {
      categories,
      nameOf,
      spendCurrency,
      newCategoryOpen,
      made,
      target,
      transferId,
      unavailable,
    }
  },
})
</script>
