<template>
  <div class="login">
    <div class="head">
      <h1 class="title" tabindex="-1">{{ t('login.title') }}</h1>
    </div>

    <div class="content">
      <ScreenSkeleton v-if="phase === 'loading'" :groups="[70, 45]" />

      <ScreenState
        v-else-if="phase === 'offer'"
        kind="empty"
        tone="accent"
        :icon="IconSend"
        :title="t('login.offer.title')"
        :body="t('login.offer.body')"
      >
        <p v-if="insecure" class="hint">{{ t('dev.login_insecure') }}</p>
        <template #action>
          <AppButton block :busy="starting" @click="begin">{{ t('login.start') }}</AppButton>
          <AppButton v-if="seam" block variant="ghost" @click="devSignIn">
            {{ t('dev.login_seam') }}
          </AppButton>
        </template>
      </ScreenState>

      <ScreenState
        v-else-if="phase === 'waiting'"
        kind="empty"
        tone="accent"
        :icon="IconSend"
        :title="t('login.waiting.title')"
        :body="t('login.waiting.body')"
      >
        <template #action>
          <AppButton block :busy="starting" :inactive="starting" @click="again">
            {{ t('login.open') }}
          </AppButton>
          <AppButton block variant="ghost" @click="restart">{{ t('login.restart') }}</AppButton>
        </template>
      </ScreenState>

      <!-- Вошли — но чей это аккаунт, знает только человек. Пока он не сказал, дальше не
           пускаем: посторонний, которому утекла ссылка, подтверждает её своим Telegram, и
           браузер забирает сессию его аккаунта (MOL-55, раунд 3). -->
      <ScreenState
        v-else-if="phase === 'welcome'"
        kind="attention"
        :title="t('login.welcome.title')"
        :body="t('login.welcome.body')"
      >
        <AppCard v-if="account">
          <p class="account">{{ account.place }}</p>
          <p class="since">{{ t('login.welcome.created', { day: account.day }) }}</p>
        </AppCard>
        <template #action>
          <AppButton block @click="confirm">{{ t('login.confirm') }}</AppButton>
          <AppButton block variant="ghost" @click="refuse">{{ t('login.refuse') }}</AppButton>
        </template>
      </ScreenState>

      <ScreenState
        v-else-if="phase === 'unavailable'"
        kind="attention"
        :title="t('login.unavailable.title')"
        :body="t('login.unavailable.body')"
      >
        <template #action>
          <AppButton block :busy="starting" @click="begin">{{ t('login.start') }}</AppButton>
        </template>
      </ScreenState>

      <!-- Повторять нечего: бота в этой копии нет вовсе, и это свойство окружения. -->
      <ScreenState
        v-else-if="phase === 'disabled'"
        kind="attention"
        :title="t('login.disabled.title')"
        :body="t('login.disabled.body')"
      >
        <template v-if="seam" #action>
          <AppButton block variant="ghost" @click="devSignIn">
            {{ t('dev.login_seam') }}
          </AppButton>
        </template>
      </ScreenState>

      <!-- Кнопки «Повторить» нет: экран попробует сам, когда связь вернётся (MOL-19). -->
      <ScreenState
        v-else-if="phase === 'offline'"
        kind="offline"
        tone="warn"
        :title="t('login.offline.title')"
        :body="t('login.offline.body')"
      />

      <!-- Квота общая на всю базу, поэтому «слишком много» — не про этого человека, и слова
           у неё свои. Ключи написаны целиком: собранный из строки ключ не видят ни линтер,
           ни vue-tsc (MOL-16, О-12). -->
      <ScreenState
        v-else-if="phase === 'rate_limited'"
        kind="error"
        :title="t('login.rate_limited.title')"
        :body="t('login.rate_limited.body')"
        @retry="retry"
      />

      <ScreenState
        v-else
        kind="error"
        :title="t('login.error.title')"
        :body="t('login.error.body')"
        @retry="retry"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconSend from '~icons/mdi/send'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { useReconnect } from '@/composables/useReconnect'
import { purchaseDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import { POLL_INTERVAL_MS, useLoginStore } from '@/stores/login'

/**
 * The first screen a person without a session sees, and everything else is behind it (MOL-56).
 *
 * **It is not a route.** `App.vue` draws it instead of the router's view, so the address stays
 * whatever the person was going to — a link from the bot to `/advice` opens «Что брать» once
 * they are in, without this screen having to remember where they were headed, and without a
 * `/login` entry the rules of «back» (MOL-17) would then have to account for.
 *
 * The whole of the waiting is a poll, and the three moments it fires are the three ways a
 * person comes back from Telegram: the timer, the app returning into view — which on iOS is
 * the only event a frozen PWA gets — and the connection returning. A hidden tab polls nothing:
 * it is frozen anyway, and there is no background sync in a PWA.
 */
export default defineComponent({
  name: 'LoginView',
  components: { AppButton, AppCard, ScreenSkeleton, ScreenState },
  setup() {
    const { t, locale } = useI18n()
    const login = useLoginStore()
    const actor = useActorStore()

    const phase = computed(() => login.phase)
    // The seam is a button rather than something that happens by itself, and only here: Vite
    // folds the literal, so a production bundle carries neither the button nor the call.
    const seam = import.meta.env.DEV
    // Over plain http on the LAN the session cookie is `Secure` and the browser keeps nothing,
    // so the first poll answers «this link no longer works» with the reason invisible.
    const insecure = seam && !window.isSecureContext

    /** What the screen can say about the account it has just been handed. */
    const account = computed(() => {
      const view = actor.actor
      if (!view) return null
      return {
        place: `${view.city} · ${view.spendCurrency} → ${view.incomeCurrency}`,
        day: purchaseDay(view.createdAt, locale.value),
      }
    })

    let timer: number | undefined
    function tick(): void {
      // A hidden tab is frozen on iOS and useless everywhere else: the answer it would get
      // cannot be shown to anybody.
      if (document.visibilityState === 'visible') void login.poll()
    }
    watch(
      () => login.request !== null,
      (waiting) => {
        window.clearInterval(timer)
        timer = waiting ? window.setInterval(tick, POLL_INTERVAL_MS) : undefined
      },
      { immediate: true },
    )
    onBeforeUnmount(() => {
      window.clearInterval(timer)
    })

    // Coming back into view *is* the return from Telegram; `online` is the other way a waiting
    // screen learns that there is something to ask again.
    useReconnect(() => void login.reconnected())

    // The tab is named by the screen that is actually shown. `installArrival` names it by the
    // route, and behind this door the route is a screen nobody can see yet.
    const before = document.title
    onMounted(() => {
      document.title = `${t('login.title')} · ${t('app.name')}`
    })
    onBeforeUnmount(() => {
      document.title = before
    })

    return {
      t,
      phase,
      seam,
      insecure,
      account,
      IconSend,
      starting: computed(() => login.starting),
      begin: () => void login.begin(),
      again: () => {
        login.again()
      },
      restart: () => void login.restart(),
      confirm: () => {
        login.confirm()
      },
      refuse: () => void login.refuse(),
      retry: () => void login.retry(),
      devSignIn: () => void login.devSignIn(),
    }
  },
})
</script>

<style scoped lang="scss">
.login {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.head {
  padding: calc(var(--safe-top) + var(--space-8)) calc(var(--space-4) + var(--safe-right))
    var(--space-3) calc(var(--space-4) + var(--safe-left));
}

.title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-display);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.01em;

  &:focus {
    outline: none;
  }
}

.content {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: var(--space-4) calc(var(--space-4) + var(--safe-right))
    calc(var(--space-4) + var(--safe-bottom)) calc(var(--space-4) + var(--safe-left));
}

.account {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.since {
  margin: var(--space-1) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.hint {
  margin: var(--space-3) 0 0;
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}
</style>
