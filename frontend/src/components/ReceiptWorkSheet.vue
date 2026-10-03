<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ title }}</template>
    <template v-if="meta" #meta>{{ meta }}</template>

    <p class="body">
      {{ t(row?.state === 'parsing' ? 'purchases.queued.parsing' : 'purchases.queued.waiting') }}
    </p>
    <ul v-if="photos.length > 0" class="photos" :aria-label="t('receipt.sheet.photos')">
      <li v-for="(url, index) in photos" :key="url">
        <img :src="url" :alt="t('receipt.capture.part', { n: index + 1 })" class="photo" />
      </li>
    </ul>

    <template #footer>
      <AppButton variant="secondary" size="large" block @click="remove">
        <template #icon><IconDelete /></template>
        {{ t('purchases.delete') }}
      </AppButton>
      <p class="note">{{ t('purchases.delete_note') }}</p>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDelete from '~icons/mdi/delete-outline'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import type { ReceiptRow } from '@/composables/useReceipts'
import { photoShelf } from '@/receipts/photoShelf'
import { useActorStore } from '@/stores/actor'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

/**
 * The sheet of a receipt still in work (handoff 03, 3f — `ReceiptSheet` there; that name is the
 * receipt's sum of MOL-78 here, Р-10): where it is, the parts as this phone took them, and «Удалить
 * чек» — with «Вернуть» on «Покупки» for ten seconds (П-8).
 */
export default defineComponent({
  name: 'ReceiptWorkSheet',
  components: { AppButton, BottomSheet, IconDelete },
  props: {
    open: { type: Boolean, required: true },
    row: { type: Object as PropType<ReceiptRow | null>, default: null },
    title: { type: String, default: '' },
    meta: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const actor = useActorStore()
    const queue = useReceiptQueueStore()
    const photos = ref<string[]>([])

    function letGo(): void {
      for (const url of photos.value) URL.revokeObjectURL(url)
      photos.value = []
    }

    watch(
      () => [props.open, props.row?.id] as const,
      async ([open, id]) => {
        letGo()
        const owner = actor.id
        if (!open || !id || !owner) return
        const parts = await photoShelf(owner).parts(id)
        if (props.open && props.row?.id === id)
          photos.value = parts.map((part) => URL.createObjectURL(part))
      },
    )
    onBeforeUnmount(letGo)

    return {
      t,
      photos,
      remove: () => {
        if (props.row) queue.remove(props.row.id)
        emit('update:open', false)
      },
    }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0;
  font-size: var(--text-callout);
}

.photos {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-4) 0 0;
  padding: 0;
  list-style: none;
}

.photo {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius);
  object-fit: cover;
}

.note {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}
</style>
