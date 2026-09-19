<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('item.propose.title') }}</template>

    <AppField
      v-model="name"
      :label="t('item.propose.name')"
      :maxlength="nameMax"
      autocapitalize="sentences"
      enterkeyhint="next"
    />
    <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
    <AppField v-model="note" :label="t('item.propose.note')" enterkeyhint="done" />

    <template #footer>
      <p v-if="!connected" class="line" role="status">{{ t('item.propose.offline') }}</p>
      <p v-else-if="failed" class="line failed" role="alert">{{ t('item.propose.failed') }}</p>
      <AppButton size="large" block :disabled="!ready" @click="submit">
        {{ t('item.propose.submit') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CATALOGUE_QUERY_MAX, proposedItemSchema } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import { api } from '@/api'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'

/**
 * «Предложить товар» — the one way the catalogue grows in 0.1, so a real form and not a
 * consolation: the name as the price tag has it, what it is sold by, and what tells it apart on
 * the shelf. How much is usually taken is not asked — the purchases will say.
 *
 * The name comes from the query, since that is what the person was looking for. The unit has no
 * default: guessed wrong, it would be the unit of every later purchase of the item.
 *
 * An answer of «already there» is not an error — the item is the one the catalogue held, and it
 * is picked like any other. Offline the button waits for the connection: the catalogue has no
 * queue in 0.1, and an item proposed twice from two queues is what the name identity exists to
 * prevent.
 *
 * What the server refuses reads as one line, not under a field: its refusals are issue codes,
 * which the dictionary does not translate, and a blank name — the one refusal a person can make
 * here — never leaves, because the button waits for a name.
 */
export default defineComponent({
  name: 'ProposeItemSheet',
  components: { AppButton, AppField, BottomSheet, SegmentedControl },
  props: {
    open: { type: Boolean, required: true },
    /** What was typed into the search; the name starts from it. */
    query: { type: String, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    proposed: (entry: CatalogueEntry) => typeof entry.id === 'string',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const name = ref('')
    const unit = ref('')
    const note = ref('')
    const sending = ref(false)
    const failed = ref(false)
    const connected = ref(navigator.onLine)

    const units = computed(() => [
      { value: 'kg', label: t('item.unit_kg') },
      { value: 'l', label: t('item.unit_l') },
      { value: 'piece', label: t('item.unit_piece') },
    ])

    // A fresh form for every opening, starting from what is in the field now.
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        connected.value = navigator.onLine
        name.value = props.query.trim()
        unit.value = ''
        note.value = ''
        failed.value = false
      },
      { immediate: true },
    )

    const input = computed(() =>
      proposedItemSchema.safeParse({
        kind: 'product',
        name: name.value,
        defaultUnit: unit.value,
        ...(note.value.trim() === '' ? {} : { note: note.value }),
      }),
    )

    const ready = computed(() => connected.value && !sending.value && input.value.success)

    async function submit(): Promise<void> {
      const parsed = input.value
      if (!ready.value || !parsed.success) return
      sending.value = true
      failed.value = false
      try {
        const { entry } = await api.proposeItem(parsed.data)
        emit('proposed', entry)
      } catch {
        connected.value = navigator.onLine
        failed.value = connected.value
      } finally {
        sending.value = false
      }
    }

    function sync(): void {
      connected.value = navigator.onLine
    }
    onMounted(() => {
      window.addEventListener('online', sync)
      window.addEventListener('offline', sync)
    })
    onUnmounted(() => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    })

    return {
      t,
      name,
      unit,
      note,
      units,
      connected,
      failed,
      ready,
      submit,
      // No name is longer than the longest query (`CATALOGUE_QUERY_MAX`).
      nameMax: CATALOGUE_QUERY_MAX,
    }
  },
})
</script>

<style scoped lang="scss">
.line {
  margin: 0 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}

.failed {
  color: var(--bad-ink);
}
</style>
