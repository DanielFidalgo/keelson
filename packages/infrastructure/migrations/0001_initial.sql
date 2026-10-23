-- Initial Keelson schema. Why it looks the way it does:
--
-- * Snapshots are content-addressed: the primary key is the sha256 of the canonical catalog, so a
--   server that has not changed writes nothing and any number of probes share one row. Probes and
--   drifts refer to a snapshot by hash without a foreign key, because the probe row is written
--   before its snapshot in the same transaction and the hash is the identity either way.
-- * probes carries a unique (monitor_id, slot). A retried Cloud Task for the same time slot hits
--   the constraint and records nothing twice, so correctness never depends on exactly-once.
-- * incidents has a partial unique index on (monitor_id, kind) where state = 'open': the database,
--   not the application, guarantees at most one open incident per kind for a monitor, so two
--   concurrent probes cannot both open one.
-- * outbox holds one row per alert and endpoint, written in the same transaction as the incident
--   change that raised it. Delivery marks the row sent afterwards, which gives at-least-once alerts;
--   the unique idempotency_key lets receivers drop the duplicates.
-- * Everything that belongs to a monitor is deleted with it (on delete cascade).
-- * Beyond the indexes above, api_keys.key_hash is unique and indexed because every authenticated request
--   looks a key up by hash, and the foreign key columns (tenant_id, monitor_id, incident_id, endpoint_id)
--   are indexed so tenant listings and cascade deletes do not scan whole tables.

-- Up Migration

create table if not exists tenants (
  id   text primary key,
  name text not null
);

create table if not exists api_keys (
  id         text primary key,
  tenant_id  text        not null references tenants (id),
  key_hash   text        not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create unique index if not exists api_keys_key_hash_idx on api_keys (key_hash);

create table if not exists monitors (
  id                   text primary key,
  tenant_id            text        not null references tenants (id),
  name                 text        not null,
  url                  text        not null,
  transport            text        not null,
  auth_secret_ref      text,
  interval_seconds     integer     not null check (interval_seconds >= 300),
  next_probe_at        timestamptz not null,
  baseline_hash        text,
  consecutive_failures integer     not null default 0,
  status               text        not null,
  created_at           timestamptz not null
);

create index if not exists monitors_tenant_idx on monitors (tenant_id);
create index if not exists monitors_due_idx on monitors (next_probe_at) where status = 'active';

create table if not exists probes (
  id             text primary key,
  monitor_id     text        not null references monitors (id) on delete cascade,
  slot           integer     not null,
  started_at     timestamptz not null,
  latency_ms     integer     not null,
  outcome        text        not null,
  error_detail   text,
  server_name    text,
  server_version text,
  snapshot_hash  text,
  unique (monitor_id, slot)
);

create index if not exists probes_monitor_started_idx on probes (monitor_id, started_at desc);

create table if not exists snapshots (
  hash          text primary key,
  canonical     jsonb       not null,
  first_seen_at timestamptz not null
);

create table if not exists drifts (
  id           text primary key,
  monitor_id   text        not null references monitors (id) on delete cascade,
  from_hash    text        not null,
  to_hash      text        not null,
  changes      jsonb       not null,
  max_severity text        not null,
  detected_at  timestamptz not null
);

create index if not exists drifts_monitor_idx on drifts (monitor_id);

create table if not exists incidents (
  id              text primary key,
  monitor_id      text        not null references monitors (id) on delete cascade,
  kind            text        not null,
  state           text        not null,
  opened_at       timestamptz not null,
  resolved_at     timestamptz,
  resolution      text,
  acknowledged_at timestamptz,
  last_drift_id   text references drifts (id)
);

create index if not exists incidents_monitor_idx on incidents (monitor_id);
create unique index if not exists incidents_one_open_per_kind_idx on incidents (monitor_id, kind) where state = 'open';

create table if not exists webhook_endpoints (
  id                   text primary key,
  tenant_id            text        not null references tenants (id),
  url                  text        not null,
  format               text        not null check (format in ('standard', 'slack')),
  secret_ref           text,
  status               text        not null,
  consecutive_failures integer     not null default 0,
  created_at           timestamptz not null
);

create index if not exists webhook_endpoints_tenant_idx on webhook_endpoints (tenant_id);

create table if not exists outbox (
  id              text primary key,
  incident_id     text        not null references incidents (id) on delete cascade,
  endpoint_id     text        not null references webhook_endpoints (id) on delete cascade,
  payload         jsonb       not null,
  idempotency_key text        not null unique,
  attempts        integer     not null default 0,
  next_attempt_at timestamptz not null,
  sent_at         timestamptz
);

create index if not exists outbox_incident_idx on outbox (incident_id);
create index if not exists outbox_endpoint_idx on outbox (endpoint_id);
create index if not exists outbox_due_idx on outbox (next_attempt_at) where sent_at is null;

-- Down Migration

drop table if exists outbox;
drop table if exists webhook_endpoints;
drop table if exists incidents;
drop table if exists drifts;
drop table if exists snapshots;
drop table if exists probes;
drop table if exists monitors;
drop table if exists api_keys;
drop table if exists tenants;
