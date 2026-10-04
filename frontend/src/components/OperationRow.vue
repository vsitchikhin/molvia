<template>
  <li>
    <!-- No `aria-label`: it would silence everything the row says; the verb is read first. -->
    <ListRow :icon="icon" :tint="tint" :meta="meta" wrap next @click="$emit('open')">
      <template #title
        ><span class="verb">{{ `${verb} ` }}</span
        >{{ title }}</template
      >
      <template v-if="tag" #below>
        <AppTag :tone="tag.tone" :icon="tag.tone === 'bad' ? IconAlert : IconUpload">{{
          tag.text
        }}</AppTag>
      </template>
      <template v-if="amount !== null" #tail>
        <span class="sums">
          <span class="amount">{{ amount }}</span>
          <span v-if="sub" class="sub">{{ sub }}</span>
        </span>
      </template>
    </ListRow>
  </li>
</template>

<script lang="ts">
import { defineComponent, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconUpload from '~icons/mdi/cloud-upload-outline'
import AppTag from '@/components/AppTag.vue'
import ListRow from '@/components/ListRow.vue'
import type { OperationRowProps } from '@/components/spending'

/**
 * One operation (Ф-12, MOL-176): a spending or a trip of «Траты», a row of an account's journal, of
 * «не попали» and of a check — one row for all of them. It knows no operation: the words come from
 * `journalRowProps` and `operationRowProps`. A circle of 40 in its category's colour, the title
 * breaking onto lines rather than cut, the meta in two lines and a tag under it; the amount and the
 * line under it never cut, and in one column, since every row has the chevron — every one opens a
 * sheet to go on with (В-14). The amount is never coloured: only a balance below zero is «плохо».
 */
export default defineComponent({
  name: 'OperationRow',
  components: { AppTag, ListRow },
  props: {
    icon: { type: [Object, Function] as PropType<Component>, required: true },
    tint: { type: String, required: true },
    verb: { type: String, required: true },
    title: { type: String, required: true },
    meta: { type: String, default: '' },
    /** None — the row has no tail: a check's reason says its sum in its title. */
    amount: { type: String as PropType<string | null>, default: null },
    sub: { type: String as PropType<string | null>, default: null },
    tag: { type: Object as PropType<OperationRowProps['tag']>, default: null },
  },
  emits: { open: () => true },
  setup() {
    return { IconAlert: markRaw(IconAlert), IconUpload: markRaw(IconUpload) }
  },
})
</script>

<style scoped lang="scss">
.verb {
  @include visually-hidden;
}

/* On a narrow phone a tag breaks inside its pill rather than standing over the amount; the item's
   own selector outweighs the kit's `nowrap` whatever order the sheets load in. */
li .tag {
  white-space: normal;
}

.sums {
  display: grid;
  justify-items: end;
}

.amount {
  white-space: nowrap;
}

.sub {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-regular);
  white-space: nowrap;
}
</style>
