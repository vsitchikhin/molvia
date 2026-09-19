<template>
  <AppScreen :title="t('verdict.title')">
    <template v-if="phase === 'ready'" #subtitle>
      {{ t('verdict.pending_count', { n: count }, count) }}
    </template>

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[58, 90]">
      <div class="keys">
        <span v-for="n in 5" :key="n" class="key"></span>
      </div>
    </ScreenSkeleton>

    <!-- Without an identity there is no queue to ask for; the notice above says why. -->
    <template v-else-if="phase !== 'idle'">
      <!-- What happened to the last rating, above whatever comes next: the next card is the
           answer to «saved», the notice says where the rating is when it has not arrived. -->
      <ScreenState
        v-if="sending === 'offline'"
        class="notice"
        kind="offline"
        tone="good"
        :inline="!alone"
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
        @retry="send"
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

        <!-- From memory: without a connection it refreshes by itself; with one, the server broke
             and nothing will fire again on its own — so the person gets the button. -->
        <div v-if="stale && fetchedAt" class="stale">
          <p class="stale-text">
            {{
              t(stale === 'offline' ? 'verdict.stale' : 'verdict.stale_error', {
                when: day(fetchedAt),
              })
            }}
          </p>
          <AppButton v-if="stale === 'error'" variant="ghost" @click="retry">
            {{ t('state.retry') }}
          </AppButton>
        </div>

        <Transition name="card" mode="out-in">
          <VerdictCard
            :key="current.itemId"
            :card="current"
            :draft="drafts.drafts[current.itemId]"
            :focus-on-mount="moved"
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

      <!-- Empty is a success here, and the only green empty state in the app: nothing left
           to rate is an achievement. Not while the last rating is still on its way — it may yet
           come back, and «all rated» said before it arrives would be taken back. -->
      <ScreenState
        v-else-if="phase === 'empty' && drafts.waiting.length === 0"
        kind="empty"
        tone="good"
        :icon="IconCheck"
        :title="t('verdict.empty.title')"
        :body="t('verdict.empty.body')"
      >
        <template #action>
          <AppButton block @click="goTab('advice')">{{ t('verdict.empty.action') }}</AppButton>
        </template>
      </ScreenState>
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check-bold'
import AppButton from '@/components/AppButton.vue'
import AppScreen from '@/components/AppScreen.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
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
 * and moves on; the app sends it, and a notice above the next card says so only when it could
 * not: green without a connection, red when the server broke.
 */
export default defineComponent({
  name: 'VerdictsView',
  components: { AppButton, AppScreen, ScreenSkeleton, ScreenState, VerdictCard },
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
    // Refused and returned, but not the card on screen — the one the person has to be told about.
    const bounced = computed(() =>
      queue.returned.value.find((card) => card.itemId !== queue.current.value?.itemId),
    )
    // The notice is the whole screen only when nothing else is: the queue is empty.
    const alone = computed(() => queue.phase.value === 'empty')

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
      drafts,
      phase: queue.phase,
      current: queue.current,
      count: queue.count,
      stale: queue.stale,
      fetchedAt: queue.fetchedAt,
      retry: () => void queue.retry(),
      sending,
      alone,
      bounced,
      moved,
      save,
      skip,
      keep,
      send: () => void drafts.flush(),
      day: (when: Date) => purchaseDay(when, locale.value),
      goTab,
    }
  },
})
</script>

<style scoped lang="scss">
.keys {
  display: flex;
  gap: var(--space-2);
}

.key {
  flex: 1;
  height: var(--rating-key);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.notice {
  margin-bottom: var(--space-4);
}

.stale {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.sending {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.stale-text {
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
