import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { config } from "./config.ts";

// Ordered migrations. Never edit one that has shipped; append a new entry instead.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    sport TEXT,
    goal_m REAL,
    unit TEXT NOT NULL DEFAULT 'km' CHECK (unit IN ('km','mi')),
    photo_file TEXT,
    tracking_method TEXT NOT NULL DEFAULT 'manual' CHECK (tracking_method IN ('manual','strava','both')),
    strava_share_consent INTEGER NOT NULL DEFAULT 0,
    sports_configured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );

  -- source: 'manual' or a provider id such as 'strava'. external_id is the provider's
  -- activity id; the unique index is what makes repeated imports idempotent.
  CREATE TABLE activities (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    sport TEXT NOT NULL,
    source_sport_type TEXT,
    name TEXT,
    date TEXT NOT NULL,
    started_at TEXT,
    distance_m REAL NOT NULL CHECK (distance_m > 0),
    moving_time_s INTEGER,
    notes TEXT,
    not_duplicate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE UNIQUE INDEX activities_external ON activities(user_id, source, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX activities_user_date ON activities(user_id, date);

  CREATE TABLE races (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    target_m REAL NOT NULL CHECK (target_m > 0),
    unit TEXT NOT NULL DEFAULT 'km' CHECK (unit IN ('km','mi')),
    start_date TEXT NOT NULL,
    end_date TEXT,
    eligible_sports TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE race_participants (
    race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('invited','joined','declined')),
    invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (race_id, user_id)
  );

  -- One row per user per external provider. Tokens are AES-256-GCM encrypted.
  CREATE TABLE integration_connections (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    display_name TEXT,
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    expires_at INTEGER,
    scope TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','needs_reauth','error')),
    last_sync_at TEXT,
    last_error TEXT,
    sync_cursor INTEGER,
    rate_limited_until INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (user_id, provider),
    UNIQUE (provider, external_user_id)
  );

  CREATE TABLE oauth_states (
    state_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Which internal sport categories count toward races for imported activities.
  CREATE TABLE user_sport_selection (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    PRIMARY KEY (user_id, category)
  );

  -- Per-user overrides of the provider sport type -> internal category mapping.
  CREATE TABLE user_sport_mapping (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    source_type TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (user_id, provider, source_type)
  );

  CREATE TABLE sync_logs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL,
    imported INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX sync_logs_user ON sync_logs(user_id, id DESC);
  `,
  // v2: four race sports with fixed goals; races become percentage races.
  `
  UPDATE users SET sport = CASE sport
    WHEN 'trail_running' THEN 'running' WHEN 'mountain_biking' THEN 'cycling' WHEN 'paddling' THEN 'rowing' ELSE sport END;
  UPDATE users SET sport = NULL WHERE sport NOT IN ('cycling','running','rowing','swimming');

  UPDATE activities SET sport = 'running' WHERE sport = 'trail_running';
  UPDATE activities SET sport = 'cycling' WHERE sport = 'mountain_biking';
  UPDATE activities SET sport = 'rowing'
    WHERE sport = 'paddling' AND (source = 'manual' OR source_sport_type IN ('Rowing','VirtualRow'));
  UPDATE activities SET sport = 'other' WHERE sport NOT IN ('cycling','running','rowing','swimming');

  UPDATE user_sport_mapping SET category = CASE category
    WHEN 'trail_running' THEN 'running' WHEN 'mountain_biking' THEN 'cycling' WHEN 'paddling' THEN 'rowing' ELSE category END;
  UPDATE user_sport_mapping SET category = 'other' WHERE category NOT IN ('cycling','running','rowing','swimming');

  DROP TABLE user_sport_selection;
  ALTER TABLE users DROP COLUMN sports_configured;
  ALTER TABLE users DROP COLUMN goal_m;

  CREATE TABLE races_new (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO races_new (id, name, description, start_date, end_date, is_default, created_by, created_at)
    SELECT id, name, description, start_date, end_date, is_default, created_by, created_at FROM races;
  DROP TABLE races;
  ALTER TABLE races_new RENAME TO races;
  `,
];

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    const path = config.databasePath ?? `${config.dataDir}/snail-race.db`;
    if (path !== ":memory:") Deno.mkdirSync(config.dataDir, { recursive: true });
    db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    migrate(db);
  }
  return db;
}

/** Test helper: swap in a fresh in-memory database. */
export function useMemoryDb(): DatabaseSync {
  db?.close();
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync) {
  const { user_version } = d.prepare("PRAGMA user_version").get() as { user_version: number };
  if (user_version >= MIGRATIONS.length) return;
  // Table rebuilds must not cascade deletes, so foreign keys are off while migrating
  // and checked before each commit (SQLite's documented ALTER TABLE procedure).
  d.exec("PRAGMA foreign_keys = OFF");
  try {
    for (let v = user_version; v < MIGRATIONS.length; v++) {
      d.exec("BEGIN");
      try {
        d.exec(MIGRATIONS[v]);
        const broken = d.prepare("PRAGMA foreign_key_check").all();
        if (broken.length) throw new Error(`Migration ${v + 1} broke foreign keys: ${JSON.stringify(broken)}`);
        d.exec(`PRAGMA user_version = ${v + 1}`);
        d.exec("COMMIT");
      } catch (e) {
        d.exec("ROLLBACK");
        throw e;
      }
    }
  } finally {
    d.exec("PRAGMA foreign_keys = ON");
  }
}

type Params = SQLInputValue[];

export function one<T>(sql: string, ...params: Params): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: Params): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: Params) {
  return getDb().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
export const nowSec = () => Math.floor(Date.now() / 1000);
