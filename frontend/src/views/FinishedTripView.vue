<template>
  <AppScreen :title="name || t('trip.history.title')">
    <template v-if="meta" #subtitle>{{ meta }}</template>

    <!-- The connection, one strip first under the header (MOL-181, Ф-14), over the record the phone
         remembers — as on the record typed by hand (MOL-206, owner's В-3 «а»): «Показаны данные…» and
         a card of its own were three ways of saying it on one screen (Е-4). -->
    <template v-if="available">
      <StatusStrip
        v-if="trouble === 'offline'"
        class="connection"
        kind="offline"
        :text="t('trip.offline.strip')"
        :attempt="attempt"
      />
      <StatusStrip
        v-else-if="trouble === 'error'"
        class="connection"
        kind="unanswered"
        :text="t('trip.error.strip')"
        :attempt="attempt"
      >
        <template #action>
          <AppButton variant="ghost" @click="load">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>
    </template>

    <!-- The answer's shape (MOL-178, Ф-13): the rows of the record and the card of its total. -->
    <ScreenSkeleton v-if="loading && !available">
      <SkeletonPart kind="rows" tail next />
      <SkeletonPart kind="figure" />
    </ScreenSkeleton>
    <ScreenState
      v-else-if="missing"
      kind="attention"
      :title="t('trip.history.missing_title')"
      :body="t('trip.history.missing_body')"
    >
      <template #action
        ><AppButton @click="history">{{ t('trip.history.title') }}</AppButton></template
      >
    </ScreenState>
    <template v-else>
      <!-- «Записали N покупок» (5o): once, on arrival from the review of a receipt. -->
      <ScreenState
        v-if="recorded !== null"
        kind="empty"
        inline
        :icon="IconCheck"
        :title="
          recorded === 0
            ? t('receipt.recorded.sum_title')
            : t('receipt.recorded.title', { n: recorded }, recorded)
        "
        v-bind="recorded === 0 ? {} : { body: t('receipt.recorded.body') }"
      >
        <!-- A sum with no purchase has nothing to rate yet (MOL-227). -->
        <template v-if="recorded !== 0" #action>
          <AppButton variant="ghost" @click="toVerdicts">
            <template #icon><IconStar /></template>
            {{ t('receipt.recorded.to_verdicts') }}
          </AppButton>
        </template>
      </ScreenState>
      <!-- A code asked to be bound that another item holds (MOL-234): the purchases stand. -->
      <p v-for="one in codesHeld" :key="one.code" class="held">
        {{ t('receipt.codes.held', { code: one.code, name: one.holder }) }}
      </p>
      <!-- Nothing of the record to show: the screen's own state, never a strip over nothing. -->
      <template v-if="!available">
        <ScreenState
          v-if="trouble === 'error'"
          kind="error"
          :title="t('trip.history.error_title')"
          :body="t('trip.history.error_body')"
          @retry="load"
        />
        <ScreenState
          v-else-if="trouble === 'offline'"
          kind="offline"
          tone="warn"
          :title="t('trip.history.offline_title')"
          :body="t('trip.history.offline_body')"
        />
      </template>
      <ScreenState
        v-if="rejected"
        kind="attention"
        inline
        :title="t('trip.history.rejected_title')"
        :body="t('trip.history.rejected_body')"
      >
        <template #action
          ><AppButton variant="ghost" @click="review">{{
            t('trip.history.review')
          }}</AppButton></template
        >
      </ScreenState>
      <p v-if="pending" class="note">{{ t('trip.history.pending') }}</p>
      <template v-if="available">
        <TripRateNotes v-if="trip" :trip="trip" />
        <AppCard v-if="rows.length > 0" list
          ><TripRow v-for="row in rows" :key="row.key" :row="row" @open="amend"
        /></AppCard>
        <p v-else class="note">{{ t('trip.history.no_purchases') }}</p>
        <!-- Under the list, the card of the record typed by hand (MOL-206): one sum and one line of
             parts, no figure without its words (Ф-23). With a receipt's sum and no purchase too — the
             sum is the record's money (MOL-227). -->
        <TripTotalCard
          v-if="rows.length > 0 || receiptCurrent"
          class="total"
          :trip="trip"
          :pending="waiting"
          :local="trip === null"
          :receipt-waiting="receiptWaiting"
          :rows="priced"
        />
        <!-- Everything under the total, no strip (owner's В-2 «а»): a finished record is not one going
             on, and adding a forgotten purchase is rare. -->
        <AppButton
          v-if="receiptAction"
          class="receipt"
          variant="ghost"
          block
          @click="receiptOpen = true"
          >{{ receiptAction }}</AppButton
        >
        <AppButton
          class="add"
          :class="{ alone: !receiptAction }"
          variant="ghost"
          block
          @click="find"
        >
          <template #icon><IconPlus /></template>
          {{ t('trip.add_item') }}
        </AppButton>
        <!-- The same place as on an open trip: the end of the list (MOL-76, В-1). -->
        <AppButton class="remove" variant="danger-ghost" block @click="askRemove">
          <template #icon><IconDelete /></template>
          {{ t('trip.remove.action') }}
        </AppButton>
      </template>
    </template>
    <ReceiptSheet
      v-if="id"
      v-model:open="receiptOpen"
      :trip-id="id"
      :trip-currency="receiptCurrency"
      :current="receiptCurrent"
      :removable="rows.length > 0"
    />
    <TripRemoveSheet
      v-model:open="removing"
      :place="removal.place"
      :day="removal.day"
      :items="removal.items"
      :receipt="removal.receipt"
      :steps="2"
      :on-closed="afterRemoveSheet"
      @confirm="confirmRemove"
    />
    <ItemDetailsSheet
      v-if="opened"
      :key="opened.key"
      :entry="opened.entry"
      :expense="opened.expense"
      :retry="opened.retry"
      :trip-id="id"
      :trip-context="trip"
      :trip-currency="local?.currency ?? undefined"
      :close-steps="1"
      :on-closed="close"
    />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconDelete from '~icons/mdi/delete-outline'
import IconPlus from '~icons/mdi/plus'
import IconStar from '~icons/mdi/star-outline'
import AppScreen from '@/components/AppScreen.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import TripRemoveSheet from '@/components/TripRemoveSheet.vue'
import TripRow from '@/components/TripRow.vue'
import TripTotalCard from '@/components/TripTotalCard.vue'
import TripRateNotes from '@/components/TripRateNotes.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ReceiptSheet from '@/components/ReceiptSheet.vue'
import { useFinishedTrip } from '@/composables/useFinishedTrip'
export default defineComponent({
  name: 'FinishedTripView',
  components: {
    AppScreen,
    AppButton,
    AppCard,
    ScreenSkeleton,
    ScreenState,
    SkeletonPart,
    StatusStrip,
    TripRemoveSheet,
    TripRow,
    TripTotalCard,
    TripRateNotes,
    IconDelete,
    IconPlus,
    IconStar,
    ItemDetailsSheet,
    ReceiptSheet,
  },
  setup: () => ({ ...useFinishedTrip(), IconCheck }),
})
</script>

<style scoped lang="scss">
.note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  margin-bottom: var(--space-4);
}

// 8 to the card it stands over, as on the record typed by hand.
.connection {
  margin-bottom: var(--space-2);
}

.total {
  margin-top: var(--space-2);
}

/* 24 under the card, 8 between the quiet actions after it (handoffs 7a and 77 v2). */
.receipt {
  margin-top: var(--space-6);
}

.add {
  margin-top: var(--space-2);

  &.alone {
    margin-top: var(--space-6);
  }
}

.remove {
  margin-top: var(--space-2);
}

.held {
  margin: 0 0 var(--space-4);
  font-size: var(--text-callout);
}
</style>
