<template>
  <AppScreen :title="t('advice.title')">
    <template v-if="phase === 'ready'" #subtitle>
      {{ scope === 'shared' ? t('advice.shared_data') : t('advice.own_data_only') }}
    </template>

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[40, 78, 62, 78]" />

    <!-- Without an identity there is nobody to advise; the notice above says why. -->
    <template v-else-if="phase !== 'idle'">
      <ScreenState
        v-if="phase === 'error'"
        kind="error"
        :title="t('advice.error.title')"
        :body="t('advice.error.body')"
        @retry="retry"
      />

      <!-- No button: nothing is remembered yet, and the screen loads by itself when the
           connection is back. -->
      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('advice.offline.title')"
        :body="t('advice.offline.body')"
      />

      <!-- The most important empty state of the product: the screen does not fill itself, and
           the words have to say «rate one → it shows up here», or the app looks broken. -->
      <ScreenState
        v-else-if="phase === 'empty'"
        kind="empty"
        tone="accent"
        :icon="IconStar"
        :title="t('advice.empty.title')"
        :body="t('advice.empty.body')"
      >
        <template #action>
          <AppButton block @click="goTab('verdicts')">{{ t('advice.empty.action') }}</AppButton>
        </template>
      </ScreenState>

      <template v-else>
        <!-- From memory: without a connection it refreshes by itself; with one, the server
             broke and nothing will fire again on its own — so the person gets the button. -->
        <div v-if="stale && fetchedAt" class="stale">
          <p class="stale-text">
            {{
              t(stale === 'offline' ? 'advice.stale' : 'advice.stale_error', {
                day: day(fetchedAt),
                time: time(fetchedAt),
              })
            }}
          </p>
          <AppButton v-if="stale === 'error'" variant="ghost" @click="retry">
            {{ t('state.retry') }}
          </AppButton>
        </div>

        <AdviceGroup v-if="groups.take.length > 0" level="take">
          <AdviceTakeCard v-for="row in groups.take" :key="row.itemId" :row="row" />
        </AdviceGroup>

        <AdviceGroup v-if="groups.if_cheap.length > 0" level="if_cheap">
          <AdviceCheapRow v-for="row in groups.if_cheap" :key="row.itemId" :row="row" />
        </AdviceGroup>

        <AdviceGroup v-if="groups.never.length > 0" level="never">
          <AdviceNeverRow v-for="row in groups.never" :key="row.itemId" :row="row" />
          <p class="tail">{{ t('advice.no_price_shown') }}</p>
        </AdviceGroup>

        <p v-if="total > shown" class="foot">{{ t('advice.truncated', { shown, total }) }}</p>
        <p v-if="scope === 'shared'" class="foot">{{ t('advice.shared_note') }}</p>
      </template>
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useI18n } from 'vue-i18n'
import IconStar from '~icons/mdi/star-outline'
import AdviceCheapRow from '@/components/AdviceCheapRow.vue'
import AdviceGroup from '@/components/AdviceGroup.vue'
import AdviceNeverRow from '@/components/AdviceNeverRow.vue'
import AdviceTakeCard from '@/components/AdviceTakeCard.vue'
import AppButton from '@/components/AppButton.vue'
import AppScreen from '@/components/AppScreen.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useAdvice } from '@/composables/useAdvice'
import { purchaseDay, timeOfDay } from '@/days'
import { useNavigation } from '@/navigation'

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
    AdviceNeverRow,
    AdviceTakeCard,
    AppButton,
    AppScreen,
    ScreenSkeleton,
    ScreenState,
  },
  setup() {
    const { t, locale } = useI18n()
    const { goTab } = useNavigation()
    const advice = useAdvice()

    return {
      t,
      IconStar,
      phase: advice.phase,
      scope: advice.scope,
      groups: advice.groups,
      shown: advice.shown,
      total: advice.total,
      stale: advice.stale,
      fetchedAt: advice.fetchedAt,
      retry: () => void advice.retry(),
      day: (when: Date) => purchaseDay(when, locale.value),
      time: (when: Date) => timeOfDay(when, locale.value),
      goTab,
    }
  },
})
</script>

<style scoped lang="scss">
.stale {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.stale-text {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.tail {
  margin: var(--space-2) 0 0;
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-style: italic;
}

.foot {
  margin: var(--space-4) 0 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  text-align: center;
}
</style>
