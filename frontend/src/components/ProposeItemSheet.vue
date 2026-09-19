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
    <AppField
      v-model="note"
      :label="t('item.propose.note')"
      :maxlength="noteMax"
      enterkeyhint="done"
    />

    <template #footer>
      <!-- There before its words, with only the text changing: a live region born together with
           what it says is often not read at all (MOL-19; review Р-18). -->
      <p class="line" :class="{ failed: textRefused }" role="status">{{ status }}</p>
      <p v-if="connected && failed" class="line failed" role="alert">
        {{ t('item.propose.failed') }}
      </p>
      <AppButton size="large" block :disabled="!ready" @click="submit">
        {{ t('item.propose.submit') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ITEM_NAME_MAX,
  ITEM_NOTE_MAX,
  drawsNothing,
  pastedLine,
  proposedItemSchema,
} from '@molvia/model'
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
/** As long as the app's live region waits before its words (`useAnnouncer`). */
const STATUS_DELAY_MS = 100

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

    /**
     * Which opening of the sheet this is. An answer to a form the person has closed — or closed
     * and opened afresh — is not theirs any more: × said no, and picking the item anyway would
     * raise the sheet «how much» for something they turned down (adversarial A1). The item itself
     * is in the catalogue by then; only the pick is dropped.
     */
    let opening = 0

    // What copying brings along — a tab between the cells of a spreadsheet row, a line break of
    // any kind, the direction marks a chat wraps a pasted name in — is made the line it was meant
    // to be. The list lives in the model beside the one the schema refuses (Р-19).
    watch([name, note], ([nextName, nextNote]) => {
      if (pastedLine(nextName) !== nextName) name.value = pastedLine(nextName)
      if (pastedLine(nextNote) !== nextNote) note.value = pastedLine(nextNote)
    })

    // A fresh form for every opening, starting from what is in the field now.
    watch(
      () => props.open,
      (open) => {
        opening += 1
        sending.value = false
        if (!open) return
        connected.value = navigator.onLine
        name.value = pastedLine(props.query).trim()
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
        // Absent when it draws nothing — by the schema's own measure, so a pasted U+200B is left
        // out like spaces rather than refused with the button going grey (A6b).
        ...(drawsNothing(note.value) ? {} : { note: note.value }),
      }),
    )

    const ready = computed(() => connected.value && !sending.value && input.value.success)

    // What is left for the schema to refuse after `pastedLine` — a private-use glyph, a lone
    // surrogate. The button waits, and the line says which field and why, instead of leaving it
    // grey in silence; typing it again is the one way out a person can see.
    const nameRefused = computed(
      () =>
        !drawsNothing(name.value) && !proposedItemSchema.shape.name.safeParse(name.value).success,
    )
    const noteRefused = computed(
      () =>
        !drawsNothing(note.value) && !proposedItemSchema.shape.note.safeParse(note.value).success,
    )
    const textRefused = computed(() => nameRefused.value || noteRefused.value)

    // The status line is in the sheet from the start, but a closed <dialog> is outside the
    // accessibility tree: a sheet opened offline would show the region and its words in one frame,
    // the case Р-18 left. The words come a moment after the sheet does, as the app's own region
    // lets them (MOL-19).
    const settled = ref(false)
    let settling: ReturnType<typeof setTimeout> | undefined
    watch(
      () => props.open,
      (open) => {
        clearTimeout(settling)
        settled.value = false
        if (open) {
          settling = setTimeout(() => {
            settled.value = true
          }, STATUS_DELAY_MS)
        }
      },
      { immediate: true },
    )
    onUnmounted(() => {
      clearTimeout(settling)
    })

    const status = computed(() => {
      if (!settled.value) return ''
      if (!connected.value) return t('item.propose.offline')
      if (nameRefused.value) return t('item.propose.name_invalid')
      if (noteRefused.value) return t('item.propose.note_invalid')
      return ''
    })

    async function submit(): Promise<void> {
      const parsed = input.value
      if (!ready.value || !parsed.success) return
      const mine = opening
      sending.value = true
      failed.value = false
      try {
        const { entry } = await api.proposeItem(parsed.data)
        if (mine === opening) emit('proposed', entry)
      } catch {
        if (mine !== opening) return
        connected.value = navigator.onLine
        failed.value = connected.value
      } finally {
        if (mine === opening) sending.value = false
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
      textRefused,
      status,
      submit,
      nameMax: ITEM_NAME_MAX,
      noteMax: ITEM_NOTE_MAX,
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

.line:empty {
  margin: 0;
}

.failed {
  color: var(--bad-ink);
}
</style>
