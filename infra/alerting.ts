import * as gcp from '@pulumi/gcp';
import { WORKER_SERVICE } from './service-urls';

const METRIC_NAME = 'probe-retries-exhausted';
const ALERT_WINDOW = '300s';

// Matches the structured log line the worker writes on a probe's last attempt (apps/worker/src/routes/probe.ts).
const RETRIES_EXHAUSTED_FILTER = [
  'resource.type="cloud_run_revision"',
  `resource.labels.service_name="${WORKER_SERVICE}"`,
  'jsonPayload.event="probe.retries_exhausted"',
].join(' AND ');

export function createRetriesExhaustedAlert(alertEmail: string): gcp.monitoring.AlertPolicy {
  const metric = new gcp.logging.Metric(METRIC_NAME, {
    name: METRIC_NAME,
    description: 'Probes that failed their last attempt and will not be retried',
    filter: RETRIES_EXHAUSTED_FILTER,
    metricDescriptor: { metricKind: 'DELTA', valueType: 'INT64' },
  });

  const emailChannel = new gcp.monitoring.NotificationChannel('keelson-alerts-email', {
    displayName: 'Keelson alerts',
    type: 'email',
    labels: { email_address: alertEmail },
  });

  return new gcp.monitoring.AlertPolicy('probe-retries-exhausted', {
    displayName: 'Keelson probe retries exhausted',
    combiner: 'OR',
    conditions: [
      {
        displayName: 'A probe used all of its attempts',
        conditionThreshold: {
          filter: metric.name.apply((name) => `metric.type="logging.googleapis.com/user/${name}" AND resource.type="cloud_run_revision"`),
          comparison: 'COMPARISON_GT',
          thresholdValue: 0,
          duration: '0s',
          aggregations: [{ alignmentPeriod: ALERT_WINDOW, perSeriesAligner: 'ALIGN_SUM' }],
        },
      },
    ],
    notificationChannels: [emailChannel.name],
  });
}
