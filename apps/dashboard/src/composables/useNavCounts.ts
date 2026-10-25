import { ref, type InjectionKey, type Ref } from 'vue';
import type { ApiClient } from '../api/client.js';
import { required } from '../injection.js';

export interface NavCounts {
  readonly monitorCount: Readonly<Ref<number | null>>;
  readonly openIncidentCount: Readonly<Ref<number | null>>;
  readonly webhookCount: Readonly<Ref<number | null>>;
  refresh: () => Promise<void>;
}

export const navCountsKey: InjectionKey<NavCounts> = Symbol('navCounts');

// The totals shown beside the sidebar sections. Pages call refresh after an action that changes them.
export function createNavCounts(client: ApiClient): NavCounts {
  const monitorCount = ref<number | null>(null);
  const openIncidentCount = ref<number | null>(null);
  const webhookCount = ref<number | null>(null);

  async function refresh(): Promise<void> {
    try {
      const [health, incidents, webhooks] = await Promise.all([client.getHealthCounts(), client.getIncidentCounts(), client.listWebhookEndpoints({ limit: 1 })]);
      monitorCount.value = health.total;
      openIncidentCount.value = incidents.open;
      webhookCount.value = webhooks.total;
    } catch {
      // The badges are a convenience and the page in view reports its own failures, so unreadable counts are hidden instead of shown stale.
      monitorCount.value = null;
      openIncidentCount.value = null;
      webhookCount.value = null;
    }
  }

  return { monitorCount, openIncidentCount, webhookCount, refresh };
}

export const useNavCounts = (): NavCounts => required(navCountsKey, 'the navigation counts');
