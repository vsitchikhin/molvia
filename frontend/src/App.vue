<template>
  <!-- The app's polite live region: states hand their words here rather than carry a role. -->
  <div class="announcer" role="status">
    <p v-for="announcement in announcements" :key="announcement.id">{{ announcement.text }}</p>
  </div>
  <!-- Всё приложение — за входом (MOL-56). Экран входа не маршрут: адрес всё это время тот,
       куда человек шёл, и после входа он там и оказывается. -->
  <!-- Кроме того, что читают до входа: «Данные и приватность» (MOL-58, `meta.public`). -->
  <LoginView v-if="closed && !route.meta.public" />
  <template v-else>
    <RouterView />
    <TabBar v-if="route.meta.tab" />
  </template>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import TabBar from '@/components/TabBar.vue'
import LoginView from '@/views/LoginView.vue'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { useLoginStore } from '@/stores/login'
import { useSignOutStore } from '@/stores/signOut'
import { useTripQueueStore } from '@/stores/tripQueue'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'

// No header of its own: no mockup carries the brand, every screen is titled by its section,
// and the frame around each screen is AppScreen's.
export default defineComponent({
  name: 'AppRoot',
  components: { LoginView, TabBar },
  setup() {
    const actor = useActorStore()
    const login = useLoginStore()

    // Whether the app is shown at all, or the login screen instead. The rule lives in the login
    // store, where it can be read and tested without mounting the app (MOL-56).
    const closed = computed(() => login.closed)

    // The app, not a screen, sends what waits on the phone, whichever screen is open when the
    // connection is back: purchases written at the shelf (MOL-24) and saved ratings (MOL-28).
    //
    // **Whether it may actually go out is each queue's own to decide**, and it is decided in
    // their `flush()`: only once the server has said who we are, because until then the app is
    // drawn from the drawer's name and a drawer says nothing about the cookie — that is how a
    // rating held back on a `401` went out into a stranger's account (adversarial Б1). Here is
    // only the occasion, and a gate here as well would be a second place that decides: it took
    // away the queue's own «the server is silent, try again later», because that timer is set by
    // `flush` and `flush` was never reached (adversarial Г1).
    const queue = useTripQueueStore()
    const drafts = useVerdictDraftsStore()
    const send = () => {
      void queue.flush()
      void drafts.flush()
    }
    onMounted(send)
    useReconnect(send)
    // Every settling of the identity is an occasion: «ready» is what the queue held on a `401`
    // has been waiting for (MOL-24, `HOLDS`), and «error» is what starts its doubling retry.
    watch(() => actor.state, send)
    // A «Выйти» whose answer was lost is settled by the server's next answer, on this launch or
    // the next (MOL-57, adversarial Б2) — the store listens from the start, whatever screen is open.
    useSignOutStore()

    return { closed, route: useRoute(), announcements: provideAnnouncer() }
  },
})
</script>

<style scoped lang="scss">
.announcer {
  @include visually-hidden;
}
</style>
