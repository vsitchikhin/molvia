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
    <!-- The attribution the base's licence asks for (MOL-162): its page, opened by the person. -->
    <a v-if="source" class="source" :href="source" target="_blank" rel="noopener noreferrer">
      {{ t('item.propose.hint_source') }}
    </a>
    <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
    <div v-if="sizeShown && size" class="size">
      <p class="size-text">{{ t('item.propose.size', sizeWords(size)) }}</p>
      <AppButton variant="icon" :label="t('item.propose.size_drop')" @click="size = null">
        <IconClose />
      </AppButton>
    </div>
    <AppField
      v-model="note"
      :label="t('item.propose.note')"
      :maxlength="noteMax"
      enterkeyhint="done"
    />
    <p v-if="nameTaken" class="code">{{ t('item.propose.name_taken', { name: nameTaken }) }}</p>
    <p v-if="code" class="code">{{ t('item.propose.code', { code }) }}</p>

    <template #footer>
      <!-- There before its words, with only the text changing: a live region born together with
           what it says is often not read at all (MOL-19; review Р-18). -->
      <p class="line" :class="{ failed: textRefused }" role="status">{{ status }}</p>
      <p v-if="connected && failed" class="line failed" role="alert">
        {{ t('item.propose.failed') }}
      </p>
      <!-- Another item holds the code (MOL-100, Р-3): nothing was written, and that item is offered
           — the package in the hand is what the catalogue already knows it as. -->
      <template v-if="holder">
        <p class="line failed" role="alert">
          {{ t('item.propose.taken', { name: holder.name }) }}
        </p>
        <AppButton ref="takeButton" size="large" block @click="$emit('taken', holder)">
          {{ t('item.propose.take', { name: holder.name }) }}
        </AppButton>
      </template>
      <AppButton v-else size="large" block :disabled="!ready" @click="submit">
        {{ t('item.propose.submit') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ITEM_NAME_MAX,
  ITEM_NOTE_MAX,
  decimalFromMilli,
  drawsNothing,
  pastedLine,
  proposedItemSchema,
} from '@molvia/model'
import type { BarcodeHint, CatalogueEntry, Quantity } from '@molvia/model'
import IconClose from '~icons/mdi/close'
import { api } from '@/api'
import { shown } from '@/composables/useItemDetails'
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
 * Opened from a code the catalogue did not know (MOL-100), the code goes with the item — shown, and
 * not taken out: to add the item without it, the person closes the sheet and finds it by name. The
 * code another item already holds writes nothing, and that item is offered instead.
 *
 * Opened with an empty name for a code Open Food Facts named (MOL-162), the form starts from what
 * the base says: the name, the unit its size is in, and the size of the package — sent as how much
 * is usually taken, so a purchase of it opens at «0,4 кг» and its price per kilo shows at once. A
 * fact from the package, not a guess, which is why the unit may start chosen here. A hint that comes
 * after the sheet opened fills only what is still empty: nothing changes under the person's finger.
 * A name the person typed before — «другой товар», a word in the search — takes no hint at all.
 *
 * What the server refuses reads as one line, not under a field: its refusals are issue codes,
 * which the dictionary does not translate, and a blank name — the one refusal a person can make
 * here — never leaves, because the button waits for a name.
 */
/** As long as the app's live region waits before its words (`useAnnouncer`). */
const STATUS_DELAY_MS = 100

export default defineComponent({
  name: 'ProposeItemSheet',
  components: { AppButton, AppField, BottomSheet, IconClose, SegmentedControl },
  props: {
    open: { type: Boolean, required: true },
    /** What was typed into the search; the name starts from it. */
    query: { type: String, required: true },
    /** The code the item is proposed for, read from its package (MOL-100); none from the name. */
    code: { type: String as PropType<string | null>, default: null },
    /**
     * The name of the item just declined as «другой товар» (MOL-100, adversarial Н): the name typed
     * is that item's, and proposed again it would be asked about again.
     */
    nameTaken: { type: String as PropType<string | null>, default: null },
    /** What Open Food Facts says the package of `code` is (MOL-162); it may come after the opening. */
    hint: { type: Object as PropType<BarcodeHint | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    /** `created: false` — the catalogue held the name; codes sent with it were not written (В-5). */
    proposed: (entry: CatalogueEntry, created: boolean) =>
      typeof entry.id === 'string' && typeof created === 'boolean',
    /** The item that holds the code already, chosen instead (MOL-100). */
    taken: (entry: CatalogueEntry) => typeof entry.id === 'string',
    /** A new item written with this code after the sheet was put away (adversarial Р6-Б). */
    writtenLate: (code: string) => typeof code === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const name = ref('')
    const unit = ref('')
    const note = ref('')
    /** The size of the package, from the hint only; sent while the unit chosen is its own. */
    const size = shallowRef<Quantity | null>(null)
    /** The page of the product in Open Food Facts once the hint filled anything — the attribution. */
    const source = ref<string | null>(null)
    /** Whether this opening started with no name — the only one a hint may fill. */
    let startedEmpty = false
    const sending = ref(false)
    const failed = ref(false)
    const connected = ref(navigator.onLine)
    const holder = shallowRef<CatalogueEntry | null>(null)
    const takeButton = ref<{ $el?: HTMLElement } | null>(null)

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
        size.value = null
        source.value = null
        failed.value = false
        holder.value = null
        startedEmpty = name.value === ''
        fill(props.hint)
      },
      { immediate: true },
    )

    /** What is still empty, from the hint (MOL-162, Р-8): nothing the person has set is replaced. */
    function fill(hint: BarcodeHint | null): void {
      if (!props.open || !startedEmpty || hint === null) return
      let used = false
      if (name.value === '') {
        name.value = hint.name
        used = true
      }
      if (hint.quantity !== null && size.value === null && unit.value === '') {
        unit.value = hint.quantity.unit
        size.value = hint.quantity
        used = true
      }
      if (used) source.value = hint.url
    }
    watch(() => props.hint, fill)

    const sizeShown = computed(() => size.value !== null && unit.value === size.value.unit)

    function sizeWords(quantity: Quantity): { amount: string; unit: string } {
      return {
        amount: shown(decimalFromMilli(quantity), locale.value === 'ru' ? ',' : '.'),
        unit: t(quantity.unit === 'kg' ? 'item.unit_kg' : 'item.unit_l'),
      }
    }

    const input = computed(() =>
      proposedItemSchema.safeParse({
        kind: 'product',
        name: name.value,
        defaultUnit: unit.value,
        barcodes: props.code === null ? [] : [props.code],
        ...(sizeShown.value && size.value !== null
          ? { typicalQuantity: { value: decimalFromMilli(size.value), unit: size.value.unit } }
          : {}),
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
      const sentCode = props.code
      sending.value = true
      failed.value = false
      try {
        const written = await api.proposeItem(parsed.data)
        if (mine !== opening) {
          // Put away meanwhile: nothing is picked (A1), but a new item was written with the code, and
          // the screen must not go on asking about it (adversarial Р6-Б).
          if (!('taken' in written) && written.created && sentCode !== null) {
            emit('writtenLate', sentCode)
          }
          return
        }
        if ('taken' in written) {
          holder.value = written.taken
          // «Добавить» goes with the answer: the focus goes to what took its place, inside the sheet
          // — gone with the button, it fell to the body outside the modal dialog (adversarial О′).
          await nextTick()
          takeButton.value?.$el?.focus()
        } else emit('proposed', written.entry, written.created)
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
      size,
      sizeShown,
      sizeWords,
      source,
      units,
      connected,
      failed,
      holder,
      takeButton,
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

.source {
  align-self: flex-start;
  color: var(--accent-ink);
  font-size: var(--text-footnote);
}

.size {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-left: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.size-text {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
}

.code {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}
</style>
