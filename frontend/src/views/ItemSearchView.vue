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
        <div v-if="phase === 'loading'" class="loading">
          <ScreenSkeleton :groups="[62, 62, 62]" />
        </div>

        <div v-else-if="phase === 'empty'" class="not-found" :class="{ stale }">
          <p class="not-found-text">{{ t('item.empty.body', { query: answered }) }}</p>
          <AppButton @click="proposing = true">
            <template #icon><IconPlus /></template>
            {{ t('item.empty.action') }}
          </AppButton>
        </div>

        <ScreenState
          v-else-if="phase === 'error'"
          kind="error"
          :inline="fallback"
          :title="t('item.error.title')"
          :body="t('item.error.body')"
          @retry="retry"
        >
          <!-- Offered only when there is something to take: with no recent items the tap would
               answer with less than was on screen before it (adversarial A4). -->
          <template v-if="!fallback && hasRecent" #action>
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

      <!-- The answer is not empty, and still not the thing: «сметана» finds the crisps «со
           сметаной», and without this the sour cream could never be added (В-3). Quiet, so it
           does not invite a duplicate of what is listed right above it. -->
      <template v-if="phase === 'ready'" #after>
        <AppButton variant="ghost" block @click="proposing = true">
          {{ t('item.not_listed') }}
        </AppButton>
      </template>
    </CatalogueCombobox>

    <ProposeItemSheet
      v-model:open="proposing"
      :query="query"
      :on-closed="afterProposing"
      @proposed="proposed"
    />

    <!-- Mounted on a pick and put away from `onClosed`: each opening is its own purchase. Two
         steps back on «Добавить в поход» — the sheet and this screen, back to the trip. -->
    <ItemDetailsSheet
      v-if="picked"
      :key="opened"
      :entry="picked.entry"
      :query="picked.query"
      :close-steps="2"
      :on-closed="putAway"
      @added="added"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { CatalogueEntry } from '@molvia/model'
import IconPlus from '~icons/mdi/plus'
import AppButton from '@/components/AppButton.vue'
import AppScreen from '@/components/AppScreen.vue'
import CatalogueCombobox from '@/components/CatalogueCombobox.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ProposeItemSheet from '@/components/ProposeItemSheet.vue'
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
 * A pick leaves with the query it was made on — see `stores/itemEntry` — and the sheet asking how
 * much and for what price comes up over the screen (MOL-24).
 */
export default defineComponent({
  name: 'ItemSearchView',
  components: {
    AppButton,
    AppScreen,
    CatalogueCombobox,
    IconPlus,
    ItemDetailsSheet,
    ProposeItemSheet,
    ScreenSkeleton,
    ScreenState,
  },
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

    // Under an error as offline: the server does not answer either way, and «хлеб» typed before
    // it fell should not show twenty rows instead of one (Р-12).
    const rows = computed<CatalogueEntry[]>(() => {
      if (phase.value === 'ready') return results.value
      if (showsRecent.value) return recent.filter(query.value)
      return []
    })

    // What the fallback would show, not whether there are recent items at all: under an error
    // they are narrowed by the query, and a button leading to none of them is a dead end (B2).
    const hasRecent = computed(() => recent.filter(query.value).length > 0)

    const heading = computed(() =>
      showsRecent.value ? t('item.group_recent') : t('item.group_found'),
    )

    // Read out once per answer, not on every letter: the answer is what changed. An empty answer
    // too — the block that replaces the list is not a ScreenState and says nothing of itself, and
    // after «found one» silence would read as nothing having happened (Р-10, A5).
    // The words go with the answer they describe — a new answer, any other state, the screen
    // left: the region is read in browse mode, and «found one» over an error is a lie (B3).
    // A dimmed answer is not read out: it is for the text before, and the answer to what is typed
    // follows — two counts in a row are noise for someone listening.
    let withdraw: (() => void) | undefined
    watch([phase, results, stale], ([next, found, dimmed]) => {
      withdraw?.()
      withdraw = undefined
      if ((next !== 'ready' && next !== 'empty') || dimmed) return
      withdraw = announce?.(
        next === 'ready'
          ? t('item.results_announced', { n: found.length }, found.length)
          : t('item.empty.body', { query: answered.value }),
      )
    })

    const { picked } = storeToRefs(entry)
    /** Which opening of the sheet this is: the same item picked twice is two purchases. */
    const opened = ref(0)

    // Rows of an answer leave with the query they answer, not with the field: the list stays on
    // screen, dimmed, while the next search is out, and a tap on «Кока-кола» found for «кола»
    // with «хлеб» already typed must not teach the search that «хлеб» means cola (Р-9, A3). The
    // recent items answer no query — they go with the field as it is.
    function pick(chosen: CatalogueEntry): void {
      opened.value += 1
      entry.pick({ entry: chosen, query: phase.value === 'ready' ? answered.value : query.value })
    }

    // Into the recent items only once it went into the trip, as the server's memory of picks
    // does (MOL-11): a pick the sheet cancelled is a changed mind.
    function added(item: CatalogueEntry): void {
      recent.remember(item)
    }

    function putAway(): void {
      entry.clear()
    }

    /** «Предложить товар» — the whole form, the only way the catalogue grows in 0.1. */
    const proposing = ref(false)
    let proposedItem: CatalogueEntry | null = null

    // Picked like any other, with the query it was looked for by: the next search for it then
    // puts it first (MOL-11). New or already there — the same, the item is the catalogue's.
    //
    // Once its sheet is put away, not at once: its close is a step back through history, and a
    // sheet laying its entry before that step lands would be the one the step took (MOL-24).
    function proposed(item: CatalogueEntry): void {
      proposedItem = item
      proposing.value = false
    }

    function afterProposing(): void {
      if (proposedItem) pick(proposedItem)
      proposedItem = null
    }

    onMounted(() => {
      recent.sync()
    })
    onUnmounted(() => {
      withdraw?.()
    })

    return {
      t,
      query,
      phase,
      stale,
      answered,
      retry,
      fallback,
      hasRecent,
      rows,
      heading,
      pick,
      picked,
      opened,
      added,
      putAway,
      proposing,
      proposed,
      afterProposing,
    }
  },
})
</script>

<style scoped lang="scss">
/* Not `.skeleton`: a scoped class reaches the root of a child too, and that is ScreenSkeleton's. */
.loading {
  margin-top: var(--space-6);
  padding: var(--space-4);
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
