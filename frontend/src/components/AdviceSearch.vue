<template>
  <SearchField
    class="field"
    :model-value="modelValue"
    :label="t('advice.search.label')"
    :placeholder="t('advice.search.placeholder')"
    clearable
    @update:model-value="$emit('update:modelValue', $event)"
  />

  <template v-if="phase !== 'idle'">
    <p v-if="phase === 'memory' && fetchedAt" class="note">
      {{ t('advice.search.offline', { day: day(fetchedAt), time: time(fetchedAt) }) }}
    </p>

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[62, 62]" />

    <ScreenState
      v-else-if="phase === 'error'"
      kind="error"
      inline
      :title="t('advice.error.title')"
      :body="t('advice.search.error_body')"
      @retry="retry"
    />

    <!-- No action: «Предложить товар» is the entry of a purchase's, and here nothing was bought
         (handoff `01`, 1e). -->
    <ScreenState
      v-else-if="found.length === 0"
      :class="{ stale }"
      kind="empty"
      :icon="IconNotFound"
      inline
      :title="t('advice.search.empty.title', { query: answered })"
      :body="
        phase === 'memory' ? t('advice.search.empty.body_offline') : t('advice.search.empty.body')
      "
    />

    <div v-else class="found" :class="{ stale }">
      <!-- Rows, and none of them close: the server's word (MOL-46), said above them. -->
      <p v-if="phase === 'far'" class="miss">
        {{ t('advice.search.empty.title', { query: answered }) }}
      </p>

      <AdviceGroup v-if="groups.take.length > 0" level="take">
        <AdviceTakeCard
          v-for="row in groups.take"
          :key="row.itemId"
          :row="row"
          :scope="scope"
          @edit="$emit('edit', row, scope)"
        />
      </AdviceGroup>

      <AdviceGroup v-if="groups.if_cheap.length > 0" level="if_cheap">
        <AdviceCheapRow
          v-for="row in groups.if_cheap"
          :key="row.itemId"
          :row="row"
          :scope="scope"
          @edit="$emit('edit', row, scope)"
        />
      </AdviceGroup>

      <!-- No price and no place here either: the row has no field for them (MOL-31, Р-8). -->
      <AdviceGroup v-if="groups.never.length > 0" level="never">
        <AdviceNeverRow
          v-for="row in groups.never"
          :key="row.itemId"
          :row="row"
          :scope="scope"
          @edit="$emit('edit', row, scope)"
        />
      </AdviceGroup>

      <AdviceGroup v-if="groups.unrated.length > 0" level="unrated">
        <AppCard list>
          <button
            v-for="item in groups.unrated"
            :key="item.itemId"
            class="unrated-row"
            type="button"
            @click="$emit('rate', item, scope)"
          >
            <span class="text">
              <span class="name">{{ item.name }}</span>
              <span class="sub">{{ t('advice.search.group_unrated') }}</span>
            </span>
            <span class="rate">{{ t('advice.search.rate') }}</span>
          </button>
        </AppCard>
      </AdviceGroup>

      <p v-if="phase === 'memory'" class="note more">{{ t('advice.search.offline_more') }}</p>
    </div>
  </template>
</template>

<script lang="ts">
import { computed, defineComponent, onUnmounted, toRef, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconNotFound from '~icons/mdi/magnify-close'
import type { AdviceFound, AdviceResponse, AdviceRow, AdviceScope } from '@molvia/model'
import AdviceCheapRow from '@/components/AdviceCheapRow.vue'
import AdviceGroup from '@/components/AdviceGroup.vue'
import AdviceNeverRow from '@/components/AdviceNeverRow.vue'
import AdviceTakeCard from '@/components/AdviceTakeCard.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SearchField from '@/components/SearchField.vue'
import type { CheapRow, NeverRow, TakeRow } from '@/components/adviceRow'
import { useAdviceSearch } from '@/composables/useAdviceSearch'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { purchaseDay, timeOfDay } from '@/days'

/** The found items laid out by group, each in the order the search gave it. */
interface Found {
  readonly take: TakeRow[]
  readonly if_cheap: CheapRow[]
  readonly never: NeverRow[]
  readonly unrated: AdviceFound[]
}

function laidOut(found: readonly AdviceFound[]): Found {
  const groups: Found = { take: [], if_cheap: [], never: [], unrated: [] }
  for (const item of found) {
    const row = item.advice
    if (row === null) groups.unrated.push(item)
    else if (row.level === 'take') groups.take.push(row)
    else if (row.level === 'if_cheap') groups.if_cheap.push(row)
    else groups.never.push(row)
  }
  return groups
}

/**
 * The search on «Что брать» (MOL-128, handoff `01`): a field at the top of the list, and what it
 * finds in the whole catalogue laid out by the same groups and the same shapes as the list — a
 * card, a row, a line — then «Ещё не оценивали» last. The groups decide the order; inside one,
 * the search does.
 *
 * Every row is the server's (В-1). «Не брать нигде» comes with no price and no place, because its
 * row has no field for them, here as in the list. No «Предложить товар», and nothing on the page
 * could ever be promoted: there is no field to promote it by.
 */
export default defineComponent({
  name: 'AdviceSearch',
  components: {
    AdviceCheapRow,
    AdviceGroup,
    AdviceNeverRow,
    AdviceTakeCard,
    AppCard,
    ScreenSkeleton,
    ScreenState,
    SearchField,
  },
  props: {
    modelValue: { type: String, required: true },
    /** The list the phone keeps: searched on the phone with no connection (В-3). */
    remembered: { type: Object as PropType<AdviceResponse | null>, default: null },
    fetchedAt: { type: Date as PropType<Date | null>, default: null },
    /** Raised after a verdict is saved: the rows on screen are asked for again. */
    refreshes: { type: Number, default: 0 },
  },
  emits: {
    'update:modelValue': (text: string) => typeof text === 'string',
    /** With the scope of the answer the row came in: the list's may be another (review Р-13, Е). */
    edit: (row: AdviceRow, scope: AdviceScope) => typeof row === 'object' && !!scope,
    rate: (item: AdviceFound, scope: AdviceScope) => typeof item === 'object' && !!scope,
  },
  setup(props) {
    const { t, locale } = useI18n()
    const search = useAdviceSearch(toRef(props, 'modelValue'), () => props.remembered)
    const { phase, found, stale, answered } = search
    const announce = useAnnouncer()

    // After a save the rows on screen are asked for again quietly, dimmed rather than taken away
    // under the sheet that is closing over them (review Р-3, adversarial Г).
    watch(
      () => props.refreshes,
      () => {
        search.refresh()
      },
    )

    // Read out once per answer, and never a dimmed one: it answers the text before (MOL-23, Р-10).
    // Nothing found is not read here: the empty block says it itself (review Р-8).
    let withdraw: (() => void) | undefined
    watch([phase, found, stale], ([next, rows, dimmed]) => {
      withdraw?.()
      withdraw = undefined
      if (dimmed || rows.length === 0 || !['ready', 'far', 'memory'].includes(next)) return
      withdraw = announce?.(
        next === 'far'
          ? t('advice.search.empty.title', { query: answered.value })
          : t('item.results_announced', { n: rows.length }, rows.length),
      )
    })
    onUnmounted(() => {
      withdraw?.()
    })

    return {
      t,
      IconNotFound,
      phase,
      found,
      stale,
      answered,
      scope: search.scope,
      groups: computed(() => laidOut(found.value)),
      retry: search.retry,
      day: (when: Date) => purchaseDay(when, locale.value),
      time: (when: Date) => timeOfDay(when, locale.value),
    }
  },
})
</script>

<style scoped lang="scss">
.field {
  margin-bottom: var(--space-4);
}

.note,
.miss {
  margin: 0 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.more {
  margin: var(--space-4) 0 0;
}

.found,
.stale {
  transition: opacity var(--dur) var(--ease-out);
}

.stale {
  opacity: var(--opacity-stale);
}

@media (prefers-reduced-motion: reduce) {
  .found,
  .stale {
    transition: none;
  }
}

.unrated-row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: 0;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.text {
  flex: 1;
  min-width: 0;
}

.name,
.sub {
  display: block;
  overflow-wrap: anywhere;
}

.name {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.sub {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.rate {
  flex: none;
  color: var(--accent-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}
</style>
