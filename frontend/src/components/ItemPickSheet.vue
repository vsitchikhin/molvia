<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.pick.title') }}</template>
    <template #meta>{{ meta }}</template>

    <AppField
      v-model="query"
      :label="t('receipt.pick.title')"
      :placeholder="t('item.search_placeholder')"
      enterkeyhint="search"
    />

    <p v-if="phase === 'loading' && results.length === 0" class="note" role="status">
      {{ t('state.loading') }}
    </p>
    <p v-else-if="phase === 'offline'" class="note">{{ t('item.offline.body') }}</p>
    <p v-else-if="phase === 'error'" class="note">{{ t('error.internal') }}</p>

    <AppCard v-if="results.length > 0" class="results" :class="{ stale }" list>
      <button
        v-for="entry in results"
        :key="entry.id"
        class="result"
        type="button"
        @click="$emit('picked', { id: entry.id, name: entry.name })"
      >
        <span class="result-name">{{ entry.name }}</span>
        <span v-if="entry.note" class="result-note">{{ entry.note }}</span>
      </button>
    </AppCard>

    <!-- The line's own name stays possible: a new item is made by «Записать» itself (Р-1 of MOL-113). -->
    <AppCard v-if="newName" class="keep" list>
      <button class="result keep-new" type="button" @click="$emit('picked', { name: newName })">
        <span class="result-name">{{ t('receipt.pick.keep_new', { text: newName }) }}</span>
        <span class="result-note">{{ t('receipt.pick.keep_new_note') }}</span>
      </button>
    </AppCard>
    <p class="note">{{ t('receipt.pick.note') }}</p>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { drawsNothing, pastedLine } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { useCatalogueSearch } from '@/composables/useCatalogueSearch'

/**
 * «Выбрать товар» (handoff 05, 5g): a sheet over the line's sheet — «‹», no × (Д-1) — with the
 * catalogue's own search, the query starting as the line's gloss, and last «Оставить новым товаром».
 * The item chosen goes back to the line; nothing is written until «Записать».
 */
export default defineComponent({
  name: 'ItemPickSheet',
  components: { AppCard, AppField, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    printed: { type: String, required: true },
    translation: { type: String as PropType<string | null>, default: null },
    /** What the line is called now — the first query, and the name a new item would take. */
    start: { type: String, default: '' },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    picked: (item: { id: string; name: string } | { name: string }) => typeof item === 'object',
  },
  setup(props) {
    const { t } = useI18n()
    const query = ref('')
    const { phase, results, stale } = useCatalogueSearch(query)
    watch(
      () => props.open,
      (open) => {
        if (open) query.value = props.translation ?? props.start
      },
      { immediate: true },
    )
    const newName = computed(() => {
      const value = pastedLine(query.value)
      return drawsNothing(value) ? null : value
    })
    return {
      t,
      query,
      phase,
      results,
      stale,
      newName,
      meta: computed(() =>
        props.translation
          ? t('receipt.pick.meta_translation', { printed: props.printed, text: props.translation })
          : t('receipt.pick.meta', { printed: props.printed }),
      ),
    }
  },
})
</script>

<style scoped lang="scss">
.note {
  margin: var(--space-3) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.results,
.keep {
  margin-top: var(--space-3);
}

.stale {
  opacity: var(--opacity-stale);
}

.result {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  min-height: var(--touch-target-lg);
  padding: var(--space-3) var(--space-4);
  border: 0;
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.result-name {
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.result-note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.keep-new .result-name {
  color: var(--accent-ink);
}
</style>
