<template>
  <AppScreen :title="t('item.search_title')">
    <CatalogueCombobox
      v-model="query"
      :items="rows"
      :heading="heading"
      :stale="stale"
      :label="t('item.search_title')"
      :placeholder="t('item.search_placeholder')"
      :hint="t('item.search_hint')"
      @pick="pick"
    >
      <template #before>
        <div v-if="phase === 'loading'" class="skeleton">
          <ScreenSkeleton :groups="[62, 62, 62]" />
        </div>

        <div v-else-if="phase === 'empty'" class="not-found" :class="{ stale }">
          <p class="not-found-text">{{ t('item.empty.body', { query: answered }) }}</p>
        </div>

        <ScreenState
          v-else-if="phase === 'error'"
          kind="error"
          :inline="fallback"
          :title="t('item.error.title')"
          :body="t('item.error.body')"
          @retry="retry"
        >
          <template v-if="!fallback" #action>
            <AppButton variant="ghost" block @click="fallback = true">
              {{ t('item.error.fallback') }}
            </AppButton>
          </template>
        </ScreenState>

        <ScreenState
          v-else-if="phase === 'offline'"
          kind="offline"
          tone="warn"
          inline
          :title="t('item.offline.title')"
          :body="t('item.offline.body')"
        />
      </template>
    </CatalogueCombobox>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CatalogueEntry } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppScreen from '@/components/AppScreen.vue'
import CatalogueCombobox from '@/components/CatalogueCombobox.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useCatalogueSearch } from '@/composables/useCatalogueSearch'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useRecentItemsStore } from '@/stores/recentItems'

/**
 * «Что взяли?» — entering an item is a lookup in the catalogue, not a text field: free text
 * gives `МОЛОКО МАРИАН 1Л`, which nothing can tie to the canon.
 *
 * Under an empty field — the recent items, which are also all there is to search offline, and
 * after an error once the person asks for them: even with the server dead the trip goes on. The
 * search itself, its pause and its stale answers, is `useCatalogueSearch`; the list and the
 * keyboard are `CatalogueCombobox`.
 *
 * A pick leaves with the query it was made on — see `stores/itemEntry`. The screen stays: the
 * sheet asking how much comes up over it (MOL-24).
 */
export default defineComponent({
  name: 'ItemSearchView',
  components: { AppButton, AppScreen, CatalogueCombobox, ScreenSkeleton, ScreenState },
  setup() {
    const { t } = useI18n()
    const query = ref('')
    const { phase, results, stale, answered, retry } = useCatalogueSearch(query)
    const recent = useRecentItemsStore()
    const entry = useItemEntryStore()
    const announce = useAnnouncer()

    /** «Взять из недавних» under an error — asked for, not shown by default. */
    const fallback = ref(false)
    watch(phase, (next) => {
      if (next !== 'error') fallback.value = false
    })

    const showsRecent = computed(
      () =>
        phase.value === 'idle' ||
        phase.value === 'offline' ||
        (phase.value === 'error' && fallback.value),
    )

    const rows = computed<CatalogueEntry[]>(() => {
      if (phase.value === 'ready') return results.value
      if (phase.value === 'offline') return recent.filter(query.value)
      if (showsRecent.value) return recent.items
      return []
    })

    const heading = computed(() =>
      showsRecent.value ? t('item.group_recent') : t('item.group_found'),
    )

    // Read out once per answer, not on every letter: the answer is what changed.
    let withdraw: (() => void) | undefined
    watch([phase, results], ([next, found]) => {
      if (next !== 'ready') return
      withdraw?.()
      withdraw = announce?.(t('item.results_announced', { n: found.length }, found.length))
    })

    function pick(picked: CatalogueEntry): void {
      entry.pick({ entry: picked, query: query.value })
    }

    onMounted(() => {
      recent.sync()
    })

    return { t, query, phase, stale, answered, retry, fallback, rows, heading, pick }
  },
})
</script>

<style scoped lang="scss">
.skeleton {
  margin-top: var(--space-6);
  overflow: hidden;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}

.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-6);
  padding: var(--space-6) var(--space-4);
  border: var(--hairline) dashed var(--border-strong);
  border-radius: var(--radius-lg);
  text-align: center;
  transition: opacity var(--dur-fast) var(--ease-out);

  &.stale {
    opacity: var(--opacity-stale);
  }
}

.not-found-text {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}

@media (prefers-reduced-motion: reduce) {
  .not-found {
    transition: none;
  }
}
</style>
