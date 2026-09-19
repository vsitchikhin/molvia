import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw, RouterScrollBehavior } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import ItemSearchView from '@/views/ItemSearchView.vue'
import TripView from '@/views/TripView.vue'
import VerdictsView from '@/views/VerdictsView.vue'
import { watchBrowserAnimatedBack } from '@/transitions'

/** The three sections of the tab bar. «trip» is home: the main scenario of the product. */
export type Tab = 'trip' | 'advice' | 'verdicts'

export type RouteName = 'trip' | 'advice' | 'verdicts' | 'item-search'

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

// Not lazy: four small screens, and a chunk per route would turn the first tap on a tab into
// a network request exactly where the connection drops.
export const routes = [
  { path: '/', name: 'trip', component: TripView, meta: { titleKey: 'trip.title', tab: 'trip' } },
  {
    path: '/advice',
    name: 'advice',
    component: HomeView,
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
  { path: '/:rest(.*)', redirect: '/' },
] satisfies (RouteRecordRaw & { name?: RouteName })[]

// Before the web history exists, so the browser's own back animation is known in time — see
// `watchBrowserAnimatedBack`.
watchBrowserAnimatedBack()

/**
 * Back and forward return to where the person was; any other move starts at the top. The
 * sections keep no scroll of their own — their state lives in stores, not in components.
 *
 * A move to the very address the screen is on leaves the page where it is. The router runs one
 * on every `popstate`, and a sheet closed by «back» is exactly that: the entry it laid is gone,
 * the address never changed, and no position was ever saved for an entry the router did not
 * write — so the list jumped to the top under a sheet that was only dismissed (MOL-18).
 */
export const scrollBehavior: RouterScrollBehavior = (to, from, saved) =>
  to.fullPath === from.fullPath ? false : (saved ?? { top: 0 })

export const router = createRouter({ history: createWebHistory(), routes, scrollBehavior })
