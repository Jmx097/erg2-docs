create table if not exists {{schema}}."pairing_sessions" (
  pairing_session_id text primary key,
  code_hash text not null unique,
  code_last4 text not null,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz null,
  failed_attempts integer not null default 0,
  created_by text not null,
  platform text not null,
  device_display_name_hint text null
);

create table if not exists {{schema}}."bootstrap_tokens" (
  token_hash text primary key,
  pairing_session_id text not null references {{schema}}."pairing_sessions"(pairing_session_id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz null
);

create table if not exists {{schema}}."paired_devices" (
  device_id text primary key,
  device_display_name text not null,
  platform text not null,
  client_type text not null,
  status text not null,
  created_at timestamptz not null,
  last_seen_at timestamptz null,
  last_ip text null,
  last_app_version text null,
  current_refresh_family_id text not null,
  revoked_at timestamptz null,
  revoke_reason text null
);

create table if not exists {{schema}}."refresh_token_families" (
  refresh_family_id text primary key,
  device_id text not null references {{schema}}."paired_devices"(device_id) on delete cascade,
  client_type text not null,
  status text not null,
  created_at timestamptz not null,
  compromised_at timestamptz null,
  revoke_reason text null
);

create table if not exists {{schema}}."refresh_tokens" (
  refresh_token_id text primary key,
  refresh_family_id text not null references {{schema}}."refresh_token_families"(refresh_family_id) on delete cascade,
  token_hash text not null unique,
  parent_refresh_token_id text null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  replaced_by_refresh_token_id text null,
  revoked_at timestamptz null
);

create table if not exists {{schema}}."websocket_tickets" (
  ticket_hash text primary key,
  ticket_id text not null unique,
  device_id text not null references {{schema}}."paired_devices"(device_id) on delete cascade,
  conversation_id text not null,
  access_expires_at timestamptz not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz null
);

create table if not exists {{schema}}."revocations" (
  revocation_id text primary key,
  subject_type text not null,
  subject_id text not null,
  reason text not null,
  created_at timestamptz not null,
  created_by text not null
);

create table if not exists {{schema}}."connection_events" (
  connection_event_id text primary key,
  device_id text not null,
  connection_id text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  ip text null,
  close_code integer null,
  details_json jsonb null
);

create table if not exists {{schema}}."prompt_results" (
  device_id text not null,
  prompt_id text not null,
  conversation_id text not null,
  request_id text not null,
  text text not null,
  created_at timestamptz not null,
  primary key (device_id, prompt_id)
);

create index if not exists prompt_results_created_at_idx on {{schema}}."prompt_results" (created_at);
create index if not exists refresh_tokens_family_idx on {{schema}}."refresh_tokens" (refresh_family_id);
create index if not exists websocket_tickets_device_idx on {{schema}}."websocket_tickets" (device_id);
