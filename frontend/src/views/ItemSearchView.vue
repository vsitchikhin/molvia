<template>
  <AppScreen :title="t('item.search_title')">
    <!-- The search of a finished record, while the record is read (Ф-13): the field as it will stand,
         its hint — known before any answer, so its own words, still, at the height they will have —
         and the recent items under it where the phone has some — they come with the screen. -->
    <ScreenSkeleton v-if="selectedId && selectedLoading && !selectedAvailable">
      <SkeletonPart kind="field" />
      <p class="ghost-hint">{{ t('item.search_hint') }}</p>
      <template v-if="recentCount > 0">
        <SkeletonPart kind="caption" :width="30" />
        <SkeletonPart kind="rows" :count="Math.min(recentCount, 3)" :narrow="false" next />
      </template>
    </ScreenSkeleton>
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
      :groups="groups"
      :stale="stale"
      :readonly="bind?.phase === 'sending'"
      :label="t('item.search_title')"
      :placeholder="t('item.search_placeholder')"
      :hint="t('item.search_hint')"
      @pick="pick"
    >
      <template #trailing>
        <AppButton
          variant="icon"
          :label="t('item.barcode.scan')"
          :inactive="bind?.phase === 'sending'"
          @click="scanning = true"
        >
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
            <AppButton
              ref="bindFirst"
              block
              :busy="bind.phase === 'sending'"
              :busy-label="t('item.barcode.bind_busy')"
              @click="attach"
            >
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
          ref="bindState"
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
          ref="bindState"
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
          <!-- What Open Food Facts says the package is (MOL-162): under the button, so the button
               stays where the thumb saw it when the hint comes (owner's decision В-5, in place of
               В-1's «above», which moved it ~100 px — adversarial Г). -->
          <p v-if="codeHint" class="code-hint">
            {{ hintWords(codeHint) }}
            <span class="code-hint-source">{{ t('item.barcode.hint_source') }}</span>
          </p>
          <p class="not-found-text">{{ t('item.barcode.missing_hint') }}</p>
        </div>

        <!-- Found by a retry nobody tapped for (adversarial Ж′): the sheet opens from this tap. -->
        <div v-else-if="barcode === 'found' && barcodeItem" class="not-found">
          <p class="not-found-text">{{ t('item.barcode.found', { code: barcodeCode }) }}</p>
          <AppButton @click="takeFound">{{ barcodeItem.name }}</AppButton>
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

        <!-- The answer's shape (1g): its caption and three rows of 64. -->
        <div v-else-if="phase === 'loading'" class="loading">
          <ScreenSkeleton>
            <SkeletonPart kind="caption" :width="20" />
            <SkeletonPart kind="rows" :count="3" :narrow="false" next />
          </ScreenSkeleton>
        </div>

        <!-- Both come while the person types: their buttons stand under the words, not in the strip
             at the bottom, which the keyboard covers on an iPhone (owner's В-20 «а»). -->
        <ScreenState
          v-else-if="phase === 'empty'"
          kind="empty"
          flow
          class="answer"
          :class="{ stale }"
          :silent="stale"
          :icon="IconMagnify"
          :title="t('item.empty.title', { query: answered })"
          :body="t('item.empty.text')"
        >
          <template #action>
            <AppButton block @click="proposing = true">
              <template #icon><IconPlus /></template>
              {{ t('item.empty.action') }}
            </AppButton>
          </template>
        </ScreenState>

        <!-- Taken from the recent items, the error is a section's: the quiet card over them (1i). -->
        <ScreenState
          v-else-if="phase === 'error'"
          kind="error"
          class="answer"
          :flow="!fallback"
          :inline="fallback"
          :title="t('item.error.title')"
          :body="errorBody"
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

        <!-- Under the field, never over it: nothing of the answer stands above the control that chooses
             it (MOL-138, В-2) — and with nothing typed too, as 1j draws it: typing offline searches the
             recent items at once, with no failure to wait for (`useCatalogueSearch`). -->
        <StatusStrip
          v-else-if="phase === 'offline' || (phase === 'idle' && !online)"
          kind="offline"
          class="connection"
          :text="t('item.offline.strip')"
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
        <AppCard class="far" :class="{ stale }">
          <p class="far-title">{{ t('item.empty.title', { query: answered }) }}</p>
          <p class="far-text">{{ t('item.empty.text') }}</p>
          <AppButton block @click="proposing = true">
            <template #icon><IconPlus /></template>
            {{ t('item.empty.action') }}
          </AppButton>
        </AppCard>
      </template>
    </CatalogueCombobox>

    <BarcodeScannerSheet v-model:open="scanning" :on-closed="afterScanning" @read="read" />

    <ProposeItemSheet
      v-model:open="proposing"
      :query="proposingByCode || nameTaken ? '' : query"
      :code="pendingCode"
      :name-taken="nameTaken"
      :hint="nameTaken ? null : codeHint"
      :on-closed="afterProposing"
      @proposed="proposed"
      @taken="takenOnProposal"
      @written-late="writtenLate"
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
import { ERROR, drawsNothing, pickLocale, placeNameIdentity } from '@molvia/model'
import type { AppLocale, BarcodeHint, CatalogueEntry, PreviousItemsResponse } from '@molvia/model'
import IconBarcode from '~icons/mdi/barcode-scan'
import IconClose from '~icons/mdi/close'
import IconMagnify from '~icons/mdi/magnify'
import IconPlus from '~icons/mdi/plus'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import BarcodeScannerSheet from '@/components/BarcodeScannerSheet.vue'
import CatalogueCombobox from '@/components/CatalogueCombobox.vue'
import type { ComboboxGroup } from '@/components/CatalogueCombobox.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ProposeItemSheet from '@/components/ProposeItemSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip, { STRIP_LATE_MS } from '@/components/StatusStrip.vue'
import { api } from '@/api'
import { useAnnouncer } from '@/composables/useAnnouncer'
import { packageSize, useBarcodeHint } from '@/composables/useBarcodeHint'
import { useBarcodeLookup } from '@/composables/useBarcodeLookup'
import { useCatalogueSearch } from '@/composables/useCatalogueSearch'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { useOnline } from '@/composables/useOnline'
import { useReconnect } from '@/composables/useReconnect'
import { useTripRows } from '@/composables/useTripRows'
import { useActorStore } from '@/stores/actor'
import {
  HERE_LAST_SHOWN,
  recallHereLast,
  rememberBoughtHere,
  rememberHereLast,
} from '@/stores/hereLast'
import type { HerePlace } from '@/stores/hereLast'
import { currentIdentity } from '@/stores/identity'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useRecentItemsStore } from '@/stores/recentItems'
import { dropSearchDraft, keepSearchDraft, recallSearchDraft } from '@/stores/searchDraft'
import { focusScreenTitle } from '@/transitions'
import { reportFailure } from '@/failures'

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
    AppCard,
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
    SkeletonPart,
    StatusStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const selected = useSelectedTrip(() =>
      route.name === 'finished-search' && typeof route.params.tripId === 'string'
        ? route.params.tripId
        : null,
    )
    const query = ref('')
    const { phase, results, stale, answered, missed, takeMissed, retry } = useCatalogueSearch(query)
    const online = useOnline()

    // What was typed comes back after a reload — a new version of the app lands while the phone
    // is away mid-search — and is put away with the screen, as it always was (MOL-46).
    const owner = currentIdentity()
    const draft = recallSearchDraft(owner)
    if (draft) {
      query.value = draft.query
      missed.value = draft.missed
    }
    const recent = useRecentItemsStore()
    const entry = useItemEntryStore()
    const announce = useAnnouncer()

    /**
     * «Брали здесь в прошлый раз» (MOL-209, Ф-24): the trip the search writes into and its place —
     * the finished one the address names, else the one going on, sent or still in the queue. The
     * place is its city and name, which a trip started with no signal knows too (Р-3).
     */
    const current = useCurrentTrip()
    const actor = useActorStore()
    const here = computed<{
      readonly tripId: string
      readonly place: HerePlace | null
      /** The server may know the trip: one still in the queue is not asked about (Р-4). */
      readonly sent: boolean
      /** A finished trip looks only before itself. */
      readonly before: Date | null
    } | null>(() => {
      if (selected.id.value !== null) {
        const trip = selected.trip.value
        if (!trip) return null
        return {
          tripId: trip.id,
          place:
            trip.placeCity === undefined ? null : { city: trip.placeCity, name: trip.place.name },
          sent: true,
          before: trip.finishedOnDeviceAt ?? trip.finishedAt,
        }
      }
      const local = current.local.value
      if (local) {
        const city = local.context?.city ?? actor.settings?.city
        return {
          tripId: local.id,
          place: city === undefined ? null : { city, name: local.placeName },
          sent: false,
          before: null,
        }
      }
      const trip = current.trip.value
      if (!trip) return null
      return {
        tripId: trip.id,
        place:
          trip.placeCity === undefined ? null : { city: trip.placeCity, name: trip.place.name },
        sent: true,
        before: null,
      }
    })
    /** What is in this trip already — on the server, or in the queue — goes from the group (Р-17). */
    const { rows: tripRows } = useTripRows(
      computed(() => here.value?.tripId ?? null),
      computed(() => (selected.id.value !== null ? selected.trip.value : current.trip.value)),
      () => '',
    )
    /** The server's answer on this screen, and what the device remembered before it. */
    const hereAnswer = ref<readonly CatalogueEntry[] | null>(null)
    const hereRemembered = ref<readonly CatalogueEntry[] | null>(null)
    /**
     * With a connection the screen waits for the answer, at most `STRIP_LATE_MS`, before what the
     * device remembers — or «Часто берёте» alone — stands (В-2 «а»; owner's В-4 «а» of the review:
     * remembered or not): the group coming in over it would take its rows from under the finger
     * (MOL-269), and the memory parts from the answer after every receipt recorded on this phone.
     * An answer later than that is only remembered, for next time.
     */
    const hereLate = ref(false)
    let hereAsked = 0
    let hereTimer: ReturnType<typeof setTimeout> | undefined

    function askHere(): void {
      const at = here.value
      if (!at?.sent || hereAnswer.value !== null || !navigator.onLine) {
        hereLate.value = true
        return
      }
      const asked = ++hereAsked
      const known = serverRows()
      // A throw before the request leaves the screen as it is too: the client builds the address
      // synchronously, and a throw in the screen's setup took the whole screen down (adversarial Т1,
      // the question it left).
      let request: Promise<PreviousItemsResponse>
      try {
        request = api.previousItems(at.tripId)
      } catch {
        hereLate.value = true
        return
      }
      request.then(
        (answer) => {
          if (asked !== hereAsked || !alive) return
          if (owner !== null && at.place !== null) {
            rememberHereLast(
              owner,
              at.place,
              at.tripId,
              answer,
              at.before,
              heldWith(answer.holds, known),
              // The trip going on as the server knows it, never the phone's copy, which may still
              // hold one removed or finished on another device (Г2, Д1, Е1 of reviews 4–6).
              answer.open,
            )
          }
          if (!hereLate.value) hereAnswer.value = answer.items
          hereLate.value = true
        },
        // A trip the server does not know yet, no connection, a server that failed: the group is a
        // help, never a state of the screen — what the device remembers stands, or nothing does.
        () => {
          if (asked === hereAsked) hereLate.value = true
        },
      )
    }

    // The place as its memory is keyed (Р-3): a start that landed names the place in the server's
    // spelling, which may differ from the one typed at the door by its case, and is the same place.
    watch(
      () => {
        const at = here.value
        return at?.place
          ? `${at.tripId}|${placeNameIdentity(at.place.city)}|${placeNameIdentity(at.place.name)}`
          : (at?.tripId ?? null)
      },
      () => {
        const at = here.value
        hereAnswer.value = null
        hereRemembered.value =
          at?.place != null ? recallHereLast(owner, at.place, at.tripId, at.before) : null
        hereLate.value = false
        clearTimeout(hereTimer)
        hereTimer = setTimeout(() => {
          hereLate.value = true
        }, STRIP_LATE_MS)
        askHere()
      },
      { immediate: true },
    )
    // The same trip, its start landed while the screen is open (Р-4): asked now, and nothing on the
    // screen waits again — «Часто берёте» already stands, and an answer would only be remembered.
    watch(
      () => here.value?.sent,
      (sent) => {
        if (sent) askHere()
      },
    )
    useReconnect(askHere)

    /** What this trip holds — on the server, or in the queue; a row being removed is given back. */
    const held = computed<CatalogueEntry[]>(() =>
      tripRows.value.flatMap((row) => (row.mark !== 'removing' && row.entry ? [row.entry] : [])),
    )
    /** The server's rows of this trip the phone knows now: purchase → item. */
    function serverRows(): Map<string, string> {
      return new Map(
        tripRows.value.flatMap((row) =>
          row.expense !== null && row.entry ? [[row.expense.id, row.entry.id] as const] : [],
        ),
      )
    }

    /**
     * What the trip holds for its memory: what the server says it holds (adversarial В1 of review 3) —
     * less what is being removed here — and the purchases the queue still carries into it, never the
     * phone's copy of the server's rows, which may keep what another device took out (Г1 of review 4).
     * **The copy counts only for what changed while the answer was on its way** (Д2 of review 5): a
     * purchase that reached the server meanwhile is in neither `holds` nor the queue, and one removed
     * meanwhile is still in `holds` — told by the server's rows known as the question left (`known`).
     */
    function heldWith(
      holds: readonly CatalogueEntry[],
      known: ReadonlyMap<string, string>,
    ): CatalogueEntry[] {
      const rows = tripRows.value
      const removing = new Set(
        rows.flatMap((row) => (row.mark === 'removing' && row.entry ? [row.entry.id] : [])),
      )
      const present = new Set(
        rows.flatMap((row) => (row.mark !== 'removing' && row.entry ? [row.entry.id] : [])),
      )
      const now = new Set(rows.flatMap((row) => (row.expense === null ? [] : [row.expense.id])))
      const gone = new Set(
        [...known].flatMap(([expense, item]) =>
          now.has(expense) || present.has(item) ? [] : [item],
        ),
      )
      const landed = rows.flatMap((row) =>
        row.expense !== null && !known.has(row.expense.id) && row.mark !== 'removing' && row.entry
          ? [row.entry]
          : [],
      )
      const queued = rows.flatMap((row) =>
        row.expense === null && row.mark !== 'removing' && row.entry ? [row.entry] : [],
      )
      return [
        ...holds.filter((item) => !removing.has(item.id) && !gone.has(item.id)),
        ...landed,
        ...queued,
      ]
    }
    /** What this trip holds already goes from the group (Р-17). */
    const hereLast = computed<CatalogueEntry[]>(() => {
      const taken = new Set(held.value.map((item) => item.id))
      return (hereAnswer.value ?? hereRemembered.value ?? [])
        .filter((item) => !taken.has(item.id))
        .slice(0, HERE_LAST_SHOWN)
    })
    /** The answer still on its way, for a second at most (В-2, В-4 of the review). */
    const hereWaiting = computed(
      () => here.value?.sent === true && hereAnswer.value === null && !hereLate.value,
    )

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
    // Kept in the draft with the query (adversarial Р5-Г): a new version reloads the page with only
    // the strip up, and the code, lost, made the next pick ask nothing.
    const pendingCode = ref<string | null>(draft?.code ?? null)
    watch(barcode, (next) => {
      if (next === 'missing') pendingCode.value = lookup.code.value
    })

    /** What Open Food Facts says the waiting code's package is (MOL-162): follows the code. */
    const interfaceLocale = computed<AppLocale>(() => pickLocale(locale.value))
    const { hint: codeHint } = useBarcodeHint(pendingCode, interfaceLocale)

    function hintWords(hint: BarcodeHint): string {
      if (hint.quantity === null) return t('item.barcode.hint', { name: hint.name })
      const size = packageSize(hint.quantity, interfaceLocale.value)
      return t('item.barcode.hint_size', {
        name: hint.name,
        amount: size.amount,
        unit: t(size.unitKey),
      })
    }

    // The strip goes with its ✕, which held the focus: the field takes it back — what the person
    // does next is type (adversarial О).
    const combobox = ref<{ focus: () => void } | null>(null)
    async function dropPending(): Promise<void> {
      pendingCode.value = null
      await nextTick()
      combobox.value?.focus()
    }

    /**
     * «Привязать код к ней?» over a row picked while a code waits (MOL-100, В-2): asked here, and the
     * purchase sheet comes once it is answered. `learns` is the pick's own, kept for when it goes on.
     * `origin` — a row picked; an item whose name a proposal met (`proposed`, В-5); the same from the
     * code's own block (`proposedByCode`), where the item was looked for by the code and what the
     * field held before the scan is nobody's word for it (MOL-99 Д, adversarial М).
     */
    /** Whether the screen is still there: an answer landing after it was left is nobody's. */
    let alive = true

    interface PickedAt {
      readonly found: boolean
      readonly text: string
      /** The miss held at the pick — not one typed while the answer was on its way (Р6-А). */
      readonly missed: string | null
    }

    interface Bind {
      readonly entry: CatalogueEntry
      readonly code: string
      readonly learns: boolean
      readonly origin: 'pick' | 'proposed' | 'proposedByCode'
      /** The query the pick was made on, as the search answered it then — not as typed since. */
      readonly at: PickedAt
      readonly phase: 'ask' | 'sending' | 'taken' | 'full' | 'offline' | 'error'
      readonly holder: CatalogueEntry | null
    }
    const bind = ref<Bind | null>(null)
    const bindFirst = ref<{ $el?: HTMLElement } | null>(null)

    // Not while it is on its way: its answer dies with the page, and a code brought back as waiting
    // may have been written meanwhile — scanned again, it says what it is (adversarial Р6-Б).
    watch([query, missed, pendingCode, () => bind.value?.phase], ([text, miss, code, stage]) => {
      keepSearchDraft(owner, { query: text, missed: miss, code: stage === 'sending' ? null : code })
    })
    const bindState = ref<{ $el?: HTMLElement } | null>(null)

    /*
     * Every block of the question replaces the one before under the button that held the focus, so
     * every change of it hands the focus on (adversarial О, О′) — left alone it fell to the body:
     *
     * - the question, «taken», «full» — to their first answer: the rows tapped are gone, and the
     *   keyboard goes down with the focus, it is a question to tap;
     * - «Повторить» pressed under an error or offline — to «Привязать», busy while it is on its way;
     *   the state's own rescue takes it to the screen's title first, this comes after;
     * - an error or offline come in place of the busy «Привязать» — to their first button, unless the
     *   person has since put the focus somewhere of their own.
     */
    watch(
      () => bind.value?.phase,
      async (next, before) => {
        if (next === undefined || next === before) return
        if (next === 'sending' && before !== 'error' && before !== 'offline') return
        await nextTick()
        // An answer that landed after the wait takes the focus only where its holder went with the
        // block — the person may have gone to the field meanwhile (adversarial Р6-В).
        const nowhere = document.activeElement === null || document.activeElement === document.body
        if (before === 'sending' && !nowhere) return
        if (next === 'error' || next === 'offline') {
          bindState.value?.$el?.querySelector<HTMLElement>('button')?.focus()
          return
        }
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
        // The screen was left meanwhile (adversarial Р5-А): the pick is nobody's now, and written into
        // the store it opened a sheet by itself on the next visit.
        if (!alive) return
        // Nothing takes the question away while it is on its way — the field is read-only, the scanner
        // inert, the other answers wait (adversarial Р5-Б, Р6-А); a guard all the same.
        if (!stillAsked(asked)) return
        if ('taken' in written) {
          bind.value = { ...asked, phase: 'taken', holder: written.taken }
          return
        }
        bind.value = null
        pendingCode.value = null
        goOn(asked)
        pickedByCode.value = { itemId: asked.entry.id, code: asked.code }
      } catch (error) {
        reportFailure(error, 'screen')
        if (!alive || !stillAsked(asked)) return
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

    // The purchase sheet of the item asked about — with no query where the code brought it. The
    // block that held the focus goes with the answer: the title holds it while the sheet is up, so the
    // sheet gives it back there — gone with its opener, it fell to the body (adversarial Ф).
    function goOn(asked: Bind): void {
      focusScreenTitle()
      if (asked.origin === 'proposedByCode') pickWithoutQuery(asked.entry)
      else take(asked.entry, asked.learns, asked.at)
    }

    // The package in the hand is the item the catalogue holds the code for: taken as found by it.
    function takeHolder(): void {
      const asked = bind.value
      if (asked?.holder == null) return
      bind.value = null
      pendingCode.value = null
      focusScreenTitle()
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
      focusScreenTitle()
      proposing.value = true
    }

    watch(scanning, (open) => {
      if (open) scannerAway = false
    })

    // A new code is a new question: a find still held for the scanner to go belongs to the code
    // before it, and would come up over «Код … не знаком» of this one (adversarial А).
    function read(code: string): void {
      // A code on its way to an item is not dropped by another scan (adversarial Р5-Б): the answer
      // would land with the question gone, the code written where «без кода» was said.
      if (bind.value?.phase === 'sending') return
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

    // «По коду … нашлось» by a retry nobody tapped for: its block goes with the tap that takes the
    // item, and the title holds the focus for the sheet to give back (adversarial Ф′).
    function takeFound(): void {
      focusScreenTitle()
      lookup.take()
    }

    /**
     * A code the screen believes waits may have been written by an answer the screen never saw — a
     * reload while «Привязать» was on its way, a «Предложить товар» put away mid-send (adversarial
     * Р6-Б). Asked again quietly; held by some item, it waits no longer.
     */
    async function verifyPending(): Promise<void> {
      const code = pendingCode.value
      if (code === null || !navigator.onLine) return
      try {
        const held = await api.catalogueByBarcode(code)
        if (alive && held !== null && pendingCode.value === code) pendingCode.value = null
      } catch {
        // No answer is no news: the code keeps waiting, as before.
      }
    }

    // The answer to a proposal put away while it was on its way: the item was written with its code
    // (the sheet picks nothing, MOL-24 A1), so the code no longer waits.
    function writtenLate(code: string): void {
      if (pendingCode.value === code) pendingCode.value = null
    }

    // Typing is the other way to find it: the answer to the code gives way to the search — and a
    // code nobody holds stays, waiting for the item found (MOL-100). A question already asked
    // about a row goes with the rows it was asked over.
    watch(query, () => {
      foundByCode = null
      lookup.clear()
      // Typing while the code is on its way keeps the question until it lands (adversarial Р5-Б):
      // dropped, a new question over the same code had live answers the landing then overruled.
      if (bind.value?.phase !== 'sending') bind.value = null
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

    // The words say what the buttons offer: «возьмите из недавних» only beside «Взять из недавних» —
    // a newcomer's first search, failing, was told of items it had none of (adversarial А2).
    const errorBody = computed(() => {
      if (fallback.value) return t('item.error.fallback_note')
      return hasRecent.value ? t('item.error.body') : t('item.error.body_alone')
    })

    const groups = computed<ComboboxGroup[]>(() => {
      // Under an empty field the place's last time comes first, and «Часто берёте» does not repeat
      // it (Ф-24); typed, only the recent items are narrowed, as with no signal (1j).
      if (showsRecent.value && drawsNothing(query.value)) {
        if (hereWaiting.value) return []
        const first = new Set(hereLast.value.map((item) => item.id))
        return [
          { key: 'here-last', heading: t('item.group_here_last'), items: hereLast.value },
          {
            key: 'recent',
            heading: t('item.group_recent'),
            items: rows.value.filter((item) => !first.has(item.id)),
          },
        ]
      }
      if (showsRecent.value)
        return [{ key: 'recent', heading: t('item.group_recent'), items: rows.value }]
      return phase.value === 'far'
        ? [{ key: 'similar', heading: t('item.group_similar'), items: rows.value }]
        : [{ key: 'found', heading: t('item.group_found'), items: rows.value }]
    })

    // Read out once per answer, not on every letter: the answer is what changed. An empty answer is
    // `ScreenState`'s, which says its own words — said here too, it was heard twice (Р-10, A5).
    // The words go with the answer they describe — a new answer, any other state, the screen
    // left: the region is read in browse mode, and «found one» over an error is a lie (B3).
    // A dimmed answer is not read out: it is for the text before, and the answer to what is typed
    // follows — two counts in a row are noise for someone listening.
    let withdraw: (() => void) | undefined
    watch([phase, results, stale], ([next, found, dimmed]) => {
      withdraw?.()
      withdraw = undefined
      if ((next !== 'ready' && next !== 'far') || dimmed) return
      // Under the answer to a code the rows are not shown, so an answer to the search that lands
      // then is not said either — «found two» over «Код … не знаком» (adversarial Б). Nor under
      // the question about a code (MOL-100).
      if (barcode.value !== 'idle' || bind.value !== null) return
      // A far answer is «не нашли» out loud too: «found one» for «Чай зелёный» on «пельмени»
      // would be the very claim the screen stopped making (MOL-46).
      withdraw = announce?.(
        next === 'ready'
          ? t('item.results_announced', { n: found.length }, found.length)
          : t('item.far_announced', { query: answered.value, n: found.length }, found.length),
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

    // The hint comes after «не знаком» was said, often before it was read out: said again with it, in
    // one message, so neither is cut off by the other (MOL-162). Not over «Предложить товар» opened
    // meanwhile: the person is in the form, which a late hint does not touch (review 3).
    // A hint that came under the sheet is said once the sheet is put away with nothing proposed: the
    // line stands under the button by then, and nothing said it (review 6).
    let hintUnsaid = false
    function sayHint(hint: BarcodeHint): void {
      hintUnsaid = false
      withdrawCode?.()
      withdrawCode = announce?.(
        `${t('item.barcode.missing', { code: lookup.code.value })}. ${hintWords(hint)}`,
      )
    }
    watch(codeHint, (hint) => {
      hintUnsaid = false
      if (hint === null || barcode.value !== 'missing') return
      if (proposing.value) hintUnsaid = true
      else sayHint(hint)
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
        } else if (next === 'full') {
          // Not a ScreenState: the block says nothing of itself.
          withdrawBind = announce?.(t('error.barcodes_full'))
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
        bind.value = {
          entry: chosen,
          code,
          learns,
          origin: 'pick',
          at: pickedAt(),
          phase: 'ask',
          holder: null,
        }
        return
      }
      take(chosen, learns)
    }

    function pickedAt(): PickedAt {
      const found = phase.value === 'ready' || phase.value === 'far'
      return { found, text: found ? answered.value : query.value, missed: missed.value }
    }

    function take(chosen: CatalogueEntry, learns: boolean, at: PickedAt = pickedAt()): void {
      opened.value += 1
      pickedByCode.value = null
      // Something else taken answers the code's question too: a retry of it must not come over the
      // sheet now opening (adversarial Ж′).
      foundByCode = null
      lookup.clear()
      const { found, text } = at
      const miss = takeMissed(text, at.missed)
      const word = learns && found ? miss : null
      entry.pick({ entry: chosen, query: text, ...(word === null ? {} : { missedQuery: word }) })
    }

    // Into the recent items only once it went into the trip, as the server's memory of picks
    // does (MOL-11): a pick the sheet cancelled is a changed mind.
    function added(item: CatalogueEntry): void {
      const code = pickedByCode.value
      recent.remember(item, code?.itemId === item.id ? code.code : undefined)
      // And into the place's memory as its newest trip (В-1 «а»): the next trip here with no signal
      // finds this one as the last time.
      const at = here.value
      // A purchase added to a finished trip keeps that trip where it stood in time, not the newest.
      if (owner !== null && at?.place) {
        rememberBoughtHere(owner, at.place, at.tripId, item, at.before)
      }
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
          at: pickedAt(),
          phase: 'ask',
          holder: null,
        }
        return
      }
      const hint = codeHint.value
      if (!item && hintUnsaid && hint !== null && barcode.value === 'missing') sayHint(hint)
      if (item && byCode) {
        // Proposed, the code's question is answered: its block goes with it (review С-5) — and with it
        // the button the sheet would give the focus back to: the title holds it (adversarial Ф′).
        lookup.clear()
        focusScreenTitle()
        pickWithoutQuery(item)
      } else if (item) take(item, false)
      if (item && code !== null) pickedByCode.value = { itemId: item.id, code }
    }

    onMounted(() => {
      recent.sync()
      // Brought back from the draft: the answer it waited for may have come while the page was gone.
      void verifyPending()
    })
    onUnmounted(() => {
      alive = false
      clearTimeout(hereTimer)
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
      errorBody,
      rows,
      groups,
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
      codeHint,
      hintWords,
      proposeByCode,
      takenOnProposal,
      pendingCode,
      dropPending,
      takeFound,
      writtenLate,
      combobox,
      bind,
      bindFirst,
      bindState,
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
      IconMagnify,
      online,
      recentCount: computed(() => recent.items.length),
    }
  },
})
</script>

<style scoped lang="scss">
/* The field's hint under the well of the skeleton, as `SearchField` sets it: the frame's 8 above it
   stands for the hint's own padding. */
.ghost-hint {
  margin: 0;
  padding: 0 var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

/* Not `.skeleton`: a scoped class reaches the root of a child too, and that is ScreenSkeleton's. The card
   is the skeleton's own (MOL-178). */
.loading {
  margin-top: var(--space-6);
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
}

/* The connection under the field and its hint (Ф-14, С-2). */
.connection {
  margin-top: var(--space-2);
}

/* The search's own answer in place of the rows: as far below the field as a group's caption. */
.answer {
  margin-top: var(--space-6);
}

/* «Не нашли» under the rows of a far answer (1e): where the quiet «Нет нужного?» stands otherwise. */
.far {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.far-title {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
  overflow-wrap: anywhere;
}

.far-text {
  margin: 0 0 var(--space-3);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  line-height: var(--leading-body);
}

/* A previous answer left while the next is on its way (К-11). */
.answer,
.far {
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

.code-hint {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-self: stretch;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--accent-tint);
  color: var(--text);
  font-size: var(--text-callout);
  line-height: var(--leading-body);
}

.code-hint-source {
  /* Ink, not muted: muted text is under 4.5:1 on a tint (MOL-172). */
  color: var(--text);
  font-size: var(--text-footnote);
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
  .answer,
  .far {
    transition: none;
  }
}
</style>
