import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import IncidentsPage from './pages/IncidentsPage.vue';
import MonitorPage from './pages/MonitorPage.vue';
import MonitorsPage from './pages/MonitorsPage.vue';
import OverviewPage from './pages/OverviewPage.vue';
import WebhooksPage from './pages/WebhooksPage.vue';

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: '/', name: 'overview', component: OverviewPage },
      { path: '/monitors', name: 'monitors', component: MonitorsPage },
      { path: '/monitors/:id', name: 'monitor', component: MonitorPage, props: true },
      { path: '/incidents', name: 'incidents', component: IncidentsPage },
      { path: '/webhooks', name: 'webhooks', component: WebhooksPage },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  });
}
