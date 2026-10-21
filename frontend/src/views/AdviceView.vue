<template>
  <AppScreen :title="t('advice.title')">
    <!-- The line is the screen's in every state, so the field under it never moves (owner's В-2 «а»
         on review № 1): whose figures these are only the answer can say — access is the server's —
         so while it is on its way the line is a bar, and with no answer at all it is held empty; so is
         the newcomer's, who has nobody's figures to speak of. -->
    <template v-if="phase !== 'idle'" #subtitle>
      <template v-if="phase === 'ready'">
        {{ scope === 'shared' ? t('advice.shared_data') : t('advice.own_data_only') }}
      </template>
      <span v-else class="subtitle-hold" :class="{ 'subtitle-bar': phase === 'loading' }"></span>
    </template>

    <!-- The connection in one line, once (MOL-181, Ф-14). Over a list it stands under the field, which
         chooses what is shown, and over the skeleton under the field's well; over the newcomer there
         is no field, and it stands under the header. -->
    <StatusStrip
      v-if="strip && phase === 'empty'"
      class="status"
      :kind="strip.kind"
      :text="strip.text"
      :attempt="attempt"
    >
      <template #action>
        <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
      </template>
    </StatusStrip>

    <!-- The well stands where the field will, the strip under it as under the field — the head of
         `AdviceSearch` drawn still (review № 2): over the well the strip took the field's place, and
         the field came 60 px higher with the answer. Out of the frame, so the strip is not hidden
         with its bars; the frame's first caption has no 24 above it, which this head gives. -->
    <template v-if="phase === 'loading'">
      <div class="ghost-head">
        <SkeletonPart kind="field" />
        <StatusStrip v-if="strip" :kind="strip.kind" :text="strip.text" :attempt="attempt" />
      </div>
      <AdviceSkeleton />
    </template>

    <!-- Without an identity there is nobody to advise; the notice above says why. -->
    <template v-else-if="phase !== 'idle'">
      <!-- At the top of the list and scrolled with it, never pinned: at a shelf a person starts
           from the top of the screen (handoff `01`). Over a list, and with no connection and no list
           remembered (Ф-14, С-1 of MOL-118): the cold offline is not empty, the field answers from
           what the phone has — nothing, and says why. Not over a failure or a newcomer, whose search
           could only answer «not rated yet» (question 1) — unless something is typed in it: the
           connection back without a list, the field stays under the thumb with what it holds, and goes
           once cleared (owner's В-3 «а» on adversarial А1). One place in the template for all, so the
           list that comes with the connection comes under the field being typed in, focus and all.
           Above the strip of the list's age, as the handoff draws it (review Р-16). -->
      <AdviceSearch
        v-if="fieldShown"
        v-model="query"
        :remembered="remembered"
        :fetched-at="fetchedAt"
        :refreshes="refreshes"
        @edit="edit"
        @rate="rate"
        @focused="fieldFocused = $event"
        @vue:unmounted="fieldFocused = false"
      >
        <template v-if="strip" #strip>
          <StatusStrip :kind="strip.kind" :text="strip.text" :attempt="attempt">
            <template #action>
              <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
            </template>
          </StatusStrip>
        </template>
      </AdviceSearch>

      <!-- With receipts the strip photographs one with the server down, through the queue, and stays
           the screen's: the error is a section's (127_128_129 v2, 1k; MOL-180, В-1). Without, the
           strip is the error's «Повторить» (1k-0) — but not under «Где вы?» opened from it: taken, the
           strip took the sheet and what was typed in it along (adversarial А1, as Р-15 of MOL-128). -->
      <ScreenState
        v-if="phase === 'error' && !searching"
        kind="error"
        :inline="Boolean(country) || entering"
        :title="t('advice.error.title')"
        :body="t(country ? 'advice.error.body_capture' : 'advice.error.body')"
        @retry="retry"
      />

      <!-- No button: nothing is remembered yet, and the screen loads by itself when the
           connection is back. Gives way to what the field found, as the list does. -->
      <ScreenState
        v-else-if="phase === 'offline' && !searching"
        kind="offline"
        tone="warn"
        :title="t('advice.offline.title')"
        :body="t(country ? 'advice.offline.body_capture' : 'advice.offline.body')"
      />

      <!-- The most important empty state of the product, and only for a list known to be empty —
           answered now or remembered (MOL-128, handoff `02`): no answer and no memory is offline
           or a failure above, never a newcomer (MOL-56, MOL-77). -->
      <!-- Kept while its «Записать вручную» has a sheet up: an answer with rows arriving under «Где
           вы?» would take the sheet with it (review Р-15 of MOL-128, review 6 of MOL-127). -->
      <AdviceHomeNew
        v-else-if="(phase === 'empty' && !searching) || (country && entering)"
        @busy="entering = $event"
      />

      <template v-else-if="!searching">
        <AdviceGroup v-if="groups.take.length > 0" level="take">
          <AppReveal group>
            <AdviceTakeCard
              v-for="row in groups.take"
              :key="row.itemId"
              :row="row"
              :scope="scope ?? 'own'"
              @edit="edit(row)"
            />
          </AppReveal>
        </AdviceGroup>

        <AdviceGroup v-if="groups.if_cheap.length > 0" level="if_cheap">
          <AppReveal group>
            <AdviceCheapRow
              v-for="row in groups.if_cheap"
              :key="row.itemId"
              :row="row"
              :scope="scope ?? 'own'"
              @edit="edit(row)"
            />
          </AppReveal>
        </AdviceGroup>

        <AdviceGroup v-if="groups.never.length > 0" level="never">
          <AppReveal group>
            <AdviceNeverRow
              v-for="row in groups.never"
              :key="row.itemId"
              :row="row"
              :scope="scope ?? 'own'"
              @edit="edit(row)"
            />
          </AppReveal>
          <p class="tail">{{ t('advice.no_price_shown') }}</p>
        </AdviceGroup>

        <p v-if="total > shown" class="foot">{{ t('advice.truncated', { shown, total }) }}</p>
        <p v-if="scope === 'shared'" class="foot">{{ t('advice.shared_note') }}</p>
      </template>
    </template>

    <!-- With receipts (MOL-127, handoff v2 01, 02): «Сфотографировать чек» under the thumb in every
         state, for a person with ratings as for a newcomer — at home a receipt is the way in. -->
    <template v-if="country" #docked>
      <CaptureButton :country="country" />
    </template>
    <!-- Without (Д-3): the newcomer's one action, under the thumb (MOL-128, В-5), and the cold
         offline's — purchases are recorded with no connection, whoever this is (Ф-14, 1l-0). Kept
         while a sheet of its own is up: an answer with rows arriving under «Где вы?» took the strip
         and the sheet with it (review Р-15). -->
    <template v-else-if="phase === 'empty' || phase === 'offline' || entering" #docked>
      <ManualEntryButton @busy="entering = $event" />
    </template>

    <!-- Mounted on a tap and put away from `onClosed`: each opening starts from the row as the
         server last described it, so a withdrawal and a second thought never share a state. -->
    <VerdictEditSheet
      v-if="editing"
      :item-id="editing.itemId"
      :name="editing.name"
      :mine="editing.mine"
      :shared="editing.shared"
      :own-score="editing.score"
      :own-review="editing.review"
      :on-closed="putAway"
      @saved="saved"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { drawsNothing } from '@molvia/model'
import type { AdviceFound, AdviceRow, AdviceScope } from '@molvia/model'
import AdviceCheapRow from '@/components/AdviceCheapRow.vue'
import AdviceGroup from '@/components/AdviceGroup.vue'
import AdviceHomeNew from '@/components/AdviceHomeNew.vue'
import CaptureButton from '@/components/CaptureButton.vue'
import AdviceNeverRow from '@/components/AdviceNeverRow.vue'
import AdviceSearch from '@/components/AdviceSearch.vue'
import AdviceSkeleton from '@/components/AdviceSkeleton.vue'
import AdviceTakeCard from '@/components/AdviceTakeCard.vue'
import AppButton from '@/components/AppButton.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip, { STRIP_LATE_MS } from '@/components/StatusStrip.vue'
import type { StripKind } from '@/components/StatusStrip.vue'
import VerdictEditSheet from '@/components/VerdictEditSheet.vue'
import { ownScore } from '@/components/adviceRow'
import type { Score } from '@/components/rating'
import { useAdvice } from '@/composables/useAdvice'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { purchaseDay, timeOfDay } from '@/days'
import { focusScreenTitle } from '@/transitions'

/**
 * «Что брать» (MOL-32) — the screen the whole product exists for. The other three fill its
 * base; this one is what the base is for.
 *
 * **The verdict decides how much matter a row gets**: a card, a row, a line of text. That is
 * the product's core rule made into a layout — cheapness cannot pull a bad item into a
 * recommendation, because in the last group there is nothing to be cheap with. The server
 * holds the same rule by type (MOL-31, Р-8), and neither half is decoration.
 *
 * The screen computes nothing about the data. The rows arrive sorted by rating, and the levels
 * are decided by that same printed tenth, so the three groups are already three stretches of
 * one list. What it does decide is one word — «Дешевле всего» or «Брали здесь» — because how
 * many places there are is visible to it alone (MOL-34).
 *
 * Whose figures they are cannot be worked out here at all, so `scope` says it: «4,3 из 5» read
 * as one's own score would be a lie, and in the shared mode the reviews and prices are still
 * the asker's own — which the footnote under the list says outright.
 */
export default defineComponent({
  name: 'AdviceView',
  components: {
    AdviceCheapRow,
    AdviceGroup,
    AdviceHomeNew,
    CaptureButton,
    AdviceNeverRow,
    AdviceSearch,
    AdviceSkeleton,
    AdviceTakeCard,
    AppButton,
    AppReveal,
    AppScreen,
    ManualEntryButton,
    ScreenState,
    SkeletonPart,
    StatusStrip,
    VerdictEditSheet,
  },
  setup() {
    const i18n = useI18n()
    const { t, locale } = i18n
    const advice = useAdvice()
    /** What is typed in the search; while it draws anything, the list gives way to what is found. */
    const query = ref('')
    const searching = computed(() => !drawsNothing(query.value))
    /** Raised by a save, so the search asks again for the rows it shows. */
    const refreshes = ref(0)
    /** A sheet of «Записать покупки» is up. */
    const entering = ref(false)
    const { country } = useReceiptCapture()
    /** The field is over a list, in the cold offline, and anywhere while something is typed in it. */
    /** The focus is in the field or its «Очистить». */
    const fieldFocused = ref(false)
    /**
     * The field is over a list and in the cold offline; over a failure or a newcomer only while
     * something is typed in it or the focus is in it (owner's В-3 «а», В-4 «а»): erased to nothing
     * to type another word, it stays under the thumb with the keyboard, and goes once the person
     * left it — the focus is then where they put it.
     */
    const fieldShown = computed(
      () =>
        advice.phase.value === 'ready' ||
        advice.phase.value === 'offline' ||
        ((searching.value || fieldFocused.value) &&
          (advice.phase.value === 'error' || advice.phase.value === 'empty')),
    )
    // The one way left for a field to go with the focus in it — a city moved in another tab, the
    // skeleton in its place: the focus is given to the heading, never left on <body>. Only a focus
    // that was in the field (review № 8, adversarial Б1): on a phone nobody touched, <body> is where
    // it always is, and taking it to the heading pulled a screen reader to the top for nothing.
    watch(fieldShown, async (shown) => {
      if (shown) return
      const held = document.activeElement?.closest('.search-field') != null
      await nextTick()
      if (held && document.activeElement === document.body) focusScreenTitle()
    })
    const day = (when: Date) => purchaseDay(when, locale.value)
    const time = (when: Date) => timeOfDay(when, locale.value)
    const cityGenitive = (city: string) =>
      i18n.te(`advice.cities_genitive.${city}`) ? t(`advice.cities_genitive.${city}`) : city

    /**
     * An answer on its way for longer than a moment: only then does the strip say so — a quick one
     * replaces what is shown in silence (MOL-201, В-1 «а»). Timed by what is waited for, not by
     * whether anything is: a refresh already late and then a city moved are two requests, and one
     * flag for both put «город сменился» up at once for one asked a moment ago (adversarial А2).
     */
    const late = ref(false)
    let lateTimer: ReturnType<typeof setTimeout> | undefined
    watch(
      () => {
        if (advice.stale.value === 'loading') {
          return `list ${String(advice.fetchedAt.value?.getTime())}`
        }
        const city = advice.cityReloading.value
        return city === null ? '' : `city ${city}`
      },
      (waiting) => {
        clearTimeout(lateTimer)
        late.value = false
        if (waiting) {
          lateTimer = setTimeout(() => {
            late.value = true
          }, STRIP_LATE_MS)
        }
      },
      { immediate: true },
    )
    onUnmounted(() => {
      clearTimeout(lateTimer)
    })

    /**
     * What the strip says, by what became of the request behind the list on the screen. The rows
     * come from the phone, and the strip says how old they are — while the request is late as well,
     * not only once it has failed (А4); an empty list from memory is dated too (С-4). Not while
     * something is typed: the list is out of sight, and the search dates what it searched itself.
     */
    const strip = computed<{ kind: StripKind; text: string } | null>(() => {
      const at = advice.fetchedAt.value
      const stale = advice.stale.value
      if (stale && at && !searching.value) {
        const when = { day: day(at), time: time(at) }
        // Only the server breaking leaves nothing that would fire again by itself: the one with «Повторить».
        if (stale === 'error') return { kind: 'unanswered', text: t('advice.stale_error', when) }
        if (stale === 'offline') {
          const other = advice.otherCity.value
          const text = other
            ? t('advice.stale_other_city', {
                ...when,
                oldCity: cityGenitive(other.oldCity),
                city: cityGenitive(other.city),
              })
            : t('advice.stale', when)
          return { kind: 'offline', text }
        }
        return late.value ? { kind: 'refreshing', text: t('advice.stale_loading', when) } : null
      }
      const city = advice.cityReloading.value
      return city && late.value
        ? { kind: 'refreshing', text: t('advice.city_reloading', { city: cityGenitive(city) }) }
        : null
    })
    /** The row whose verdict is being amended, as the last answer described it. */
    const editing = ref<{
      itemId: string
      name: string
      mine: boolean
      shared: boolean
      score: Score | null
      review: string | null
    } | null>(null)

    /**
     * A row found by the search carries the scope of the search's answer, which may not be the
     * list's — access opened or ran out between the two (review Р-13, adversarial Е): read by the
     * list's, an average of three was offered pre-chosen as one's own score.
     */
    function edit(row: AdviceRow, answered?: AdviceScope): void {
      const scope = answered ?? advice.scope.value ?? 'own'
      editing.value = {
        itemId: row.itemId,
        name: row.name,
        // Whether there is a verdict of this person's to amend at all (А2). In the shared mode
        // a row may be entirely other people's, and nothing else in it says so.
        mine: row.isMine,
        shared: scope === 'shared',
        score: ownScore(row.rating, scope),
        review: row.review,
      }
    }

    /**
     * «Оценить» on an item nobody has rated in sight — found by the search, with no row of its own.
     * Without a place, as a verdict from «Оценки» is (MOL-27).
     */
    function rate(item: AdviceFound, answered: AdviceScope): void {
      editing.value = {
        itemId: item.itemId,
        name: item.name,
        mine: false,
        shared: answered === 'shared',
        score: null,
        review: null,
      }
    }

    return {
      t,
      query,
      strip,
      fieldShown,
      fieldFocused,
      searching,
      entering,
      country,
      refreshes,
      remembered: advice.answer,
      phase: advice.phase,
      scope: advice.scope,
      groups: advice.groups,
      shown: advice.shown,
      total: advice.total,
      fetchedAt: advice.fetchedAt,
      attempt: advice.attempt,
      editing,
      edit,
      rate,
      saved: () => {
        void advice.retry()
        refreshes.value += 1
      },
      putAway: () => {
        editing.value = null
      },
      retry: () => void advice.retry(),
    }
  },
})
</script>

<style scoped lang="scss">
.status {
  margin-bottom: var(--space-6);
}

/* `.head` of `AdviceSearch`, still: its gap and its margin, which move together (review № 9). */
.ghost-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
}

/* An empty line of the subtitle: an atomic inline keeps the line box, and the strut its height. */
.subtitle-hold {
  display: inline-block;
  width: 46%;
  height: var(--skeleton-sub);
  vertical-align: middle;
  visibility: hidden;
}

.subtitle-bar {
  @include skeleton-bar;

  display: inline-block;
  visibility: visible;
}

.tail {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-style: italic;
}

.foot {
  margin: var(--space-4) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}
</style>
