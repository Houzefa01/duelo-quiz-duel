-- Migration 002 — Phase 12 (NON destructive : que des ADD COLUMN / CREATE TABLE IF NOT EXISTS).
-- Thème + avatars (F-90..F-111)
ALTER TABLE users ADD COLUMN theme_pref TEXT DEFAULT 'system';
ALTER TABLE users ADD COLUMN avatar_kind TEXT DEFAULT 'preset';
ALTER TABLE users ADD COLUMN avatar_ref TEXT;
ALTER TABLE users ADD COLUMN upload_banned INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN reduced_motion INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS uploads(
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, kind TEXT NOT NULL,
  path TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_owner ON uploads(owner_id, created_at);

CREATE TABLE IF NOT EXISTS avatar_reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_user_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT 'inapproprie',
  handled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

-- Organisateurs (F-120..F-123)
CREATE TABLE IF NOT EXISTS organizer_profiles(
  user_id INTEGER PRIMARY KEY, max_active_tournaments INTEGER NOT NULL DEFAULT 3,
  max_players INTEGER NOT NULL DEFAULT 32, storage_quota_mb INTEGER NOT NULL DEFAULT 200,
  requires_approval INTEGER NOT NULL DEFAULT 1, terms_accepted_at INTEGER NULL,
  granted_by INTEGER NULL, granted_at INTEGER NULL, revoked_at INTEGER NULL
);

-- Tournois personnalisés (F-130..F-137)
ALTER TABLE tournaments ADD COLUMN organizer_id INTEGER;
ALTER TABLE tournaments ADD COLUMN description TEXT DEFAULT '';
ALTER TABLE tournaments ADD COLUMN cover_ref TEXT;
ALTER TABLE tournaments ADD COLUMN visibility TEXT DEFAULT 'public';
ALTER TABLE tournaments ADD COLUMN invite_code TEXT;
ALTER TABLE tournaments ADD COLUMN approval_status TEXT DEFAULT 'approved';
ALTER TABLE tournaments ADD COLUMN rejection_reason TEXT;
ALTER TABLE tournaments ADD COLUMN rules_json TEXT DEFAULT '{}';
ALTER TABLE tournaments ADD COLUMN manual_release INTEGER DEFAULT 0;
ALTER TABLE tournaments ADD COLUMN reward_release TEXT DEFAULT 'auto'; -- auto|manual (lots)
CREATE INDEX IF NOT EXISTS idx_tournaments_org ON tournaments(organizer_id, status);

-- Lots (F-140..F-155)
CREATE TABLE IF NOT EXISTS tournament_rewards(
  id INTEGER PRIMARY KEY AUTOINCREMENT, tournament_id INTEGER NOT NULL,
  rank_from INTEGER NOT NULL DEFAULT 1, rank_to INTEGER NOT NULL DEFAULT 1,
  scope TEXT NOT NULL DEFAULT 'rank', public_label TEXT NOT NULL,
  kind TEXT NOT NULL, instructions TEXT DEFAULT '', expires_at INTEGER NULL,
  payload_enc TEXT, nonce TEXT, file_upload_id INTEGER NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_codes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, reward_id INTEGER NOT NULL,
  code_enc TEXT NOT NULL, nonce TEXT NOT NULL,
  assigned_to INTEGER NULL, assigned_at INTEGER NULL
);
CREATE INDEX IF NOT EXISTS idx_codes_reward ON reward_codes(reward_id, assigned_to);
CREATE TABLE IF NOT EXISTS reward_claims(
  id INTEGER PRIMARY KEY AUTOINCREMENT, reward_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  code_id INTEGER NULL, status TEXT NOT NULL DEFAULT 'available',
  revealed_at INTEGER NULL, downloads_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_user ON reward_claims(user_id, status);
CREATE TABLE IF NOT EXISTS reward_reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, claim_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
  reason TEXT NOT NULL, handled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
