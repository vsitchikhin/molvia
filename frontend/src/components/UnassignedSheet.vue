<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('accounts.unassigned_sheet.title') }}</template>
    <template #meta>{{ t('accounts.unassigned_sheet.meta') }}</template>

    <p v-if="state === 'loading'" class="note">{{ t('state.loading') }}</p>
    <p v-else-if="state === 'offline'" class="strip">
      <IconCloudOff class="strip-icon" aria-hidden="true" />{{ t('spending.offline.title') }}
    </p>
    <p v-else-if="state === 'error'" class="failed" role="alert">
      {{ t('accounts.load_failed') }}
    </p>
    <p v-else-if="visible.length === 0" class="done">
      <IconCheck class="strip-icon" aria-hidden="true" />{{
        t('accounts.unassigned_sheet.all_done')
      }}
    </p>
    <AppCard v-else as="ul" list>
      <AppReveal group>
        <OperationRow
          v-for="row in visible"
          :key="`${row.id}-${row.side ?? ''}`"
          :operation="row"
          :categories="categories"
          :name-of="nameOf"
          :account-name="accountName"
          :meta="metaOf(row)"
          @open="openRow"
        />
      </AppReveal>
    </AppCard>

    <template #footer>
      <!-- A spending removed from its own sheet over this one comes back here (MOL-82). -->
      <UndoStrip
        v-if="removed"
        :key="removed.stamp"
        class="undo"
        :text="t('spending.removed', removed)"
        :announcement="t('spending.removed_announced', removed)"
        :action="t('spending.restore')"
        @restore="restore"
        @expire="removed = null"
      />
      <AppButton size="large" block @click="$emit('update:open', false)">
        <template #icon><IconCheck /></template>
        {{ t('accounts.done') }}
      </AppButton>
    </template>
  </BottomSheet>
  <OperationSheet
    v-model:open="operationOpen"
    :operation="operation"
    back
    :online="online"
    @saved="saved"
    @removed="onRemoved"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import type { AccountOperationView } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { shortDay } from '@/components/accounts'
import type { Removed } from '@/components/spending'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useOwnCategories } from '@/composables/useOwnCategories'
import { useReconnect } from '@/composables/useReconnect'
import { useAccountsStore } from '@/stores/accounts'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { reportFailure } from '@/failures'

/**
 * «Не попали в остатки» (MOL-123, handoff 01): the operations with no account that could still
 * explain a difference of some account — the server's list (Р-16 MOL-115). A row opens its own sheet
 * over this one, where the account is chosen; once that reaches the server the row leaves the list.
 */
export default defineComponent({
  name: 'UnassignedSheet',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    BottomSheet,
    IconCheck,
    IconCloudOff,
    OperationRow,
    OperationSheet,
    UndoStrip,
  },
  props: {
    open: { type: Boolean, required: true },
    online: { type: Boolean, default: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const store = useAccountsStore()
    const spendings = useSpendingQueueStore()
    const trips = useTripQueueStore()
    const { categories, nameOf, nameById } = useOwnCategories()

    const rows = ref<AccountOperationView[]>([])
    const state = ref<'loading' | 'ready' | 'offline' | 'error'>('loading')
    let latest = 0

    async function load(): Promise<void> {
      const mine = ++latest
      try {
        const answer = await api.unassignedOperations()
        if (mine !== latest) return
        rows.value = answer.rows
        state.value = 'ready'
      } catch (error) {
        reportFailure(error, 'screen')
        if (mine !== latest) return
        if (state.value !== 'ready') state.value = navigator.onLine ? 'error' : 'offline'
      }
    }

    watch(
      () => props.open,
      (open) => {
        if (!open) return
        state.value = 'loading'
        void load()
      },
    )
    // A spending given its account goes through the queue: the list is read again once it lands.
    watch(
      () => [spendings.landed, trips.wrote],
      () => {
        if (props.open) void load()
      },
    )

    // Back online, a list that could not be read is read again.
    useReconnect(() => {
      if (props.open && state.value !== 'ready') void load()
    })

    /** A trip whose removal waits in the queue is shown nowhere (MOL-76, review 25). */
    const visible = computed(() =>
      rows.value.filter((row) => row.kind !== 'trip' || !trips.removing.has(row.id)),
    )

    const announce = useAnnouncer()
    const removed = ref<(Removed & { stamp: number }) | null>(null)
    function onRemoved(value: Removed): void {
      removed.value = { ...value, stamp: Date.now() }
    }
    function restore(): void {
      const value = removed.value
      if (!value) return
      spendings.restore(value.undo)
      removed.value = null
      announce?.(t('spending.restored'))
    }

    const accountName = (id: string) => store.accounts.find((one) => one.id === id)?.name ?? null

    /** «Кофе и сэндвич · 21 сент.»: what it was and its day, as the journal of the month says. */
    function metaOf(row: AccountOperationView): string {
      const what =
        row.kind === 'spending'
          ? nameById(row.categoryId)
          : row.kind === 'income'
            ? t('income.fab')
            : row.kind === 'trip'
              ? (row.place ?? '')
              : t('accounts.account.exchange')
      return `${what} · ${shortDay(row.day, locale.value)}`
    }

    const operationOpen = ref(false)
    const operation = ref<AccountOperationView | null>(null)
    function openRow(row: AccountOperationView): void {
      operation.value = row
      operationOpen.value = true
    }
    function saved(): void {
      // An income and an exchange are written by now; a spending is on its way through the queue.
      void load()
      void store.refresh()
    }

    return {
      t,
      rows,
      visible,
      removed,
      onRemoved,
      restore,
      state,
      categories,
      nameOf,
      accountName,
      metaOf,
      operationOpen,
      operation,
      openRow,
      saved,
    }
  },
})
</script>

<style scoped lang="scss">
.undo {
  margin-bottom: var(--space-2);
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.strip,
.done {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  font-size: var(--text-footnote);
}

.strip {
  @include appear;

  background: var(--warn-tint);
  color: var(--warn-ink);
}

.done {
  background: var(--good-tint);
  color: var(--good-ink);
  font-weight: var(--weight-medium);
}

.strip-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.failed {
  margin: 0;
  color: var(--bad-ink);
  font-size: var(--text-footnote);
}
</style>
