import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import SettingsView from '@/views/SettingsView.vue'
import AdviceView from '@/views/AdviceView.vue'
import ItemSearchView from '@/views/ItemSearchView.vue'
import TripHistoryView from '@/views/TripHistoryView.vue'
import FinishedTripView from '@/views/FinishedTripView.vue'
import TripView from '@/views/TripView.vue'
import ExchangeView from '@/views/ExchangeView.vue'
import VerdictsView from '@/views/VerdictsView.vue'
import { watchBrowserAnimatedBack } from '@/transitions'

/** The four sections of the tab bar. «trip» is home: the main scenario of the product. */
export type Tab = 'trip' | 'advice' | 'verdicts' | 'settings'

export type RouteName =
  | 'trip'
  | 'advice'
  | 'verdicts'
  | 'settings'
  | 'exchange'
  | 'item-search'
  | 'trip-history'
  | 'finished-trip'
  | 'finished-search'
  | 'kit'

declare module 'vue-router' {
  interface RouteMeta {
    /** The dictionary key of the screen's title: its heading, the back label, the tab title. */
    titleKey: string
    /** Set on a section; the tab bar is shown only there. */
    tab?: Tab
    /**
     * Set on a nested screen. The back chevron is labelled with the parent's title and leads
     * to it, so no screen has to know where it was opened from.
     */
    parent?: RouteName
  }
}

// Not lazy: nine small screens, and a chunk per route would turn the first tap on a tab into
// a network request exactly where the connection drops.
export const routes = [
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { titleKey: 'settings.title', tab: 'settings' },
  },
  {
    path: '/settings/exchange',
    name: 'exchange',
    component: ExchangeView,
    meta: { titleKey: 'exchange.title', parent: 'settings' },
  },
  { path: '/', name: 'trip', component: TripView, meta: { titleKey: 'trip.title', tab: 'trip' } },
  {
    path: '/advice',
    name: 'advice',
    component: AdviceView,
    meta: { titleKey: 'advice.title', tab: 'advice' },
  },
  {
    path: '/verdicts',
    name: 'verdicts',
    component: VerdictsView,
    meta: { titleKey: 'verdict.title', tab: 'verdicts' },
  },
  {
    path: '/trip/add',
    name: 'item-search',
    component: ItemSearchView,
    meta: { titleKey: 'item.search_title', parent: 'trip' },
  },
  {
    path: '/trip/history',
    name: 'trip-history',
    component: TripHistoryView,
    meta: { titleKey: 'trip.history.title', parent: 'trip' },
  },
  {
    path: '/trip/history/:tripId',
    name: 'finished-trip',
    component: FinishedTripView,
    meta: { titleKey: 'trip.history.finished_title', parent: 'trip-history' },
  },
  {
    path: '/trip/history/:tripId/add',
    name: 'finished-search',
    component: ItemSearchView,
    meta: { titleKey: 'item.search_title', parent: 'finished-trip' },
  },
  // Every piece of the kit in every state, and the sheet in a real history — for the eye in both
  // schemes and for the end-to-end tests, before any screen uses them (MOL-18). Development only:
  // in a production build the condition is false, the chunk is never emitted, and the path falls
  // through to the trip.
  ...(import.meta.env.DEV
    ? [
        {
          path: '/_kit',
          name: 'kit',
          component: () => import('@/views/KitView.vue'),
          meta: { titleKey: 'dev.kit.title', parent: 'trip' },
        } satisfies RouteRecordRaw & { name: RouteName },
      ]
    : []),
  { path: '/:rest(.*)', redirect: '/' },
] satisfies (RouteRecordRaw & { name?: RouteName })[]

// Before the web history exists, so the browser's own back animation is known in time — see
// `watchBrowserAnimatedBack`.
watchBrowserAnimatedBack()

export const router = createRouter({
  history: createWebHistory(),
  routes,
  // Back and forward return to where the person was; any other move starts at the top. The
  // sections keep no scroll of their own — their state lives in stores, not in components.
  //
  // A sheet closed by «back» is a move to the same address, and it lands where the list was:
  // the router's own `history.push` stores the position in the entry the sheet leaves, and
  // `saved` comes from there. That is why the sheet lays its entry through the router and never
  // with a bare `pushState` — which would leave nothing saved and drop the list to the top.
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
})
