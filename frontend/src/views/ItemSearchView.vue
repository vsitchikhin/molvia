<template>
  <AppScreen :title="t('item.search_title')">
    <ScreenSkeleton
      v-if="selectedId && selectedLoading && !selectedAvailable"
      :groups="[72, 54, 84]"
    />
    <ScreenState
      v-else-if="selectedId && selectedMissing"
      kind="attention"
      :title="t('trip.history.missing_title')"
      :body="t('trip.history.missing_body')"
    />
    <ScreenState
      v-else-if="selectedId && !selectedAvailable && selectedTrouble === 'error'"
      kind="error"
      :title="t('trip.history.error_title')"
      :body="t('trip.history.error_body')"
      @retry="selectedLoad"
    />
    <ScreenState
      v-else-if="selectedId && !selectedAvailable && selectedTrouble === 'offline'"
      kind="offline"
      tone="warn"
      :title="t('trip.history.offline_title')"
      :body="t('trip.history.offline_body')"
    />
    <CatalogueCombobox
      v-if="!selectedId || selectedAvailable"
      ref="combobox"
      v-model="query"
      :items="rows"
      :heading="heading"
      :stale="stale"
      :label="t('item.search_title')"
      :placeholder="t('item.search_placeholder')"
      :hint="t('item.search_hint')"
      @pick="pick"
    >
      <template #trailing>
        <AppButton variant="icon" :label="t('item.barcode.scan')" @click="scanning = true">
          <IconBarcode />
        </AppButton>
      </template>

      <template #before>
        <!-- A code the catalogue did not know waits for its item (MOL-100): the search goes on
             under it, and a pick asks whether the code is that item's. -->
        <div v-if="pendingCode && barcode === 'idle' && !bind" class="pending">
          <p class="pending-text">{{ t('item.barcode.pending', { code: pendingCode }) }}</p>
          <AppButton variant="icon" :label="t('item.barcode.pending_drop')" @click="dropPending">
            <IconClose />
          </AppButton>
        </div>

        <!-- «Привязать код к ней?» (MOL-100, В-2): here, where the code's block stood, so that
             «taken» or «no network» is said where the person is; the purchase sheet comes after. -->
        <div v-if="bind && (bind.phase === 'ask' || bind.phase === 'sending')" class="not-found">
          <p class="bind-question">
            {{
              t(bind.origin === 'pick' ? 'item.barcode.bind_question' : 'item.barcode.bind_named', {
                code: bind.code,
                name: bind.entry.name,
              })
            }}
          </p>
          <p class="not-found-text">{{ t('item.barcode.bind_hint') }}</p>
          <div class="bind-actions">
            <AppButton ref="bindFirst" block :busy="bind.phase === 'sending'" @click="attach">
              {{ t('item.barcode.bind') }}
            </AppButton>
            <!-- Inactive while the code is on its way: «без кода» then would be written with it,
                 and «другой товар» would meet it at the very item it was said not to be (review Б). -->
            <AppButton
              variant="secondary"
              block
              :inactive="bind.phase === 'sending'"
              @click="withoutCode"
            >
              {{ t('item.barcode.without_code') }}
            </AppButton>
            <AppButton
              variant="ghost"
              block
              :inactive="bind.phase === 'sending'"
              @click="proposeOther"
            >
              {{ t('item.barcode.propose_other') }}
            </AppButton>
          </div>
        </div>

        <div v-else-if="bind && bind.phase === 'taken' && bind.holder" class="not-found">
          <p class="bind-question">
            {{ t('item.barcode.taken', { code: bind.code, name: bind.holder.name }) }}
          </p>
          <div class="bind-actions">
            <AppButton ref="bindFirst" block @click="takeHolder">
              {{ t('item.propose.take', { name: bind.holder.name }) }}
            </AppButton>
            <AppButton variant="secondary" block @click="withoutCode">
              {{ t('item.barcode.without_code_named', { name: bind.entry.name }) }}
            </AppButton>
          </div>
        </div>

        <!-- The item holds as many codes as one may (review В): asking again changes nothing. -->
        <div v-else-if="bind && bind.phase === 'full'" class="not-found">
          <p class="bind-question">{{ t('error.barcodes_full') }}</p>
          <div class="bind-actions">
            <AppButton ref="bindFirst" block @click="withoutCode">
              {{ t('item.barcode.without_code_named', { name: bind.entry.name }) }}
            </AppButton>
          </div>
        </div>

        <ScreenState
          v-else-if="bind && bind.phase === 'error'"
          kind="error"
          inline
          :title="t('item.error.title')"
          :body="t('item.barcode.bind_error_body', { code: bind.code })"
          @retry="attach"
        >
          <template #action>
            <AppButton variant="ghost" block @click="withoutCode">
              {{ t('item.barcode.without_code') }}
            </AppButton>
          </template>
        </ScreenState>

        <ScreenState
          v-else-if="bind && bind.phase === 'offline'"
          kind="offline"
          tone="warn"
          inline
          :title="t('item.offline.title')"
          :body="t('item.barcode.bind_offline_body')"
        >
          <template #action>
            <AppButton block @click="attach">{{ t('state.retry') }}</AppButton>
            <AppButton variant="ghost" block @click="withoutCode">
              {{ t('item.barcode.without_code') }}
            </AppButton>
          </template>
        </ScreenState>

        <!-- A code looked up (MOL-99) stands in for the search until something is typed. -->
        <div v-else-if="barcode === 'loading'" class="loading">
          <ScreenSkeleton :groups="[62]" />
        </div>

        <!-- A shop's own code (MOL-100, В-4): nobody holds it, and nobody is asked to link it. -->
        <div v-else-if="barcode === 'label'" class="not-found">
          <p class="bind-question">{{ t('item.barcode.in_store', { code: barcodeCode }) }}</p>
          <p class="not-found-text">{{ t('item.barcode.in_store_body') }}</p>
        </div>

        <div v-else-if="barcode === 'missing'" class="not-found">
          <p class="not-found-text">{{ t('item.barcode.missing', { code: barcodeCode }) }}</p>
          <AppButton @click="proposeByCode">
            <template #icon><IconPlus /></template>
            {{ t('item.empty.action') }}
          </AppButton>
          <p class="not-found-text">{{ t('item.barcode.missing_hint') }}</p>
        </div>

        <!-- Found by a retry nobody tapped for (adversarial Ж′): the sheet opens from this tap. -->
        <div v-else-if="barcode === 'found' && barcodeItem" class="not-found">
          <p class="not-found-text">{{ t('item.barcode.found', { code: barcodeCode }) }}</p>
          <AppButton @click="lookup.take">{{ barcodeItem.name }}</AppButton>
        </div>

        <ScreenState
          v-else-if="barcode === 'error'"
          kind="error"
          inline
          :title="t('item.error.title')"
          :body="t('item.barcode.error_body', { code: barcodeCode })"
          @retry="lookup.retry"
        />

        <ScreenState
          v-else-if="barcode === 'offline'"
          kind="offline"
          tone="warn"
          inline
          :title="t('item.offline.title')"
          :body="t('item.barcode.offline_body')"
        />

        <div v-else-if="phase === 'loading'" class="loading">
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
      <template v-if="phase === 'ready' && barcode === 'idle' && !bind" #after>
        <AppButton variant="ghost" block @click="proposing = true">
          {{ t('item.not_listed') }}
        </AppButton>
      </template>

      <!-- A far answer (MOL-46): what «пельмени» finds in «Чай зелёный» is a likeness, not a find,
           so «не нашли» stands here with the button that adds the item. Under the rows, in place
           of the quiet line: the answer flips near and far while a word is typed, and a block
           above would move every row under the finger as it came and went (owner's decision). -->
      <template v-else-if="phase === 'far' && barcode === 'idle' && !bind" #after>
        <div class="not-found" :class="{ stale }">
          <p class="not-found-text">{{ t('item.empty.body', { query: answered }) }}</p>
          <AppButton @click="proposing = true">
            <template #icon><IconPlus /></template>
            {{ t('item.empty.action') }}
          </AppButton>
        </div>
      </template>
    </CatalogueCombobox>

    <BarcodeScannerSheet v-model:open="scanning" :on-closed="afterScanning" @read="read" />

    <ProposeItemSheet
      v-model:open="proposing"
      :query="proposingByCode || nameTaken ? '' : query"
      :code="pendingCode"
      :name-taken="nameTaken"
      :on-closed="afterProposing"
      @proposed="proposed"
      @taken="takenOnProposal"
    />

    <!-- Mounted on a pick and put away from `onClosed`: each opening is its own purchase. Two
         steps back on «Добавить в поход» — the sheet and this screen, back to the trip. -->
    <ItemDetailsSheet
      v-if="picked && (!selectedId || selectedAvailable)"
      :key="opened"
      :entry="picked.entry"
      :trip-id="selectedId"
      :trip-context="selectedId ? selectedTrip : undefined"
      :trip-currency="selectedLocal?.currency ?? undefined"
      :query="picked.query"
      :missed-query="picked.missedQuery ?? null"
      :code="pickedByCode?.itemId === picked.entry.id ? pickedByCode.code : null"
      :close-steps="2"
      :on-closed="putAway"
      @added="added"
      @detached="detached"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useSelectedTrip } from '@/composables/useSelectedTrip'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import IconBarcode from '~icons/mdi/barcode-scan'
import IconClose from '~icons/mdi/close'
import IconPlus from '~icons/mdi/plus'
import AppButton from '@/components/AppButton.vue'
import AppScreen from '@/components/AppScreen.vue'
import BarcodeScannerSheet from '@/components/BarcodeScannerSheet.vue'
import CatalogueCombobox from '@/components/CatalogueCombobox.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ProposeItemSheet from '@/components/ProposeItemSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { api } from '@/api'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { useBarcodeLookup } from '@/composables/useBarcodeLookup'
import { useCatalogueSearch } from '@/composables/useCatalogueSearch'
import { currentIdentity } from '@/stores/identity'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useRecentItemsStore } from '@/stores/recentItems'
import { dropSearchDraft, keepSearchDraft, recallSearchDraft } from '@/stores/searchDraft'

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
    BarcodeScannerSheet,
    CatalogueCombobox,
    IconBarcode,
    IconClose,
    IconPlus,
    ItemDetailsSheet,
    ProposeItemSheet,
    ScreenSkeleton,
    ScreenState,
  },
  setup() {
    const { t } = useI18n()
    const route = useRoute()
    const selected = useSelectedTrip(() =>
      route.name === 'finished-search' && typeof route.params.tripId === 'string'
        ? route.params.tripId
        : null,
    )
    const query = ref('')
    const { phase, results, stale, answered, missed, takeMissed, retry } = useCatalogueSearch(query)

    // What was typed comes back after a reload — a new version of the app lands while the phone
    // is away mid-search — and is put away with the screen, as it always was (MOL-46).
    const owner = currentIdentity()
    const draft = recallSearchDraft(owner)
    if (draft) {
      query.value = draft.query
      missed.value = draft.missed
    }
    watch([query, missed], ([text, miss]) => {
      keepSearchDraft(owner, { query: text, missed: miss })
    })
    const recent = useRecentItemsStore()
    const entry = useItemEntryStore()
    const announce = useAnnouncer()

    /** «Взять из недавних» under an error — asked for, not shown by default. */
    const fallback = ref(false)
    watch(phase, (next) => {
      if (next !== 'error') fallback.value = false
    })

    /**
     * The scanner (MOL-99). A code read looks up its item at once, but the purchase sheet waits for
     * the scanner to be put away: its close is a step back through history, and a sheet opened
     * before that step lands would be the one the step took (as «Предложить товар», MOL-24).
     */
    const scanning = ref(false)
    let scannerAway = true
    let foundByCode: { entry: CatalogueEntry; code: string } | null = null
    /**
     * The code the item now on the purchase sheet was found by or given (MOL-99, MOL-100): kept
     * beside the recent items (В-2), and «не этот товар?» on the sheet lets it go (В-1).
     */
    const pickedByCode = ref<{ itemId: string; code: string } | null>(null)

    const lookup = useBarcodeLookup({
      found: (item, code) => {
        foundByCode = { entry: item, code }
        takeFoundByCode()
      },
      local: (code) => recent.byCode(code),
    })
    const barcode = lookup.phase

    /**
     * A code the catalogue does not know, waiting for the item it belongs to (MOL-100): proposed
     * with it, or found by name and asked about. Set when the server says nobody holds it — only
     * then: a code not looked up for want of a network may well be held.
     */
    const pendingCode = ref<string | null>(null)
    watch(barcode, (next) => {
      if (next === 'missing') pendingCode.value = lookup.code.value
    })

    // The strip goes with its ✕, which held the focus: the field takes it back — what the person
    // does next is type (adversarial О).
    const combobox = ref<{ $el?: HTMLElement } | null>(null)
    async function dropPending(): Promise<void> {
      pendingCode.value = null
      await nextTick()
      combobox.value?.$el?.querySelector<HTMLInputElement>('input')?.focus()
    }

    /**
     * «Привязать код к ней?» over a row picked while a code waits (MOL-100, В-2): asked here, and the
     * purchase sheet comes once it is answered. `learns` is the pick's own, kept for when it goes on.
     * `origin` — a row picked; an item whose name a proposal met (`proposed`, В-5); the same from the
     * code's own block (`proposedByCode`), where the item was looked for by the code and what the
     * field held before the scan is nobody's word for it (MOL-99 Д, adversarial М).
     */
    interface Bind {
      readonly entry: CatalogueEntry
      readonly code: string
      readonly learns: boolean
      readonly origin: 'pick' | 'proposed' | 'proposedByCode'
      readonly phase: 'ask' | 'sending' | 'taken' | 'full' | 'offline' | 'error'
      readonly holder: CatalogueEntry | null
    }
    const bind = ref<Bind | null>(null)
    const bindFirst = ref<{ $el?: HTMLElement } | null>(null)

    // The rows the person tapped are gone under the question: the focus goes to its first answer
    // rather than to the body, and the keyboard goes down with it — it is a question to tap.
    watch(
      () => bind.value?.phase,
      async (next, before) => {
        if (next !== 'ask' && next !== 'taken' && next !== 'full') return
        if (next === before) return
        await nextTick()
        bindFirst.value?.$el?.focus()
      },
    )

    // Whether the question is still the one asked: typing, or another scan, takes it away while
    // the answer is on its way, and that answer is then nobody's.
    function stillAsked(asked: Bind): boolean {
      return bind.value?.entry === asked.entry && bind.value.code === asked.code
    }

    async function attach(): Promise<void> {
      const asked = bind.value
      if (asked === null || asked.phase === 'sending') return
      bind.value = { ...asked, phase: 'sending' }
      try {
        const written = await api.attachBarcode(asked.entry.id, asked.code)
        if (!stillAsked(asked)) {
          // Typing went on while it was on its way (adversarial Д): the sheet is not opened, but a
          // code the server wrote no longer waits for its item.
          if (!('taken' in written) && pendingCode.value === asked.code) pendingCode.value = null
          return
        }
        if ('taken' in written) {
          bind.value = { ...asked, phase: 'taken', holder: written.taken }
          return
        }
        bind.value = null
        pendingCode.value = null
        goOn(asked)
        pickedByCode.value = { itemId: asked.entry.id, code: asked.code }
      } catch (error) {
        if (!stillAsked(asked)) return
        const full = error instanceof ApiError && error.code === ERROR.BARCODES_FULL
        // Offline or error is decided after the failure (MOL-19).
        bind.value = { ...asked, phase: full ? 'full' : navigator.onLine ? 'error' : 'offline' }
      }
    }

    function withoutCode(): void {
      const asked = bind.value
      if (asked === null || asked.phase === 'sending') return
      bind.value = null
      pendingCode.value = null
      goOn(asked)
    }

    // The purchase sheet of the item asked about — with no query where the code brought it.
    function goOn(asked: Bind): void {
      if (asked.origin === 'proposedByCode') pickWithoutQuery(asked.entry)
      else take(asked.entry, asked.learns)
    }

    // The package in the hand is the item the catalogue holds the code for: taken as found by it.
    function takeHolder(): void {
      const asked = bind.value
      if (asked?.holder == null) return
      bind.value = null
      pendingCode.value = null
      pickWithoutQuery(asked.holder)
      pickedByCode.value = { itemId: asked.holder.id, code: asked.code }
    }

    // «Это другой товар — предложить» (В-3): the item found by name is not the package; the code
    // goes with the one proposed, whose name starts from what was typed. Asked about an item whose
    // name a proposal met (В-5), the name typed is that item's: the sheet starts empty and says the
    // name is taken, or «другой товар» went round in a circle (adversarial Н).
    function proposeOther(): void {
      const asked = bind.value
      if (asked === null || asked.phase === 'sending') return
      bind.value = null
      if (asked.origin !== 'pick') {
        nameTaken.value = asked.entry.name
        proposingByCode.value = asked.origin === 'proposedByCode'
      }
      proposing.value = true
    }

    watch(scanning, (open) => {
      if (open) scannerAway = false
    })

    // A new code is a new question: a find still held for the scanner to go belongs to the code
    // before it, and would come up over «Код … не знаком» of this one (adversarial А).
    function read(code: string): void {
      foundByCode = null
      pendingCode.value = null
      bind.value = null
      lookup.lookUp(code)
    }

    function afterScanning(): void {
      scannerAway = true
      takeFoundByCode()
    }

    // Taken without a query: a code is not one, and the search learns nothing from it — neither a
    // pick nor the person's own word (MOL-99, Р-3). The miss held from before is used up all the
    // same, as by any sheet opened after it (MOL-45).
    function takeFoundByCode(): void {
      if (!scannerAway || foundByCode === null) return
      const { entry: chosen, code } = foundByCode
      foundByCode = null
      pickWithoutQuery(chosen)
      pickedByCode.value = { itemId: chosen.id, code }
    }

    function pickWithoutQuery(chosen: CatalogueEntry): void {
      opened.value += 1
      takeMissed('')
      pickedByCode.value = null
      entry.pick({ entry: chosen, query: '' })
    }

    // Typing is the other way to find it: the answer to the code gives way to the search — and a
    // code nobody holds stays, waiting for the item found (MOL-100). A question already asked
    // about a row goes with the rows it was asked over.
    watch(query, () => {
      foundByCode = null
      lookup.clear()
      bind.value = null
    })

    // Arrived by «Сканировать» on the record (В-4): the scanner is up over the screen at once, and
    // put away it leaves the search by name.
    onMounted(() => {
      if (entry.takeScan()) scanning.value = true
    })

    // Under a code looked up with no network too: those are what the device can still find.
    const showsRecent = computed(
      () =>
        barcode.value === 'offline' ||
        (barcode.value === 'idle' &&
          (phase.value === 'idle' ||
            phase.value === 'offline' ||
            (phase.value === 'error' && fallback.value))),
    )

    // Under an error as offline: the server does not answer either way, and «хлеб» typed before
    // it fell should not show twenty rows instead of one (Р-12).
    const rows = computed<CatalogueEntry[]>(() => {
      if (bind.value !== null) return []
      if (barcode.value !== 'idle' && barcode.value !== 'offline') return []
      if (phase.value === 'ready' || phase.value === 'far') return results.value
      if (showsRecent.value) return recent.filter(query.value)
      return []
    })

    // What the fallback would show, not whether there are recent items at all: under an error
    // they are narrowed by the query, and a button leading to none of them is a dead end (B2).
    const hasRecent = computed(() => recent.filter(query.value).length > 0)

    const heading = computed(() => {
      if (showsRecent.value) return t('item.group_recent')
      return phase.value === 'far' ? t('item.group_similar') : t('item.group_found')
    })

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
      if ((next !== 'ready' && next !== 'far' && next !== 'empty') || dimmed) return
      // Under the answer to a code the rows are not shown, so an answer to the search that lands
      // then is not said either — «found two» over «Код … не знаком» (adversarial Б). Nor under
      // the question about a code (MOL-100).
      if (barcode.value !== 'idle' || bind.value !== null) return
      // A far answer is «не нашли» out loud too: «found one» for «Чай зелёный» on «пельмени»
      // would be the very claim the screen stopped making (MOL-46).
      withdraw = announce?.(
        next === 'ready'
          ? t('item.results_announced', { n: found.length }, found.length)
          : next === 'far'
            ? t('item.far_announced', { query: answered.value, n: found.length }, found.length)
            : t('item.empty.body', { query: answered.value }),
      )
    })

    // «Код … не знаком» out loud, as an empty answer is: the block says nothing of itself. The
    // search's words go the moment a code is looked up — they describe what is no longer shown.
    let withdrawCode: (() => void) | undefined
    watch(barcode, (next) => {
      withdrawCode?.()
      withdrawCode = undefined
      if (next === 'idle') return
      withdraw?.()
      withdraw = undefined
      if (next === 'label') {
        withdrawCode = announce?.(t('item.barcode.in_store', { code: lookup.code.value }))
      } else if (next === 'missing') {
        withdrawCode = announce?.(t('item.barcode.missing', { code: lookup.code.value }))
      } else if (next === 'found') {
        withdrawCode = announce?.(
          t('item.barcode.found_announced', {
            code: lookup.code.value,
            name: lookup.item.value?.name ?? '',
          }),
        )
      }
    })

    // The question about a code is said as the lookup's answers are: the block says nothing of
    // itself, and the focus on its first button reads only the button (MOL-100).
    let withdrawBind: (() => void) | undefined
    watch(
      () => bind.value?.phase,
      (next, before) => {
        if (next === before) return
        withdrawBind?.()
        withdrawBind = undefined
        const asked = bind.value
        if (asked === null) return
        withdraw?.()
        withdraw = undefined
        if (next === 'ask') {
          withdrawBind = announce?.(
            t(asked.origin === 'pick' ? 'item.barcode.bind_question' : 'item.barcode.bind_named', {
              code: asked.code,
              name: asked.entry.name,
            }),
          )
        } else if (next === 'taken' && asked.holder) {
          withdrawBind = announce?.(
            t('item.barcode.taken', { code: asked.code, name: asked.holder.name }),
          )
        }
      },
    )

    const { picked } = storeToRefs(entry)
    /** Which opening of the sheet this is: the same item picked twice is two purchases. */
    const opened = ref(0)

    // Rows of an answer leave with the query they answer, not with the field: the list stays on
    // screen, dimmed, while the next search is out, and a tap on «Кока-кола» found for «кола»
    // with «хлеб» already typed must not teach the search that «хлеб» means cola (Р-9, A3). The
    // recent items answer no query — they go with the field as it is.
    //
    // A pick from the server's answer takes along the query that found nothing before it
    // (MOL-45): the person's own word for the item. Not a pick from the recent items or one just
    // proposed — neither was found by another word — and every pick uses the miss up.
    //
    // While a code waits for its item (MOL-100), a pick asks first whether the code is that item's.
    function pick(chosen: CatalogueEntry, learns = true): void {
      const code = pendingCode.value
      if (code !== null) {
        bind.value = { entry: chosen, code, learns, origin: 'pick', phase: 'ask', holder: null }
        return
      }
      take(chosen, learns)
    }

    function take(chosen: CatalogueEntry, learns: boolean): void {
      opened.value += 1
      pickedByCode.value = null
      // Something else taken answers the code's question too: a retry of it must not come over the
      // sheet now opening (adversarial Ж′).
      foundByCode = null
      lookup.clear()
      const found = phase.value === 'ready' || phase.value === 'far'
      const text = found ? answered.value : query.value
      const missed = takeMissed(text)
      const word = learns && found ? missed : null
      entry.pick({ entry: chosen, query: text, ...(word === null ? {} : { missedQuery: word }) })
    }

    // Into the recent items only once it went into the trip, as the server's memory of picks
    // does (MOL-11): a pick the sheet cancelled is a changed mind.
    function added(item: CatalogueEntry): void {
      const code = pickedByCode.value
      recent.remember(item, code?.itemId === item.id ? code.code : undefined)
    }

    /**
     * «Код … — не этот товар?» let the code go (MOL-100, В-1): once the sheet is away the code is
     * asked again — nobody holds it now, so it waits for its item. The device forgets it in the sheet
     * itself, which an answer landing after the sheet was put away still reaches (review Г).
     */
    let askAgain: string | null = null
    function detached(code: string): void {
      pickedByCode.value = null
      askAgain = code
    }

    function putAway(): void {
      entry.clear()
      const code = askAgain
      askAgain = null
      if (code !== null) read(code)
    }

    /** «Предложить товар» — the whole form, the only way the catalogue grows in 0.1. */
    const proposing = ref(false)
    let proposedItem: CatalogueEntry | null = null
    /**
     * «Предложить товар» under «Код … не знаком» (adversarial Д): it was looked for by the code, not by
     * what the field held before the scan — so the name starts empty, and the pick teaches no word.
     */
    /** The name a proposal met, when «другой товар» was said about that very item (adversarial Н). */
    const nameTaken = ref<string | null>(null)
    const proposingByCode = ref(false)

    function proposeByCode(): void {
      proposingByCode.value = true
      proposing.value = true
    }

    // Picked like any other, with the query it was looked for by: the next search for it then
    // puts it first (MOL-11). New or already there — the same, the item is the catalogue's.
    //
    // Once its sheet is put away, not at once: its close is a step back through history, and a
    // sheet laying its entry before that step lands would be the one the step took (MOL-24).
    /**
     * Proposed with a code under a name the catalogue already holds, nothing was written (owner's
     * decision В-5): the item is asked about once the sheet is away, as one found by name is — by
     * the same question, «все увидят» and «это другой товар» included.
     */
    let askAboutProposed = false

    function proposed(item: CatalogueEntry, created: boolean): void {
      proposedItem = item
      askAboutProposed = !created && pendingCode.value !== null
      if (!askAboutProposed) {
        proposedCode = pendingCode.value
        pendingCode.value = null
      }
      proposing.value = false
    }

    /** The code was another item's (MOL-100, Р-3), and the person took that item instead. */
    let takenHolder = false
    function takenOnProposal(holder: CatalogueEntry): void {
      takenHolder = true
      proposed(holder, true)
    }

    /** The code the item just proposed was written with, or the one its holder was taken by. */
    let proposedCode: string | null = null

    function afterProposing(): void {
      const fromCode = proposingByCode.value
      const byCode = fromCode || takenHolder
      proposingByCode.value = false
      nameTaken.value = null
      takenHolder = false
      const item = proposedItem
      const code = proposedCode
      const ask = askAboutProposed
      proposedItem = null
      proposedCode = null
      askAboutProposed = false
      const waiting = pendingCode.value
      if (item && ask && waiting !== null) {
        lookup.clear()
        bind.value = {
          entry: item,
          code: waiting,
          learns: false,
          origin: fromCode ? 'proposedByCode' : 'proposed',
          phase: 'ask',
          holder: null,
        }
        return
      }
      if (item && byCode) {
        // Proposed, the code's question is answered: its block goes with it (review С-5).
        lookup.clear()
        pickWithoutQuery(item)
      } else if (item) take(item, false)
      if (item && code !== null) pickedByCode.value = { itemId: item.id, code }
    }

    onMounted(() => {
      recent.sync()
    })
    onUnmounted(() => {
      withdraw?.()
      withdrawCode?.()
      withdrawBind?.()
      dropSearchDraft(owner)
    })

    return {
      selectedId: selected.id,
      selectedLoading: selected.loading,
      selectedAvailable: selected.available,
      selectedMissing: selected.missing,
      selectedTrouble: selected.trouble,
      selectedLoad: selected.load,
      selectedTrip: selected.trip,
      selectedLocal: selected.local,
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
      scanning,
      read,
      afterScanning,
      proposingByCode,
      nameTaken,
      proposeByCode,
      takenOnProposal,
      pendingCode,
      dropPending,
      combobox,
      bind,
      bindFirst,
      attach,
      withoutCode,
      takeHolder,
      proposeOther,
      detached,
      pickedByCode,
      lookup,
      barcode,
      barcodeCode: lookup.code,
      barcodeItem: lookup.item,
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

.bind-question {
  margin: 0;
  font-weight: var(--weight-medium);
  line-height: var(--leading-body);
  overflow-wrap: anywhere;
}

.bind-actions {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  gap: var(--space-2);
}

.pending {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-left: var(--space-4);
  border-radius: var(--radius);
  background: var(--accent-tint);
  color: var(--accent-ink);
}

.pending-text {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-callout);
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .not-found {
    transition: none;
  }
}
</style>
