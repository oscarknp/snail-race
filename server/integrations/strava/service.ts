// Strava connection lifecycle: OAuth, token storage and refresh, incremental sync,
// webhook events and disconnection. Routes stay thin and call into this module.
import { config, stravaConfigured } from "../../config.ts";
import { all, nowIso, nowSec, one, run, tx } from "../../db.ts";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto.ts";
import { HttpError } from "../../lib/http.ts";
import type { ConnectionRow } from "../../lib/types.ts";
import {
  createStravaClient,
  type RateUsage,
  type StravaActivity,
  StravaAuthError,
  type StravaClient,
  StravaError,
  StravaRateLimitError,
} from "./client.ts";
import { resolveCategory, userMappingOverrides } from "./sportMap.ts";

export const PROVIDER = "strava";
const OVERLAP_SECONDS = 3 * 86400; // re-read recent days to catch late uploads
const MAX_PAGES_PER_SYNC = 20; // 2,000 activities; the rest continues on the next sync
const STATE_TTL_SECONDS = 600;

// Strava rate limits apply to the whole application, not per athlete, so this is global.
let appRateLimitedUntil = 0;
let lastUsage: RateUsage | null = null;

let client: StravaClient = createStravaClient({
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  onUsage: (u) => (lastUsage = u),
});

/** Test hook: replace the HTTP client. */
export function setStravaClient(c: StravaClient) {
  client = c;
  appRateLimitedUntil = 0;
  lastUsage = null;
}

export const redirectUri = () => `${config.appUrl}/api/integrations/strava/callback`;

export function getConnection(userId: number): ConnectionRow | undefined {
  return one<ConnectionRow>("SELECT * FROM integration_connections WHERE user_id = ? AND provider = ?", userId, PROVIDER);
}

function assertConfigured() {
  if (!stravaConfigured()) throw new HttpError(503, "Strava isn't set up on this server yet. Ask the site admin to add Strava API credentials.");
}

// ---------- OAuth ----------

export function beginConnect(userId: number): string {
  assertConfigured();
  const state = randomToken();
  run(
    "INSERT INTO oauth_states (state_hash, user_id, provider, expires_at) VALUES (?, ?, ?, ?)",
    sha256(state),
    userId,
    PROVIDER,
    nowSec() + STATE_TTL_SECONDS,
  );
  // The user agreed to share their Strava-derived totals with race participants before connecting.
  run("UPDATE users SET strava_share_consent = 1 WHERE id = ?", userId);
  return client.authorizeUrl(state, redirectUri());
}

export async function completeConnect(
  userId: number,
  q: { code?: string; state?: string; scope?: string; error?: string },
): Promise<void> {
  assertConfigured();
  // State must exist, belong to this logged-in user, be unexpired, and is single-use.
  const stateRow = q.state
    ? one<{ user_id: number; expires_at: number; provider: string }>(
      "SELECT user_id, expires_at, provider FROM oauth_states WHERE state_hash = ?",
      sha256(q.state),
    )
    : undefined;
  if (q.state) run("DELETE FROM oauth_states WHERE state_hash = ?", sha256(q.state));
  if (!stateRow || stateRow.user_id !== userId || stateRow.provider !== PROVIDER || stateRow.expires_at < nowSec()) {
    throw new HttpError(400, "The Strava connection request expired or didn't match. Please try again.");
  }
  if (q.error) throw new HttpError(400, "Strava connection was cancelled.");
  if (!q.code) throw new HttpError(400, "Strava didn't send an authorization code.");
  const granted = (q.scope ?? "").split(",");
  if (!granted.includes("activity:read") && !granted.includes("activity:read_all")) {
    throw new HttpError(400, "Snail Race needs permission to read your activities. Please tick “View data about your activities” on Strava.");
  }

  const tokens = await client.exchangeCode(q.code);
  const athleteId = String(tokens.athlete?.id ?? "");
  if (!athleteId) throw new HttpError(502, "Strava didn't return athlete details.");
  const other = one<{ user_id: number }>(
    "SELECT user_id FROM integration_connections WHERE provider = ? AND external_user_id = ? AND user_id != ?",
    PROVIDER,
    athleteId,
    userId,
  );
  if (other) {
    await client.revoke(tokens.access_token).catch(() => {});
    throw new HttpError(409, "That Strava account is already connected to another Snail Race racer.");
  }
  const name = [tokens.athlete?.firstname, tokens.athlete?.lastname].filter(Boolean).join(" ") || tokens.athlete?.username || null;

  tx(() => {
    run(
      `INSERT INTO integration_connections
         (user_id, provider, external_user_id, display_name, access_token_enc, refresh_token_enc, expires_at, scope, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT (user_id, provider) DO UPDATE SET
         external_user_id = excluded.external_user_id, display_name = excluded.display_name,
         access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
         expires_at = excluded.expires_at, scope = excluded.scope, status = 'active', last_error = NULL,
         sync_cursor = CASE WHEN integration_connections.external_user_id = excluded.external_user_id
                            THEN integration_connections.sync_cursor END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      userId,
      PROVIDER,
      athleteId,
      name,
      encryptSecret(tokens.access_token),
      encryptSecret(tokens.refresh_token),
      tokens.expires_at,
      q.scope ?? null,
    );
    run("UPDATE users SET tracking_method = 'both' WHERE id = ? AND tracking_method = 'manual'", userId);
  });
}

// ---------- Tokens ----------

const refreshing = new Map<number, Promise<string>>();

/** Returns a valid access token, refreshing (once, even under concurrency) when near expiry. */
export function accessTokenFor(conn: ConnectionRow): Promise<string> {
  if (!conn.access_token_enc || !conn.refresh_token_enc) {
    return Promise.reject(new StravaAuthError("Strava tokens are missing", 401));
  }
  if ((conn.expires_at ?? 0) - 300 > nowSec()) return Promise.resolve(decryptSecret(conn.access_token_enc));
  const pending = refreshing.get(conn.user_id);
  if (pending) return pending;
  const p = (async () => {
    const tokens = await client.refresh(decryptSecret(conn.refresh_token_enc!));
    // Strava may rotate the refresh token; the old one stops working immediately.
    run(
      `UPDATE integration_connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      encryptSecret(tokens.access_token),
      encryptSecret(tokens.refresh_token),
      tokens.expires_at,
      conn.id,
    );
    return tokens.access_token;
  })().finally(() => refreshing.delete(conn.user_id));
  refreshing.set(conn.user_id, p);
  return p;
}

// ---------- Import ----------

type UpsertResult = "imported" | "updated" | "unchanged" | "deleted" | "skipped";

export function upsertStravaActivity(userId: number, a: StravaActivity, overrides: Map<string, string>): UpsertResult {
  const externalId = String(a.id);
  const existing = one<{ id: number }>(
    "SELECT id FROM activities WHERE user_id = ? AND source = ? AND external_id = ?",
    userId,
    PROVIDER,
    externalId,
  );
  if (!(a.distance > 0)) {
    // Distance-less sessions (yoga, weights...) can't move a snail.
    if (existing) {
      run("DELETE FROM activities WHERE id = ?", existing.id);
      return "deleted";
    }
    return "skipped";
  }
  const type = a.sport_type || a.type || "Workout";
  const values = [
    resolveCategory(type, overrides),
    type,
    a.name?.slice(0, 200) ?? null,
    a.start_date_local.slice(0, 10),
    a.start_date,
    a.distance,
    a.moving_time ?? null,
  ];
  if (existing) {
    const r = run(
      `UPDATE activities SET sport = ?, source_sport_type = ?, name = ?, date = ?, started_at = ?, distance_m = ?, moving_time_s = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND (sport IS NOT ? OR source_sport_type IS NOT ? OR name IS NOT ? OR date IS NOT ?
         OR started_at IS NOT ? OR distance_m IS NOT ? OR moving_time_s IS NOT ?)`,
      ...values,
      existing.id,
      ...values,
    );
    return r.changes ? "updated" : "unchanged";
  }
  run(
    `INSERT INTO activities (user_id, source, external_id, sport, source_sport_type, name, date, started_at, distance_m, moving_time_s)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    PROVIDER,
    externalId,
    ...values,
  );
  return "imported";
}

export interface SyncResult {
  status: "ok" | "error" | "rate_limited" | "skipped";
  imported: number;
  updated: number;
  deleted: number;
  message: string;
}

function logSync(userId: number, trigger: string, startedAt: string, r: SyncResult) {
  run(
    `INSERT INTO sync_logs (user_id, provider, trigger, status, imported, updated, deleted, message, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    PROVIDER,
    trigger,
    r.status,
    r.imported,
    r.updated,
    r.deleted,
    r.message,
    startedAt,
    nowIso(),
  );
  // Keep the log bounded.
  run(
    `DELETE FROM sync_logs WHERE user_id = ? AND provider = ? AND id NOT IN
       (SELECT id FROM sync_logs WHERE user_id = ? AND provider = ? ORDER BY id DESC LIMIT 50)`,
    userId,
    PROVIDER,
    userId,
    PROVIDER,
  );
}

/** Record a failure on the connection in a way the user can act on. */
function recordFailure(conn: ConnectionRow, err: unknown): SyncResult {
  const base = { imported: 0, updated: 0, deleted: 0 };
  if (err instanceof StravaRateLimitError) {
    appRateLimitedUntil = Math.max(appRateLimitedUntil, err.retryAt);
    run("UPDATE integration_connections SET rate_limited_until = ? WHERE id = ?", err.retryAt, conn.id);
    return { ...base, status: "rate_limited", message: `Strava is busy. We'll try again after ${new Date(err.retryAt * 1000).toISOString()}.` };
  }
  if (err instanceof StravaAuthError) {
    run(
      "UPDATE integration_connections SET status = 'needs_reauth', last_error = ? WHERE id = ?",
      "Strava access was revoked or expired. Reconnect Strava to resume syncing.",
      conn.id,
    );
    return { ...base, status: "error", message: "Strava access was revoked or expired. Reconnect to resume." };
  }
  const message = err instanceof StravaError ? err.message : "Unexpected error while syncing with Strava";
  if (!(err instanceof StravaError)) console.error("[strava] sync error", err instanceof Error ? err.message : err);
  run("UPDATE integration_connections SET last_error = ? WHERE id = ?", message, conn.id);
  return { ...base, status: "error", message };
}

const syncing = new Map<number, Promise<SyncResult>>();

/** Incremental import. Concurrent calls for the same user share one run. */
export function syncUser(userId: number, trigger: "manual" | "initial" | "scheduled"): Promise<SyncResult> {
  const pending = syncing.get(userId);
  if (pending) return pending;
  const p = doSync(userId, trigger).finally(() => syncing.delete(userId));
  syncing.set(userId, p);
  return p;
}

async function doSync(userId: number, trigger: string): Promise<SyncResult> {
  const conn = getConnection(userId);
  if (!conn) throw new HttpError(404, "Strava isn't connected");
  const startedAt = nowIso();
  const empty = { imported: 0, updated: 0, deleted: 0 };
  if (conn.status === "needs_reauth") {
    return { ...empty, status: "skipped", message: "Reconnect Strava to resume syncing." };
  }
  if (appRateLimitedUntil > nowSec()) {
    const r: SyncResult = { ...empty, status: "rate_limited", message: "Strava is busy right now. Syncing will resume automatically shortly." };
    logSync(userId, trigger, startedAt, r);
    return r;
  }

  const counts = { imported: 0, updated: 0, deleted: 0 };
  let cursor = conn.sync_cursor ?? 0;
  try {
    const token = await accessTokenFor(conn);
    const overrides = userMappingOverrides(userId);
    const after = conn.sync_cursor ? conn.sync_cursor - OVERLAP_SECONDS : nowSec() - config.strava.initialSyncDays * 86400;
    for (let page = 1; page <= MAX_PAGES_PER_SYNC; page++) {
      const batch = await client.listActivities(token, after, page, 100);
      tx(() => {
        for (const a of batch) {
          const result = upsertStravaActivity(userId, a, overrides);
          if (result === "imported" || result === "updated" || result === "deleted") counts[result]++;
          cursor = Math.max(cursor, Math.floor(Date.parse(a.start_date) / 1000));
        }
      });
      if (batch.length < 100) break;
    }
    run(
      `UPDATE integration_connections SET last_sync_at = ?, last_error = NULL, status = 'active', rate_limited_until = NULL,
         sync_cursor = ? WHERE id = ?`,
      nowIso(),
      cursor || nowSec(),
      conn.id,
    );
    const r: SyncResult = {
      ...counts,
      status: "ok",
      message: counts.imported + counts.updated + counts.deleted === 0
        ? "Up to date"
        : `${counts.imported} new, ${counts.updated} updated, ${counts.deleted} removed`,
    };
    logSync(userId, trigger, startedAt, r);
    return r;
  } catch (err) {
    // Keep whatever pages were imported before the failure.
    if (cursor) run("UPDATE integration_connections SET sync_cursor = ? WHERE id = ?", cursor, conn.id);
    const r = { ...recordFailure(conn, err), ...counts };
    logSync(userId, trigger, startedAt, r);
    return r;
  }
}

// ---------- Webhooks ----------

export interface StravaWebhookEvent {
  object_type: "activity" | "athlete";
  aspect_type: "create" | "update" | "delete";
  object_id: number;
  owner_id: number;
  subscription_id?: number;
  event_time?: number;
  updates?: Record<string, string>;
}

/**
 * Webhook payloads aren't signed, so they are only used as hints: we look up the
 * athlete, then fetch the activity from Strava ourselves before changing anything.
 */
export async function handleWebhookEvent(e: StravaWebhookEvent): Promise<void> {
  const conn = one<ConnectionRow>(
    "SELECT * FROM integration_connections WHERE provider = ? AND external_user_id = ?",
    PROVIDER,
    String(e.owner_id),
  );
  if (!conn) return;
  const startedAt = nowIso();

  if (e.object_type === "athlete") {
    if (e.updates?.authorized === "false") {
      // The athlete revoked access on Strava's side: stop using and remove their Strava data.
      removeConnection(conn.user_id, true);
      logSync(conn.user_id, "webhook", startedAt, {
        status: "ok", imported: 0, updated: 0, deleted: 0, message: "Strava access was revoked from Strava; imported data removed",
      });
    }
    return;
  }
  if (e.object_type !== "activity") return;

  const externalId = String(e.object_id);
  if (e.aspect_type === "delete") {
    const r = run("DELETE FROM activities WHERE user_id = ? AND source = ? AND external_id = ?", conn.user_id, PROVIDER, externalId);
    logSync(conn.user_id, "webhook", startedAt, {
      status: "ok", imported: 0, updated: 0, deleted: Number(r.changes), message: "Activity deleted on Strava",
    });
    return;
  }
  if (conn.status !== "active") return;
  if (appRateLimitedUntil > nowSec()) return; // the scheduled sync will catch up

  try {
    const token = await accessTokenFor(conn);
    let result: UpsertResult;
    try {
      const activity = await client.getActivity(token, externalId);
      result = upsertStravaActivity(conn.user_id, activity, userMappingOverrides(conn.user_id));
    } catch (err) {
      // Not visible to us any more (e.g. made private without read_all scope): drop the local copy.
      if (err instanceof StravaError && (err.status === 404 || err.status === 403)) {
        const r = run("DELETE FROM activities WHERE user_id = ? AND source = ? AND external_id = ?", conn.user_id, PROVIDER, externalId);
        result = r.changes ? "deleted" : "skipped";
      } else throw err;
    }
    const n = (k: UpsertResult) => (result === k ? 1 : 0);
    logSync(conn.user_id, "webhook", startedAt, {
      status: "ok",
      imported: n("imported"),
      updated: n("updated"),
      deleted: n("deleted"),
      message: `Activity ${e.aspect_type === "create" ? "added" : "changed"} on Strava`,
    });
    run("UPDATE integration_connections SET last_sync_at = ?, last_error = NULL WHERE id = ?", nowIso(), conn.id);
  } catch (err) {
    logSync(conn.user_id, "webhook", startedAt, recordFailure(conn, err));
  }
}

// ---------- Disconnect ----------

function removeConnection(userId: number, deleteImported: boolean) {
  tx(() => {
    run("DELETE FROM integration_connections WHERE user_id = ? AND provider = ?", userId, PROVIDER);
    if (deleteImported) {
      run("DELETE FROM activities WHERE user_id = ? AND source = ?", userId, PROVIDER);
      run("DELETE FROM user_sport_mapping WHERE user_id = ? AND provider = ?", userId, PROVIDER);
      run("UPDATE users SET tracking_method = 'manual', strava_share_consent = 0 WHERE id = ?", userId);
    }
  });
}

export async function disconnect(userId: number, deleteImported: boolean): Promise<void> {
  const conn = getConnection(userId);
  if (!conn) throw new HttpError(404, "Strava isn't connected");
  if (conn.access_token_enc && stravaConfigured()) {
    // Revoking one token revokes its counterpart. If Strava is unreachable we still
    // forget the tokens locally, which is the part that protects the user.
    await client.revoke(decryptSecret(conn.access_token_enc)).catch((e) =>
      console.warn("[strava] revoke failed:", e instanceof Error ? e.message : e)
    );
  }
  removeConnection(userId, deleteImported);
  logSync(userId, "manual", nowIso(), {
    status: "ok", imported: 0, updated: 0, deleted: 0,
    message: deleteImported ? "Disconnected; imported activities deleted" : "Disconnected; imported activities kept",
  });
}

// ---------- Scheduled fallback sync ----------

export async function syncAllDue(): Promise<void> {
  if (!stravaConfigured()) return;
  const cutoff = new Date(Date.now() - config.strava.syncIntervalMinutes * 60_000).toISOString();
  const due = all<{ user_id: number }>(
    `SELECT user_id FROM integration_connections WHERE provider = ? AND status = 'active'
     AND (last_sync_at IS NULL OR last_sync_at < ?) ORDER BY last_sync_at`,
    PROVIDER,
    cutoff,
  );
  for (const { user_id } of due) {
    // Leave headroom in the shared 15-minute window for webhooks and "Sync now".
    if (appRateLimitedUntil > nowSec()) break;
    if (lastUsage && lastUsage.shortUsage >= lastUsage.shortLimit * 0.7) break;
    await syncUser(user_id, "scheduled").catch(() => {});
  }
}

export function startStravaScheduler() {
  if (!stravaConfigured()) return;
  const every = Math.max(5, Math.min(config.strava.syncIntervalMinutes, 60)) * 60_000;
  setInterval(() => syncAllDue().catch((e) => console.error("[strava] scheduled sync failed", e)), every);
}

export function stravaStatusInfo() {
  return { rateLimitedUntil: appRateLimitedUntil > nowSec() ? appRateLimitedUntil : null };
}
