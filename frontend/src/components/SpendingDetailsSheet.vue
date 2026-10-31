<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ t('spending.sheet.details_title') }}</template>

    <div ref="fields" class="fields">
      <AppField
        :model-value="day"
        data-field="day"
        :label="t('spending.sheet.date')"
        kind="date"
        min="2000-01-02"
        :max="latest"
        :display="display"
        :error-text="dayBad ? t('spending.sheet.bad_day') : null"
        @update:model-value="$emit('update:day', $event)"
      />
      <AppField
        :model-value="note"
        data-field="note"
        :label="t('spending.sheet.note')"
        :placeholder="t('spending.sheet.note_placeholder')"
        :maxlength="textMax"
        :error-text="noteBad ? t('spending.sheet.bad_text') : null"
        enterkeyhint="next"
        @update:model-value="$emit('update:note', $event)"
      >
        <template #label-extra>
          <span class="optional">{{ t('spending.sheet.optional') }}</span>
        </template>
      </AppField>
      <AppField
        :model-value="place"
        data-field="place"
        :label="t('spending.sheet.place')"
        :placeholder="t('spending.sheet.place_placeholder')"
        :maxlength="textMax"
        :error-text="placeBad ? t('spending.sheet.bad_text') : null"
        enterkeyhint="done"
        @update:model-value="$emit('update:place', $event)"
      >
        <template #label-extra>
          <span class="optional">{{ t('spending.sheet.optional') }}</span>
        </template>
      </AppField>
    </div>

    <template #footer>
      <AppButton size="large" block @click="$emit('update:open', false)">
        <template #icon><IconCheck /></template>
        {{ t('spending.sheet.details_done') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import { SPENDING_TEXT_MAX } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import type { SpendingDetailsField } from '@/components/spending'
import { useFieldRefusal } from '@/composables/useFieldRefusal'

/**
 * «Дата, заметка, место» over the spending sheet (MOL-199, handoff 72 v2, Ф-17): the three fields that
 * stood under the chips, behind one line. The values are the spending sheet's — typed here, they are
 * in its line at once — so «‹», Esc, «back», a pull down and «Готово» all keep what was typed: there
 * was no undo with the fields in the form either. Nothing is checked here; «Сохранить трату» checks,
 * and opens this sheet on the field it found wrong (`focus`).
 */
export default defineComponent({
  name: 'SpendingDetailsSheet',
  components: { AppButton, AppField, BottomSheet, IconCheck },
  props: {
    open: { type: Boolean, required: true },
    day: { type: String, required: true },
    note: { type: String, required: true },
    place: { type: String, required: true },
    /** The latest day the spending takes — the phone's today, or its own day when that is later. */
    latest: { type: String, required: true },
    /** «Сегодня, 30 сентября» over the native date field. */
    display: { type: String, default: '' },
    dayBad: { type: Boolean, default: false },
    noteBad: { type: Boolean, default: false },
    placeBad: { type: Boolean, default: false },
    /** The field to take the focus as the sheet opens — the first wrong one; none for a tap. */
    focus: { type: String as PropType<SpendingDetailsField | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    'update:day': (day: string) => typeof day === 'string',
    'update:note': (note: string) => typeof note === 'string',
    'update:place': (place: string) => typeof place === 'string',
  },
  setup(props) {
    const { t } = useI18n()
    const fields = ref<HTMLElement | null>(null)
    const refuse = useFieldRefusal()

    watch(
      () => props.open,
      (open) => {
        const field = props.focus
        if (!open || field === null) return
        // Opened by a refusal on its field (MOL-199): through the one way a refused field is focused
        // (MOL-235) — `AppField` hands every attribute but class and style to its control.
        void refuse(() => fields.value?.querySelector<HTMLElement>(`[data-field="${field}"]`))
      },
    )

    return { t, fields, textMax: SPENDING_TEXT_MAX }
  },
})
</script>

<style scoped lang="scss">
.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-4);
}

.optional {
  margin-left: var(--space-1);
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}
</style>
