<template>
  <AppScreen :title="t('verdict.title')">
    <!-- Said only over the queue (Д-2), and held by a bar while it loads: a queue is the common
         answer, and the line coming with it took the card 23 px down from under its skeleton. -->
    <template v-if="phase === 'ready' || phase === 'loading'" #subtitle>
      <template v-if="phase === 'ready'">
        {{ t('verdict.pending_count', { n: count }, count) }}
      </template>
      <span v-else class="subtitle-bar"></span>
    </template>

    <!-- The card's own shape (Ф-13): its caption, the question on two lines, the five keys, the
         field's label and the field — in a card, where the answer stands. -->
    <ScreenSkeleton v-if="phase === 'loading'">
      <AppCard class="ghost-card">
        <span class="ghost-line ghost-caption"
          ><span class="ghost-bar" :style="{ width: '30%' }"></span
        ></span>
        <span class="ghost-question">
          <span class="ghost-line ghost-title"
            ><span class="ghost-bar" :style="{ width: '52%' }"></span
          ></span>
          <span class="ghost-line ghost-title"
            ><span class="ghost-bar" :style="{ width: '34%' }"></span
          ></span>
        </span>
        <span class="keys">
          <span v-for="n in 5" :key="n" class="key"></span>
        </span>
        <!-- The line of the scale's ends, unseen: the handoff draws no bars there (7a). -->
        <span class="ghost-ends"></span>
        <span class="ghost-line ghost-label"
          ><span class="ghost-bar" :style="{ width: '58%' }"></span
        ></span>
        <span class="ghost-field"></span>
      </AppCard>
    </ScreenSkeleton>

    <!-- Without an identity there is no queue to ask for; the notice above says why. -->
    <template v-else-if="phase !== 'idle'">
      <!-- The connection in one line, over the card it is about (Ф-14, MOL-181): a rating kept on
           the phone, else a list from memory — one strip a screen, the rating's first (owner's В-2
           «а»): it is the news of the tap just made, and «без связи» says the list is not fresh. -->
      <StatusStrip
        v-if="strip"
        class="strip"
        :kind="strip.kind"
        :text="strip.text"
        :attempt="strip.kind === 'unanswered' ? attempt : 0"
      >
        <!-- One «Повторить» a screen: while «Оценка не ушла» stands with its own, that one does
             both — sends the rating and reads the list again (adversarial А3). -->
        <template v-if="sending !== 'failed'" #action>
          <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>

      <!-- With nothing left to rate, what happened to the last rating is the screen: green without
           a connection (owner's В-1 «а»), red when the server broke — its «Повторить» in the strip.
           Over a card, «не ушла» is the quiet card with its own ghost «Повторить» (Ф-15). -->
      <ScreenState
        v-if="sending === 'offline' && alone"
        kind="offline"
        tone="good"
        :title="t('verdict.offline.title')"
        :body="t('verdict.offline.body')"
      />
      <ScreenState
        v-else-if="sending === 'failed'"
        class="notice"
        kind="error"
        :inline="!alone"
        :title="t('verdict.error.title')"
        :body="t('verdict.error.body')"
        @retry="sendAgain"
      />

      <ScreenState
        v-if="phase === 'error'"
        kind="error"
        :title="t('verdict.load_error.title')"
        :body="t('verdict.load_error.body')"
        @retry="retry"
      />

      <!-- No button: the queue loads by itself when the connection is back. -->
      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('verdict.load_offline.title')"
        :body="t('verdict.load_offline.body')"
      />

      <template v-else-if="phase === 'ready' && current">
        <!-- A rating the server refused came back while another card is on screen: the card
             under the finger stays, so the person is told where the other went (owner's С-4). -->
        <ScreenState
          v-if="bounced"
          class="notice"
          kind="attention"
          inline
          :title="t('verdict.returned', { name: bounced.name })"
        />

        <Transition name="card" mode="out-in">
          <VerdictCard
            :key="current.itemId"
            :card="current"
            :draft="drafts.drafts[current.itemId]"
            :focus-on-mount="moved"
            :city="city"
            @save="save"
            @skip="skip"
            @change="keep"
          />
        </Transition>

        <p class="footnote">{{ t('verdict.footnote') }}</p>
      </template>

      <!-- The last rating on its way and nothing said yet: not a blank screen (owner's С-14). -->
      <p v-else-if="phase === 'empty' && !sending && drafts.waiting.length > 0" class="sending">
        {{ t('verdict.sending') }}
      </p>

      <!-- Empty says the truth of it (Ф-16, Е-5): nothing bought yet is not «all rated». Not while
           the last rating is still on its way — it may yet come back, and «all rated» said before
           it arrives would be taken back. -->
      <ScreenState
        v-else-if="settled && bought === false"
        kind="empty"
        :icon="IconStar"
        :title="t('verdict.none.title')"
        :body="t('verdict.none.body')"
      />
      <ScreenState
        v-else-if="settled"
        kind="empty"
        :icon="IconCheck"
        :title="t('verdict.empty.title')"
        :body="t('verdict.empty.body')"
      />
    </template>

    <!-- The one action of an empty queue stands in the strip, at one height on every screen
         (Ф-15, Ф-16), and comes with its state: under the skeleton there is none (MOL-269). -->
    <template v-if="settled" #docked>
      <AppButton v-if="bought === false" size="large" block @click="goTab('purchases')">
        {{ t('verdict.none.action') }}
      </AppButton>
      <AppButton v-else size="large" block @click="goTab('advice')">
        {{ t('verdict.empty.action') }}
      </AppButton>
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { cityWhereNameRepeats } from '@molvia/model'
import IconCheck from '~icons/mdi/check-bold'
import IconStar from '~icons/mdi/star-outline'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import type { StripKind } from '@/components/StatusStrip.vue'
import VerdictCard from '@/components/VerdictCard.vue'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import { purchaseDay } from '@/days'
import { useNavigation } from '@/navigation'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'
import type { Score } from '@/stores/verdictDrafts'
import { focusScreenTitle } from '@/transitions'

/**
 * «Оценки» (MOL-28): what was bought and not rated, one card at a time. Until the bot of 0.2
 * this is the only place a verdict is born.
 *
 * No price here and no stars on the trip: a verdict and an expense are separate streams. No
 * toast either — the next card is the confirmation. «Сохранить» keeps the rating on the phone
 * and moves on; the app sends it, and the screen says so only when it could not: the strip
 * without a connection, the quiet red card when the server broke (MOL-214, Ф-14, Ф-15).
 */
export default defineComponent({
  name: 'VerdictsView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    ScreenSkeleton,
    ScreenState,
    StatusStrip,
    VerdictCard,
  },
  setup() {
    const { t, locale } = useI18n()
    const { goTab } = useNavigation()
    const drafts = useVerdictDraftsStore()
    const queue = useVerdictQueue()
    /** Set once a card has been answered: the next one takes the focus, the first does not. */
    const moved = ref(false)

    // Only while something is actually waiting: a notice about a rating that has since gone
    // through would be a lie.
    const sending = computed(() => (drafts.waiting.length > 0 ? drafts.held : null))
    // By the whole queue, as the line «ждут оценки» decides it (MOL-120): a card alone cannot know
    // that another one names a shop of its name in another city.
    const city = computed(() => {
      const card = queue.current.value
      if (!card) return null
      const places = queue.cards.value.map(({ placeName, placeCity }) => ({
        name: placeName,
        city: placeCity,
      }))
      return cityWhereNameRepeats(places)({ name: card.placeName, city: card.placeCity })
    })
    // Refused and returned, but not the card on screen — the one the person has to be told about.
    const bounced = computed(() =>
      queue.returned.value.find((card) => card.itemId !== queue.current.value?.itemId),
    )
    // The notice is the whole screen only when nothing else is: the queue is empty.
    const alone = computed(() => queue.phase.value === 'empty')
    // The queue is empty and nothing of it is on its way: the truth of the empty state can be said.
    const settled = computed(() => queue.phase.value === 'empty' && drafts.waiting.length === 0)

    /** One strip a screen, only over a card: a rating kept on the phone first (owner's В-2 «а»). */
    const strip = computed<{ kind: StripKind; text: string } | null>(() => {
      if (queue.phase.value !== 'ready') return null
      if (sending.value === 'offline') return { kind: 'offline', text: t('verdict.offline.strip') }
      const when = queue.fetchedAt.value
      if (!queue.stale.value || !when) return null
      return queue.stale.value === 'offline'
        ? { kind: 'offline', text: t('verdict.stale', { when: day(when) }) }
        : { kind: 'unanswered', text: t('verdict.stale_error', { when: day(when) }) }
    })

    /** «Повторить» of «Оценка не ушла»: the rating, and the list, if it is from memory too (А3). */
    function sendAgain(): void {
      void drafts.flush()
      if (queue.stale.value === 'error') void queue.retry()
    }

    function day(when: Date): string {
      return purchaseDay(when, locale.value)
    }

    function afterMove(): void {
      moved.value = true
      void nextTick(() => {
        if (!queue.current.value) focusScreenTitle()
      })
    }

    // Each acts on the card on screen: the card is keyed by its item, so its events are its own.
    function save(score: Score, review: string): void {
      const card = queue.current.value
      if (!card) return
      queue.save(card, score, review)
      afterMove()
    }

    function skip(): void {
      const card = queue.current.value
      if (!card) return
      queue.skip(card)
      afterMove()
    }

    function keep(score: Score | null, review: string): void {
      const card = queue.current.value
      if (card) drafts.keep(card, score, review)
    }

    return {
      t,
      IconCheck,
      IconStar,
      drafts,
      phase: queue.phase,
      current: queue.current,
      city,
      count: queue.count,
      bought: queue.bought,
      attempt: queue.attempt,
      strip,
      retry: () => void queue.retry(),
      sending,
      alone,
      settled,
      bounced,
      moved,
      save,
      skip,
      keep,
      sendAgain,
      goTab,
    }
  },
})
</script>

<style scoped lang="scss">
/* An inline block keeps the subtitle's line box, and the strut its height. */
.subtitle-bar {
  @include skeleton-bar;

  display: inline-block;
  width: 46%;
  height: var(--skeleton-sub);
  vertical-align: middle;
}

/* The card's own shape, as `VerdictCard` stands (Ф-13). `ghost-*`, never `skeleton-*`: those are the
   roots of the kit's parts, and a scoped class of this screen would reach one put in the frame. */
.ghost-card {
  display: flex;
  flex-direction: column;
  padding: var(--space-6) var(--space-4);
}

.ghost-bar {
  @include skeleton-bar;

  height: var(--skeleton-line);
}

/* Each bar in a line of the words it stands for, so the bars are as tall as the card's lines. */
.ghost-line {
  display: flex;
  align-items: center;
}

.ghost-caption {
  height: calc(1em * var(--leading-body));
  font-size: var(--text-caption);

  .ghost-bar {
    height: var(--skeleton-caption);
  }
}

.ghost-question {
  margin: var(--space-2) 0 var(--space-6);
}

.ghost-title {
  height: calc(1em * var(--leading-snug));
  font-size: var(--text-title);
}

.keys {
  display: flex;
  gap: var(--space-2);
}

.key {
  @include skeleton-bar;

  flex: 1;
  height: var(--rating-key);
  border-radius: var(--radius);
}

/* As `RatingScale`'s `.ends`: 8 under the keys, a line of 13. */
.ghost-ends {
  height: calc(1em * var(--leading-body));
  margin-top: var(--space-2);
  font-size: var(--text-footnote);
}

.ghost-label {
  height: calc(1em * var(--leading-body));
  margin-top: var(--space-6);
  font-size: var(--text-footnote);
}

/* The review's three lines, as `rows="3"` draws them, with their padding and edge. */
.ghost-field {
  box-sizing: border-box;
  height: calc(3em * var(--leading-body) + 2 * var(--space-3) + 2 * var(--hairline));
  margin-top: var(--space-2);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-2);
  font-size: var(--text-body);
}

.strip,
.notice {
  margin-bottom: var(--space-4);
}

.sending {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.footnote {
  margin: var(--space-4) 0 0;
  padding: 0 var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}

.card-enter-active,
.card-leave-active {
  transition:
    opacity var(--dur) var(--ease-out),
    transform var(--dur) var(--ease-out);
}

.card-enter-from {
  opacity: 0;
  transform: translateX(var(--space-6));
}

.card-leave-to {
  opacity: 0;
  transform: translateX(calc(-1 * var(--space-6)));
}

@media (prefers-reduced-motion: reduce) {
  .card-enter-active,
  .card-leave-active {
    transition: none;
  }
}
</style>
