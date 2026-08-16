CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'subscriber',
  status TEXT NOT NULL DEFAULT 'active',
  wallet_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  collaboration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS collaboration JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registration_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_packages (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v0.1',
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT NOT NULL DEFAULT 'upload',
  repo_url TEXT,
  billing_periods JSONB NOT NULL DEFAULT '{}'::jsonb,
  screens JSONB NOT NULL DEFAULT '[]'::jsonb,
  assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  css_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  design_tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  package_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_preview_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_session_id TEXT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES page_packages(id) ON DELETE CASCADE,
  package_version TEXT NOT NULL,
  exchange_token_hash TEXT UNIQUE NOT NULL,
  preview_token_hash TEXT UNIQUE,
  ticket_expires_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_versions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES page_packages(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  screens JSONB NOT NULL DEFAULT '[]'::jsonb,
  assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  css_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS github_change_events (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES page_packages(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  branch TEXT NOT NULL,
  before_sha TEXT,
  after_sha TEXT,
  compare_url TEXT,
  author TEXT,
  event_type TEXT NOT NULL DEFAULT 'push',
  status TEXT NOT NULL DEFAULT 'received',
  changed_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  processed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(package_id, delivery_id)
);

CREATE TABLE IF NOT EXISTS user_pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES page_packages(id),
  package_version TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  subscription JSONB NOT NULL DEFAULT '{}'::jsonb,
  flow JSONB NOT NULL DEFAULT '[]'::jsonb,
  configs JSONB NOT NULL DEFAULT '{}'::jsonb,
  security_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  hosting_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_file JSONB NOT NULL DEFAULT '{}'::jsonb,
  ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_pages
ADD COLUMN IF NOT EXISTS ui_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_deposit_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  crypto_type TEXT NOT NULL,
  network TEXT NOT NULL,
  quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  tx_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  admin_note TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wallet_deposit_requests
ADD COLUMN IF NOT EXISTS quote JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_deposit_requests_tx_hash_idx
ON wallet_deposit_requests (lower(tx_hash));

CREATE TABLE IF NOT EXISTS page_results (
  id TEXT PRIMARY KEY,
  user_page_id TEXT REFERENCES user_pages(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  package_id TEXT REFERENCES page_packages(id) ON DELETE SET NULL,
  package_version TEXT,
  page_id TEXT,
  page_name TEXT,
  license_key TEXT,
  session_id TEXT,
  screen TEXT,
  flow JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  hostname TEXT,
  path TEXT,
  ip TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE page_results
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';

ALTER TABLE page_results
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE page_results
ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

CREATE TABLE IF NOT EXISTS result_attachments (
  id TEXT PRIMARY KEY,
  user_page_id TEXT NOT NULL REFERENCES user_pages(id) ON DELETE CASCADE,
  result_id TEXT REFERENCES page_results(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  screen_file TEXT,
  field_id TEXT NOT NULL,
  field_label TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'document',
  object_key TEXT UNIQUE NOT NULL,
  mime_type TEXT NOT NULL,
  expected_size BIGINT NOT NULL,
  size_bytes BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_page_id TEXT REFERENCES user_pages(id) ON DELETE CASCADE,
  result_id TEXT REFERENCES page_results(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'result.created',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(result_id, event_type)
);

CREATE TABLE IF NOT EXISTS telegram_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id TEXT UNIQUE NOT NULL,
  chat_id TEXT UNIQUE NOT NULL,
  username TEXT,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  last_delivery_at TIMESTAMPTZ,
  last_test_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_webhook_updates (
  update_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_page_id TEXT NOT NULL REFERENCES user_pages(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'telegram',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  error_code TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(notification_id, channel)
);

CREATE TABLE IF NOT EXISTS traffic_events (
  id TEXT PRIMARY KEY,
  user_page_id TEXT REFERENCES user_pages(id) ON DELETE CASCADE,
  page_id TEXT,
  session_id TEXT,
  event TEXT NOT NULL,
  screen TEXT,
  hostname TEXT,
  path TEXT,
  ip TEXT,
  result TEXT,
  reason TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_packages_status ON page_packages(status);
CREATE INDEX IF NOT EXISTS idx_github_change_events_package_created ON github_change_events(package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_change_events_package_status ON github_change_events(package_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_package_preview_exchange ON package_preview_sessions(exchange_token_hash);
CREATE INDEX IF NOT EXISTS idx_package_preview_token ON package_preview_sessions(preview_token_hash);
CREATE INDEX IF NOT EXISTS idx_package_preview_user_session ON package_preview_sessions(user_session_id);
CREATE INDEX IF NOT EXISTS idx_package_preview_expires ON package_preview_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_registration_invitations_email ON registration_invitations(lower(email));
CREATE INDEX IF NOT EXISTS idx_registration_invitations_token_hash ON registration_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_registration_invitations_created_at ON registration_invitations(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_invitations_one_pending_email
ON registration_invitations(lower(email)) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_pages_user_id ON user_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pages_package_id ON user_pages(package_id);
CREATE INDEX IF NOT EXISTS idx_page_results_user_page_id ON page_results(user_page_id);
CREATE INDEX IF NOT EXISTS idx_page_results_created_at ON page_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_results_user_page_created ON page_results(user_page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_results_user_page_session ON page_results(user_page_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_results_user_page_status ON page_results(user_page_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_result_attachments_result ON result_attachments(result_id, created_at);
CREATE INDEX IF NOT EXISTS idx_result_attachments_session ON result_attachments(user_page_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_result_attachments_pending ON result_attachments(status, expires_at) WHERE result_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_created ON notification_outbox(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_unread ON notification_outbox(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user ON telegram_link_tokens(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_hash ON telegram_link_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_due ON telegram_notification_deliveries(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_user_page ON telegram_notification_deliveries(user_page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_events_user_page_id ON traffic_events(user_page_id);
CREATE INDEX IF NOT EXISTS idx_traffic_events_created_at ON traffic_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_events_user_page_created ON traffic_events(user_page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_events_user_page_session ON traffic_events(user_page_id, session_id);

WITH ranked_heartbeats AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_page_id, session_id
      ORDER BY created_at DESC, id DESC
    ) AS heartbeat_rank
  FROM traffic_events
  WHERE event = 'heartbeat'
    AND session_id IS NOT NULL
    AND session_id <> ''
)
DELETE FROM traffic_events
WHERE id IN (SELECT id FROM ranked_heartbeats WHERE heartbeat_rank > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_traffic_events_session_heartbeat
ON traffic_events(user_page_id, session_id)
WHERE event = 'heartbeat'
  AND session_id IS NOT NULL
  AND session_id <> '';
