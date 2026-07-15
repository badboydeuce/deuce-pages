CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'subscriber',
  status TEXT NOT NULL DEFAULT 'active',
  wallet_balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pages_user_id ON user_pages(user_id);
CREATE INDEX IF NOT EXISTS idx_user_pages_package_id ON user_pages(package_id);
CREATE INDEX IF NOT EXISTS idx_page_results_user_page_id ON page_results(user_page_id);
CREATE INDEX IF NOT EXISTS idx_page_results_created_at ON page_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_events_user_page_id ON traffic_events(user_page_id);
CREATE INDEX IF NOT EXISTS idx_traffic_events_created_at ON traffic_events(created_at DESC);
