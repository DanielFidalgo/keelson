import { DomainValidationError, openIncident, resolveIncident } from '@keelson/domain';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../shared/errors.js';
import { AcknowledgeIncident } from './acknowledge-incident.js';
import { createHarness, MONITOR_ID, NOW, seedMonitor, TENANT_ID } from '../test-support.js';

const INCIDENT_ID = 'inc_1';

async function seedOpenIncident(harness: ReturnType<typeof createHarness>) {
  await seedMonitor(harness);
  const incident = openIncident({ id: INCIDENT_ID, monitorId: MONITOR_ID, kind: 'down', lastDriftId: null }, NOW);
  await harness.db.incidents.save(incident);
  return incident;
}

describe('AcknowledgeIncident', () => {
  it('stamps the acknowledgement time and keeps the incident open', async () => {
    const harness = createHarness();
    await seedOpenIncident(harness);

    const incident = await new AcknowledgeIncident(harness.deps).execute({ tenantId: TENANT_ID, incidentId: INCIDENT_ID });

    expect(incident).toMatchObject({ state: 'open', acknowledgedAt: NOW });
    expect(harness.db.incidents.records.get(INCIDENT_ID)).toEqual(incident);
  });

  it('treats another tenant\'s incident as missing', async () => {
    const harness = createHarness();
    await seedOpenIncident(harness);

    const attempt = new AcknowledgeIncident(harness.deps).execute({ tenantId: 'ten_other', incidentId: INCIDENT_ID });

    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
  });

  it('reports an unknown incident as missing', async () => {
    const harness = createHarness();
    const attempt = new AcknowledgeIncident(harness.deps).execute({ tenantId: TENANT_ID, incidentId: 'inc_unknown' });
    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to acknowledge a resolved incident', async () => {
    const harness = createHarness();
    const open = await seedOpenIncident(harness);
    await harness.db.incidents.save(resolveIncident(open, 'recovered', NOW));

    const attempt = new AcknowledgeIncident(harness.deps).execute({ tenantId: TENANT_ID, incidentId: INCIDENT_ID });

    await expect(attempt).rejects.toBeInstanceOf(DomainValidationError);
  });
});
